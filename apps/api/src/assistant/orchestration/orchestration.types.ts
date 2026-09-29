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
  /** 重排沿用的历史步骤 stepKey（该步骤产出直接沿用、不再执行）；无则省略。 */
  carriedFromStepKey?: string | null;
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

export type PublicTaskInteractionType = 'AUTHORIZATION' | 'QUESTION' | 'DECISION';

export type PublicTaskInteractionStatus =
  | 'PENDING'
  | 'RESOLVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

/** 临时授权范围：仅本次有效 / 本任务内多次有效。 */
export type PublicTaskInteractionScope = 'ONCE' | 'TASK';

/** 提问与裁决的候选项（与契约 AssistantTaskInteractionOption 一致）。 */
export interface PublicTaskInteractionOption {
  id: string;
  label: string;
  description?: string | null;
}

/** 挂起事项公开形态（与契约 AssistantTaskInteraction 一致）。 */
export interface PublicTaskInteraction {
  id: string;
  taskId: string;
  stepId: string | null;
  /** 触发步骤的计划内稳定标识（展示用）；任务级事项为 null。 */
  stepKey: string | null;
  type: PublicTaskInteractionType;
  status: PublicTaskInteractionStatus;
  /** 展示级摘要：授权=要执行的动作与影响；提问=问题文本；裁决=分岔说明。 */
  summary: string;
  /** 需要用户介入的原因：授权理由 / 提问背景 / 裁决背景。 */
  reason: string | null;
  options: PublicTaskInteractionOption[];
  /** 临时授权范围；批准后填充（仅 AUTHORIZATION）。 */
  scope: PublicTaskInteractionScope | null;
  /** 用户解决内容（所选候选 id / 答复文本 / approve·reject）；未解决为 null。 */
  resolution: string | null;
  resolvedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface PublicTaskDetail {
  task: PublicTask;
  /** 当前最新计划版本；PENDING_CONFIRM 阶段即待确认草案。 */
  currentPlan: PublicTaskPlan | null;
  /** 当前生效计划的运行时步骤；计划确认前为空数组。 */
  steps: PublicTaskStep[];
  /** 挂起事项列表（含已解决历史，按创建时间升序）。 */
  interactions: PublicTaskInteraction[];
}

export interface PublicTaskListResult {
  items: PublicTask[];
  nextCursor: string | null;
}

/** 知识库可见范围（与契约 KnowledgeBaseVisibilityScope 一致）。 */
export type PublicTaskVisibilityScope = 'PRIVATE' | 'DEPARTMENT' | 'PROJECT' | 'TENANT';

/** 产出归档结果（与契约 AssistantTaskOutputArchive 一致）。 */
export interface PublicTaskOutputArchive {
  knowledgeBaseId: string;
  /** 知识库侧文档 ID（转存产物；同源重复转存追加版本）。 */
  knowledgeDocumentId: string;
  visibilityScope: PublicTaskVisibilityScope;
  confirmedAt: Date;
}

/** 归档目标建议（与契约 AssistantTaskOutputSuggestion 一致）。 */
export interface PublicTaskOutputSuggestion {
  knowledgeBaseId: string;
  /** 推荐理由（规则路径=组织归属；LLM 路径=模型基于产出主题给出）。 */
  reason: string;
}

/** 可归档知识库候选（与契约 AssistantTaskOutputArchiveOption 一致）。 */
export interface PublicTaskOutputArchiveOption {
  knowledgeBaseId: string;
  name: string;
  visibilityScope: PublicTaskVisibilityScope;
}

/** 产出验收条目（与契约 AssistantTaskOutput 一致）。 */
export interface PublicTaskOutput {
  /** 产出资产（AI 文档）；验收与归档的载体。 */
  documentId: string;
  title: string;
  /** 产出步骤的计划内稳定标识。 */
  stepKey: string;
  /** 产出步骤的简短名；计划未给出时为 null。 */
  stepTitle: string | null;
  /** 内容验收与归档确认是否已完成。 */
  confirmed: boolean;
  /** 已确认时的归档结果；未确认为 null。 */
  archive: PublicTaskOutputArchive | null;
  /** 归档目标建议；未确认时给出，已确认时为空数组。 */
  suggestions: PublicTaskOutputSuggestion[];
}

/** 产出验收视图（与契约 AssistantTaskOutputsView 一致）。 */
export interface PublicTaskOutputsView {
  taskId: string;
  status: PublicTaskStatus;
  outputs: PublicTaskOutput[];
  /** 可归档知识库候选（当前成员具 EDITOR 及以上；服务端权限硬过滤）。 */
  archiveOptions: PublicTaskOutputArchiveOption[];
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
  | {
    type: 'plan_revision_requested';
    seq: number;
    /** 请求调整时的当前计划版本（调整内容在对话中提出，随后生成新版本草案）。 */
    version: number;
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
  | {
    type: 'interaction_requested';
    seq: number;
    interactionId: string;
    interactionType: PublicTaskInteractionType;
    stepId: string | null;
    stepKey: string | null;
    /** 展示级摘要（授权动作 / 问题 / 分岔说明）。 */
    summary: string;
    reason: string | null;
    options: PublicTaskInteractionOption[];
    expiresAt: string | null;
  }
  | {
    type: 'interaction_resolved';
    seq: number;
    interactionId: string;
    interactionType: PublicTaskInteractionType;
    stepId: string | null;
    stepKey: string | null;
    /** 解决后状态：RESOLVED 已处理；REJECTED 已拒绝；EXPIRED 超时失效；CANCELLED 任务终态清理。 */
    status: Exclude<PublicTaskInteractionStatus, 'PENDING'>;
    /** 所选候选 id 或答复文本；拒绝与系统清理时为 null。 */
    value: string | null;
    /** 临时授权范围（仅授权批准）。 */
    scope: PublicTaskInteractionScope | null;
    resolvedAt: string;
  }
  | {
    type: 'output_confirmed';
    seq: number;
    /** 产出资产 ID（步骤回流的 AI 文档）。 */
    documentId: string;
    knowledgeBaseId: string;
    /** 知识库侧文档 ID（同源重复转存追加版本，不重复归档）。 */
    knowledgeDocumentId: string;
    visibilityScope: PublicTaskVisibilityScope;
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
    case 'plan_revision_requested': return AssistantTaskEventType.PLAN_REVISION_REQUESTED;
    case 'plan_confirmed': return AssistantTaskEventType.PLAN_CONFIRMED;
    case 'step_started': return AssistantTaskEventType.STEP_STARTED;
    case 'step_progress': return AssistantTaskEventType.STEP_PROGRESS;
    case 'step_completed': return AssistantTaskEventType.STEP_COMPLETED;
    case 'step_failed': return AssistantTaskEventType.STEP_FAILED;
    case 'step_skipped': return AssistantTaskEventType.STEP_SKIPPED;
    case 'interaction_requested': return AssistantTaskEventType.INTERACTION_REQUESTED;
    case 'interaction_resolved': return AssistantTaskEventType.INTERACTION_RESOLVED;
    case 'output_confirmed': return AssistantTaskEventType.OUTPUT_CONFIRMED;
    case 'task_completed': return AssistantTaskEventType.TASK_COMPLETED;
    case 'task_failed': return AssistantTaskEventType.TASK_FAILED;
    case 'task_cancelled': return AssistantTaskEventType.TASK_CANCELLED;
  }
}
