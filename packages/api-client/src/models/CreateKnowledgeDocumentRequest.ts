/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { KnowledgeDocumentVisibilityScope } from './KnowledgeDocumentVisibilityScope';
export type CreateKnowledgeDocumentRequest = {
    /**
     * 人工上传路径：已上传完成的文件对象 ID；与 sourceType/sourceId 二选一
     */
    fileObjectId?: string;
    /**
     * 转存路径：来源类型（附件文件 / AI 生成文档 / 对话消息），与 sourceId 配套，二选一必填
     */
    sourceType?: CreateKnowledgeDocumentRequest.sourceType;
    /**
     * 转存路径：来源资源 ID，与 sourceType 配套
     */
    sourceId?: string;
    /**
     * 文档名称；转存路径下省略时沿用来源资源名称
     */
    name?: string;
    visibilityScope: KnowledgeDocumentVisibilityScope;
    /**
     * 可见范围为 DEPARTMENT 时必填
     */
    departmentId?: string | null;
    /**
     * 可见范围为 PROJECT 时必填
     */
    projectId?: string | null;
};
export namespace CreateKnowledgeDocumentRequest {
    /**
     * 转存路径：来源类型（附件文件 / AI 生成文档 / 对话消息），与 sourceId 配套，二选一必填
     */
    export enum sourceType {
        FILE_OBJECT = 'FILE_OBJECT',
        DOCUMENT = 'DOCUMENT',
        MESSAGE = 'MESSAGE',
    }
}

