import { Logger } from '@nestjs/common';

/** 任务与步骤的执行租约时长：一次续约覆盖的窗口（与轮次租约同构）。 */
export const TASK_LEASE_MS = 60_000;
/** 任务/步骤心跳间隔：远小于租约时长，保证续约失败能及时暴露。 */
export const TASK_HEARTBEAT_INTERVAL_MS = 15_000;
/** 任务恢复扫描间隔：收束「RUNNING 且租约过期」的任务与步骤。 */
export const TASK_RECOVERY_INTERVAL_MS = 30_000;

/**
 * 单个步骤窗口的硬上限：最多模型调用次数与工具调用提案数。
 * 数值与轮次执行（MAX_TOOL_TURNS / MAX_TOOL_STEPS）一致，超限即步骤失败。
 */
export const MAX_STEP_MODEL_CALLS = 5;
export const MAX_STEP_TOOL_CALLS = 10;

/** 步骤回流摘要的字符上限；超出部分截断（完整内容在产出资产与窗口消息中）。 */
export const MAX_STEP_SUMMARY_CHARS = 2000;

/** 步骤自动播报任务事件的进度文案里允许出现的工具名上限（防御性截断）。 */
export const STEP_PROGRESS_NOTE_MAX_CHARS = 200;

export function nextTaskLease(now = new Date()): Date {
  return new Date(now.getTime() + TASK_LEASE_MS);
}

/**
 * 防滥用配置（需求 §6.2 对齐）：单任务内授权申请 / 提问的创建次数上限。
 * 超限不再自动挂起新事项（授权驳回并提示人工处理；提问按 proceed 继续），
 * 防“反复弹窗”式滥用。<=0 表示不限。
 */
export interface OrchestrationGuards {
  maxAuthorizationsPerTask: number;
  maxQuestionsPerTask: number;
}

const DEFAULT_MAX_AUTHORIZATIONS_PER_TASK = 10;
const DEFAULT_MAX_QUESTIONS_PER_TASK = 10;

/** 挂起超时策略（需求 §6.3）：默认无限等待；可配“按默认值继续 / 跳过该步骤 / 终止任务”。 */
export type SuspendTimeoutAction = 'continue_default' | 'skip_step' | 'fail_task';

export interface SuspendTimeoutConfig {
  /** 超时分钟数；0 表示无限等待（默认）。 */
  timeoutMinutes: number;
  /** 超时后的动作。 */
  action: SuspendTimeoutAction;
}

const guardLogger = new Logger('OrchestrationGuardsConfig');

export function loadOrchestrationGuards(
  env: NodeJS.ProcessEnv = process.env,
): OrchestrationGuards {
  return {
    maxAuthorizationsPerTask: readCount(
      env.ORCHESTRATION_MAX_AUTHORIZATIONS_PER_TASK,
      DEFAULT_MAX_AUTHORIZATIONS_PER_TASK,
    ),
    maxQuestionsPerTask: readCount(
      env.ORCHESTRATION_MAX_QUESTIONS_PER_TASK,
      DEFAULT_MAX_QUESTIONS_PER_TASK,
    ),
  };
}

export function loadSuspendTimeoutConfig(
  env: NodeJS.ProcessEnv = process.env,
): SuspendTimeoutConfig {
  return {
    timeoutMinutes: readCount(env.ORCHESTRATION_SUSPEND_TIMEOUT_MINUTES, 0),
    action: readTimeoutAction(env.ORCHESTRATION_SUSPEND_TIMEOUT_ACTION),
  };
}

function readCount(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    guardLogger.warn(`invalid numeric config "${value}", falling back to ${fallback}`);
    return fallback;
  }
  return parsed;
}

function readTimeoutAction(value: string | undefined): SuspendTimeoutAction {
  if (!value || value === 'continue_default') return 'continue_default';
  if (value === 'skip_step' || value === 'fail_task') return value;
  guardLogger.warn(
    `unknown ORCHESTRATION_SUSPEND_TIMEOUT_ACTION "${value}", falling back to continue_default`,
  );
  return 'continue_default';
}
