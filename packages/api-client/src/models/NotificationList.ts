/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NotificationResult } from './NotificationResult';
export type NotificationList = {
    items: Array<NotificationResult>;
    nextCursor: string | null;
    /**
     * 当前成员未读通知总数
     */
    unreadCount: number;
};

