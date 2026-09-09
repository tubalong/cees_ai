/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FileUploadPurpose } from './FileUploadPurpose';
export type CreateUploadSessionRequest = {
    purpose: FileUploadPurpose;
    /**
     * 仅作为元数据保存，不参与 COS 对象键生成
     */
    fileName: string;
    contentType: string;
    /**
     * 系统硬上限为 500 MiB，环境配置可以设置更低的实际上限
     */
    sizeBytes: number;
};

