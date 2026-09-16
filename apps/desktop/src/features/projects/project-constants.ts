import type { ProjectMemberRole, ProjectStatus, ProjectTransitionAction, TaskPriority, TaskStatus } from '../../core/api';

export const projectStatusLabels: Record<ProjectStatus, string> = {
    PLANNING: '规划中',
    ACTIVE: '进行中',
    PAUSED: '已暂停',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
    ARCHIVED: '已归档',
};

export const projectStatusColors: Record<ProjectStatus, string> = {
    PLANNING: 'default',
    ACTIVE: 'processing',
    PAUSED: 'warning',
    COMPLETED: 'success',
    CANCELLED: 'error',
    ARCHIVED: 'default',
};

export const projectMemberRoleLabels: Record<ProjectMemberRole, string> = {
    OWNER: '负责人',
    MANAGER: '项目经理',
    MEMBER: '项目成员',
};

export const taskStatusLabels: Record<TaskStatus, string> = {
    TODO: '待处理',
    IN_PROGRESS: '进行中',
    BLOCKED: '已阻塞',
    DONE: '已完成',
    CANCELLED: '已取消',
};

export const taskStatusColors: Record<TaskStatus, string> = {
    TODO: 'default',
    IN_PROGRESS: 'processing',
    BLOCKED: 'warning',
    DONE: 'success',
    CANCELLED: 'error',
};

export const taskPriorityLabels: Record<TaskPriority, string> = {
    LOW: '低',
    MEDIUM: '中',
    HIGH: '高',
    URGENT: '紧急',
};

export interface ProjectTransitionOption {
    action: ProjectTransitionAction;
    label: string;
    reason?: 'optional' | 'required';
    summary?: boolean;
}

export const projectTransitions: Record<ProjectStatus, ProjectTransitionOption[]> = {
    PLANNING: [{ action: 'start', label: '启动项目' }],
    ACTIVE: [
        { action: 'pause', label: '暂停' },
        { action: 'complete', label: '完成项目', summary: true },
        { action: 'cancel', label: '取消', reason: 'required' },
    ],
    PAUSED: [
        { action: 'resume', label: '恢复' },
        { action: 'cancel', label: '取消', reason: 'required' },
    ],
    COMPLETED: [
        { action: 'reopen', label: '重新开启', reason: 'required' },
        { action: 'archive', label: '归档' },
    ],
    CANCELLED: [],
    ARCHIVED: [{ action: 'restore', label: '恢复归档' }],
};

export const taskTransitions: Record<TaskStatus, Array<{ to: TaskStatus; reason?: boolean }>> = {
    TODO: [{ to: 'IN_PROGRESS' }, { to: 'CANCELLED', reason: true }],
    IN_PROGRESS: [{ to: 'BLOCKED', reason: true }, { to: 'DONE' }, { to: 'CANCELLED', reason: true }],
    BLOCKED: [{ to: 'IN_PROGRESS' }, { to: 'DONE' }, { to: 'CANCELLED', reason: true }],
    DONE: [],
    CANCELLED: [],
};

/** 已完成、已取消和已归档项目禁止修改资料与成员。 */
export function isReadOnlyProject(status: ProjectStatus): boolean {
    return status === 'COMPLETED' || status === 'CANCELLED' || status === 'ARCHIVED';
}
