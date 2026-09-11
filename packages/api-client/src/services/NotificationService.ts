/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NotificationListResponseEnvelope } from '../models/NotificationListResponseEnvelope';
import type { NotificationMarkAllReadResponseEnvelope } from '../models/NotificationMarkAllReadResponseEnvelope';
import type { NotificationResponseEnvelope } from '../models/NotificationResponseEnvelope';
import type { NotificationUnreadCountResponseEnvelope } from '../models/NotificationUnreadCountResponseEnvelope';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class NotificationService {
    /**
     * 查询当前成员的通知
     * @returns NotificationListResponseEnvelope 当前成员的通知列表
     * @throws ApiError
     */
    public static notificationList({
        unreadOnly = false,
        limit = 20,
        cursor,
    }: {
        unreadOnly?: boolean,
        limit?: number,
        cursor?: string,
    }): CancelablePromise<NotificationListResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/notifications',
            query: {
                'unreadOnly': unreadOnly,
                'limit': limit,
                'cursor': cursor,
            },
            errors: {
                403: `缺少 notification.read 权限`,
            },
        });
    }
    /**
     * 查询当前成员的未读通知数
     * @returns NotificationUnreadCountResponseEnvelope 当前成员的未读通知数
     * @throws ApiError
     */
    public static notificationUnreadCount(): CancelablePromise<NotificationUnreadCountResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/notifications/unread-count',
            errors: {
                403: `缺少 notification.read 权限`,
            },
        });
    }
    /**
     * 批量标记当前成员通知为已读
     * @returns NotificationMarkAllReadResponseEnvelope 批量标记成功
     * @throws ApiError
     */
    public static notificationMarkAllRead(): CancelablePromise<NotificationMarkAllReadResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/notifications/read-all',
            errors: {
                403: `缺少 notification.read 权限`,
            },
        });
    }
    /**
     * 标记单条通知为已读
     * @returns NotificationResponseEnvelope 通知已读
     * @throws ApiError
     */
    public static notificationMarkRead({
        notificationId,
    }: {
        notificationId: string,
    }): CancelablePromise<NotificationResponseEnvelope> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/notifications/{notificationId}/read',
            path: {
                'notificationId': notificationId,
            },
            errors: {
                403: `缺少 notification.read 权限`,
                404: `通知不存在或当前成员不可见`,
            },
        });
    }
}
