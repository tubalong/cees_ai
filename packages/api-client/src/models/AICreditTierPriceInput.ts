/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditSubscriptionDuration } from './AICreditSubscriptionDuration';
export type AICreditTierPriceInput = {
    duration: AICreditSubscriptionDuration;
    /**
     * 档位价格（该持续时间），十进制字符串，最多两位小数
     */
    tierPrice: string;
    /**
     * 单位单价（该持续时间），订阅总价 = (档位价格 + 单位单价 × 单位数) × 折扣
     */
    unitPrice: string;
};

