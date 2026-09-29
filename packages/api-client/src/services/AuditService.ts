/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AuditEventListResponseEnvelope } from '../models/AuditEventListResponseEnvelope';
import type { AuditEventResponseEnvelope } from '../models/AuditEventResponseEnvelope';
import type { AuditOutcome } from '../models/AuditOutcome';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AuditService {
    /**
     * 查询当前租户审计事件
     * 只返回仍在 audit_logs 热表中的租户审计。超过保留期的租户审计已迁移到 audit_logs_archive，不再通过本接口返回；其中连接器只读逐条审计量级最高，保留期短于其他审计并到期后物理删除。保留期与归档范围见 docs/architecture/audit-log-retention.md。
     * @returns AuditEventListResponseEnvelope 当前租户审计事件列表
     * @throws ApiError
     */
    public static auditListEvents({
        action,
        outcome,
        actorId,
        membershipId,
        resourceType,
        resourceId,
        requestId,
        from,
        to,
        limit = 50,
        cursor,
    }: {
        action?: string,
        outcome?: AuditOutcome,
        actorId?: string,
        membershipId?: string,
        resourceType?: string,
        resourceId?: string,
        requestId?: string,
        from?: string,
        to?: string,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<AuditEventListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/audit-events',
            query: {
                'action': action,
                'outcome': outcome,
                'actorId': actorId,
                'membershipId': membershipId,
                'resourceType': resourceType,
                'resourceId': resourceId,
                'requestId': requestId,
                'from': from,
                'to': to,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                400: `查询参数或分页游标无效`,
                401: `登录状态无效或已过期`,
                403: `缺少 audit.read 权限`,
            },
        });
    }
    /**
     * 获取当前租户审计事件详情
     * 只查询仍在 audit_logs 热表中的审计事件；已归档或已清理的事件按不存在处理，返回 404。
     * @returns AuditEventResponseEnvelope 审计事件详情
     * @throws ApiError
     */
    public static auditGetEvent({
        auditEventId,
    }: {
        auditEventId: string,
    }): CancelablePromise<AuditEventResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/audit-events/{auditEventId}',
            path: {
                'auditEventId': auditEventId,
            },
            errors: {
                401: `登录状态无效或已过期`,
                403: `缺少 audit.read 权限`,
                404: `当前租户内审计事件不存在`,
            },
        });
    }
}
