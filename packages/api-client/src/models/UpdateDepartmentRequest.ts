/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DepartmentStatus } from './DepartmentStatus';
export type UpdateDepartmentRequest = {
    name?: string;
    parentId?: string | null;
    description?: string | null;
    sortOrder?: number;
    status?: DepartmentStatus;
    version: number;
};

