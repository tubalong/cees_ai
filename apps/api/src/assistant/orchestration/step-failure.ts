/**
 * 失败阶梯的可重试判定（需求 §8.1）：白名单只收录「重放安全且预期瞬时」的错误码，
 * 未收录的一律不可自动重试、直接升级用户裁决——避免对权限失效、预算超限、
 * 上游永久拒绝等确定性失败做无意义的重复尝试。
 */
export const RETRYABLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  /** 调度层未处理异常（transient 兜底）。 */
  'STEP_EXECUTION_ERROR',
  /** 执行进程失联（租约过期收束）。 */
  'STEP_EXECUTION_LOST',
  /** 上游流未正常完成。 */
  'AI_SERVICE_INVALID_RESPONSE',
  /** AI 服务暂不可用 / 未就绪。 */
  'AI_SERVICE_UNAVAILABLE',
  'AI_SERVICE_NOT_READY',
  /** 网关层请求处理失败兜底。 */
  'TURN_REQUEST_FAILED',
]);

export function isRetryableFailureCode(code: string): boolean {
  return RETRYABLE_FAILURE_CODES.has(code);
}

/**
 * 失败处置的裁决动作（升级交互的候选项 id，与 resolution.value 一致）。
 * replan（调整计划）不落步骤状态：任务保持挂起，由重排链路生成新版本后再次确认。
 */
export const FAILURE_DECISION_ACTIONS = ['retry', 'skip', 'abort', 'replan'] as const;
export type FailureDecisionAction = (typeof FAILURE_DECISION_ACTIONS)[number];

export function isFailureDecisionAction(value: string): value is FailureDecisionAction {
  return (FAILURE_DECISION_ACTIONS as readonly string[]).includes(value);
}
