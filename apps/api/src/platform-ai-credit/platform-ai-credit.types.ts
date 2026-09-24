import {
    AICreditCapabilityKind,
    AICreditConfigStatus,
    AICreditMeterType,
} from '@prisma/client';

export interface AICreditCapabilityResult {
    id: string;
    code: string;
    name: string;
    description: string | null;
    meterType: AICreditMeterType;
    capabilityKind: AICreditCapabilityKind;
    permissionCode: string | null;
    sortOrder: number;
    status: AICreditConfigStatus;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface AICreditCapabilityListResult {
    items: AICreditCapabilityResult[];
}
