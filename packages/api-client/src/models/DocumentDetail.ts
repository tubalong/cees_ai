/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DocumentVisibility } from './DocumentVisibility';
export type DocumentDetail = {
    id: string;
    resourceId: string;
    title: string;
    content: string;
    /**
     * 结构化生成规格（DocumentSpec），用于导出 DOCX/PDF/PPTX；手工创建的文档为 null。
     */
    documentSpec: any | null;
    /**
     * 生成时落盘的正式文件标识；手工文档或落盘失败时为 null。
     */
    fileObjectId: string | null;
    /**
     * 生成时请求的正式文件 MIME 类型，用于客户端恢复 DOCX/PDF/PPTX 下载格式。
     */
    fileMimeType: string | null;
    visibility: DocumentVisibility;
    ownerMembershipId: string;
    effectivePermissions: Array<string>;
    version: number;
    createdAt: string;
    updatedAt: string;
};

