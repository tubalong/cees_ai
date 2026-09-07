/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AclSubjectType } from './AclSubjectType';
export type CreateResourceAclRequest = {
    subjectType: AclSubjectType;
    subjectId: string;
    permissionCodes: Array<string>;
    expiresAt?: string | null;
};

