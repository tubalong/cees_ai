import {
    AICreditConfigStatus,
    AICreditSubscriptionDuration,
} from '@prisma/client';

export interface AICreditTierPriceResult {
    duration: AICreditSubscriptionDuration;
    tierPrice: string;
    unitPrice: string;
}

export interface AICreditTierResult {
    id: string;
    code: string;
    name: string;
    description: string | null;
    monthlyBaseCredits: string;
    status: AICreditConfigStatus;
    prices: AICreditTierPriceResult[];
    capabilityCodes: string[];
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface AICreditTierListResult {
    items: AICreditTierResult[];
}
