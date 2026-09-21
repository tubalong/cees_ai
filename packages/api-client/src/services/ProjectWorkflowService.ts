/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelProjectMilestoneRequest } from '../models/CancelProjectMilestoneRequest';
import type { CompleteProjectMilestoneRequest } from '../models/CompleteProjectMilestoneRequest';
import type { CreateProjectDecisionRequest } from '../models/CreateProjectDecisionRequest';
import type { CreateProjectMilestoneRequest } from '../models/CreateProjectMilestoneRequest';
import type { CreateProjectRepositoryRequest } from '../models/CreateProjectRepositoryRequest';
import type { ProjectActivity } from '../models/ProjectActivity';
import type { ProjectDecision } from '../models/ProjectDecision';
import type { ProjectMilestone } from '../models/ProjectMilestone';
import type { ProjectRepository } from '../models/ProjectRepository';
import type { ProjectWorkflowSummary } from '../models/ProjectWorkflowSummary';
import type { ProjectWorkflowVersionRequest } from '../models/ProjectWorkflowVersionRequest';
import type { PublishProjectDecisionRequest } from '../models/PublishProjectDecisionRequest';
import type { ReopenProjectMilestoneRequest } from '../models/ReopenProjectMilestoneRequest';
import type { UpdateProjectDecisionRequest } from '../models/UpdateProjectDecisionRequest';
import type { UpdateProjectMilestoneRequest } from '../models/UpdateProjectMilestoneRequest';
import type { UpdateProjectRepositoryRequest } from '../models/UpdateProjectRepositoryRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class ProjectWorkflowService {
    /**
     * 查询项目工作流汇总
     * @returns ProjectWorkflowSummary 项目工作流汇总
     * @throws ApiError
     */
    public static getProjectWorkflowSummary({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<ProjectWorkflowSummary> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/workflow-summary',
            path: {
                'projectId': projectId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                404: `项目不存在或无权访问`,
            },
        });
    }
    /**
     * 查询项目正式动态
     * @returns ProjectActivity 项目动态列表
     * @throws ApiError
     */
    public static listProjectActivities({
        projectId,
        limit = 100,
    }: {
        projectId: string,
        limit?: number,
    }): CancelablePromise<Array<ProjectActivity>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/activities',
            path: {
                'projectId': projectId,
            },
            query: {
                'limit': limit,
            },
        });
    }
    /**
     * 查询项目决策
     * @returns ProjectDecision 项目决策列表
     * @throws ApiError
     */
    public static listProjectDecisions({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<Array<ProjectDecision>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/decisions',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * 创建决策草稿
     * @returns ProjectDecision 决策草稿已创建
     * @throws ApiError
     */
    public static createProjectDecision({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: CreateProjectDecisionRequest,
    }): CancelablePromise<ProjectDecision> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/decisions',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `请求字段校验失败`,
                403: `无权访问项目`,
            },
        });
    }
    /**
     * 查询项目决策详情
     * @returns ProjectDecision 项目决策详情
     * @throws ApiError
     */
    public static getProjectDecision({
        projectId,
        decisionId,
    }: {
        projectId: string,
        decisionId: string,
    }): CancelablePromise<ProjectDecision> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/decisions/{decisionId}',
            path: {
                'projectId': projectId,
                'decisionId': decisionId,
            },
        });
    }
    /**
     * 修改决策草稿
     * @returns ProjectDecision 修改后的项目决策
     * @throws ApiError
     */
    public static updateProjectDecision({
        projectId,
        decisionId,
        requestBody,
    }: {
        projectId: string,
        decisionId: string,
        requestBody: UpdateProjectDecisionRequest,
    }): CancelablePromise<ProjectDecision> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/projects/{projectId}/decisions/{decisionId}',
            path: {
                'projectId': projectId,
                'decisionId': decisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 删除决策草稿
     * @returns void
     * @throws ApiError
     */
    public static deleteProjectDecision({
        projectId,
        decisionId,
        version,
    }: {
        projectId: string,
        decisionId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{projectId}/decisions/{decisionId}',
            path: {
                'projectId': projectId,
                'decisionId': decisionId,
            },
            query: {
                'version': version,
            },
        });
    }
    /**
     * 发布项目决策
     * @returns ProjectDecision 已发布的决策
     * @throws ApiError
     */
    public static publishProjectDecision({
        projectId,
        decisionId,
        requestBody,
    }: {
        projectId: string,
        decisionId: string,
        requestBody: PublishProjectDecisionRequest,
    }): CancelablePromise<ProjectDecision> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/decisions/{decisionId}/publish',
            path: {
                'projectId': projectId,
                'decisionId': decisionId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 查询项目里程碑
     * @returns ProjectMilestone 项目里程碑列表
     * @throws ApiError
     */
    public static listProjectMilestones({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<Array<ProjectMilestone>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/milestones',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * 创建项目里程碑
     * @returns ProjectMilestone 项目里程碑已创建
     * @throws ApiError
     */
    public static createProjectMilestone({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: CreateProjectMilestoneRequest,
    }): CancelablePromise<ProjectMilestone> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/milestones',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 查询项目里程碑详情
     * @returns ProjectMilestone 项目里程碑详情
     * @throws ApiError
     */
    public static getProjectMilestone({
        projectId,
        milestoneId,
    }: {
        projectId: string,
        milestoneId: string,
    }): CancelablePromise<ProjectMilestone> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/milestones/{milestoneId}',
            path: {
                'projectId': projectId,
                'milestoneId': milestoneId,
            },
        });
    }
    /**
     * 修改项目里程碑
     * @returns ProjectMilestone 修改后的项目里程碑
     * @throws ApiError
     */
    public static updateProjectMilestone({
        projectId,
        milestoneId,
        requestBody,
    }: {
        projectId: string,
        milestoneId: string,
        requestBody: UpdateProjectMilestoneRequest,
    }): CancelablePromise<ProjectMilestone> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/projects/{projectId}/milestones/{milestoneId}',
            path: {
                'projectId': projectId,
                'milestoneId': milestoneId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 启动项目里程碑
     * @returns ProjectMilestone 已启动的里程碑
     * @throws ApiError
     */
    public static startProjectMilestone({
        projectId,
        milestoneId,
        requestBody,
    }: {
        projectId: string,
        milestoneId: string,
        requestBody: ProjectWorkflowVersionRequest,
    }): CancelablePromise<ProjectMilestone> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/milestones/{milestoneId}/start',
            path: {
                'projectId': projectId,
                'milestoneId': milestoneId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 将项目里程碑进入验收
     * @returns ProjectMilestone 验收中的里程碑
     * @throws ApiError
     */
    public static startProjectMilestoneAcceptance({
        projectId,
        milestoneId,
        requestBody,
    }: {
        projectId: string,
        milestoneId: string,
        requestBody: ProjectWorkflowVersionRequest,
    }): CancelablePromise<ProjectMilestone> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/milestones/{milestoneId}/acceptance',
            path: {
                'projectId': projectId,
                'milestoneId': milestoneId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 确认项目里程碑完成
     * @returns ProjectMilestone 已完成的里程碑
     * @throws ApiError
     */
    public static completeProjectMilestone({
        projectId,
        milestoneId,
        requestBody,
    }: {
        projectId: string,
        milestoneId: string,
        requestBody: CompleteProjectMilestoneRequest,
    }): CancelablePromise<ProjectMilestone> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/milestones/{milestoneId}/complete',
            path: {
                'projectId': projectId,
                'milestoneId': milestoneId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 取消项目里程碑
     * @returns ProjectMilestone 已取消的里程碑
     * @throws ApiError
     */
    public static cancelProjectMilestone({
        projectId,
        milestoneId,
        requestBody,
    }: {
        projectId: string,
        milestoneId: string,
        requestBody: CancelProjectMilestoneRequest,
    }): CancelablePromise<ProjectMilestone> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/milestones/{milestoneId}/cancel',
            path: {
                'projectId': projectId,
                'milestoneId': milestoneId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 重新打开项目里程碑
     * @returns ProjectMilestone 重新打开的里程碑
     * @throws ApiError
     */
    public static reopenProjectMilestone({
        projectId,
        milestoneId,
        requestBody,
    }: {
        projectId: string,
        milestoneId: string,
        requestBody: ReopenProjectMilestoneRequest,
    }): CancelablePromise<ProjectMilestone> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/milestones/{milestoneId}/reopen',
            path: {
                'projectId': projectId,
                'milestoneId': milestoneId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 查询项目仓库
     * @returns ProjectRepository 项目仓库列表
     * @throws ApiError
     */
    public static listProjectRepositories({
        projectId,
    }: {
        projectId: string,
    }): CancelablePromise<Array<ProjectRepository>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/projects/{projectId}/repositories',
            path: {
                'projectId': projectId,
            },
        });
    }
    /**
     * 绑定项目仓库
     * @returns ProjectRepository 项目仓库已绑定
     * @throws ApiError
     */
    public static createProjectRepository({
        projectId,
        requestBody,
    }: {
        projectId: string,
        requestBody: CreateProjectRepositoryRequest,
    }): CancelablePromise<ProjectRepository> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/projects/{projectId}/repositories',
            path: {
                'projectId': projectId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 修改项目仓库
     * @returns ProjectRepository 修改后的项目仓库
     * @throws ApiError
     */
    public static updateProjectRepository({
        projectId,
        repositoryId,
        requestBody,
    }: {
        projectId: string,
        repositoryId: string,
        requestBody: UpdateProjectRepositoryRequest,
    }): CancelablePromise<ProjectRepository> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/projects/{projectId}/repositories/{repositoryId}',
            path: {
                'projectId': projectId,
                'repositoryId': repositoryId,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * 解除项目仓库绑定
     * @returns void
     * @throws ApiError
     */
    public static deleteProjectRepository({
        projectId,
        repositoryId,
        version,
    }: {
        projectId: string,
        repositoryId: string,
        version: number,
    }): CancelablePromise<void> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/projects/{projectId}/repositories/{repositoryId}',
            path: {
                'projectId': projectId,
                'repositoryId': repositoryId,
            },
            query: {
                'version': version,
            },
        });
    }
}
