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
