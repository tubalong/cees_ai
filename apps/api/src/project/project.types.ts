import { ProjectMemberRole, ProjectStatus } from '@prisma/client';

export interface ProjectMemberResult {
    id: string;
    membershipId: string;
    account: string;
    displayName: string;
    departmentId: string | null;
    role: ProjectMemberRole;
    joinedAt: Date;
    version: number;
}

export interface ProjectResult {
    id: string;
    code: string;
    name: string;
    description: string | null;
    status: ProjectStatus;
    departmentId: string | null;
    owner: ProjectMemberResult | null;
    currentMemberRole: ProjectMemberRole | null;
    startedAt: Date | null;
    completedAt: Date | null;
    closedAt: Date | null;
    completedByMembershipId: string | null;
    completionSummary: string | null;
    memberCount: number;
    taskCount: number;
    createdAt: Date;
    updatedAt: Date;
    version: number;
}

export interface ProjectListResult {
    items: ProjectResult[];
    nextCursor: string | null;
}

export interface ProjectMemberListResult {
    items: ProjectMemberResult[];
}
