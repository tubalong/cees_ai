/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectCode } from './ProjectCode';
import type { ProjectMemberRole } from './ProjectMemberRole';
import type { ProjectMemberSummary } from './ProjectMemberSummary';
import type { ProjectStatus } from './ProjectStatus';
export type ProjectSummary = {
    id: string;
    code: ProjectCode;
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
    /**
     * 首次启动时间；项目从 PLANNING 流转为 ACTIVE 时由系统写入，此后不再变更
     */
    startedAt?: string | null;
    /**
     * 完成时间；reopen 时清空
     */
    completedAt?: string | null;
    /**
     * 关闭时间；项目进入 CANCELLED 或 ARCHIVED 时由系统写入，归档恢复时清空
     */
    closedAt?: string | null;
    completedByMembershipId?: string | null;
    completionSummary?: string | null;
    memberCount: number;
    taskCount: number;
    createdAt: string;
    updatedAt: string;
    version: number;
};

