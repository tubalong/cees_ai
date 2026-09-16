/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AddProjectMemberRequest } from '../models/AddProjectMemberRequest';
import type { CompleteProjectRequest } from '../models/CompleteProjectRequest';
import type { CreateProjectRequest } from '../models/CreateProjectRequest';
import type { ProjectListResponseEnvelope } from '../models/ProjectListResponseEnvelope';
import type { ProjectMemberListResponseEnvelope } from '../models/ProjectMemberListResponseEnvelope';
import type { ProjectMemberResponseEnvelope } from '../models/ProjectMemberResponseEnvelope';
import type { ProjectReasonRequest } from '../models/ProjectReasonRequest';
import type { ProjectResponseEnvelope } from '../models/ProjectResponseEnvelope';
import type { ProjectStatus } from '../models/ProjectStatus';
import type { ProjectVersionRequest } from '../models/ProjectVersionRequest';
import type { TransferProjectOwnerRequest } from '../models/TransferProjectOwnerRequest';
import type { UpdateProjectMemberRequest } from '../models/UpdateProjectMemberRequest';
import type { UpdateProjectRequest } from '../models/UpdateProjectRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ProjectService {
    /**
     * 查询当前成员可见的项目
     * @returns ProjectListResponseEnvelope 项目列表
     * @throws ApiError
     */
    public static projectList({
        keyword,
        status,
        departmentId,
        ownerMembershipId,
        includeArchived = false,
        limit = 20,
        cursor,
    }: {
        keyword?: string,
        status?: ProjectStatus,
        departmentId?: string,
        ownerMembershipId?: string,
        includeArchived?: boolean,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<ProjectListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects',
            query: {
                'keyword': keyword,
                'status': status,
                'departmentId': departmentId,
                'ownerMembershipId': ownerMembershipId,
                'includeArchived': includeArchived,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                403: `缺少 project.read 权限`,
            },
        });
    }
    /**
     * 创建项目并设置负责人
     * @returns ProjectResponseEnvelope 项目已创建
     * @throws ApiError
     */
    public static projectCreate({
        requestBody,
    }: {
        requestBody: CreateProjectRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                403: `缺少 project.create 权限、无权指定其他负责人，或提交初始成员但缺少 project.member.manage`,
                409: `项目编码冲突（服务端自动分配失败时的兜底）`,
            },
        });
    }
    /**
     * 查询项目详情
     * @returns ProjectResponseEnvelope 项目详情
     * @throws ApiError
     */
    public static projectGet({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}',
            path: {
                'projectId': projectId,
            },
            errors: {
                404: `项目不存在或当前成员不可见`,
            },
        });
    }
    /**
     * 修改未完成项目的核心信息
     * @returns ProjectResponseEnvelope 项目已修改
     * @throws ApiError
     */
    public static projectUpdate({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: UpdateProjectRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/projects/{projectId}',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `项目已只读、编码重复或版本冲突`,
            },
        });
    }
    /**
     * 删除没有业务数据的错误项目
     * @returns void
     * @throws ApiError
     */
    public static projectDelete({
        projectId,
        version,
    }: {
        projectId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{projectId}',
            path: {
                'projectId': projectId,
            },
            query: {
                'version': version,
            },
            errors: {
                409: `项目存在任务或版本冲突`,
            },
        });
    }
    /**
     * 查询项目成员
     * @returns ProjectMemberListResponseEnvelope 项目成员列表
     * @throws ApiError
     */
    public static projectMemberList({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<ProjectMemberListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/members',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * 添加项目成员
     * @returns ProjectMemberResponseEnvelope 项目成员已添加
     * @throws ApiError
     */
    public static projectMemberAdd({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: AddProjectMemberRequest,
    }): CancelablePromise<ProjectMemberResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/members',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `项目已只读或成员已经存在`,
            },
        });
    }
    /**
     * 修改项目成员角色
     * @returns ProjectMemberResponseEnvelope 项目成员角色已修改
     * @throws ApiError
     */
    public static projectMemberUpdate({
        projectId,
        membershipId,
        requestBody,
    }: {
        projectId: string,
        membershipId: string,
        requestBody: UpdateProjectMemberRequest,
    }): CancelablePromise<ProjectMemberResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/projects/{projectId}/members/{membershipId}',
            path: {
                'projectId': projectId,
                'membershipId': membershipId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `不能通过成员接口修改负责人、项目已只读或版本冲突`,
            },
        });
    }
    /**
     * 移除项目成员
     * @returns void
     * @throws ApiError
     */
    public static projectMemberRemove({
        projectId,
        membershipId,
        version,
    }: {
        projectId: string,
        membershipId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{projectId}/members/{membershipId}',
            path: {
                'projectId': projectId,
                'membershipId': membershipId,
            },
            query: {
                'version': version,
            },
            errors: {
                409: `不能移除负责人、项目已只读或版本冲突`,
            },
        });
    }
    /**
     * 转移项目负责人
     * @returns ProjectResponseEnvelope 项目负责人已转移
     * @throws ApiError
     */
    public static projectTransferOwner({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: TransferProjectOwnerRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/projects/{projectId}/owner',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `项目已只读、目标不是项目成员或版本冲突`,
            },
        });
    }
    /**
     * 启动规划中的项目
     * @returns ProjectResponseEnvelope 项目已启动
     * @throws ApiError
     */
    public static projectStart({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: ProjectVersionRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/start',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 暂停进行中的项目
     * @returns ProjectResponseEnvelope 项目已暂停
     * @throws ApiError
     */
    public static projectPause({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: ProjectVersionRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/pause',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 恢复暂停中的项目
     * @returns ProjectResponseEnvelope 项目已恢复
     * @throws ApiError
     */
    public static projectResume({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: ProjectVersionRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/resume',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 完成项目并进入只读状态
     * @returns ProjectResponseEnvelope 项目已完成
     * @throws ApiError
     */
    public static projectComplete({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: CompleteProjectRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/complete',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `项目存在未完成任务、状态或版本冲突`,
            },
        });
    }
    /**
     * 重新开启已完成项目
     * @returns ProjectResponseEnvelope 项目已重新开启
     * @throws ApiError
     */
    public static projectReopen({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: ProjectReasonRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/reopen',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 取消未完成项目
     * @returns ProjectResponseEnvelope 项目已取消
     * @throws ApiError
     */
    public static projectCancel({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: ProjectReasonRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/cancel',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 归档已完成项目
     * @returns ProjectResponseEnvelope 项目已归档
     * @throws ApiError
     */
    public static projectArchive({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: ProjectVersionRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/archive',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `状态或版本冲突`,
            },
        });
    }
    /**
     * 将归档项目恢复为已完成
     * @returns ProjectResponseEnvelope 项目已恢复为已完成
     * @throws ApiError
     */
    public static projectRestore({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: ProjectVersionRequest,
    }): CancelablePromise<ProjectResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/restore',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                409: `状态或版本冲突`,
            },
        });
    }
}
