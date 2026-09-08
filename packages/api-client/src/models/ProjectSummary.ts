/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectMemberRole } from './ProjectMemberRole';
import type { ProjectMemberSummary } from './ProjectMemberSummary';
import type { ProjectStatus } from './ProjectStatus';
export type ProjectSummary = {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    status: ProjectStatus;
    departmentId?: string | null;
    /**
     * 仅无法推断负责人的迁移旧数据可能为空；新项目始终存在负责人
     */
    owner: (ProjectMemberSummary | null);
    /**
     * project.manage_all 跨项目访问时可能为空
     */
    currentMemberRole: (ProjectMemberRole | null);
    startsAt?: string | null;
    endsAt?: string | null;
    completedAt?: string | null;
    completedByMembershipId?: string | null;
    completionSummary?: string | null;
    memberCount: number;
    taskCount: number;
    createdAt: string;
    updatedAt: string;
    version: number;
};

