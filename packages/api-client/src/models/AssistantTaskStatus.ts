/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
/**
 * 任务状态：CREATED 计划生成中；PENDING_CONFIRM 等待用户确认计划（确认前不派发）；
 * RUNNING 执行中；WAITING_USER 存在挂起事项（其余步骤可继续）；
 * 终态包括 COMPLETED / FAILED / CANCELLED。
 *
 */
export enum AssistantTaskStatus {
    CREATED = 'CREATED',
    PENDING_CONFIRM = 'PENDING_CONFIRM',
    RUNNING = 'RUNNING',
    WAITING_USER = 'WAITING_USER',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
}
