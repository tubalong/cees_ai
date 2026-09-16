/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TenantStatus } from './TenantStatus';
export type TenantDetail = {
    id: string;
    code: string;
    name: string;
    /**
     * 租户时区，IANA 标识；用于业务日界线（工作台“今日”、日报提醒所属日期）与项目编码年份
     */
    timezone: string;
    status: TenantStatus;
    version: number;
    createdAt: string;
    updatedAt: string;
};

