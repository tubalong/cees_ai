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
    visibility: DocumentVisibility;
    ownerMembershipId: string;
    effectivePermissions: Array<string>;
    version: number;
    createdAt: string;
    updatedAt: string;
};

