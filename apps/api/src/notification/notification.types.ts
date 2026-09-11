export interface NotificationResult {
    id: string;
    title: string;
    content: string;
    channel: string;
    relationType: string | null;
    relationId: string | null;
    readAt: Date | null;
    createdAt: Date;
}

export interface NotificationListResult {
    items: NotificationResult[];
    nextCursor: string | null;
    unreadCount: number;
}

export interface CreateNotificationInput {
    tenantId: string;
    title: string;
    content: string;
    channel?: string;
    relationType?: string | null;
    relationId?: string | null;
    dedupKey?: string | null;
    recipientUserIds: string[];
    createdBy?: string | null;
}
