/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProjectRepositoryProvider } from './ProjectRepositoryProvider';
export type ProjectRepository = {
    id: string;
    projectId: string;
    provider: ProjectRepositoryProvider;
    name: string;
    url: string;
    defaultBranch: string;
    enabled: boolean;
    lastSyncedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    version: number;
};
