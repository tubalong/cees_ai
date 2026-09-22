/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TencentMeetingConnectorProvider } from './TencentMeetingConnectorProvider';
import type { TencentMeetingToolId } from './TencentMeetingToolId';
export type TencentMeetingConnectorContext = {
    provider: TencentMeetingConnectorProvider;
    toolId: TencentMeetingToolId;
    toolName: string;
    fetchedAt: string;
    /**
     * 已按工具白名单过滤并脱敏的腾讯会议结构化结果，不包含 Token、Secret 或原始认证响应
     */
    data: Record<string, any>;
};

