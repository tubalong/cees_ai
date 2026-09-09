/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { FileUploadPurpose } from './FileUploadPurpose';
import type { UploadInstruction } from './UploadInstruction';
import type { UploadMode } from './UploadMode';
import type { UploadSessionStatus } from './UploadSessionStatus';
export type UploadSession = {
    uploadSessionId: string;
    fileId: string;
    purpose: FileUploadPurpose;
    uploadMode: UploadMode;
    status: UploadSessionStatus;
    expiresAt: string;
    upload: UploadInstruction;
};

