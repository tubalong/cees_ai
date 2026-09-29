import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AssistantTask,
  AssistantTaskEventType,
  AssistantTaskStepStatus,
  Prisma,
  VisibilityScope,
} from '@prisma/client';
import type {
  InvokeRequest,
  InvokeResponse,
  JsonSchemaResponseFormat,
} from '@cees/ai-service-client';
import { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../../database/prisma.service';
import {
  KnowledgeDocumentService,
  type KnowledgeSourceSaveActor,
} from '../../knowledge/knowledge-document.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { RequestTenantContext, TenantContext } from '../../tenant/tenant-context';
import {
  isTerminalTaskStatus,
  PublicTaskOutputArchive,
  PublicTaskOutputArchiveOption,
  PublicTaskOutputSuggestion,
  PublicTaskOutputsView,
  PublicTaskPlanStep,
  PublicTaskResourceRef,
  PublicTaskStatus,
  PublicTaskVisibilityScope,
} from './orchestration.types';
import { TaskEventService } from './task-event.service';

/** 归档建议的结构化输出约束名（JSON Schema 校验 + 失败重试一次，与决策器同一约定）。 */
const SUGGESTION_SCHEMA_NAME = 'archive_suggestion';
/** 单次建议的输出上限：至多每产出一条建议 + 一句理由。 */
const SUGGESTION_MAX_OUTPUT_TOKENS = 2048;
/** 单条建议理由截断上限（与契约 maxLength 一致）。 */
const MAX_SUGGESTION_REASON_CHARS = 500;
/** 单个产出最多下发的建议条数（与契约 maxItems 一致）。 */
const MAX_SUGGESTIONS_PER_OUTPUT = 5;
/** 无法判断时兜底理由（模型给出空理由时使用）。 */
const FALLBACK_SUGGESTION_REASON = '基于产出主题推荐';

const SUGGESTION_SYSTEM_PROMPT = [
  '你是企业知识库归档助手。用户在 AI 任务完成后要把产出的文档归档到知识库。',
  '根据任务目标与产出标题，为每个产出从候选知识库中选择最合适的归档目标（可给出多条、按推荐顺序），并给出一句中文理由。',
  '只能使用候选清单中的 knowledgeBaseId 和输入中的 documentId，不得编造；无法判断时可不给出该产出的建议。',
  '只输出结构化结果：suggestions（documentId、knowledgeBaseId、reason）。',
].join('');

const SUGGESTION_RESPONSE_SCHEMA: JsonSchemaResponseFormat['schema'] = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['documentId', 'knowledgeBaseId', 'reason'],
        properties: {
          documentId: { type: 'string' },
          knowledgeBaseId: { type: 'string' },
          reason: { type: 'string', maxLength: MAX_SUGGESTION_REASON_CHARS },
        },
      },
    },
  },
};

const VISIBILITY_SCOPES: readonly PublicTaskVisibilityScope[] = [
  'PRIVATE',
  'DEPARTMENT',
  'PROJECT',
  'TENANT',
];

/** 产出收集的中间态：去重与排序所需信息。 */
interface CollectedOutput {
  documentId: string;
  title: string;
  /** 产出步骤的计划内稳定标识（最近完成的一次）。 */
  stepKey: string;
  stepTitle: string | null;
  completedAt: Date | null;
}

/** 归档候选（含部门锚点，供规则路径匹配；对外仅暴露契约字段）。 */
interface ArchiveOptionWithAnchor extends PublicTaskOutputArchiveOption {
  departmentId: string | null;
}

/** output_confirmed 事件 payload（写入与解析共用）。 */
interface ArchivedOutputPayload {
  documentId: string;
  knowledgeBaseId: string;
  knowledgeDocumentId: string;
  visibilityScope: PublicTaskVisibilityScope;
}

export interface ConfirmOutputItemInput {
  documentId: string;
  knowledgeBaseId: string;
}

export interface ConfirmOutputsRequest {
  outputs: ConfirmOutputItemInput[];
}

/**
 * 产出验收与归档（技术设计 §2.4）：任务终态后，用户对任务产出的 AI 文档
 * 逐项确认内容并归档入知识库。不新增表：归档复用 knowledge 模块既有转存
 * 链路（sourceType=DOCUMENT 锚定来源，同源重复转存追加版本），确认事实以
 * output_confirmed 事件承载（payload：documentId / knowledgeBaseId /
 * knowledgeDocumentId / visibilityScope）。
 *
 * 归档目标解析 v1：发起人有部门且部门库在候选内 → 确定性默认（规则路径，
 * 不调模型）；无明确归属 → LLM 基于产出主题生成候选与理由（结构化约束，
 * 候选集=发起人 EDITOR 及以上权限的库，服务端硬过滤，失败降级为空建议）。
 * 任务尚无项目关联通道，「任务关联项目 → PROJECT 库」规则 v1 不可达。
 */
@Injectable()
export class TaskOutputsService {
  private readonly logger = new Logger(TaskOutputsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly taskEvents: TaskEventService,
    private readonly knowledge: KnowledgeService,
    private readonly knowledgeDocuments: KnowledgeDocumentService,
    private readonly gateway: AiServiceGateway,
  ) { }

  /** 产出验收视图：产出清单（含归档结果与建议）与可归档知识库候选。 */
  async getOutputsView(taskId: string): Promise<PublicTaskOutputsView> {
    const task = await this.requireOwnTask(taskId);
    const outputs = await this.collectOutputs(task);
    const archiveOptions = await this.loadArchiveOptions(task);
    const archived = await this.loadArchivedOutputs(task.id);
    const suggestions = await this.resolveSuggestions(task, outputs, archiveOptions, archived);
    return {
      taskId: task.id,
      status: task.status,
      outputs: outputs.map((output) => {
        const archive = archived.get(output.documentId) ?? null;
        return {
          documentId: output.documentId,
          title: output.title,
          stepKey: output.stepKey,
          stepTitle: output.stepTitle,
          confirmed: archive !== null,
          archive,
          suggestions: archive ? [] : suggestions.get(output.documentId) ?? [],
        };
      }),
      archiveOptions: archiveOptions.map(({ knowledgeBaseId, name, visibilityScope }) => ({
        knowledgeBaseId,
        name,
        visibilityScope,
      })),
    };
  }

  /**
   * 产出验收与归档确认：逐产出指定知识库，校验目标库 EDITOR+ 权限后触发
   * 既有转存链路，并写 output_confirmed 事件。幂等：重复提交已归档且位置
   * 一致的产出按当前状态返回；已归档到其他知识库的产出提交时 409。
   * 仅任务终态（COMPLETED / FAILED / CANCELLED）可提交。
   */
  async confirmOutputs(taskId: string, input: ConfirmOutputsRequest): Promise<PublicTaskOutputsView> {
    const task = await this.requireOwnTask(taskId);
    if (!isTerminalTaskStatus(task.status)) {
      throw new ConflictException({
        code: 'TASK_NOT_TERMINAL',
        message: '任务尚未进入终态，验收归档将在任务结束后开放',
      });
    }
    const outputs = await this.collectOutputs(task);
    const outputById = new Map(outputs.map((output) => [output.documentId, output]));
    const archived = await this.loadArchivedOutputs(task.id);

    // 预检：全部条目先校验通过再执行任何归档，避免部分成功后才发现非法项。
    const seenTargets = new Map<string, string>();
    for (const item of input.outputs) {
      if (!outputById.has(item.documentId)) {
        throw new BadRequestException({
          code: 'TASK_OUTPUT_NOT_FOUND',
          message: '产出不存在或不属于该任务',
        });
      }
      const priorTarget = seenTargets.get(item.documentId);
      if (priorTarget !== undefined && priorTarget !== item.knowledgeBaseId) {
        throw this.alreadyArchivedConflict();
      }
      seenTargets.set(item.documentId, item.knowledgeBaseId);
      const archive = archived.get(item.documentId);
      if (archive && archive.knowledgeBaseId !== item.knowledgeBaseId) {
        throw this.alreadyArchivedConflict();
      }
    }

    for (const item of input.outputs) {
      // 已归档且位置一致：幂等跳过；位置不一致已在预检拦截。
      if (archived.has(item.documentId)) continue;
      const output = outputById.get(item.documentId);
      if (!output) continue;
      const archive = await this.archiveOutput(task, output, item.knowledgeBaseId);
      archived.set(item.documentId, archive);
    }
    return this.getOutputsView(task.id);
  }

  /** 单条产出归档：权限校验 → 转存（同源重复转存追加版本）→ output_confirmed 事件。 */
  private async archiveOutput(
    task: AssistantTask,
    output: CollectedOutput,
    knowledgeBaseId: string,
  ): Promise<PublicTaskOutputArchive> {
    const context = this.tenantContext.require();
    // 归档是写入操作：门槛为 EDITOR 成员权限（manage_all 短路），无权库不会出现在候选内。
    const knowledgeBase = await this.knowledge.assertKnowledgeBaseMemberPermission({
      tenantId: context.tenantId,
      userId: context.userId,
      permissions: context.permissions,
      knowledgeBaseId,
      minimumPermission: 'EDITOR',
    });
    const saved = await this.knowledgeDocuments.saveFromSource(toSaveActor(context, task), {
      knowledgeBaseId,
      sourceType: 'DOCUMENT',
      sourceId: output.documentId,
      name: output.title,
      // 文档可见范围跟随归档库：公司库全员可检索、部门库本部门、项目库项目成员。
      visibilityScope: toArchiveScope(knowledgeBase.visibilityScope),
      departmentId: knowledgeBase.departmentId,
      projectId: knowledgeBase.projectId,
    });
    await this.recordOutputConfirmed(task, {
      documentId: output.documentId,
      knowledgeBaseId,
      knowledgeDocumentId: saved.id,
      visibilityScope: saved.visibilityScope,
    });
    return {
      knowledgeBaseId,
      knowledgeDocumentId: saved.id,
      visibilityScope: saved.visibilityScope,
      confirmedAt: new Date(),
    };
  }

  /**
   * 事件写入（任务行锁下）：锁内复查已有 output_confirmed 事件，避免并发
   * 重复归档事件；异库冲突 409。事件与后续视图读取构成同一事实源。
   */
  private async recordOutputConfirmed(
    task: AssistantTask,
    payload: ArchivedOutputPayload,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockTaskForUpdate(transaction, task.tenantId, task.id);
      const existing = await this.findArchivedEvent(transaction, task.id, payload.documentId);
      if (existing) {
        if (existing.knowledgeBaseId === payload.knowledgeBaseId) return;
        throw this.alreadyArchivedConflict();
      }
      await this.taskEvents.appendInTransaction(transaction, task.id, task.tenantId, {
        type: 'output_confirmed',
        documentId: payload.documentId,
        knowledgeBaseId: payload.knowledgeBaseId,
        knowledgeDocumentId: payload.knowledgeDocumentId,
        visibilityScope: payload.visibilityScope,
      });
    });
  }

  /** 锁内复查（含未提交并发）：该产出是否已有 output_confirmed 事件。 */
  private async findArchivedEvent(
    transaction: Prisma.TransactionClient,
    taskId: string,
    documentId: string,
  ): Promise<ArchivedOutputPayload | null> {
    const events = await transaction.assistantTaskEvent.findMany({
      where: { taskId, type: AssistantTaskEventType.OUTPUT_CONFIRMED },
      orderBy: { seq: 'asc' },
      select: { payload: true },
    });
    for (const event of events) {
      const parsed = parseArchivedPayload(event.payload);
      if (parsed?.documentId === documentId) return parsed;
    }
    return null;
  }

  /**
   * 产出收集：跨计划版本聚合 SUCCEEDED 步骤的 DOCUMENT 产出，按最近完成
   * 步骤去重（重排沿用或重复出现的产出保留最近一次）；已删除的 AI 文档
   * 不再进入验收清单。
   */
  private async collectOutputs(task: AssistantTask): Promise<CollectedOutput[]> {
    const steps = await this.prisma.assistantTaskStep.findMany({
      where: { taskId: task.id, status: AssistantTaskStepStatus.SUCCEEDED },
      orderBy: [{ completedAt: 'asc' }, { stepNo: 'asc' }],
      select: { stepKey: true, planVersion: true, outputRefs: true, completedAt: true },
    });
    if (steps.length === 0) return [];

    const latestByDocument = new Map<string, { stepKey: string; planVersion: number; completedAt: Date | null }>();
    for (const step of steps) {
      const refs = Array.isArray(step.outputRefs)
        ? (step.outputRefs as unknown as PublicTaskResourceRef[])
        : [];
      for (const ref of refs) {
        if (ref?.type !== 'DOCUMENT' || typeof ref.id !== 'string') continue;
        // 升序遍历：重复出现时删除重插，保证迭代顺序按最近完成时间升序。
        latestByDocument.delete(ref.id);
        latestByDocument.set(ref.id, {
          stepKey: step.stepKey,
          planVersion: step.planVersion,
          completedAt: step.completedAt,
        });
      }
    }

    const documentIds = [...latestByDocument.keys()];
    if (documentIds.length === 0) return [];
    const documents = await this.prisma.managedDocument.findMany({
      where: { id: { in: documentIds }, tenantId: task.tenantId, deletedAt: null },
      select: { id: true, title: true },
    });
    const titleById = new Map(documents.map((document) => [document.id, document.title]));
    const stepTitles = await this.loadStepTitles(task.id);
    return [...latestByDocument.entries()].flatMap(([documentId, last]) => {
      const title = titleById.get(documentId);
      if (title === undefined) return [];
      return [{
        documentId,
        title,
        stepKey: last.stepKey,
        stepTitle: stepTitles.get(`${last.planVersion}:${last.stepKey}`) ?? null,
        completedAt: last.completedAt,
      }];
    });
  }

  /**
   * 跨版本步骤标题索引：`${planVersion}:${stepKey}` → 计划快照中的简短名。
   * 步骤表不存标题，标题来自各版本计划快照（重排产生的版本各自保留归属）。
   */
  private async loadStepTitles(taskId: string): Promise<Map<string, string>> {
    const plans = await this.prisma.assistantTaskPlan.findMany({
      where: { taskId },
      select: { version: true, steps: true },
    });
    const titles = new Map<string, string>();
    for (const plan of plans) {
      if (!Array.isArray(plan.steps)) continue;
      for (const step of plan.steps as unknown as PublicTaskPlanStep[]) {
        if (typeof step?.stepKey !== 'string') continue;
        const title = typeof step.title === 'string' ? step.title.trim() : '';
        if (title) titles.set(`${plan.version}:${step.stepKey}`, title);
      }
    }
    return titles;
  }

  /** 已归档产出：从 output_confirmed 事件重建（payload 直接落库，读取时形状可信）。 */
  private async loadArchivedOutputs(taskId: string): Promise<Map<string, PublicTaskOutputArchive>> {
    const events = await this.prisma.assistantTaskEvent.findMany({
      where: { taskId, type: AssistantTaskEventType.OUTPUT_CONFIRMED },
      orderBy: { seq: 'asc' },
      select: { payload: true, createdAt: true },
    });
    const archived = new Map<string, PublicTaskOutputArchive>();
    for (const event of events) {
      const parsed = parseArchivedPayload(event.payload);
      if (!parsed) continue;
      archived.set(parsed.documentId, {
        knowledgeBaseId: parsed.knowledgeBaseId,
        knowledgeDocumentId: parsed.knowledgeDocumentId,
        visibilityScope: parsed.visibilityScope,
        confirmedAt: event.createdAt,
      });
    }
    return archived;
  }

  /**
   * 可归档知识库候选：manage_all 覆盖租户内全部库；否则当前成员具
   * EDITOR 及以上权限的库。服务端硬过滤：不出现无权库，也不出现锚点
   * 人群的虚拟 READER 库（其无法归档）。
   */
  private async loadArchiveOptions(task: AssistantTask): Promise<ArchiveOptionWithAnchor[]> {
    const context = this.tenantContext.require();
    const select = {
      id: true,
      name: true,
      visibilityScope: true,
      departmentId: true,
    } as const;
    const bases = context.permissions.includes('knowledge_base.manage_all')
      ? await this.prisma.knowledgeBase.findMany({
        where: { tenantId: task.tenantId, deletedAt: null },
        select,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      : await this.loadMemberEditableBases(task.tenantId, context.userId, select);
    return bases.map((base) => ({
      knowledgeBaseId: base.id,
      name: base.name,
      visibilityScope: toArchiveScope(base.visibilityScope),
      departmentId: base.departmentId,
    }));
  }

  private async loadMemberEditableBases(
    tenantId: string,
    userId: string,
    select: { id: true; name: true; visibilityScope: true; departmentId: true },
  ) {
    const members = await this.prisma.knowledgeBaseMember.findMany({
      where: {
        tenantId,
        userId,
        permission: { in: ['EDITOR', 'MANAGER'] },
      },
      select: { knowledgeBaseId: true },
    });
    if (members.length === 0) return [];
    return this.prisma.knowledgeBase.findMany({
      where: {
        tenantId,
        id: { in: members.map((member) => member.knowledgeBaseId) },
        deletedAt: null,
      },
      select,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * 归档建议（技术设计 §2.4 规则路径 + LLM 路径）：仅任务终态且存在
   * 未确认产出时生成；已确认产出恒为空建议（契约）。候选集为空时不给
   * 建议（提示创建库属于前端在候选之外的引导）。
   */
  private async resolveSuggestions(
    task: AssistantTask,
    outputs: CollectedOutput[],
    archiveOptions: ArchiveOptionWithAnchor[],
    archived: Map<string, PublicTaskOutputArchive>,
  ): Promise<Map<string, PublicTaskOutputSuggestion[]>> {
    const pending = outputs.filter((output) => !archived.has(output.documentId));
    if (pending.length === 0 || !isTerminalTaskStatus(task.status)) return new Map();
    if (archiveOptions.length === 0) return new Map();

    const byRule = await this.resolveRuleSuggestions(task, pending, archiveOptions);
    if (byRule) return byRule;
    return this.resolveLlmSuggestions(task, pending, archiveOptions);
  }

  /**
   * 规则路径：发起人有部门且该部门锚定的 DEPARTMENT 库在候选内 →
   * 确定性默认（不调模型）。无部门或部门尚无库时返回 null 交给 LLM 路径。
   */
  private async resolveRuleSuggestions(
    task: AssistantTask,
    pending: CollectedOutput[],
    archiveOptions: ArchiveOptionWithAnchor[],
  ): Promise<Map<string, PublicTaskOutputSuggestion[]> | null> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { id: task.membershipId },
      select: { departmentId: true },
    });
    if (!membership?.departmentId) return null;
    const departmentBases = archiveOptions.filter(
      (option) =>
        option.visibilityScope === 'DEPARTMENT'
        && option.departmentId === membership.departmentId,
    );
    if (departmentBases.length === 0) return null;
    const suggestions = new Map<string, PublicTaskOutputSuggestion[]>();
    for (const output of pending) {
      suggestions.set(output.documentId, departmentBases.slice(0, MAX_SUGGESTIONS_PER_OUTPUT).map((base) => ({
        knowledgeBaseId: base.knowledgeBaseId,
        reason: '按发起人部门归属推荐（部门成员可检索）',
      })));
    }
    return suggestions;
  }

  /** LLM 路径：无明确组织归属时基于产出主题生成推荐；失败降级为空建议。 */
  private async resolveLlmSuggestions(
    task: AssistantTask,
    pending: CollectedOutput[],
    archiveOptions: ArchiveOptionWithAnchor[],
  ): Promise<Map<string, PublicTaskOutputSuggestion[]>> {
    try {
      const response = await this.invokeSuggestion(task, pending, archiveOptions);
      return parseSuggestionOutput(
        response,
        new Set(pending.map((output) => output.documentId)),
        new Set(archiveOptions.map((option) => option.knowledgeBaseId)),
      );
    } catch (error) {
      this.logger.warn(`archive suggestion invocation failed: ${String(error)}`);
      return new Map();
    }
  }

  private async invokeSuggestion(
    task: AssistantTask,
    pending: CollectedOutput[],
    archiveOptions: ArchiveOptionWithAnchor[],
  ): Promise<InvokeResponse> {
    const context = this.tenantContext.require();
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const request: InvokeRequest = {
          request_id: `${context.requestId}:archive-suggestion:${attempt}`,
          tenant_id: task.tenantId,
          user_id: task.userId,
          role: 'archive_suggestion',
          temperature: 0,
          max_output_tokens: SUGGESTION_MAX_OUTPUT_TOKENS,
          messages: [
            { role: 'system', content: [{ type: 'text', text: SUGGESTION_SYSTEM_PROMPT }] },
            { role: 'user', content: [{ type: 'text', text: buildSuggestionUserContent(task, pending, archiveOptions) }] },
          ],
          response_format: {
            type: 'json_schema',
            name: SUGGESTION_SCHEMA_NAME,
            schema: SUGGESTION_RESPONSE_SCHEMA,
          },
        };
        return await this.gateway.invoke(request);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `archive suggestion invocation failed (attempt ${attempt + 1}): ${String(error)}`,
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`archive suggestion failed: ${String(lastError)}`);
  }

  /** 任务只属于发起成员：按 tenantId + membershipId 过滤，缺失即 404。 */
  private async requireOwnTask(taskId: string): Promise<AssistantTask> {
    const context = this.tenantContext.require();
    const task = await this.prisma.assistantTask.findFirst({
      where: { id: taskId, tenantId: context.tenantId, membershipId: context.membershipId },
    });
    if (!task) {
      throw new NotFoundException({
        code: 'TASK_NOT_FOUND',
        message: '任务不存在或不属于当前成员',
      });
    }
    return task;
  }

  private alreadyArchivedConflict(): ConflictException {
    return new ConflictException({
      code: 'TASK_OUTPUT_ALREADY_ARCHIVED',
      message: '该产出已归档到其他知识库',
    });
  }
}

/** 转存执行上下文：来自请求上下文，任务会话带入选避免工具侧校验缺口。 */
function toSaveActor(context: RequestTenantContext, task: AssistantTask): KnowledgeSourceSaveActor {
  return {
    tenantId: context.tenantId,
    userId: context.userId,
    membershipId: context.membershipId,
    permissions: context.permissions,
    requestId: context.requestId,
    conversationId: task.conversationId ?? undefined,
  };
}

/**
 * 知识库可见范围收窄到归档四档：Prisma 枚举含 CUSTOM（历史通用范围），
 * 知识库创建已校验四档；异常值按最保守的 PRIVATE 处理（不扩大可见面）。
 */
function toArchiveScope(value: VisibilityScope): PublicTaskVisibilityScope {
  return value === 'DEPARTMENT' || value === 'PROJECT' || value === 'TENANT'
    ? value
    : 'PRIVATE';
}

/**
 * 任务行锁：串行化同一任务的验收归档事件写入（仿会话锁模式），
 * 消除并发确认下的重复事件窗口。
 */
async function lockTaskForUpdate(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  taskId: string,
): Promise<void> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "assistant_tasks"
    WHERE "id" = CAST(${taskId} AS uuid)
      AND "tenant_id" = CAST(${tenantId} AS uuid)
    FOR UPDATE
  `);
}

/** 解析 output_confirmed 事件 payload；形状不符返回 null（防御性跳过）。 */
function parseArchivedPayload(payload: Prisma.JsonValue): ArchivedOutputPayload | null {
  if (!isRecord(payload)) return null;
  const { documentId, knowledgeBaseId, knowledgeDocumentId, visibilityScope } = payload;
  if (typeof documentId !== 'string' || typeof knowledgeBaseId !== 'string'
    || typeof knowledgeDocumentId !== 'string') {
    return null;
  }
  if (typeof visibilityScope !== 'string'
    || !(VISIBILITY_SCOPES as readonly string[]).includes(visibilityScope)) {
    return null;
  }
  return {
    documentId,
    knowledgeBaseId,
    knowledgeDocumentId,
    visibilityScope: visibilityScope as PublicTaskVisibilityScope,
  };
}

function buildSuggestionUserContent(
  task: AssistantTask,
  pending: CollectedOutput[],
  archiveOptions: ArchiveOptionWithAnchor[],
): string {
  const payload = {
    taskGoal: task.goal,
    outputs: pending.map((output) => ({
      documentId: output.documentId,
      title: output.title,
      stepKey: output.stepKey,
      stepTitle: output.stepTitle,
    })),
    knowledgeBases: archiveOptions.map((option) => ({
      knowledgeBaseId: option.knowledgeBaseId,
      name: option.name,
      visibilityScope: option.visibilityScope,
    })),
  };
  return `归档建议输入（JSON）：\n${JSON.stringify(payload)}`;
}

/** 解析建议输出并按候选集硬过滤：非法 documentId / knowledgeBaseId 直接丢弃。 */
function parseSuggestionOutput(
  response: InvokeResponse,
  pendingIds: ReadonlySet<string>,
  optionIds: ReadonlySet<string>,
): Map<string, PublicTaskOutputSuggestion[]> {
  const suggestions = new Map<string, PublicTaskOutputSuggestion[]>();
  if (response.output.type !== 'json') return suggestions;
  const value = response.output.value;
  if (!isRecord(value) || !Array.isArray(value.suggestions)) return suggestions;
  for (const item of value.suggestions) {
    if (!isRecord(item)) continue;
    const { documentId, knowledgeBaseId, reason } = item;
    if (typeof documentId !== 'string' || !pendingIds.has(documentId)) continue;
    if (typeof knowledgeBaseId !== 'string' || !optionIds.has(knowledgeBaseId)) continue;
    const list = suggestions.get(documentId) ?? [];
    if (list.length >= MAX_SUGGESTIONS_PER_OUTPUT) continue;
    if (list.some((entry) => entry.knowledgeBaseId === knowledgeBaseId)) continue;
    const text = typeof reason === 'string' ? reason.trim() : '';
    list.push({
      knowledgeBaseId,
      reason: truncate(text, MAX_SUGGESTION_REASON_CHARS) || FALLBACK_SUGGESTION_REASON,
    });
    suggestions.set(documentId, list);
  }
  return suggestions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
