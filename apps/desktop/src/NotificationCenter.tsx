import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import { App as AntdApp, Badge, Button, Empty, Spin, Switch, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getUnreadNotificationCount, hasStoredSession, listNotifications, markAllNotificationsRead, markNotificationRead, type MeResult, type NotificationItem } from './api';
import './project.css';
import { useDateFormatter, useI18n } from './i18n';

interface NotificationCenterProps {
    authContext: MeResult;
    onSessionExpired: () => void;
    onUnreadCountChange?: (count: number) => void;
}

export default function NotificationCenter({ authContext, onSessionExpired, onUnreadCountChange }: NotificationCenterProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const [unreadOnly, setUnreadOnly] = useState(false);

    const notificationsQuery = useQuery({
        queryKey: ['notifications', unreadOnly],
        queryFn: () => listNotifications(unreadOnly),
    });
    const unreadQuery = useQuery({ queryKey: ['notifications-unread'], queryFn: () => getUnreadNotificationCount(), refetchInterval: 60_000 });

    useEffect(() => {
        if (notificationsQuery.error && !hasStoredSession()) onSessionExpired();
    }, [notificationsQuery.error, onSessionExpired]);

    useEffect(() => {
        onUnreadCountChange?.(unreadQuery.data ?? 0);
    }, [unreadQuery.data, onUnreadCountChange]);

    const notifications = notificationsQuery.data?.items ?? [];
    const unreadCount = unreadQuery.data ?? 0;

    const markRead = async (notification: NotificationItem): Promise<void> => {
        try {
            await markNotificationRead(notification.id);
            await queryClient.invalidateQueries({ queryKey: ['notifications'] });
            await queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const markAll = async (): Promise<void> => {
        try {
            const updated = await markAllNotificationsRead();
            message.success(t('已标记 {count} 条通知为已读', { count: updated }));
            await queryClient.invalidateQueries({ queryKey: ['notifications'] });
            await queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    return <div className="workspace-page project-management-page">
        <header className="workspace-page-header">
            <div><h1>{t('通知中心')}</h1><p>{t('租户内投递给你的应用通知与后台提醒')}</p></div>
            <div className="header-actions">
                <Badge count={unreadCount} size="small" offset={[-4, 4]}>
                    <BellOutlined style={{ fontSize: 18 }} />
                </Badge>
                <Button type="primary" disabled={!unreadCount} onClick={() => void markAll()}>{t('全部标记已读')}</Button>
            </div>
        </header>
        <div className="task-toolbar surface-panel" style={{ padding: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <Switch size="small" checked={unreadOnly} onChange={setUnreadOnly} />{t('仅看未读')}
            </label>
            <span style={{ flex: 1 }} />
            <small style={{ color: 'var(--cees-muted)' }}>{t('未读 {count} 条', { count: unreadCount })}</small>
        </div>
        <section className="surface-panel">
            {notificationsQuery.isLoading ? <div className="data-loading"><Spin /></div> : notifications.length ? <div className="task-list">
                {notifications.map((notification) => <div className="task-row-item" key={notification.id} style={{ cursor: 'default', alignItems: 'flex-start' }}>
                    <BellOutlined style={{ marginTop: 4 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ display: 'block' }}>{notification.title}</strong>
                        {notification.content && <small style={{ display: 'block', color: 'var(--cees-muted)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{notification.content}</small>}
                        <small style={{ display: 'block', marginTop: 4, color: 'var(--cees-muted)' }}>
                            {notification.relationType && <Tag style={{ marginRight: 6 }}>{notification.relationType}</Tag>}
                            {notification.createdAt ? formatDate(notification.createdAt) : ''}
                        </small>
                    </div>
                    {!notification.readAt && <Button size="small" icon={<CheckOutlined />} onClick={() => void markRead(notification)}>{t('标记已读')}</Button>}
                </div>)}
            </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无通知')} />}
        </section>
    </div>;
}
