/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FileUploadPurpose } from './FileUploadPurpose';
export type FileMetadata = {
    id: string;
    purpose: FileUploadPurpose;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    etag: string | null;
    createdAt: string;
};

