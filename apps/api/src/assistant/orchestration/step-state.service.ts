import { Injectable, Logger } from '@nestjs/common';
import {
  AssistantTaskStatus,
  AssistantTaskStepStatus,
  ConversationMessageRole,
  ManagedImageStatus,
  Prisma,
  ToolCallStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { KnowledgeToolCitation, ToolSource } from '../tools/tool.types';
import { TaskEventService } from './task-event.service';
import type { PublicTaskResourceRef } from './orchestration.types';
import type { FailureDecisionAction } from './step-failure';

interface StepToolResult {
  summary: string;
  resourceType: 'IMAGE' | 'DOCUMENT' | null;
  resourceId: string | null;
  sources?: ToolSource[];
  citations?: KnowledgeToolCitation[];
}

/** createStepToolCall 的稳定返回：回放时复用已存在记录的字段快照。 */
export interface StepToolCallRecord {
  id: string;
  status: ToolCallStatus;
  result: Prisma.JsonValue | null;
  errorCode: string | null;
  errorMessage: string | null;
  name: string;
  arguments: Prisma.JsonValue;
  assistantContent: string | null;
}

/**
 * 任务步骤的持久化状态机（与 TurnStateService 同构，独立成服务是因为两者
 * 的租约载体、消息表和事件流完全不同）。关键状态、步骤窗口消息与任务事件
 * 只在这里成组提交；StepRunner 只负责决定下一步。
 *
 * seq 分配说明：AssistantTaskStepMessage 没有 nextSeq 分配器列，seq 在事务内
 * 用「当前最大 + 1」分配——步骤由租约串行独占（同一时刻只有一个执行者写窗口），
 * 不存在并发插入竞态；工具结算与终稿写入又都在同一事务内，先分配后插入即可。
 */
@Injectable()
export class StepStateService {
  private readonly logger = new Logger(StepStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: TaskEventService,
  ) { }

  /**
   * 任务级心跳：续约任务、当前 RUNNING 步骤与 EXECUTING 工具调用，三者共用
   * 同一租约窗口。返回 false 表示任务已被取消或本执行者已失去租约。
   */
  async heartbeatTask(input: {
    taskId: string;
    executionOwner: string;
    leaseExpiresAt: Date;
  }): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.assistantTask.updateMany({
        where: {
          id: input.taskId,
          status: AssistantTaskStatus.RUNNING,
          executionOwner: input.executionOwner,
          // 过期租约不允许被迟来的心跳复活；收束由恢复扫描独占。
          leaseExpiresAt: { gt: now },
        },
        data: {
          heartbeatAt: now,
          leaseExpiresAt: input.leaseExpiresAt,
        },
      });
      if (updated.count !== 1) return false;
      await transaction.assistantTaskStep.updateMany({
        where: {
          taskId: input.taskId,
          status: AssistantTaskStepStatus.RUNNING,
          executionOwner: input.executionOwner,
        },
        data: { heartbeatAt: now, leaseExpiresAt: input.leaseExpiresAt },
      });
      // 一次模型调用可能跨过多个心跳周期，执行中的工具必须与任务同步续约，
      // 否则健康执行者可能在写回结果前先丢失工具认领。
      await transaction.toolCall.updateMany({
        where: {
          taskStep: { taskId: input.taskId },
          status: ToolCallStatus.EXECUTING,
          executionToken: { not: null },
        },
        data: { leaseExpiresAt: input.leaseExpiresAt },
      });
      return true;
    });
  }

  /**
   * 调度让行：任务交还执行权（退避等待 / 无进展兜底）。租约置为当前时刻，
   * 恢复扫描可立即重拾——避免退避窗口内长时间空转。
   */
  async yieldTaskExecution(input: {
    taskId: string;
    executionOwner: string;
  }): Promise<boolean> {
    const now = new Date();
    const updated = await this.prisma.assistantTask.updateMany({
      where: {
        id: input.taskId,
        status: AssistantTaskStatus.RUNNING,
        executionOwner: input.executionOwner,
      },
      data: {
        executionOwner: null,
        leaseExpiresAt: now,
        heartbeatAt: now,
      },
    });
    return updated.count === 1;
  }

  /**
   * 派发步骤（两类入口，条件更新原子抢占）：
   * - 首次派发：READY → RUNNING，attemptNo + 1，写派发书快照、租约与 step_started 事件；
   * - 挂起恢复：WAITING_USER → RUNNING（attemptNo 不变，断点续跑），只重写租约，
   *   不重复写 step_started——恢复是同一执行尝试的继续，不是新一次尝试。
   * 状态与事件原子提交，不出现「已运行但无开始事件」。
   */
  async claimStep(input: {
    taskId: string;
    stepId: string;
    tenantId: string;
    executionOwner: string;
    leaseExpiresAt: Date;
    brief: Prisma.InputJsonValue;
    stepKey: string;
    stepNo: number;
    stepTitle: string | null;
    assigneeName: string | null;
  }): Promise<boolean> {
    const now = new Date();
    const ownershipWhere = {
      task: {
        is: {
          status: AssistantTaskStatus.RUNNING,
          executionOwner: input.executionOwner,
          leaseExpiresAt: { gt: now },
        },
      },
    };
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.assistantTaskStep.updateMany({
        where: {
          id: input.stepId,
          taskId: input.taskId,
          tenantId: input.tenantId,
          status: AssistantTaskStepStatus.READY,
          ...ownershipWhere,
        },
        data: {
          status: AssistantTaskStepStatus.RUNNING,
          attemptNo: { increment: 1 },
          brief: input.brief,
          executionOwner: input.executionOwner,
          leaseExpiresAt: input.leaseExpiresAt,
          heartbeatAt: now,
          startedAt: now,
        },
      });
      if (updated.count === 1) {
        await this.events.appendInTransaction(transaction, input.taskId, input.tenantId, {
          type: 'step_started',
          stepId: input.stepId,
          stepKey: input.stepKey,
          stepNo: input.stepNo,
          title: input.stepTitle,
          assigneeName: input.assigneeName,
        });
        return true;
      }
      // 恢复路径：挂起事项全部解决后由调度器重新派发；不重复写 step_started。
      const resumed = await transaction.assistantTaskStep.updateMany({
        where: {
          id: input.stepId,
          taskId: input.taskId,
          tenantId: input.tenantId,
          status: AssistantTaskStepStatus.WAITING_USER,
          ...ownershipWhere,
        },
        data: {
          status: AssistantTaskStepStatus.RUNNING,
          brief: input.brief,
          executionOwner: input.executionOwner,
          leaseExpiresAt: input.leaseExpiresAt,
          heartbeatAt: now,
        },
      });
      return resumed.count === 1;
    });
  }

  /**
   * 授权挂起（须在调用方事务内执行）：RUNNING → WAITING_USER 条件更新并释放
   * 步骤租约——等待期间步骤不属于任何执行者；与工具结算、挂起事项创建同事务提交。
   */
  async suspendStepInTransaction(
    transaction: Prisma.TransactionClient,
    input: { taskId: string; stepId: string; tenantId: string; executionOwner: string; now?: Date },
  ): Promise<boolean> {
    const now = input.now ?? new Date();
    const updated = await transaction.assistantTaskStep.updateMany({
      where: {
        id: input.stepId,
        taskId: input.taskId,
        tenantId: input.tenantId,
        status: AssistantTaskStepStatus.RUNNING,
        executionOwner: input.executionOwner,
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: AssistantTaskStepStatus.WAITING_USER,
        executionOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
      },
    });
    return updated.count === 1;
  }

  /**
   * 失败升级（失败阶梯：升级用户裁决，须在调用方事务内执行）：FAILED →
   * WAITING_USER 条件更新并清空完成时间——裁决交互创建、状态迁移与错误详情
   * 保留同事务提交；等待期间步骤不属于任何执行者，不阻塞其它步骤推进。
   */
  async escalateStepInTransaction(
    transaction: Prisma.TransactionClient,
    input: { taskId: string; stepId: string; tenantId: string },
  ): Promise<boolean> {
    const updated = await transaction.assistantTaskStep.updateMany({
      where: {
        id: input.stepId,
        taskId: input.taskId,
        tenantId: input.tenantId,
        status: AssistantTaskStepStatus.FAILED,
      },
      data: {
        status: AssistantTaskStepStatus.WAITING_USER,
        completedAt: null,
        heartbeatAt: new Date(),
      },
    });
    return updated.count === 1;
  }

  /** 依赖满足：PENDING → READY（无事件；就绪不是对外可见的状态迁移）。 */
  async markStepReady(taskId: string, stepId: string): Promise<boolean> {
    const updated = await this.prisma.assistantTaskStep.updateMany({
      where: { id: stepId, taskId, status: AssistantTaskStepStatus.PENDING },
      data: { status: AssistantTaskStepStatus.READY },
    });
    return updated.count === 1;
  }

  /**
   * 失败重试调度（失败阶梯：自动重试）：FAILED → READY 条件更新并写入退避
   * 「不早于」时间；本次失败详情保留在 error 作为失败痕迹，重试派发时
   * attemptNo 再 +1。不写事件：本次失败已由 step_failed 留痕，重试开始由
   * 下一次 step_started 表达。
   */
  async scheduleStepRetry(input: {
    taskId: string;
    stepId: string;
    tenantId: string;
    retryAfterAt: Date | null;
  }): Promise<boolean> {
    const updated = await this.prisma.assistantTaskStep.updateMany({
      where: {
        id: input.stepId,
        taskId: input.taskId,
        tenantId: input.tenantId,
        status: AssistantTaskStepStatus.FAILED,
      },
      data: {
        status: AssistantTaskStepStatus.READY,
        retryAfterAt: input.retryAfterAt,
        heartbeatAt: new Date(),
      },
    });
    return updated.count === 1;
  }

  /** 依赖失败级联：PENDING → SKIPPED，状态与 step_skipped 事件原子提交。 */
  async skipStep(input: {
    taskId: string;
    stepId: string;
    stepKey: string;
    tenantId: string;
    reason: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.assistantTaskStep.updateMany({
        where: {
          id: input.stepId,
          taskId: input.taskId,
          tenantId: input.tenantId,
          status: AssistantTaskStepStatus.PENDING,
        },
        data: {
          status: AssistantTaskStepStatus.SKIPPED,
          completedAt: now,
          error: { code: 'STEP_DEPENDENCY_FAILED', message: input.reason } as Prisma.InputJsonObject,
        },
      });
      if (updated.count !== 1) return false;
      await this.events.appendInTransaction(transaction, input.taskId, input.tenantId, {
        type: 'step_skipped',
        stepId: input.stepId,
        stepKey: input.stepKey,
        reason: input.reason,
      });
      return true;
    });
  }

  /**
   * 应用失败裁决（用户对升级交互的解决，幂等条件更新）：
   * - retry：WAITING_USER → READY，清退避立即重试（派发时 attemptNo 再 +1，
   *   用户显式重试可突破自动重试上限）；
   * - skip：WAITING_USER → SKIPPED，写 step_skipped 事件，产出缺失由任务汇总呈现；
   * - abort：WAITING_USER → FAILED，error 标记 resolution=abort，调度收尾据此
   *   跳过再次升级、任务随之判定失败。
   * replan（调整计划）不在此落步骤状态：步骤保持 WAITING_USER 让行，
   * 由重排链路生成新计划版本、用户再次确认后随新版本物化收束。
   */
  async applyFailureDecision(input: {
    taskId: string;
    stepId: string;
    stepKey: string;
    tenantId: string;
    action: FailureDecisionAction;
    reason: string;
  }): Promise<boolean> {
    if (input.action === 'replan') {
      // 防御：调整计划裁决不属于状态收束动作，误入即视为调用方接线错误。
      throw new Error('failure decision replan is handled by the plan revision flow');
    }
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      if (input.action === 'retry') {
        const updated = await transaction.assistantTaskStep.updateMany({
          where: {
            id: input.stepId,
            taskId: input.taskId,
            tenantId: input.tenantId,
            status: AssistantTaskStepStatus.WAITING_USER,
          },
          data: {
            status: AssistantTaskStepStatus.READY,
            retryAfterAt: null,
            heartbeatAt: now,
          },
        });
        return updated.count === 1;
      }
      const aborted = input.action === 'abort';
      const updated = await transaction.assistantTaskStep.updateMany({
        where: {
          id: input.stepId,
          taskId: input.taskId,
          tenantId: input.tenantId,
          status: AssistantTaskStepStatus.WAITING_USER,
        },
        data: {
          status: aborted ? AssistantTaskStepStatus.FAILED : AssistantTaskStepStatus.SKIPPED,
          completedAt: now,
          heartbeatAt: now,
          error: {
            code: aborted ? 'STEP_ABORTED_BY_USER' : 'STEP_SKIPPED_BY_USER',
            message: input.reason,
            ...(aborted ? { resolution: 'abort' } : {}),
          } as Prisma.InputJsonObject,
        },
      });
      if (updated.count !== 1) return false;
      await this.events.appendInTransaction(transaction, input.taskId, input.tenantId, {
        type: aborted ? 'step_failed' : 'step_skipped',
        stepId: input.stepId,
        stepKey: input.stepKey,
        reason: input.reason,
      });
      return true;
    });
  }

  /**
   * 挂起超时终局（skip_step / fail_task 策略）：WAITING_USER（无执行者）→
   * SKIPPED / FAILED，终态与任务事件原子提交；continue_default 策略不走此路径。
   */
  async expireWaitingStep(input: {
    taskId: string;
    stepId: string;
    stepKey: string;
    tenantId: string;
    outcome: 'skip' | 'fail';
    reason: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.assistantTaskStep.updateMany({
        where: {
          id: input.stepId,
          taskId: input.taskId,
          tenantId: input.tenantId,
          status: AssistantTaskStepStatus.WAITING_USER,
        },
        data: {
          status: input.outcome === 'skip'
            ? AssistantTaskStepStatus.SKIPPED
            : AssistantTaskStepStatus.FAILED,
          completedAt: now,
          heartbeatAt: now,
          error: { code: 'STEP_SUSPEND_TIMEOUT', message: input.reason } as Prisma.InputJsonObject,
        },
      });
      if (updated.count !== 1) return false;
      await this.events.appendInTransaction(transaction, input.taskId, input.tenantId, {
        type: input.outcome === 'skip' ? 'step_skipped' : 'step_failed',
        stepId: input.stepId,
        stepKey: input.stepKey,
        reason: input.reason,
      });
      return true;
    });
  }

  /**
   * 挂起超时“按默认值继续”策略：向步骤窗口注入系统提示（USER 角色），
   * 恢复后模型可见并据此继续；步骤维持 WAITING_USER，由恢复扫描续跑。
   */
  async writeSuspendTimeoutNotice(input: {
    tenantId: string;
    stepId: string;
    content: string;
  }): Promise<void> {
    await this.prisma.$transaction((transaction) =>
      writeStepMessage(transaction, {
        tenantId: input.tenantId,
        stepId: input.stepId,
        role: ConversationMessageRole.USER,
        content: input.content,
      }));
  }

  /**
   * 步内工具调用记录：由步骤行原子分配 nextToolCallSeq 后创建；唯一约束
   * 冲突（同一 modelStep + upstreamCallId 重放）回读已存在记录，绝不重复执行。
   * 任务事件不写：任务事件流只承载步骤级展示事件，工具级明细留在窗口消息内。
   */
  async createStepToolCall(input: {
    id: string;
    taskId: string;
    stepId: string;
    modelStep: number;
    tenantId: string;
    conversationId: string;
    executionOwner: string;
    upstreamCallId: string;
    assistantContent?: string | null;
    name: string;
    arguments: Prisma.InputJsonValue;
  }): Promise<StepToolCallRecord> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const now = new Date();
        const allocated = await transaction.assistantTaskStep.updateMany({
          where: {
            id: input.stepId,
            taskId: input.taskId,
            tenantId: input.tenantId,
            status: AssistantTaskStepStatus.RUNNING,
            executionOwner: input.executionOwner,
            leaseExpiresAt: { gt: now },
          },
          data: { nextToolCallSeq: { increment: 1 } },
        });
        if (allocated.count !== 1) {
          throw new Error(`step ${input.stepId} execution ownership was lost`);
        }
        const allocation = await transaction.assistantTaskStep.findUniqueOrThrow({
          where: { id: input.stepId },
          select: { nextToolCallSeq: true },
        });
        return await transaction.toolCall.create({
          data: {
            id: input.id,
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            taskStepId: input.stepId,
            seq: allocation.nextToolCallSeq - 1,
            modelStep: input.modelStep,
            upstreamCallId: input.upstreamCallId,
            assistantContent: input.assistantContent ?? null,
            name: input.name,
            arguments: input.arguments,
            status: ToolCallStatus.PROPOSED,
          },
          select: {
            id: true,
            status: true,
            result: true,
            errorCode: true,
            errorMessage: true,
            name: true,
            arguments: true,
            assistantContent: true,
          },
        });
      });
    } catch (error) {
      if (!isUniqueConstraintError(error, 'model_step')) throw error;
      const existing = await this.prisma.toolCall.findFirst({
        where: {
          tenantId: input.tenantId,
          taskStepId: input.stepId,
          modelStep: input.modelStep,
          upstreamCallId: input.upstreamCallId,
        },
        select: {
          id: true,
          status: true,
          result: true,
          errorCode: true,
          errorMessage: true,
          name: true,
          arguments: true,
          assistantContent: true,
        },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  /** 执行前原子抢占：只有 PROPOSED → EXECUTING 成功的一方产生外部副作用。 */
  async claimStepToolExecution(input: {
    toolCallId: string;
    taskId: string;
    stepId: string;
    tenantId: string;
    executionOwner: string;
    executionToken: string;
    leaseExpiresAt: Date;
  }): Promise<boolean> {
    const now = new Date();
    const updated = await this.prisma.toolCall.updateMany({
      where: {
        id: input.toolCallId,
        taskStepId: input.stepId,
        tenantId: input.tenantId,
        status: ToolCallStatus.PROPOSED,
        taskStep: {
          is: {
            id: input.stepId,
            taskId: input.taskId,
            status: AssistantTaskStepStatus.RUNNING,
            executionOwner: input.executionOwner,
            leaseExpiresAt: { gt: now },
          },
        },
      },
      data: {
        status: ToolCallStatus.EXECUTING,
        approvedAt: now,
        startedAt: now,
        executionToken: input.executionToken,
        leaseExpiresAt: input.leaseExpiresAt,
      },
    });
    return updated.count === 1;
  }

  /** 执行成功：保存稳定资源引用与摘要，写 TOOL 窗口消息（状态与消息原子提交）。 */
  async completeStepToolCall(input: {
    toolCallId: string;
    taskId: string;
    stepId: string;
    tenantId: string;
    executionOwner: string;
    executionToken: string;
    summary: string;
    resourceType: 'IMAGE' | 'DOCUMENT' | null;
    resourceId: string | null;
    sources?: ToolSource[];
    citations?: KnowledgeToolCitation[];
  }): Promise<boolean> {
    return this.settleStepToolCall({
      ...input,
      expectedStatus: ToolCallStatus.EXECUTING,
      status: ToolCallStatus.COMPLETED,
      result: {
        summary: input.summary,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        sources: input.sources ?? [],
        citations: input.citations ?? [],
      },
    });
  }

  /** 执行失败：失败状态与可回喂摘要原子提交。 */
  async failStepToolCall(input: {
    toolCallId: string;
    taskId: string;
    stepId: string;
    tenantId: string;
    executionOwner: string;
    executionToken: string;
    code: string;
    summary: string;
    errorMessage?: string;
  }): Promise<boolean> {
    return this.settleStepToolCall({
      ...input,
      expectedStatus: ToolCallStatus.EXECUTING,
      status: ToolCallStatus.FAILED,
      errorMessage: input.errorMessage ?? input.summary,
      result: { summary: input.summary, resourceType: null, resourceId: null, sources: [] },
    });
  }

  /** 批准拒绝：拒绝状态与可回喂摘要原子提交（从未进入 EXECUTING）。 */
  async rejectStepToolCall(input: {
    toolCallId: string;
    taskId: string;
    stepId: string;
    tenantId: string;
    executionOwner: string;
    code: string;
    summary: string;
    errorMessage?: string;
  }): Promise<boolean> {
    return this.settleStepToolCall({
      ...input,
      expectedStatus: ToolCallStatus.PROPOSED,
      status: ToolCallStatus.REJECTED,
      executionToken: null,
      errorMessage: input.errorMessage ?? input.summary,
      result: { summary: input.summary, resourceType: null, resourceId: null, sources: [] },
    });
  }

  /** 同 rejectStepToolCall，但复用调用方事务：授权挂起与工具拒绝结果原子提交。 */
  async rejectStepToolCallInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
      toolCallId: string;
      taskId: string;
      stepId: string;
      tenantId: string;
      executionOwner: string;
      code: string;
      summary: string;
      errorMessage?: string;
    },
  ): Promise<boolean> {
    return this.settleStepToolCallInTransaction(transaction, {
      ...input,
      expectedStatus: ToolCallStatus.PROPOSED,
      status: ToolCallStatus.REJECTED,
      executionToken: null,
      errorMessage: input.errorMessage ?? input.summary,
      result: { summary: input.summary, resourceType: null, resourceId: null, sources: [] },
    });
  }

  /**
   * 同 completeStepToolCall，但复用调用方事务：提问挂起路径把「协议工具已受理」
   * 的 TOOL 消息与交互创建、步骤挂起原子提交。
   */
  async completeStepToolCallInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
      toolCallId: string;
      taskId: string;
      stepId: string;
      tenantId: string;
      executionOwner: string;
      summary: string;
    },
  ): Promise<boolean> {
    return this.settleStepToolCallInTransaction(transaction, {
      ...input,
      expectedStatus: ToolCallStatus.PROPOSED,
      status: ToolCallStatus.COMPLETED,
      executionToken: null,
      result: { summary: input.summary, resourceType: null, resourceId: null, sources: [] },
    });
  }

  /** 同 completeStepToolCallInTransaction 的非事务入口：提问抑制等「受理即完成」场景。 */
  async completeStepToolCallFromProposed(input: {
    toolCallId: string;
    taskId: string;
    stepId: string;
    tenantId: string;
    executionOwner: string;
    summary: string;
  }): Promise<boolean> {
    return this.prisma.$transaction((transaction) =>
      this.completeStepToolCallInTransaction(transaction, input));
  }

  /** 步骤成功回流：SUCCEEDED、终稿窗口消息与 step_completed 事件原子提交。 */
  async succeedStep(input: {
    taskId: string;
    stepId: string;
    stepKey: string;
    tenantId: string;
    executionOwner: string;
    summary: string;
    outputRefs: PublicTaskResourceRef[];
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.assistantTaskStep.updateMany({
        where: {
          id: input.stepId,
          taskId: input.taskId,
          tenantId: input.tenantId,
          status: AssistantTaskStepStatus.RUNNING,
          executionOwner: input.executionOwner,
          leaseExpiresAt: { gt: now },
        },
        data: {
          status: AssistantTaskStepStatus.SUCCEEDED,
          summary: input.summary,
          outputRefs: input.outputRefs as unknown as Prisma.InputJsonValue,
          completedAt: now,
          executionOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
        },
      });
      if (updated.count !== 1) return false;
      await writeStepMessage(transaction, {
        tenantId: input.tenantId,
        stepId: input.stepId,
        role: ConversationMessageRole.ASSISTANT,
        content: input.summary,
      });
      await this.events.appendInTransaction(transaction, input.taskId, input.tenantId, {
        type: 'step_completed',
        stepId: input.stepId,
        stepKey: input.stepKey,
        summary: input.summary,
        outputRefs: input.outputRefs,
      });
      return true;
    });
  }

  /** 步骤失败：FAILED、错误详情与 step_failed 事件原子提交。reason 为展示级文案。 */
  async failStep(input: {
    taskId: string;
    stepId: string;
    stepKey: string;
    tenantId: string;
    executionOwner: string;
    code: string;
    reason: string;
    /** 排障详情；缺省时与 reason 一致。 */
    detail?: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const updated = await transaction.assistantTaskStep.updateMany({
        where: {
          id: input.stepId,
          taskId: input.taskId,
          tenantId: input.tenantId,
          status: AssistantTaskStepStatus.RUNNING,
          executionOwner: input.executionOwner,
          leaseExpiresAt: { gt: now },
        },
        data: {
          status: AssistantTaskStepStatus.FAILED,
          error: {
            code: input.code,
            message: input.detail ?? input.reason,
          } as Prisma.InputJsonObject,
          completedAt: now,
          executionOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
        },
      });
      if (updated.count !== 1) return false;
      await this.events.appendInTransaction(transaction, input.taskId, input.tenantId, {
        type: 'step_failed',
        stepId: input.stepId,
        stepKey: input.stepKey,
        reason: input.reason,
      });
      return true;
    });
  }

  /**
   * 收束租约过期的 RUNNING 步骤（进程失联）：步骤 FAILED（M2 无重试阶梯，
   * 失败即终态；M3/M4 再引入重试与重排），执行中的工具标 RECOVERY_REQUIRED，
   * 未执行的调用标 REJECTED——与轮次恢复同一原则，禁止盲目重放副作用。
   */
  async recoverStaleSteps(taskId: string, now = new Date(), limit = 100): Promise<number> {
    const stale = await this.prisma.assistantTaskStep.findMany({
      where: {
        taskId,
        status: AssistantTaskStepStatus.RUNNING,
        leaseExpiresAt: { lte: now },
      },
      orderBy: { stepNo: 'asc' },
      take: limit,
      select: { id: true, stepKey: true, tenantId: true },
    });
    let recovered = 0;
    for (const step of stale) {
      try {
        const changed = await this.prisma.$transaction(async (transaction) => {
          const updated = await transaction.assistantTaskStep.updateMany({
            where: {
              id: step.id,
              taskId,
              status: AssistantTaskStepStatus.RUNNING,
              leaseExpiresAt: { lte: now },
            },
            data: {
              status: AssistantTaskStepStatus.FAILED,
              error: {
                code: 'STEP_EXECUTION_LOST',
                message: '步骤执行进程已失联，任务调度将按失败处理',
              } as Prisma.InputJsonObject,
              completedAt: now,
              executionOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: now,
            },
          });
          if (updated.count !== 1) return false;
          await this.reconcileToolsForSteps(transaction, {
            tenantId: step.tenantId,
            stepIds: [step.id],
            now,
            executingCode: 'TOOL_EXECUTION_RECOVERY_REQUIRED',
            executingMessage: '该操作在服务中断前未能确认结果，请稍后核对',
            pendingCode: 'STEP_EXECUTION_LOST',
            pendingMessage: '该操作因服务中断未能执行，请稍后重试',
          });
          await this.events.appendInTransaction(transaction, taskId, step.tenantId, {
            type: 'step_failed',
            stepId: step.id,
            stepKey: step.stepKey,
            reason: '步骤执行进程已失联，本步骤未完成',
          });
          return true;
        });
        if (changed) recovered++;
      } catch (error) {
        this.logger.error(`failed to reconcile stale task step ${step.id}: ${String(error)}`);
      }
    }
    return recovered;
  }

  /**
   * 任务级工具收束（供任务取消复用）：把指定步骤下所有非终态工具调用
   * 收束为 RECOVERY_REQUIRED / REJECTED，并写 TOOL 窗口消息、隐藏未完成图片。
   * 必须在调用方事务内执行，保证与任务终态迁移原子提交。
   */
  async reconcileTaskStepTools(
    transaction: Prisma.TransactionClient,
    input: {
      tenantId: string;
      stepIds: string[];
      now: Date;
      executingCode: string;
      executingMessage: string;
      pendingCode: string;
      pendingMessage: string;
    },
  ): Promise<void> {
    await this.reconcileToolsForSteps(transaction, input);
  }

  /**
   * 结算步内工具调用的唯一实现：条件更新（预期前态 + 步骤租约有效）成功才
   * 写 TOOL 窗口消息；任何一步失败即整体回滚，不产生半截状态。
   */
  private async settleStepToolCall(input: {
    toolCallId: string;
    taskId: string;
    stepId: string;
    tenantId: string;
    executionOwner: string;
    expectedStatus: ToolCallStatus;
    status: ToolCallStatus;
    executionToken: string | null;
    code?: string;
    summary: string;
    errorMessage?: string;
    result: StepToolResult;
  }): Promise<boolean> {
    return this.prisma.$transaction((transaction) =>
      this.settleStepToolCallInTransaction(transaction, input));
  }

  /** 结算的事务内实现；授权挂起路径与工具拒绝结果同事务提交（见 rejectStepToolCallInTransaction）。 */
  private async settleStepToolCallInTransaction(
    transaction: Prisma.TransactionClient,
    input: {
      toolCallId: string;
      taskId: string;
      stepId: string;
      tenantId: string;
      executionOwner: string;
      expectedStatus: ToolCallStatus;
      status: ToolCallStatus;
      executionToken: string | null;
      code?: string;
      summary: string;
      errorMessage?: string;
      result: StepToolResult;
    },
  ): Promise<boolean> {
    const settled = input.status === ToolCallStatus.COMPLETED;
    const now = new Date();
    const updated = await transaction.toolCall.updateMany({
      where: {
        id: input.toolCallId,
        taskStepId: input.stepId,
        tenantId: input.tenantId,
        status: input.expectedStatus,
        taskStep: {
          is: {
            id: input.stepId,
            taskId: input.taskId,
            status: AssistantTaskStepStatus.RUNNING,
            executionOwner: input.executionOwner,
            leaseExpiresAt: { gt: now },
          },
        },
        ...(input.executionToken
          ? { executionToken: input.executionToken, leaseExpiresAt: { gt: now } }
          : {}),
      },
      data: {
        status: input.status,
        completedAt: now,
        leaseExpiresAt: null,
        result: input.result as unknown as Prisma.InputJsonObject,
        errorCode: settled ? null : input.code ?? 'TOOL_EXECUTION_FAILED',
        errorMessage: settled ? null : input.errorMessage ?? input.summary,
        executedResourceType: input.result.resourceType,
        executedResourceId: input.result.resourceId,
      },
    });
    if (updated.count !== 1) return false;
    await writeStepMessage(transaction, {
      tenantId: input.tenantId,
      stepId: input.stepId,
      role: ConversationMessageRole.TOOL,
      content: input.summary,
      toolCallRef: input.toolCallId,
    });
    return true;
  }

  /**
   * 收束指定步骤集合下所有非终态工具调用：EXECUTING → RECOVERY_REQUIRED
   * （副作用状态未知，禁止自动重放），PROPOSED/APPROVED → REJECTED（从未执行）。
   * 未完成的图片占位符同步处理，避免恢复后暴露「疑似可用」的资源。
   */
  private async reconcileToolsForSteps(
    transaction: Prisma.TransactionClient,
    input: {
      tenantId: string;
      stepIds: string[];
      now: Date;
      executingCode: string;
      executingMessage: string;
      pendingCode: string;
      pendingMessage: string;
    },
  ): Promise<void> {
    if (input.stepIds.length === 0) return;
    const calls = await transaction.toolCall.findMany({
      where: {
        tenantId: input.tenantId,
        taskStepId: { in: input.stepIds },
        status: {
          in: [ToolCallStatus.PROPOSED, ToolCallStatus.APPROVED, ToolCallStatus.EXECUTING],
        },
      },
      orderBy: { seq: 'asc' },
      select: { id: true, taskStepId: true, status: true },
    });
    if (calls.length === 0) return;

    const callIds = calls.map((call) => call.id);
    // 图片占位可能在模型调用前（PENDING）或上传过程中（GENERATING/UPLOADING）；
    // 全部标记为不可用，防止失败/取消的任务暴露可用占位。
    const unfinishedImages = await transaction.managedImage.findMany({
      where: {
        toolCallId: { in: callIds },
        status: {
          in: [
            ManagedImageStatus.PENDING,
            ManagedImageStatus.GENERATING,
            ManagedImageStatus.UPLOADING,
          ],
        },
      },
      select: { id: true, status: true },
    });

    for (const call of calls) {
      if (!call.taskStepId) continue;
      const executing = call.status === ToolCallStatus.EXECUTING;
      const code = executing ? input.executingCode : input.pendingCode;
      const message = executing ? input.executingMessage : input.pendingMessage;
      const updated = await transaction.toolCall.updateMany({
        where: {
          id: call.id,
          taskStepId: call.taskStepId,
          tenantId: input.tenantId,
          status: call.status,
        },
        data: {
          status: executing ? ToolCallStatus.RECOVERY_REQUIRED : ToolCallStatus.REJECTED,
          completedAt: input.now,
          leaseExpiresAt: null,
          executionToken: null,
          errorCode: code,
          errorMessage: message,
          result: {
            summary: message,
            resourceType: null,
            resourceId: null,
            sources: [],
          } as Prisma.InputJsonObject,
        },
      });
      if (updated.count !== 1) continue;
      await writeStepMessage(transaction, {
        tenantId: input.tenantId,
        stepId: call.taskStepId,
        role: ConversationMessageRole.TOOL,
        content: message,
        toolCallRef: call.id,
      });
    }

    if (unfinishedImages.length > 0) {
      const imageIds = unfinishedImages.map((image) => image.id);
      await transaction.managedImage.updateMany({
        where: { id: { in: imageIds }, status: ManagedImageStatus.PENDING },
        data: {
          status: ManagedImageStatus.FAILED,
          failureCode: input.pendingCode,
          failureMessage: input.pendingMessage,
        },
      });
      await transaction.managedImage.updateMany({
        where: { id: { in: imageIds }, status: ManagedImageStatus.GENERATING },
        data: {
          status: ManagedImageStatus.FAILED,
          failureCode: input.executingCode,
          failureMessage: input.executingMessage,
        },
      });
      await transaction.managedImage.updateMany({
        where: { id: { in: imageIds }, status: ManagedImageStatus.UPLOADING },
        data: {
          status: ManagedImageStatus.ORPHANED,
          failureCode: input.executingCode,
          failureMessage: input.executingMessage,
        },
      });
    }
  }
}

/**
 * 事务内写步骤窗口消息：seq 分配（最大 + 1）与插入同事务——
 * 步骤租约串行独占，不存在并发插入竞态。交互解决（答复注入）与超时提示
 * 共用本函数，导出给 interaction.service 复用。
 */
export async function writeStepMessage(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    stepId: string;
    role: ConversationMessageRole;
    content: string;
    toolCallRef?: string;
  },
): Promise<void> {
  const tail = await transaction.assistantTaskStepMessage.findFirst({
    where: { stepId: input.stepId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  await transaction.assistantTaskStepMessage.create({
    data: {
      tenantId: input.tenantId,
      stepId: input.stepId,
      seq: (tail?.seq ?? 0) + 1,
      role: input.role,
      content: input.content,
      toolCallRef: input.toolCallRef ?? null,
    },
  });
}

function isUniqueConstraintError(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const needle = field.replace(/[_\s-]/g, '').toLowerCase();
  const parts = Array.isArray(target) ? target : target === undefined ? [] : [target];
  return parts.some((entry) => String(entry).replace(/[_\s-]/g, '').toLowerCase().includes(needle));
}
