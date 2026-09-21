/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectMemberRole } from './ProjectMemberRole';
export type ProjectMemberSummary = {
    id: string;
    membershipId: string;
    account: string;
    displayName: string;
    departmentId?: string | null;
    role: ProjectMemberRole;
    joinedAt: string;
    version: number;
};
