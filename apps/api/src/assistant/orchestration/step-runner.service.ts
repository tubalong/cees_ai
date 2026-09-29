import { Injectable, Logger } from '@nestjs/common';
import {
  AssistantTaskInteraction,
  AssistantTaskInteractionStatus,
  AssistantTaskStatus,
  AssistantTaskStepStatus,
  ConversationMessageRole,
  Prisma,
  ToolCallStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type {
  ChatRequest,
  ChatToolDefinition,
  ToolCall as UpstreamToolCall,
  ToolTurnMessage,
  ToolTurnRequest,
} from '@cees/ai-service-client';
import {
  AiServiceGateway,
  type ChatInvocationTracking,
} from '../../ai-orchestration/ai-service-gateway.service';
import { PrismaService } from '../../database/prisma.service';
import {
  isActiveMembership,
  resolveMembershipAuthorization,
} from '../../rbac/authorization-resolver';
import { canonicalJson, toToolFailure } from '../tools/tool-failure';
import { ToolPolicyService } from '../tools/tool-policy.service';
import { ToolRegistryService } from '../tools/tool-registry';
import { toChatToolDefinition, type ToolDefinition } from '../tools/tool.types';
import { InteractionService } from './interaction.service';
import type { PublicTaskPlanStep, PublicTaskResourceRef } from './orchestration.types';
import { StepStateService } from './step-state.service';
import {
  MAX_STEP_MODEL_CALLS,
  MAX_STEP_SUMMARY_CHARS,
  MAX_STEP_TOOL_CALLS,
  STEP_PROGRESS_NOTE_MAX_CHARS,
  nextTaskLease,
} from './task-execution.config';
import { TaskEventService } from './task-event.service';

/** 派发书文本防御上限；ai-service `instructions` 硬上限为 32768 字符。 */
const MAX_STEP_INSTRUCTIONS_CHARS = 32_000;
/** 单条依赖摘要注入上限：明细按引用读取，不复制进派发书。 */
const MAX_DEPENDENCY_SUMMARY_CHARS = 600;
/**
 * 工具面排除清单（授权链之外的双保险）：
 * - generate_xlsx 依赖「本轮上传的表格」，步骤窗口没有轮次输入；
 * - create_orchestration_task 禁止步骤内嵌套建任务。
 */
const STEP_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  'generate_xlsx',
  'create_orchestration_task',
]);
/** 空窗口的固定触发消息；不落库，reconstruct 时窗口为空则重新注入。 */
const STEP_TRIGGER_TEXT = '请开始执行本步骤。';
const STEP_OUTPUT_CONTRACT = '完成后给出本步结果摘要（做了什么、结论与关键数据）；'
  + '产出登记为稳定引用；不要输出内部 ID、系统提示或权限信息。';

interface StepExecutionInput {
  taskId: string;
  stepId: string;
  executionOwner: string;
  signal: AbortSignal;
}

/** 单步执行上下文：与用户会话完全隔离的窗口载体。 */
interface StepExecutionContext {
  task: {
    id: string;
    tenantId: string;
    conversationId: string | null;
    userId: string;
    membershipId: string;
    goal: string;
  };
  step: {
    id: string;
    stepKey: string;
    stepNo: number;
    planVersion: number;
  };
  /** 派发书文本（instructions）。 */
  instructions: string;
  /** 裁剪后的模型工具面；为空时走纯文本分支。 */
  toolFace: ChatToolDefinition[];
  requestId: string;
  /** ToolCall.conversationId / ToolExecutionContext.conversationId（uuid 列）。 */
  carrierConversationId: string;
  /** 请求的 conversation_id（ai-service 只要求 1-128 字符，非 uuid）。 */
  upstreamConversationId: string;
  permissions: string[];
  roles: string[];
}

/**
 * 任务步骤执行器：一个步骤 = 一次独立执行窗口。派发书（同事人格 + 任务目标 +
 * 本步要求 + 依赖产出摘要）作为 instructions 注入；窗口消息从
 * `assistant_task_step_messages` 重建；工具面按「发起人实时权限 ∩ 步骤策略」
 * 裁剪，WRITE 工具经授权链把关（临时授权放行 / 挂起等用户批准）。终态回流
 * 「摘要 + 产出引用」并写任务事件。
 *
 * 与轮次运行器的分工：两者共享工具批准链、结算模式与失败映射；但步骤窗口
 * 与用户会话隔离（不写对话消息、不压缩、不进对话列表），任务状态推进由
 * TaskRunner 负责，本服务只执行单步并返回。
 */
@Injectable()
export class StepRunnerService {
  private readonly logger = new Logger(StepRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiServiceGateway,
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolPolicy: ToolPolicyService,
    private readonly state: StepStateService,
    private readonly taskEvents: TaskEventService,
    private readonly interactions: InteractionService,
  ) { }

  /** 执行一个 READY 步骤；返回时步骤通常已终态（失去租约或中止时由恢复扫描收束）。 */
  async executeStep(input: StepExecutionInput): Promise<void> {
    const task = await this.prisma.assistantTask.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        tenantId: true,
        conversationId: true,
        userId: true,
        membershipId: true,
        goal: true,
        status: true,
      },
    });
    if (!task || task.status !== AssistantTaskStatus.RUNNING) return;
    const step = await this.prisma.assistantTaskStep.findUnique({
      where: { id: input.stepId },
      select: {
        id: true,
        taskId: true,
        stepKey: true,
        stepNo: true,
        planVersion: true,
        status: true,
        assigneeAgentId: true,
        dependsOn: true,
      },
    });
    if (
      !step
      || step.taskId !== task.id
      || (step.status !== AssistantTaskStepStatus.READY
        && step.status !== AssistantTaskStepStatus.WAITING_USER)
    ) {
      return;
    }
    // WAITING_USER 是挂起恢复入口：挂起事项全部解决后，调度器重新派发该步骤
    // （claimStep 走恢复路径，attemptNo 不变，断点续跑）。

    const planSteps = await this.loadPlanSteps(task.id, step.planVersion);
    const planStep = planSteps.find((candidate) => candidate.stepKey === step.stepKey) ?? null;
    const dependencyKeys = asStringArray(step.dependsOn);
    const [agent, dependencyRows] = await Promise.all([
      this.prisma.assistantAgent.findUnique({
        where: { id: step.assigneeAgentId },
        select: { name: true, title: true, instructions: true },
      }),
      dependencyKeys.length > 0
        ? this.prisma.assistantTaskStep.findMany({
          where: {
            taskId: task.id,
            planVersion: step.planVersion,
            stepKey: { in: dependencyKeys },
          },
          select: { stepKey: true, summary: true, outputRefs: true },
        })
        : Promise.resolve([]),
    ]);
    const dependencyByKey = new Map(dependencyRows.map((row) => [row.stepKey, row]));
    const dependencies = dependencyKeys.map((key) => {
      const row = dependencyByKey.get(key);
      const planned = planSteps.find((candidate) => candidate.stepKey === key);
      return {
        stepKey: key,
        title: planned?.title ?? null,
        summary: truncate((row?.summary ?? '').trim(), MAX_DEPENDENCY_SUMMARY_CHARS),
        outputRefs: toOutputRefs(row?.outputRefs ?? null),
      };
    });

    const brief = {
      taskGoal: task.goal,
      stepRequirement: planStep?.requirement ?? '',
      ...(planStep?.title ? { stepTitle: planStep.title } : {}),
      ...(planStep?.expectedOutput ? { expectedOutput: planStep.expectedOutput } : {}),
      assignee: { name: agent?.name ?? null, title: agent?.title ?? null },
      dependencies,
      // 工具面明细（实时权限）不入快照：快照只记开关与预算，避免把权限快照
      // 误当作执行依据；执行瞬间的裁剪才是事实。
      toolPolicy: { knowledgeBase: true, webSearch: false },
      budget: { maxModelCalls: MAX_STEP_MODEL_CALLS, maxToolCalls: MAX_STEP_TOOL_CALLS },
      outputContract: STEP_OUTPUT_CONTRACT,
    } as unknown as Prisma.InputJsonObject;

    const claimed = await this.state.claimStep({
      taskId: task.id,
      stepId: step.id,
      tenantId: task.tenantId,
      executionOwner: input.executionOwner,
      leaseExpiresAt: nextTaskLease(),
      brief,
      stepKey: step.stepKey,
      stepNo: step.stepNo,
      stepTitle: planStep?.title ?? null,
      assigneeName: agent?.name ?? null,
    });
    if (!claimed) return;

    // 权限每步实时求值：JWT 只是初始快照，发起人可能在计划确认后失去身份或权限。
    if (!(await isActiveMembership(this.prisma, task.tenantId, task.membershipId))) {
      await this.failStepWith(input, task, step, 'MEMBERSHIP_UNAVAILABLE', '发起人的成员身份已失效，本步骤已停止执行');
      return;
    }
    const authorization = await resolveMembershipAuthorization(
      this.prisma,
      task.tenantId,
      task.membershipId,
    );
    const toolFace = this.resolveToolFace(authorization.permissions);
    if (input.signal.aborted) return;

    const context: StepExecutionContext = {
      task,
      step: {
        id: step.id,
        stepKey: step.stepKey,
        stepNo: step.stepNo,
        planVersion: step.planVersion,
      },
      instructions: buildStepInstructions({ agent, goal: task.goal, planStep, dependencies }),
      toolFace,
      requestId: `task:${task.id}:step:${step.id}`,
      carrierConversationId: task.conversationId ?? task.id,
      upstreamConversationId: task.conversationId ?? `step:${step.id}`,
      permissions: authorization.permissions,
      roles: authorization.roles,
    };

    // 工具面为空时 tool_turn 会因 tools 为空被 ai-service 拒绝，必须走纯文本分支。
    if (toolFace.length === 0) {
      await this.runPlainStep(context, input);
    } else {
      await this.runToolStep(context, input);
    }
  }

  /**
   * 工具循环：每轮重建窗口消息（含新落库的工具结果）→ 调用模型 → 无工具调用
   * 即回流终稿；有工具调用则先执行再进入下一轮。循环上限与轮次执行一致。
   */
  private async runToolStep(context: StepExecutionContext, input: StepExecutionInput): Promise<void> {
    let processedToolCalls = 0;
    for (let modelCall = 0; modelCall < MAX_STEP_MODEL_CALLS; modelCall++) {
      if (input.signal.aborted) return;
      const windowMessages = await this.loadStepWindow(context.step.id);
      if (input.signal.aborted) return;

      const request: ToolTurnRequest = {
        request_id: context.requestId,
        tenant_id: context.task.tenantId,
        user_id: context.task.userId,
        conversation_id: context.upstreamConversationId,
        mode: 'standard',
        instructions: context.instructions,
        conversation_summary: null,
        user_memories: null,
        // 空窗口必须注入触发消息：ToolTurnRequest.messages 最少 1 条；
        // 该消息不落库，仅保证首轮请求合法，重建窗口时保持一致。
        messages: windowMessages.length > 0 ? windowMessages : [
          { role: 'user', content: [{ type: 'text', text: STEP_TRIGGER_TEXT }] },
        ],
        tools: context.toolFace,
      };
      const upstream = await this.gateway.streamToolTurn(
        request,
        this.tracking(context),
        input.signal,
      );

      const suggestedCalls: UpstreamToolCall[] = [];
      const seenUpstreamCallIds = new Map<string, UpstreamToolCall>();
      let modelContent = '';
      let completed = false;
      let terminalError: { code: string; message: string } | null = null;

      streamEvents: for await (const event of upstream) {
        if (input.signal.aborted) return;
        switch (event.type) {
          case 'tool_calls':
            for (const call of event.tool_calls) {
              const previous = seenUpstreamCallIds.get(call.id);
              if (previous) {
                if (
                  previous.name !== call.name
                  || canonicalJson(previous.arguments) !== canonicalJson(call.arguments)
                ) {
                  throw new Error(`AI service returned conflicting tool call ${call.id}`);
                }
                continue;
              }
              seenUpstreamCallIds.set(call.id, call);
              suggestedCalls.push(call);
            }
            break;
          case 'completed':
            completed = true;
            break streamEvents;
          case 'error':
            terminalError = { code: event.error.code, message: event.error.message };
            break streamEvents;
          case 'content_delta':
            modelContent += event.text;
            break;
          default:
            // started / status / usage 不落窗口消息。
            break;
        }
      }

      if (input.signal.aborted) return;
      if (terminalError) {
        await this.failStepWith(input, context.task, context.step, terminalError.code, terminalError.message);
        return;
      }
      if (!completed) {
        await this.failStepWith(
          input,
          context.task,
          context.step,
          'AI_SERVICE_INVALID_RESPONSE',
          '步骤执行流在模型调用完成事件前意外结束',
        );
        return;
      }
      if (suggestedCalls.length === 0) {
        const outputRefs = await this.collectOutputRefs(context.step.id);
        const summary = truncate(modelContent.trim(), MAX_STEP_SUMMARY_CHARS) || buildFallbackSummary(outputRefs);
        await this.state.succeedStep({
          taskId: context.task.id,
          stepId: context.step.id,
          stepKey: context.step.stepKey,
          tenantId: context.task.tenantId,
          executionOwner: input.executionOwner,
          summary,
          outputRefs,
        });
        return;
      }

      const remainingToolCalls = Math.max(0, MAX_STEP_TOOL_CALLS - processedToolCalls);
      const execution = await this.executeStepToolCalls(context, input, {
        calls: suggestedCalls,
        modelStep: modelCall + 1,
        maxExecutable: remainingToolCalls,
        assistantContent: modelContent,
      });
      processedToolCalls += Math.min(suggestedCalls.length, remainingToolCalls);

      // 挂起等待用户授权：步骤已转 WAITING_USER，本循环立即退出（等待恢复派发）。
      if (execution.suspended) return;
      if (execution.ownershipLost) return;
      if (execution.limitExceeded) {
        await this.failStepWith(
          input,
          context.task,
          context.step,
          'STEP_TOOL_LIMIT_EXCEEDED',
          '本步骤工具调用次数已超过安全上限，步骤已终止',
        );
        return;
      }
    }

    await this.failStepWith(
      input,
      context.task,
      context.step,
      'STEP_MODEL_CALL_LIMIT_EXCEEDED',
      '本步骤模型调用次数已超过上限，步骤已终止',
    );
  }

  /** 纯文本步骤：工具面为空（权限极窄）时直接一次模型调用产出摘要。 */
  private async runPlainStep(context: StepExecutionContext, input: StepExecutionInput): Promise<void> {
    const request: ChatRequest = {
      request_id: context.requestId,
      tenant_id: context.task.tenantId,
      user_id: context.task.userId,
      conversation_id: context.upstreamConversationId,
      mode: 'standard',
      instructions: context.instructions,
      conversation_summary: null,
      user_memories: null,
      messages: [
        { role: 'user', content: [{ type: 'text', text: STEP_TRIGGER_TEXT }] },
      ],
    };
    const upstream = await this.gateway.streamChat(
      request,
      this.tracking(context),
      input.signal,
    );
    let content = '';
    for await (const event of upstream) {
      if (input.signal.aborted) return;
      switch (event.type) {
        case 'completed':
          await this.state.succeedStep({
            taskId: context.task.id,
            stepId: context.step.id,
            stepKey: context.step.stepKey,
            tenantId: context.task.tenantId,
            executionOwner: input.executionOwner,
            summary: truncate(content.trim(), MAX_STEP_SUMMARY_CHARS) || '本步骤已执行完成。',
            outputRefs: [],
          });
          return;
        case 'error':
          await this.failStepWith(input, context.task, context.step, event.error.code, event.error.message);
          return;
        case 'content_delta':
          content += event.text;
          break;
        default:
          break;
      }
    }
    await this.failStepWith(
      input,
      context.task,
      context.step,
      'AI_SERVICE_INVALID_RESPONSE',
      '步骤执行流在模型调用完成事件前意外结束',
    );
  }

  /**
   * 执行一轮模型建议的工具调用：记录 → 一致性校验 → 实时权限批准 →
   * WRITE 授权链 → 进度播报 → 抢占 → 执行 → 结算。串行执行保证同一步骤的
   * 窗口消息 seq 无并发竞争。
   */
  private async executeStepToolCalls(
    context: StepExecutionContext,
    input: StepExecutionInput,
    round: {
      calls: UpstreamToolCall[];
      modelStep: number;
      maxExecutable: number;
      assistantContent: string;
    },
  ): Promise<{ limitExceeded: boolean; ownershipLost: boolean; suspended?: boolean }> {
    for (let index = 0; index < round.calls.length; index++) {
      if (input.signal.aborted) return { limitExceeded: false, ownershipLost: true };
      const call = round.calls[index];
      const record = await this.state.createStepToolCall({
        id: randomUUID(),
        taskId: context.task.id,
        stepId: context.step.id,
        modelStep: round.modelStep,
        tenantId: context.task.tenantId,
        conversationId: context.carrierConversationId,
        executionOwner: input.executionOwner,
        upstreamCallId: call.id,
        assistantContent: index === 0 ? round.assistantContent || null : null,
        name: call.name,
        arguments: call.arguments as Prisma.InputJsonValue,
      });
      const effectiveToolCallId = record.id;

      if (
        record.name !== call.name
        || canonicalJson(record.arguments) !== canonicalJson(call.arguments)
        || (index === 0 && (record.assistantContent ?? '') !== round.assistantContent)
      ) {
        throw new Error(`Step tool call ${call.id} was replayed with different arguments`);
      }

      // 恢复或重放场景：终态记录可直接跳过（窗口消息已含结果）；
      // 执行中/待恢复记录表示副作用状态未知，立即停止本步骤执行。
      if (record.status !== 'PROPOSED') {
        if (
          record.status === 'EXECUTING'
          || record.status === 'RECOVERY_REQUIRED'
          || record.status === 'APPROVED'
        ) {
          return { limitExceeded: false, ownershipLost: true };
        }
        continue;
      }

      if (index >= round.maxExecutable) {
        const settled = await this.state.rejectStepToolCall({
          toolCallId: effectiveToolCallId,
          taskId: context.task.id,
          stepId: context.step.id,
          tenantId: context.task.tenantId,
          executionOwner: input.executionOwner,
          code: 'STEP_TOOL_LIMIT_EXCEEDED',
          summary: '本步骤工具调用次数已达到安全上限，该调用未执行',
        });
        if (!settled) return { limitExceeded: false, ownershipLost: true };
        continue;
      }

      let approval: ReturnType<ToolPolicyService['approve']>;
      let executionPermissions = context.permissions;
      let executionRoles = context.roles;
      try {
        if (!(await isActiveMembership(this.prisma, context.task.tenantId, context.task.membershipId))) {
          throw new Error('租户成员身份已失效，拒绝执行工具');
        }
        const currentAuthorization = await resolveMembershipAuthorization(
          this.prisma,
          context.task.tenantId,
          context.task.membershipId,
        );
        executionPermissions = currentAuthorization.permissions;
        executionRoles = currentAuthorization.roles;
        approval = this.toolPolicy.approve({
          name: call.name,
          arguments: call.arguments,
          permissions: currentAuthorization.permissions,
        });
      } catch (error) {
        const rejection = toToolFailure(error);
        const settled = await this.state.rejectStepToolCall({
          toolCallId: effectiveToolCallId,
          taskId: context.task.id,
          stepId: context.step.id,
          tenantId: context.task.tenantId,
          executionOwner: input.executionOwner,
          code: rejection.code,
          summary: rejection.summary,
          errorMessage: rejection.errorMessage,
        });
        if (!settled) return { limitExceeded: false, ownershipLost: true };
        continue;
      }

      // WRITE 工具授权链（M3）：命中临时授权 → 消费后执行；最近一次已被用户拒绝
      // → 直接拒绝本次调用（不重复挂起）；否则创建授权交互并挂起步骤等待用户批准。
      let authorizationToConsume: AssistantTaskInteraction | null = null;
      if (approval.definition.riskLevel === 'WRITE') {
        // 授权以工具声明的主权限项为粒度（WRITE 必须声明权限，登记约束）。
        const permissionCode = approval.definition.requiredPermissions[0] ?? null;
        if (!permissionCode) {
          const settled = await this.state.rejectStepToolCall({
            toolCallId: effectiveToolCallId,
            taskId: context.task.id,
            stepId: context.step.id,
            tenantId: context.task.tenantId,
            executionOwner: input.executionOwner,
            code: 'STEP_TOOL_FORBIDDEN',
            summary: '该操作在任务步骤内暂不可用；如确需此操作，请告知用户在对话中直接发起',
          });
          if (!settled) return { limitExceeded: false, ownershipLost: true };
          continue;
        }
        const usable = await this.interactions.findUsableAuthorization({
          tenantId: context.task.tenantId,
          taskId: context.task.id,
          permissionCode,
        });
        if (!usable) {
          const latest = await this.interactions.findLatestAuthorization({
            tenantId: context.task.tenantId,
            taskId: context.task.id,
            permissionCode,
          });
          if (latest?.status === AssistantTaskInteractionStatus.REJECTED) {
            const settled = await this.state.rejectStepToolCall({
              toolCallId: effectiveToolCallId,
              taskId: context.task.id,
              stepId: context.step.id,
              tenantId: context.task.tenantId,
              executionOwner: input.executionOwner,
              code: 'AUTHORIZATION_REJECTED',
              summary: '用户已拒绝此操作的授权，请不要重复发起；如确实无法完成本步骤，请说明原因',
            });
            if (!settled) return { limitExceeded: false, ownershipLost: true };
            continue;
          }
          const suspended = await this.suspendForAuthorization(context, input, {
            toolCallId: effectiveToolCallId,
            definition: approval.definition,
            permissionCode,
            // 已有未决请求（防御场景）：只重新挂起步骤，不重复创建交互。
            createRequested: latest?.status !== AssistantTaskInteractionStatus.PENDING,
          });
          if (!suspended) return { limitExceeded: false, ownershipLost: true };
          return { limitExceeded: false, ownershipLost: false, suspended: true };
        }
        authorizationToConsume = usable;
      }

      // 进度播报只用工具显示名（服务端固定文案），绝不透出参数或内部引用。
      await this.taskEvents.append(context.task.id, context.task.tenantId, {
        type: 'step_progress',
        stepId: context.step.id,
        stepKey: context.step.stepKey,
        note: truncate(`正在执行：${approval.definition.displayName}`, STEP_PROGRESS_NOTE_MAX_CHARS),
      });

      const executionToken = randomUUID();
      const claimed = await this.state.claimStepToolExecution({
        toolCallId: effectiveToolCallId,
        taskId: context.task.id,
        stepId: context.step.id,
        tenantId: context.task.tenantId,
        executionOwner: input.executionOwner,
        executionToken,
        leaseExpiresAt: nextTaskLease(),
      });
      if (!claimed) return { limitExceeded: false, ownershipLost: true };

      // 临时授权消费在抢占成功后：抢占失败（失去租约）不浪费用户批准；
      // 消费失败（过期/已被使用）时本调用未执行，模型可重新发起（将重新挂起）。
      if (authorizationToConsume) {
        const consumed = await this.interactions.markAuthorizationUsed({
          tenantId: context.task.tenantId,
          interactionId: authorizationToConsume.id,
          membershipId: context.task.membershipId,
          requestId: context.requestId,
          stepId: context.step.id,
          toolCallId: effectiveToolCallId,
        });
        if (!consumed) {
          const settled = await this.state.failStepToolCall({
            toolCallId: effectiveToolCallId,
            taskId: context.task.id,
            stepId: context.step.id,
            tenantId: context.task.tenantId,
            executionOwner: input.executionOwner,
            executionToken,
            code: 'AUTHORIZATION_EXPIRED',
            summary: '临时授权已失效，请重新发起本操作',
          });
          if (!settled) return { limitExceeded: false, ownershipLost: true };
          continue;
        }
      }

      let result: Awaited<ReturnType<typeof approval.definition.execute>>;
      try {
        result = await approval.definition.execute(
          {
            tenantId: context.task.tenantId,
            userId: context.task.userId,
            membershipId: context.task.membershipId,
            requestId: context.requestId,
            conversationId: context.carrierConversationId,
            turnId: null,
            taskStepId: context.step.id,
            taskId: context.task.id,
            toolCallId: effectiveToolCallId,
            executionOwner: input.executionOwner,
            executionToken,
            signal: input.signal,
            permissions: executionPermissions,
            roles: executionRoles,
            knowledgeBaseEnabled: true,
            webSearchEnabled: false,
          },
          approval.parsedArguments,
        );
      } catch (error) {
        const failure = toToolFailure(error);
        const settled = await this.state.failStepToolCall({
          toolCallId: effectiveToolCallId,
          taskId: context.task.id,
          stepId: context.step.id,
          tenantId: context.task.tenantId,
          executionOwner: input.executionOwner,
          executionToken,
          code: failure.code,
          summary: failure.summary,
          errorMessage: failure.errorMessage,
        });
        if (!settled) return { limitExceeded: false, ownershipLost: true };
        continue;
      }

      const settled = await this.state.completeStepToolCall({
        toolCallId: effectiveToolCallId,
        taskId: context.task.id,
        stepId: context.step.id,
        tenantId: context.task.tenantId,
        executionOwner: input.executionOwner,
        executionToken,
        summary: result.summary,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        sources: result.sources ?? [],
        citations: result.citations ?? [],
      });
      if (!settled) return { limitExceeded: false, ownershipLost: true };
    }
    return {
      limitExceeded: round.calls.length > round.maxExecutable,
      ownershipLost: false,
    };
  }

  /**
   * 授权挂起（原子事务）：工具结算（PROPOSED → REJECTED，写 TOOL 窗口消息）→
   * 创建授权交互（写 interaction_requested 事件）→ 步骤 RUNNING → WAITING_USER
   * 并释放租约。失败整体回滚（条件更新共享同一租约事实），由调度器按「失去执行权」收束本步骤。
   */
  private async suspendForAuthorization(
    context: StepExecutionContext,
    input: StepExecutionInput,
    request: {
      toolCallId: string;
      definition: ToolDefinition;
      permissionCode: string;
      /** false：该权限项已有未决请求（数据异常防御），只挂起步骤不重复创建交互。 */
      createRequested: boolean;
    },
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const settled = await this.state.rejectStepToolCallInTransaction(transaction, {
          toolCallId: request.toolCallId,
          taskId: context.task.id,
          stepId: context.step.id,
          tenantId: context.task.tenantId,
          executionOwner: input.executionOwner,
          code: 'AUTHORIZATION_REQUIRED',
          summary: '该操作需要用户授权，本次未执行；授权请求已发送，用户处理完成后请重新发起本调用',
        });
        if (!settled) return false;
        if (request.createRequested) {
          await this.interactions.createInTransaction(transaction, {
            tenantId: context.task.tenantId,
            taskId: context.task.id,
            stepId: context.step.id,
            stepKey: context.step.stepKey,
            type: 'AUTHORIZATION',
            summary: `允许执行「${request.definition.displayName}」`,
            reason: '该操作会修改或新增企业业务数据，需要你授权后 AI 同事才能继续执行',
            permissionCode: request.permissionCode,
            toolName: request.definition.name,
            requestId: context.requestId,
            membershipId: context.task.membershipId,
          });
        }
        const suspended = await this.state.suspendStepInTransaction(transaction, {
          taskId: context.task.id,
          stepId: context.step.id,
          tenantId: context.task.tenantId,
          executionOwner: input.executionOwner,
        });
        // 前两步已有写入，挂起冲突必须抛错回滚而非半截提交。
        if (!suspended) throw new Error(`step ${context.step.id} suspend conflict`);
        return true;
      });
    } catch (error) {
      this.logger.warn(`step ${context.step.id} authorization suspend failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * 重建步骤窗口消息：TOOL 消息按 ToolCall.upstreamCallId 映射回模型可见的
   * 调用 ID，并按 modelStep 分组补回 assistant(tool_calls) 前缀——与轮次
   * 工具轮次同一协议，保证模型每轮看到的工具历史自洽。
   */
  private async loadStepWindow(stepId: string): Promise<ToolTurnMessage[]> {
    const [messages, toolCalls] = await Promise.all([
      this.prisma.assistantTaskStepMessage.findMany({
        where: { stepId },
        orderBy: { seq: 'asc' },
        select: { role: true, content: true, toolCallRef: true },
      }),
      this.prisma.toolCall.findMany({
        where: { taskStepId: stepId },
        orderBy: { seq: 'asc' },
        select: {
          id: true,
          modelStep: true,
          upstreamCallId: true,
          assistantContent: true,
          name: true,
          arguments: true,
        },
      }),
    ]);

    const callById = new Map(toolCalls.map((call) => [call.id, call]));
    const callsByStep = new Map<string, NonNullable<ToolTurnMessage['tool_calls']>>();
    const assistantContentByStep = new Map<string, string | null>();
    for (const call of toolCalls) {
      const stepKey = String(call.modelStep);
      const bucket = callsByStep.get(stepKey) ?? [];
      bucket.push({
        id: call.upstreamCallId,
        name: call.name,
        arguments: toJsonArguments(call.arguments),
      });
      callsByStep.set(stepKey, bucket);
      if (!assistantContentByStep.has(stepKey) || call.assistantContent !== null) {
        assistantContentByStep.set(stepKey, call.assistantContent);
      }
    }

    const items: ToolTurnMessage[] = [];
    const synthesizedSteps = new Set<string>();
    for (const message of messages) {
      if (message.role === ConversationMessageRole.TOOL) {
        if (!message.toolCallRef) continue;
        const call = callById.get(message.toolCallRef);
        if (!call) continue;
        const stepKey = String(call.modelStep);
        if (!synthesizedSteps.has(stepKey)) {
          synthesizedSteps.add(stepKey);
          const calls = callsByStep.get(stepKey) ?? [];
          if (calls.length > 0) {
            const assistantContent = assistantContentByStep.get(stepKey);
            items.push({
              role: 'assistant',
              content: assistantContent ? [{ type: 'text', text: assistantContent }] : null,
              tool_calls: calls,
            });
          }
        }
        items.push({
          role: 'tool',
          content: [{ type: 'text', text: message.content }],
          tool_call_id: call.upstreamCallId,
          name: call.name,
        });
        continue;
      }
      if (message.role === ConversationMessageRole.USER) {
        items.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
        continue;
      }
      items.push({ role: 'assistant', content: [{ type: 'text', text: message.content }] });
    }
    return items;
  }

  /**
   * 步骤工具面：发起人实时权限 ∩ 步骤策略。WRITE 工具同样进入工具面——
   * 调用时经授权链二次把关（临时授权放行 / 无授权挂起等用户批准），
   * 仅剔除显式排除项。
   */
  private resolveToolFace(permissions: string[]): ChatToolDefinition[] {
    return this.toolRegistry
      .listAllowedDefinitions(permissions)
      .filter((tool) => !STEP_EXCLUDED_TOOLS.has(tool.name))
      .map(toChatToolDefinition);
  }

  /** 本步骤产出的稳定资源引用（去重、按调用顺序）。 */
  private async collectOutputRefs(stepId: string): Promise<PublicTaskResourceRef[]> {
    const rows = await this.prisma.toolCall.findMany({
      where: {
        taskStepId: stepId,
        status: ToolCallStatus.COMPLETED,
        executedResourceType: { not: null },
        executedResourceId: { not: null },
      },
      orderBy: { seq: 'asc' },
      select: { executedResourceType: true, executedResourceId: true },
    });
    const seen = new Set<string>();
    const refs: PublicTaskResourceRef[] = [];
    for (const row of rows) {
      const type = row.executedResourceType;
      const id = row.executedResourceId;
      if ((type !== 'IMAGE' && type !== 'DOCUMENT') || !id) continue;
      const key = `${type}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ type, id });
    }
    return refs;
  }

  private async loadPlanSteps(taskId: string, planVersion: number): Promise<PublicTaskPlanStep[]> {
    const plan = await this.prisma.assistantTaskPlan.findUnique({
      where: { taskId_version: { taskId, version: planVersion } },
      select: { steps: true },
    });
    const value = plan?.steps;
    return Array.isArray(value) ? (value as unknown as PublicTaskPlanStep[]) : [];
  }

  private tracking(context: StepExecutionContext): ChatInvocationTracking {
    return {
      membershipId: context.task.membershipId,
      turnId: null,
      conversationId: context.task.conversationId ?? undefined,
      taskId: context.task.id,
      stepId: context.step.id,
    };
  }

  private async failStepWith(
    input: StepExecutionInput,
    task: { id: string; tenantId: string },
    step: { id: string; stepKey: string },
    code: string,
    reason: string,
  ): Promise<void> {
    await this.state.failStep({
      taskId: task.id,
      stepId: step.id,
      stepKey: step.stepKey,
      tenantId: task.tenantId,
      executionOwner: input.executionOwner,
      code,
      reason,
    });
  }
}

/**
 * 派发书文本（instructions）：同事人格 + 任务目标 + 本步要求 + 依赖产出摘要 +
 * 执行说明。依赖只注入摘要与引用（明细由工具按需读取）；整体防御性截断，
 * 保证不越过 ai-service 的 instructions 上限。
 */
function buildStepInstructions(input: {
  agent: { name: string; title: string; instructions: string } | null;
  goal: string;
  planStep: PublicTaskPlanStep | null;
  dependencies: Array<{ stepKey: string; title: string | null; summary: string }>;
}): string {
  const lines: string[] = [];
  const persona = input.agent
    ? `你是企业 AI 同事「${input.agent.name}」${input.agent.title ? `（${input.agent.title}）` : ''}。`
    : '你是企业 AI 同事。';
  lines.push(persona);
  if (input.agent?.instructions) lines.push(input.agent.instructions);
  lines.push('', `任务目标：${input.goal}`);
  if (input.planStep?.title) lines.push(`本步名称：${input.planStep.title}`);
  lines.push(`本步要求：${input.planStep?.requirement ?? '按任务目标完成本步骤。'}`);
  if (input.planStep?.expectedOutput) lines.push(`预期产出：${input.planStep.expectedOutput}`);
  if (input.dependencies.length > 0) {
    lines.push('', '前置步骤产出摘要（明细请用工具按引用读取，不要凭空推断）：');
    for (const dependency of input.dependencies) {
      const label = dependency.title ? `「${dependency.title}」` : dependency.stepKey;
      lines.push(`- ${dependency.stepKey} ${label}：${dependency.summary || '（无摘要）'}`);
    }
  }
  lines.push(
    '',
    '执行说明：',
    '1. 你正在企业任务中独立执行一个步骤：聚焦本步要求，不要扩大范围；',
    '2. 需要内部资料或外部信息时使用可用工具检索，不要凭记忆编造；',
    '3. 涉及写操作（新增或修改企业数据）时直接调用相应工具：系统会在必要时自动向用户申请授权；',
    '4. 完成后直接给出本步结果摘要：做了什么、结论与关键数据，保持简洁；',
    '5. 不要向用户提问或等待确认；确实无法完成时说明原因，不要假装完成。',
  );
  const text = lines.join('\n');
  return text.length > MAX_STEP_INSTRUCTIONS_CHARS
    ? text.slice(0, MAX_STEP_INSTRUCTIONS_CHARS)
    : text;
}

function buildFallbackSummary(outputRefs: PublicTaskResourceRef[]): string {
  return outputRefs.length > 0
    ? `本步骤已执行完成，产出 ${outputRefs.length} 项资产。`
    : '本步骤已执行完成。';
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function asStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** 产出引用 JSON 由本模块写入，读取时形状可信；防御性回退为空数组。 */
function toOutputRefs(value: Prisma.JsonValue | null): PublicTaskResourceRef[] {
  return Array.isArray(value) ? (value as unknown as PublicTaskResourceRef[]) : [];
}

function toJsonArguments(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
