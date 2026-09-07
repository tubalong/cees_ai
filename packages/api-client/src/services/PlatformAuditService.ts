/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuditOutcome } from '../models/AuditOutcome';
import type { PlatformAuditEventListResponseEnvelope } from '../models/PlatformAuditEventListResponseEnvelope';
import type { PlatformAuditEventResponseEnvelope } from '../models/PlatformAuditEventResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class PlatformAuditService {
    /**
     * 查询平台审计事件
     * @returns PlatformAuditEventListResponseEnvelope 平台审计事件列表
     * @throws ApiError
     */
    public static platformAuditList({
        action,
        outcome,
        limit = 20,
        cursor,
    }: {
        action?: string,
        outcome?: AuditOutcome,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<PlatformAuditEventListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/audit-events',
            query: {
                'action': action,
                'outcome': outcome,
                'limit': limit,
                'cursor': cursor,
            },
        });
    }
    /**
     * 获取平台审计事件详情
     * @returns PlatformAuditEventResponseEnvelope 平台审计事件详情
     * @throws ApiError
     */
    public static platformAuditGet({
        auditEventId,
    }: {
        auditEventId: string,
    }): CancelablePromise<PlatformAuditEventResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/platform/audit-events/{auditEventId}',
            path: {
                'auditEventId': auditEventId,
            },
        });
    }
}
