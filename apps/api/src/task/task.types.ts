import { TaskAssigneeType, TaskPriority, TaskStatus } from '@prisma/client';

export interface TaskMemberResult {
    membershipId: string;
    account: string;
    displayName: string;
    departmentId: string | null;
}

export interface TaskAssigneeResult extends TaskMemberResult {
    type: TaskAssigneeType;
}

export interface TaskResult {
    id: string;
    projectId: string;
    parentId: string | null;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: Date | null;
    owner: TaskAssigneeResult | null;
    collaborators: TaskAssigneeResult[];
    subtaskCount: number;
    commentCount: number;
    attachmentCount: number;
    createdAt: Date;
    updatedAt: Date;
    version: number;
}

export interface TaskListResult {
    items: TaskResult[];
    nextCursor: string | null;
}

export interface TaskCommentResult {
    id: string;
    taskId: string;
    content: string;
    author: TaskMemberResult;
    createdAt: Date;
    updatedAt: Date;
    version: number;
}

export interface TaskCommentListResult {
    items: TaskCommentResult[];
    nextCursor: string | null;
}

export interface TaskAttachmentResult {
    id: string;
    taskId: string;
    fileObjectId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdByMembershipId: string;
    createdAt: Date;
    version: number;
}

export interface TaskAttachmentListResult {
    items: TaskAttachmentResult[];
}

export interface TaskActivityResult {
    id: string;
    taskId: string;
    action: string;
    actor: TaskMemberResult | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
}

export interface TaskActivityListResult {
    items: TaskActivityResult[];
    nextCursor: string | null;
}
