/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type NotificationResult = {
    /**
     * 通知 UUID
     */
    id: string;
    /**
     * 通知标题
     */
    title: string;
    /**
     * 通知正文
     */
    content: string;
    /**
     * 通知渠道，当前为 IN_APP
     */
    channel: string;
    /**
     * 关联业务资源类型
     */
    relationType: string | null;
    /**
     * 关联业务资源 UUID
     */
    relationId: string | null;
    /**
     * 当前成员阅读时间
     */
    readAt: string | null;
    /**
     * 通知投递时间
     */
    createdAt: string;
};

