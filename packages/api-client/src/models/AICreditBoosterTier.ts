/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AICreditConfigStatus } from './AICreditConfigStatus';
export type AICreditBoosterTier = {
    id: string;
    name: string;
    /**
     * 加油包额度（credit），十进制字符串，最多两位小数
     */
    credits: string;
    /**
     * 加油包价格，十进制字符串，最多两位小数
     */
    price: string;
    description?: string | null;
    status: AICreditConfigStatus;
    version: number;
    createdAt: string;
    updatedAt: string;
};

