/**
 * 编排决策器抽象位（技术设计 §6）：编排代码只依赖本接口，v1 由「规则 + LLM」
 * 组合实现，v2 接入 JEV 时只替换工厂装配（流程代码零改动）。
 */
export type DecisionType =
  | 'SUFFICIENCY_CHECK'
  | 'ROUTING'
  | 'COMPLETION_CHECK'
  | 'RISK_SCORE'
  | 'REPLAN_TRIGGER';

/** 任务状态快照：结构化事实，决策时刻从数据库现读（不以内存态为准）。 */
export interface DecisionTaskSnapshot {
  taskId: string;
  goal: string;
  /** 当前生效计划版本。 */
  planVersion: number;
  steps: Array<{
    stepKey: string;
    title: string | null;
    status: string;
    summary: string | null;
  }>;
}

/** 判定场景的当前步骤上下文；信息充分性判定携带拟提问内容与防滥用统计。 */
export interface DecisionStepResult {
  stepKey: string;
  stepTitle: string | null;
  summary: string | null;
  question?: {
    kind: 'question' | 'decision';
    summary: string;
    optionCount: number;
  };
  sufficiency?: {
    /** 本任务已创建的提问 / 裁决事项数（含未决，防滥用上限判定用）。 */
    askedCount: number;
    /** 单任务上限；<= 0 表示不限。 */
    maxQuestions: number;
    /** 同任务内已存在未决的同类问题（去重防御）。 */
    duplicatePending: boolean;
  };
}

export interface DecisionInput {
  decisionType: DecisionType;
  /** 调用载体（模型调用与审计所需），不参与判定语义。 */
  context: {
    tenantId: string;
    userId: string;
    requestId: string;
  };
  taskSnapshot: DecisionTaskSnapshot;
  stepResult?: DecisionStepResult;
}

export interface Decision {
  /** 选项（SUFFICIENCY_CHECK 取值见 SufficiencyChoice）。 */
  choice: string;
  /** 0~1：规则路径为 1（确定性）；LLM 路径为模型自评，按阈值分流。 */
  confidence: number;
  /** 判定理由（进审计与排障）。 */
  rationale?: string;
}

/** SUFFICIENCY_CHECK 的 choice：ask_user=需要用户介入（挂起提问）；proceed=可自主继续。 */
export const SUFFICIENCY_CHOICES = ['ask_user', 'proceed'] as const;
export type SufficiencyChoice = (typeof SUFFICIENCY_CHOICES)[number];

export interface OrchestrationDecider {
  decide(input: DecisionInput): Promise<Decision>;
}

/** 决策器装配令牌；业务只注入该令牌，不直接依赖具体实现。 */
export const ORCHESTRATION_DECIDER = Symbol('ORCHESTRATION_DECIDER');
