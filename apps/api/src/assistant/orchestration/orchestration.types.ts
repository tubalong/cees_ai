import { AssistantTaskEventType } from '@prisma/client';

/**
 * 公开 /assistant/tasks 资源类型，与 packages/contracts 的 AssistantTask 系列
 * schema 一一对应；契约是唯一事实源，本文件仅提供 NestJS 实现侧的类型约束。
 */
export type PublicTaskStatus =
  | 'CREATED'
  | 'PENDING_CONFIRM'
  | 'RUNNING'
  | 'WAITING_USER'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type PublicTaskOriginType = 'CONVERSATION' | 'AGENT_CHAT' | 'AUTO';

export type PublicTaskStepStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'WAITING_USER'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED';

export type PublicTaskPlanCreatedBy = 'USER' | 'SYSTEM';

/** 任务终态：终态后不再发生状态迁移，事件流随之结束。 */
export function isTerminalTaskStatus(status: PublicTaskStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

/** 计划步骤快照；plans.steps JSON 的元素结构，与契约 AssistantTaskPlanStep 一致。 */
export interface PublicTaskPlanStep {
  stepNo: number;
  /** 计划内稳定标识（s1、s2……），由服务端按顺序生成。 */
  stepKey: string;
  /** 步骤简短名（如「收集销售数据」）；模型未给出时省略。 */
  title?: string;
  requirement: string;
  assigneeAgentId: string;
  /** 执行同事名称快照，展示用；确认后执行同事档案改名不影响已确认计划。 */
  assigneeName?: string;
  expectedOutput?: string | null;
  /** 前置步骤的 stepKey；空数组表示可立即开始。 */
  dependsOnStepKeys: string[];
}

export interface PublicTaskClarificationOption {
  id: string;
  label: string;
  description?: string | null;
}

export interface PublicTaskClarification {
  key: string;
  question: string;
  options: PublicTaskClarificationOption[];
  /** 用户答复（所选选项 id）；未答复为 null。 */
  answer: string | null;
}

export interface PublicTask {
  id: string;
  title: string;
  goal: string;
  status: PublicTaskStatus;
  originType: PublicTaskOriginType;
  /** 发起会话；AUTO 来源（主动建议转任务）可为 null。 */
  conversationId: string | null;
  /** 当前生效计划版本；计划确认前为 0。 */
  planVersion: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  failedReason: string | null;
}

export interface PublicTaskPlan {
  version: number;
  createdBy: PublicTaskPlanCreatedBy;
  confirmedAt: Date | null;
  createdAt: Date;
  steps: PublicTaskPlanStep[];
  clarifications: PublicTaskClarification[];
}

export interface PublicTaskStep {
  id: string;
  stepNo: number;
  stepKey: string;
  planVersion: number;
  status: PublicTaskStepStatus;
  assigneeAgentId: string | null;
  assigneeName: string | null;
  summary: string | null;
  /** 产出资产引用列表；尚未回流时为空数组（与契约 ToolResultResourceReference 一致）。 */
  outputRefs: PublicTaskResourceRef[];
  attemptNo: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** 产出资产引用（与契约 ToolResultResourceReference 一致）；不含签名 URL。 */
export interface PublicTaskResourceRef {
  type: 'IMAGE' | 'DOCUMENT';
  id: string;
}

export interface PublicTaskDetail {
  task: PublicTask;
  /** 当前最新计划版本；PENDING_CONFIRM 阶段即待确认草案。 */
  currentPlan: PublicTaskPlan | null;
  /** 当前生效计划的运行时步骤；计划确认前为空数组。 */
  steps: PublicTaskStep[];
}

export interface PublicTaskListResult {
  items: PublicTask[];
  nextCursor: string | null;
}

/**
 * 任务事件流（SSE）联合，与契约 AssistantTaskStreamEvent 一一对应；
 * 步骤级事件（step_*）由执行器（task-runner / step-runner）在 M2 产出。
 * 事件 payload 直接以 JSON 落库并原样透传，时间字段使用 ISO 字符串。
 */
export type PublicTaskStreamEvent =
  | { type: 'task_created'; seq: number; status: PublicTaskStatus }
  | {
    type: 'plan_ready';
    seq: number;
    version: number;
    steps: PublicTaskPlanStep[];
    clarifications: PublicTaskClarification[];
  }
  | { type: 'plan_confirmed'; seq: number; version: number; confirmedAt: string }
  | {
    type: 'step_started';
    seq: number;
    stepId: string;
    stepKey: string;
    stepNo: number;
    /** 步骤简短名；计划未给出时为 null。 */
    title: string | null;
    /** 执行同事名称（实时解析）；档案缺失时为 null。 */
    assigneeName: string | null;
  }
  | {
    type: 'step_progress';
    seq: number;
    stepId: string;
    stepKey: string;
    /** 进度说明（展示级），例如正在执行的动作。 */
    note: string;
  }
  | {
    type: 'step_completed';
    seq: number;
    stepId: string;
    stepKey: string;
    /** 步骤结果摘要（回流总管与展示）。 */
    summary: string;
    /** 产出资产引用；无产出时为空数组。 */
    outputRefs: PublicTaskResourceRef[];
  }
  | {
    type: 'step_failed';
    seq: number;
    stepId: string;
    stepKey: string;
    /** 失败原因摘要（展示级）。 */
    reason: string | null;
  }
  | {
    type: 'step_skipped';
    seq: number;
    stepId: string;
    stepKey: string;
    /** 跳过原因摘要（展示级）。 */
    reason: string | null;
  }
  | { type: 'task_completed'; seq: number }
  | { type: 'task_failed'; seq: number; reason: string | null }
  | { type: 'task_cancelled'; seq: number };

/** 分配 seq 前的待写入事件。 */
export type PendingTaskStreamEvent = DistributiveOmit<PublicTaskStreamEvent, 'seq'>;

/** Omit 对联合类型会退化为公共属性；分配式 Omit 保留每个成员的结构。 */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** 公开事件名（契约）→ DB 存储枚举。 */
export function toAssistantTaskEventType(
  type: PublicTaskStreamEvent['type'],
): AssistantTaskEventType {
  switch (type) {
    case 'task_created': return AssistantTaskEventType.TASK_CREATED;
    case 'plan_ready': return AssistantTaskEventType.PLAN_READY;
    case 'plan_confirmed': return AssistantTaskEventType.PLAN_CONFIRMED;
    case 'step_started': return AssistantTaskEventType.STEP_STARTED;
    case 'step_progress': return AssistantTaskEventType.STEP_PROGRESS;
    case 'step_completed': return AssistantTaskEventType.STEP_COMPLETED;
    case 'step_failed': return AssistantTaskEventType.STEP_FAILED;
    case 'step_skipped': return AssistantTaskEventType.STEP_SKIPPED;
    case 'task_completed': return AssistantTaskEventType.TASK_COMPLETED;
    case 'task_failed': return AssistantTaskEventType.TASK_FAILED;
    case 'task_cancelled': return AssistantTaskEventType.TASK_CANCELLED;
  }
}
