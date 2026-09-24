/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditSubscriptionDuration } from './AICreditSubscriptionDuration';
export type AICreditBillingConfig = {
    /**
     * 固定主键 default
     */
    id: string;
    /**
     * 最小计量单位（credit），如 0.1
     */
    minCreditUnit: string;
    /**
     * 每月重置日（企业本地时区）
     */
    resetDay: number;
    /**
     * 重置时区模式（企业本地时区，值预留扩展）
     */
    resetTimezoneMode: AICreditBillingConfig.resetTimezoneMode;
    /**
     * 未配置费率的调用一律拒绝
     */
    rejectUnconfiguredRate: boolean;
    /**
     * 可配置的订阅持续时间选项
     */
    subscriptionDurations: Array<AICreditSubscriptionDuration>;
    /**
     * 半年折扣率（0.01-0.99）
     */
    halfYearlyDiscountRate: string;
    /**
     * 一年折扣率（0.01-0.99）
     */
    yearlyDiscountRate: string;
    maxSubscriptionUnits: number;
    updatedAt: string;
    version: number;
};
export namespace AICreditBillingConfig {
    /**
     * 重置时区模式（企业本地时区，值预留扩展）
     */
    export enum resetTimezoneMode {
        TENANT_LOCAL = 'TENANT_LOCAL',
    }
}

