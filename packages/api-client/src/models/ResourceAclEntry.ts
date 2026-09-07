/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AclSubjectType } from './AclSubjectType';
export type ResourceAclEntry = {
    id: string;
    resourceId: string;
    subjectType: AclSubjectType;
    subjectId: string;
    permissionCodes: Array<string>;
    expiresAt: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
};

