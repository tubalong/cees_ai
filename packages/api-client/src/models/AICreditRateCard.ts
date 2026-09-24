/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditConfigStatus } from './AICreditConfigStatus';
import type { AICreditRateDimension } from './AICreditRateDimension';
export type AICreditRateCard = {
    id: string;
    capabilityId: string;
    capabilityCode: string;
    modelGroup: string;
    dimension: AICreditRateDimension;
    /**
     * token 倍率（上游 token → 计费 token），仅 TOKEN 维度填写
     */
    tokenMultiplier?: string | null;
    /**
     * token→credit 比例（计费 token → credit），仅 TOKEN 维度填写
     */
    creditPerToken?: string | null;
    /**
     * 按次 credit，仅 PER_REQUEST 维度填写
     */
    perRequestCredits?: string | null;
    /**
     * 业务版本号，调价插入新版本行
     */
    rateVersion: number;
    status: AICreditConfigStatus;
    version: number;
    createdAt: string;
    updatedAt: string;
};

