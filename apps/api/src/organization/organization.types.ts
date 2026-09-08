import { DepartmentStatus } from '@prisma/client';

export interface DepartmentResult {
    id: string;
    parentId: string | null;
    name: string;
    description: string | null;
    sortOrder: number;
    status: DepartmentStatus;
    memberCount: number;
    childCount: number;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface DepartmentTreeNodeResult extends DepartmentResult {
    children: DepartmentTreeNodeResult[];
}

export interface DepartmentTreeResult {
    items: DepartmentTreeNodeResult[];
}
