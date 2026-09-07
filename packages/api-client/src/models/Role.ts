/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DataScope } from './DataScope';
import type { Permission } from './Permission';
export type Role = {
    id: string;
    code: string;
    name: string;
    description: string | null;
    dataScope: DataScope;
    isSystem: boolean;
    permissions: Array<Permission>;
    memberCount: number;
    version: number;
    createdAt: string;
    updatedAt: string;
};

