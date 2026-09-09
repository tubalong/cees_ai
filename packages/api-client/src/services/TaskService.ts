/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddTaskAttachmentRequest } from '../models/AddTaskAttachmentRequest';
import type { CreateTaskCommentRequest } from '../models/CreateTaskCommentRequest';
import type { CreateTaskRequest } from '../models/CreateTaskRequest';
import type { ReplaceTaskAssigneesRequest } from '../models/ReplaceTaskAssigneesRequest';
import type { TaskActivityListResponseEnvelope } from '../models/TaskActivityListResponseEnvelope';
import type { TaskAttachmentListResponseEnvelope } from '../models/TaskAttachmentListResponseEnvelope';
import type { TaskAttachmentResponseEnvelope } from '../models/TaskAttachmentResponseEnvelope';
import type { TaskCommentListResponseEnvelope } from '../models/TaskCommentListResponseEnvelope';
import type { TaskCommentResponseEnvelope } from '../models/TaskCommentResponseEnvelope';
import type { TaskListResponseEnvelope } from '../models/TaskListResponseEnvelope';
import type { TaskPriority } from '../models/TaskPriority';
import type { TaskResponseEnvelope } from '../models/TaskResponseEnvelope';
import type { TaskStatus } from '../models/TaskStatus';
import type { TaskTransitionRequest } from '../models/TaskTransitionRequest';
import type { UpdateTaskCommentRequest } from '../models/UpdateTaskCommentRequest';
import type { UpdateTaskRequest } from '../models/UpdateTaskRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TaskService {
    /**
     * 查询项目任务
     * @returns TaskListResponseEnvelope 当前项目任务列表
     * @throws ApiError
     */
    public static taskList({
        projectId,
        keyword,
        status,
        priority,
        assigneeMembershipId,
        parentId,
        rootOnly = false,
        limit = 20,
        cursor,
    }: {
        projectId: string,
        keyword?: string,
        status?: TaskStatus,
        priority?: TaskPriority,
        assigneeMembershipId?: string,
        parentId?: string,
        rootOnly?: boolean,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<TaskListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/tasks',
            path: {
                'projectId': projectId,
            },
            query: {
                'keyword': keyword,
                'status': status,
                'priority': priority,
                'assigneeMembershipId': assigneeMembershipId,
                'parentId': parentId,
                'rootOnly': rootOnly,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                401: `登录状态无效`,
                403: `缺少 task.read 权限`,
                404: `项目不存在或当前成员不是项目成员`,
            },
        });
    }
    /**
     * 创建项目任务
     * @returns TaskResponseEnvelope 已创建任务
     * @throws ApiError
     */
    public static taskCreate({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: CreateTaskRequest,
    }): CancelablePromise<TaskResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/tasks',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `父任务、负责人、协作人或字段无效`,
                403: `缺少 task.create 权限`,
                404: `项目不存在或当前成员不是项目成员`,
                409: `项目只读或任务层级冲突`,
            },
        });
    }
    /**
     * 查询任务详情
     * @returns TaskResponseEnvelope 任务详情
     * @throws ApiError
     */
    public static taskGet({
        projectId,
        taskId,
    }: {
        projectId: string,
        taskId: string,
    }): CancelablePromise<TaskResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/tasks/{taskId}',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            errors: {
                403: `缺少 task.read 权限`,
                404: `项目或任务不存在，或者当前成员不是项目成员`,
            },
        });
    }
    /**
     * 修改任务资料或父任务
     * @returns TaskResponseEnvelope 修改后的任务
     * @throws ApiError
     */
    public static taskUpdate({
        projectId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        taskId: string,
        requestBody: UpdateTaskRequest,
    }): CancelablePromise<TaskResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/projects/{projectId}/tasks/{taskId}',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `字段或父子关系无效`,
                403: `需要 task.update 权限及任务负责人或项目 OWNER/MANAGER 身份`,
                404: `项目或任务不存在`,
                409: `项目只读、任务终态或版本冲突`,
            },
        });
    }
    /**
     * 删除任务
     * @returns void
     * @throws ApiError
     */
    public static taskDelete({
        projectId,
        taskId,
        version,
    }: {
        projectId: string,
        taskId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{projectId}/tasks/{taskId}',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            query: {
                'version': version,
            },
            errors: {
                403: `缺少 task.delete 权限或不是任务管理者`,
                404: `项目或任务不存在`,
                409: `项目只读、任务存在子任务或版本冲突`,
            },
        });
    }
    /**
     * 执行任务状态流转
     * @returns TaskResponseEnvelope 状态变更后的任务
     * @throws ApiError
     */
    public static taskTransition({
        projectId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        taskId: string,
        requestBody: TaskTransitionRequest,
    }): CancelablePromise<TaskResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/tasks/{taskId}/transitions',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `状态或原因无效`,
                403: `缺少 task.status.update 权限或不是任务执行人/项目管理者`,
                404: `项目或任务不存在`,
                409: `项目只读、状态流转或版本冲突`,
            },
        });
    }
    /**
     * 整体替换任务负责人和协作人
     * @returns TaskResponseEnvelope 修改执行人后的任务
     * @throws ApiError
     */
    public static taskReplaceAssignees({
        projectId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        taskId: string,
        requestBody: ReplaceTaskAssigneesRequest,
    }): CancelablePromise<TaskResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/projects/{projectId}/tasks/{taskId}/assignees',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `负责人或协作人不是有效项目成员`,
                403: `缺少 task.assignee.manage 权限或不是任务管理者`,
                404: `项目或任务不存在`,
                409: `项目只读、任务终态或版本冲突`,
            },
        });
    }
    /**
     * 查询任务评论
     * @returns TaskCommentListResponseEnvelope 任务评论列表
     * @throws ApiError
     */
    public static taskCommentList({
        projectId,
        taskId,
        limit = 20,
        cursor,
    }: {
        projectId: string,
        taskId: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<TaskCommentListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/tasks/{taskId}/comments',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            query: {
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                403: `缺少 task.read 权限`,
                404: `项目或任务不存在`,
            },
        });
    }
    /**
     * 新增任务评论
     * @returns TaskCommentResponseEnvelope 已创建评论
     * @throws ApiError
     */
    public static taskCommentCreate({
        projectId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        taskId: string,
        requestBody: CreateTaskCommentRequest,
    }): CancelablePromise<TaskCommentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/tasks/{taskId}/comments',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                403: `缺少 task.comment.create 权限`,
                404: `项目或任务不存在`,
                409: `项目只读`,
            },
        });
    }
    /**
     * 修改自己的任务评论
     * @returns TaskCommentResponseEnvelope 修改后的评论
     * @throws ApiError
     */
    public static taskCommentUpdate({
        projectId,
        taskId,
        commentId,
        requestBody,
    }: {
        projectId: string,
        taskId: string,
        commentId: string,
        requestBody: UpdateTaskCommentRequest,
    }): CancelablePromise<TaskCommentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/projects/{projectId}/tasks/{taskId}/comments/{commentId}',
            path: {
                'projectId': projectId,
                'taskId': taskId,
                'commentId': commentId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                403: `缺少 task.comment.update 权限或不是评论作者/任务管理者`,
                404: `项目、任务或评论不存在`,
                409: `项目只读或版本冲突`,
            },
        });
    }
    /**
     * 删除任务评论
     * @returns void
     * @throws ApiError
     */
    public static taskCommentDelete({
        projectId,
        taskId,
        commentId,
        version,
    }: {
        projectId: string,
        taskId: string,
        commentId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{projectId}/tasks/{taskId}/comments/{commentId}',
            path: {
                'projectId': projectId,
                'taskId': taskId,
                'commentId': commentId,
            },
            query: {
                'version': version,
            },
            errors: {
                403: `缺少 task.comment.delete 权限或不是评论作者/任务管理者`,
                404: `项目、任务或评论不存在`,
                409: `项目只读或版本冲突`,
            },
        });
    }
    /**
     * 查询任务附件
     * @returns TaskAttachmentListResponseEnvelope 任务附件列表
     * @throws ApiError
     */
    public static taskAttachmentList({
        projectId,
        taskId,
    }: {
        projectId: string,
        taskId: string,
    }): CancelablePromise<TaskAttachmentListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/tasks/{taskId}/attachments',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            errors: {
                403: `缺少 task.read 权限`,
                404: `项目或任务不存在`,
            },
        });
    }
    /**
     * 关联已上传文件为任务附件
     * @returns TaskAttachmentResponseEnvelope 已添加任务附件
     * @throws ApiError
     */
    public static taskAttachmentCreate({
        projectId,
        taskId,
        requestBody,
    }: {
        projectId: string,
        taskId: string,
        requestBody: AddTaskAttachmentRequest,
    }): CancelablePromise<TaskAttachmentResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/tasks/{taskId}/attachments',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `文件无效或不属于当前租户`,
                403: `缺少 task.attachment.manage 权限`,
                404: `项目或任务不存在`,
                409: `项目只读或附件已关联`,
            },
        });
    }
    /**
     * 移除任务附件关联
     * @returns void
     * @throws ApiError
     */
    public static taskAttachmentDelete({
        projectId,
        taskId,
        attachmentId,
        version,
    }: {
        projectId: string,
        taskId: string,
        attachmentId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{projectId}/tasks/{taskId}/attachments/{attachmentId}',
            path: {
                'projectId': projectId,
                'taskId': taskId,
                'attachmentId': attachmentId,
            },
            query: {
                'version': version,
            },
            errors: {
                403: `缺少 task.attachment.manage 权限或不是附件创建者/任务管理者`,
                404: `项目、任务或附件不存在`,
                409: `项目只读或版本冲突`,
            },
        });
    }
    /**
     * 查询任务操作动态
     * @returns TaskActivityListResponseEnvelope 任务操作动态列表
     * @throws ApiError
     */
    public static taskActivityList({
        projectId,
        taskId,
        limit = 50,
        cursor,
    }: {
        projectId: string,
        taskId: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<TaskActivityListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/tasks/{taskId}/activities',
            path: {
                'projectId': projectId,
                'taskId': taskId,
            },
            query: {
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                403: `缺少 task.read 权限`,
                404: `项目或任务不存在`,
            },
        });
    }
}
