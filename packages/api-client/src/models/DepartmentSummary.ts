/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DepartmentStatus } from './DepartmentStatus';
export type DepartmentSummary = {
    id: string;
    parentId: string | null;
    name: string;
    description: string | null;
    sortOrder: number;
    status: DepartmentStatus;
    memberCount: number;
    childCount: number;
    version: number;
    createdAt: string;
    updatedAt: string;
};

