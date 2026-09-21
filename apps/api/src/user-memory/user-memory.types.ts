import type { MemoryType } from '@prisma/client';

export interface UserMemoryResult {
    id: string;
    type: MemoryType;
    content: string;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}
