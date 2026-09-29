/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AssistantTaskOutput } from './AssistantTaskOutput';
import type { AssistantTaskOutputArchiveOption } from './AssistantTaskOutputArchiveOption';
import type { AssistantTaskStatus } from './AssistantTaskStatus';
export type AssistantTaskOutputsView = {
    taskId: string;
    status: AssistantTaskStatus;
    /**
     * 任务产出的可归档文档（跨计划版本聚合、按最近完成步骤去重）；无产出时为空数组
     */
    outputs: Array<AssistantTaskOutput>;
    /**
     * 可归档知识库候选（当前成员具 EDITOR 及以上；服务端权限硬过滤，绝不出现无权库）
     */
    archiveOptions: Array<AssistantTaskOutputArchiveOption>;
};

