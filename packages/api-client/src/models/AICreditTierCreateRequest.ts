/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditTierPriceInput } from './AICreditTierPriceInput';
export type AICreditTierCreateRequest = {
    /**
     * 档位 code，兼作档位权限码值，创建后不可修改
     */
    code: string;
    name: string;
    description?: string | null;
    monthlyBaseCredits: string;
    prices: Array<AICreditTierPriceInput>;
    /**
     * 功能开关类能力 code 列表（通用能力全档开放，不写入）
     */
    capabilityCodes?: Array<string>;
};

