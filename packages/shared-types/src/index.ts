export type DataScope = 'SELF' | 'DEPARTMENT' | 'DEPARTMENT_TREE' | 'PROJECT' | 'CUSTOM' | 'TENANT';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
export type AIActionDraftStatus =
    | 'DRAFT'
    | 'PENDING_CONFIRMATION'
    | 'CONFIRMED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'EXECUTED'
    | 'FAILED';

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    requestId?: string;
}