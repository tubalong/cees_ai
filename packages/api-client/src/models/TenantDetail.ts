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
    /**
     * 连接器读操作是否逐条审计。默认 false：连接器读调用按轮次级聚合成一条 CONNECTOR_READ_OPERATION 审计；开启后每次读调用各留一条。写/破坏性操作始终 逐条审计，不受该开关影响。修改需要 tenant.update 权限。
     */
    connectorReadAuditEnabled: boolean;
};

