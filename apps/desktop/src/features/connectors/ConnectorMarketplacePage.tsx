import { DingdingOutlined, LinkOutlined, MessageOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Modal, Select, Space, Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../core/i18n';
import {
    connectTencentMeeting,
    disconnectTencentMeetingConnector,
    getTencentMeetingStatus,
} from './tencentMeetingConnector';

const EMPTY_STATUS: DesktopConnectorStatus = {
    state: 'NOT_INSTALLED',
    installed: false,
    authenticated: false,
    version: null,
    checkedAt: '',
    issueCode: null,
    recoveryAction: 'INSTALL',
    error: null,
};

const EMPTY_DINGTALK_STATUS: DingTalkConnectorStatus = {
    ...EMPTY_STATUS,
    source: null,
    installSupported: false,
    profile: null,
    corpId: null,
    corpName: null,
    externalUserId: null,
    externalUserName: null,
    profiles: [],
};

const EMPTY_RELEASE: DingTalkConnectorReleaseStatus = {
    version: 'v1.0.62',
    license: 'Apache-2.0',
    channel: 'stable',
    installedVersion: null,
    latestVersion: null,
    updateAvailable: false,
    checkSupported: false,
    upgradeSupported: false,
    rollbackAvailable: false,
    rollbackVersion: null,
    checkedAt: null,
    releaseDate: null,
    releaseUrl: null,
    changelog: [],
    error: null,
    lastOperation: null,
};

export default function ConnectorMarketplacePage(): JSX.Element {
    const { t } = useI18n();
    const { message, modal } = AntdApp.useApp();
    const navigate = useNavigate();
    const [manifests, setManifests] = useState<DesktopConnectorManifest[]>([]);
    const [statuses, setStatuses] = useState<Record<string, DesktopConnectorStatus>>({});
    const [release, setRelease] = useState<DingTalkConnectorReleaseStatus>(EMPTY_RELEASE);
    const [marketplaceError, setMarketplaceError] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [connectingId, setConnectingId] = useState<string>();
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [upgrading, setUpgrading] = useState(false);
    const [rollingBack, setRollingBack] = useState(false);
    const [disconnectingId, setDisconnectingId] = useState<string>();
    const [selectedConnectorId, setSelectedConnectorId] = useState<string>();
    const [selectedProfile, setSelectedProfile] = useState<string>();

    const refresh = async (): Promise<void> => {
        const connectors = window.cees?.connectors;
        if (!connectors) {
            setManifests([]);
            setMarketplaceError(t('当前环境不支持本地连接器'));
            setLoading(false);
            return;
        }
        setLoading(true);
        setMarketplaceError(undefined);
        try {
            const nextManifests = await connectors.list();
            const statusEntries = await Promise.all(nextManifests.map(async (manifest) => {
                try {
                    const status = manifest.id === 'tencent-meeting'
                        ? await getTencentMeetingStatus()
                        : await connectors.status(manifest.id);
                    return [manifest.id, status] as const;
                } catch (error) {
                    return [manifest.id, connectorErrorStatus(error, t('读取连接器状态失败'))] as const;
                }
            }));
            setManifests(nextManifests);
            setStatuses(Object.fromEntries(statusEntries));
            setSelectedConnectorId((current) => current && nextManifests.some((item) => item.id === current) ? current : undefined);

            if (nextManifests.some((item) => item.id === 'dingtalk') && connectors.dingtalk) {
                try {
                    setRelease(await connectors.dingtalk.release());
                } catch (error) {
                    setRelease({
                        ...EMPTY_RELEASE,
                        error: error instanceof Error ? error.message : t('读取 DWS 版本状态失败'),
                    });
                }
            }
        } catch (error) {
            setManifests([]);
            setStatuses({});
            setMarketplaceError(error instanceof Error ? error.message : t('读取连接器列表失败'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
        const connectors = window.cees?.connectors;
        return connectors?.onStatusChanged((event) => {
            setStatuses((current) => ({ ...current, [event.connectorId]: event.status }));
            if (event.connectorId === 'dingtalk' && event.status.state !== 'PROFILE_REQUIRED') {
                setSelectedProfile(undefined);
            }
        });
    }, []);

    const selectedManifest = manifests.find((manifest) => manifest.id === selectedConnectorId);
    const selectedStatus = selectedManifest ? statuses[selectedManifest.id] ?? EMPTY_STATUS : EMPTY_STATUS;
    const selectedDingTalkStatus = toDingTalkStatus(selectedManifest?.id === 'dingtalk' ? selectedStatus : undefined);
    const selectedTencentMeetingStatus = toTencentMeetingStatus(selectedManifest?.id === 'tencent-meeting' ? selectedStatus : undefined);
    const selectedConnected = selectedStatus.state === 'READY';

    const updateStatus = (connectorId: string, status: DesktopConnectorStatus): void => {
        setStatuses((current) => ({ ...current, [connectorId]: status }));
    };

    const connect = async (): Promise<void> => {
        if (!selectedManifest) return;
        const connectors = window.cees?.connectors;
        if (!connectors) return;
        setConnectingId(selectedManifest.id);
        try {
            const nextStatus = selectedManifest.id === 'tencent-meeting'
                ? await connectTencentMeeting((authorizingStatus) => {
                    updateStatus(selectedManifest.id, authorizingStatus);
                    setSelectedConnectorId(undefined);
                    message.info(t('已打开腾讯会议授权页面，请在系统浏览器中完成授权'));
                })
                : selectedManifest.id === 'dingtalk'
                    && selectedDingTalkStatus.state === 'PROFILE_REQUIRED'
                    && connectors.dingtalk
                    ? await connectors.dingtalk.selectProfile(selectedProfile ?? '')
                    : await connectors.connect(selectedManifest.id);
            updateStatus(selectedManifest.id, nextStatus);
            if (nextStatus.state === 'PROFILE_REQUIRED') return;
            setSelectedConnectorId(undefined);
            if (nextStatus.authenticated) {
                message.success(t('{name}连接器已连接', { name: selectedManifest.name }));
            } else {
                message.warning(nextStatus.error || t('连接器已安装，请继续完成授权'));
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('{name}连接器安装或授权失败', { name: selectedManifest.name }));
        } finally {
            setConnectingId(undefined);
        }
    };

    const checkForUpdates = async (): Promise<void> => {
        const connector = window.cees?.connectors?.dingtalk;
        if (!connector) return;
        setCheckingUpdate(true);
        try {
            const nextRelease = await connector.checkForUpdates();
            setRelease(nextRelease);
            if (nextRelease.error) message.warning(nextRelease.error);
            else if (nextRelease.updateAvailable) message.success(t('发现 DWS 新版本 {version}', { version: nextRelease.latestVersion ?? '' }));
            else message.success(t('当前已是最新稳定版本'));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('检查 DWS 更新失败'));
        } finally {
            setCheckingUpdate(false);
        }
    };

    const confirmUpgrade = (): void => {
        if (!release.latestVersion) return;
        modal.confirm({
            title: t('升级 DWS 到 {version}', { version: release.latestVersion }),
            content: t('CEES 将调用 DWS 官方升级器，跳过技能更新。升级前会创建备份，升级后执行版本和 Schema 健康检查；检查失败时自动回滚。'),
            okText: t('确认升级'),
            cancelText: t('取消'),
            onOk: async () => {
                const connector = window.cees?.connectors?.dingtalk;
                if (!connector) return;
                setUpgrading(true);
                try {
                    const nextRelease = await connector.upgrade(release.latestVersion ?? undefined);
                    setRelease(nextRelease);
                    message.success(t('DWS 已升级到 {version}', { version: nextRelease.installedVersion ?? release.latestVersion ?? '' }));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t('DWS 升级失败'));
                    await refresh();
                } finally {
                    setUpgrading(false);
                }
            },
        });
    };

    const confirmRollback = (): void => {
        if (!release.rollbackVersion) return;
        modal.confirm({
            title: t('回滚 DWS 到 {version}', { version: release.rollbackVersion }),
            content: t('回滚会替换当前 DWS 二进制，并在完成后重新执行版本和 Schema 健康检查。'),
            okText: t('确认回滚'),
            okButtonProps: { danger: true },
            cancelText: t('取消'),
            onOk: async () => {
                const connector = window.cees?.connectors?.dingtalk;
                if (!connector) return;
                setRollingBack(true);
                try {
                    const nextRelease = await connector.rollback();
                    setRelease(nextRelease);
                    message.success(t('DWS 已回滚到 {version}', { version: nextRelease.installedVersion ?? release.rollbackVersion ?? '' }));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t('DWS 回滚失败'));
                    await refresh();
                } finally {
                    setRollingBack(false);
                }
            },
        });
    };

    const openConnectorConversation = (manifest: DesktopConnectorManifest): void => {
        setSelectedConnectorId(undefined);
        navigate('/assistant', {
            state: {
                createNewConversation: true,
                source: manifest.id === 'dingtalk' ? 'DINGTALK_CONNECTOR' : 'CONNECTOR_MARKETPLACE',
            },
        });
    };

    const tryConnector = (): void => {
        if (!selectedManifest) return;
        openConnectorConversation(selectedManifest);
    };

    const confirmDisconnect = (): void => {
        if (!selectedManifest) return;
        modal.confirm({
            title: t('解绑{name}连接器', { name: selectedManifest.name }),
            content: selectedManifest.id === 'dingtalk'
                ? t('解绑会清除本机保存的全部钉钉登录授权，但不会卸载 DWS，也不会删除已导入 CEES 的组织或业务数据。解绑后需要重新授权才能继续使用。')
                : selectedManifest.id === 'tencent-meeting'
                    ? t('解绑会清除 CEES API 服务端为当前租户成员保存的腾讯会议授权凭据，不会删除腾讯会议中的会议或 CEES 业务数据。')
                    : t('解绑会清除当前连接器保存的授权信息，但不会删除已经写入 CEES 的业务数据。'),
            okText: t('确认解绑'),
            cancelText: t('取消'),
            okButtonProps: { danger: true },
            onOk: async () => {
                const connectors = window.cees?.connectors;
                if (!connectors) return;
                setDisconnectingId(selectedManifest.id);
                try {
                    const nextStatus = selectedManifest.id === 'tencent-meeting'
                        ? await disconnectTencentMeetingConnector()
                        : await connectors.disconnect(selectedManifest.id);
                    updateStatus(selectedManifest.id, nextStatus);
                    if (selectedManifest.id === 'dingtalk') setSelectedProfile(undefined);
                    setSelectedConnectorId(undefined);
                    message.success(t('{name}连接器已解绑', { name: selectedManifest.name }));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t('{name}连接器解绑失败', { name: selectedManifest.name }));
                } finally {
                    setDisconnectingId(undefined);
                }
            },
        });
    };

    return <div className="workspace-page connector-marketplace-page">
        <header className="connector-marketplace-header">
            <div>
                <span className="connector-marketplace-eyebrow">CONNECTORS</span>
                <h1>{t('连接器')}</h1>
                <p>{t('连接你日常使用的办公应用，让 AI 在你的授权范围内读取信息并协助工作。')}</p>
            </div>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>{t('刷新状态')}</Button>
        </header>

        <section className="connector-section">
            <div className="connector-section-heading">
                <div><h2>{t('办公协作')}</h2><p>{t('连接器由桌面运行时动态发现，技能与专家将在后续版本提供。')}</p></div>
                <Tag>{t('{count} 个连接器', { count: manifests.length })}</Tag>
            </div>
            {marketplaceError ? <div className="connector-marketplace-error">{marketplaceError}</div> : null}
            {loading && manifests.length === 0 ? <div className="connector-marketplace-loading"><Spin /></div> : null}
            <div className="connector-grid">
                {manifests.map((manifest) => {
                    const status = statuses[manifest.id] ?? EMPTY_STATUS;
                    const connected = status.state === 'READY';
                    return <article key={manifest.id} className={`connector-card ${connected ? 'is-connected' : 'is-disconnected'}`}>
                        <button
                            className="connector-card-hit-area"
                            type="button"
                            aria-label={connected
                                ? t('查看{name}连接器详情', { name: manifest.name })
                                : t('连接{name}连接器', { name: manifest.name })}
                            onClick={() => setSelectedConnectorId(manifest.id)}
                        />
                        {connected ? <button
                            className="connector-card-indicator connector-card-conversation-action"
                            type="button"
                            aria-label={t('使用{name}开始新对话', { name: manifest.name })}
                            onClick={() => openConnectorConversation(manifest)}
                        >
                            <MessageOutlined />
                            <span className="connector-card-indicator-label">{t('去对话')}</span>
                        </button> : <span className="connector-card-indicator" aria-hidden="true">
                            <PlusOutlined />
                            <span className="connector-card-indicator-label">{t('连接')}</span>
                        </span>}
                        <div className="connector-logo" aria-hidden="true">{connectorGlyph(manifest)}</div>
                        <div className="connector-card-copy">
                            <div className="connector-card-title"><h3>{t(manifest.name)}</h3></div>
                            <p>{t(manifest.description)}</p>
                        </div>
                    </article>;
                })}
            </div>
        </section>

        <Modal
            open={Boolean(selectedManifest)}
            title={undefined}
            footer={null}
            width={620}
            onCancel={() => !connectingId && !disconnectingId && setSelectedConnectorId(undefined)}
            maskClosable={!connectingId && !disconnectingId}
            closable={!connectingId && !disconnectingId}
            centered
        >
            {selectedManifest && selectedConnected ? <div className="connector-connected-dialog">
                <div className="connector-connected-visual" aria-hidden="true">
                    <div className="connector-connected-node connector-connected-cees">
                        <img src="./assests/logo.webp" alt="" />
                    </div>
                    <div className="connector-connected-dots"><span /><span /><span /></div>
                    <div className="connector-connected-node connector-connected-provider">{connectorProviderGlyph(selectedManifest)}</div>
                </div>
                <h2>{t('连接 {name}', { name: selectedManifest.name })}</h2>
                <p className="connector-connected-description">{t(selectedManifest.description)}</p>
                <div className="connector-connected-account">
                    <strong>{selectedManifest.id === 'dingtalk'
                        ? selectedDingTalkStatus.corpName || t('当前钉钉组织')
                        : selectedManifest.id === 'tencent-meeting'
                            ? selectedTencentMeetingStatus.account?.organizationName || t('当前腾讯会议账号')
                            : selectedManifest.name}</strong>
                    <span>{selectedManifest.id === 'dingtalk'
                        ? selectedDingTalkStatus.externalUserName || selectedDingTalkStatus.profile || t('已完成授权')
                        : selectedManifest.id === 'tencent-meeting'
                            ? selectedTencentMeetingStatus.account?.displayName || selectedTencentMeetingStatus.account?.externalUserId || t('已完成授权')
                        : selectedStatus.version || t('已完成授权')}</span>
                </div>
                {selectedManifest.id === 'dingtalk' && selectedManifest.supportsVersionManagement ? <DingTalkVersionPanel
                    release={release}
                    status={selectedDingTalkStatus}
                    checkingUpdate={checkingUpdate}
                    upgrading={upgrading}
                    rollingBack={rollingBack}
                    onCheckForUpdates={() => void checkForUpdates()}
                    onUpgrade={confirmUpgrade}
                    onRollback={confirmRollback}
                    t={t}
                /> : null}
                <div className="connector-connected-actions">
                    <Button type="primary" size="large" onClick={tryConnector}>{t('去试试')}</Button>
                    {selectedManifest.supportsDisconnect ? <Button danger size="large" loading={disconnectingId === selectedManifest.id} onClick={confirmDisconnect}>{t('解绑')}</Button> : null}
                </div>
            </div> : selectedManifest ? <div className="connector-connected-dialog connector-disconnected-dialog">
                <div className="connector-connected-visual" aria-hidden="true">
                    <div className="connector-connected-node connector-connected-cees">
                        <img src="./assests/logo.webp" alt="" />
                    </div>
                    <div className="connector-connected-dots"><span /><span /><span /></div>
                    <div className="connector-connected-node connector-connected-provider">{connectorProviderGlyph(selectedManifest)}</div>
                </div>
                <h2>{t('连接 {name}', { name: selectedManifest.name })}</h2>
                <p className="connector-connected-description">{t(selectedManifest.description)}</p>
                {selectedManifest.id === 'dingtalk' && selectedDingTalkStatus.state === 'PROFILE_REQUIRED'
                    ? <DingTalkProfileSelector
                        status={selectedDingTalkStatus}
                        selectedProfile={selectedProfile}
                        onSelectProfile={setSelectedProfile}
                        t={t}
                    />
                    : null}
                <Button
                    className="connector-connect-button"
                    type="primary"
                    size="large"
                    icon={<LinkOutlined />}
                    loading={connectingId === selectedManifest.id}
                    disabled={selectedManifest.id === 'dingtalk'
                        && selectedDingTalkStatus.state === 'PROFILE_REQUIRED'
                        && !selectedProfile}
                    onClick={() => void connect()}
                >
                    {selectedManifest.id === 'dingtalk' && selectedDingTalkStatus.state === 'PROFILE_REQUIRED'
                        ? t('使用此组织')
                        : t('连接')}
                </Button>
            </div> : null}
        </Modal>
    </div>;
}

function DingTalkVersionPanel(props: {
    release: DingTalkConnectorReleaseStatus;
    status: DingTalkConnectorStatus;
    checkingUpdate: boolean;
    upgrading: boolean;
    rollingBack: boolean;
    onCheckForUpdates: () => void;
    onUpgrade: () => void;
    onRollback: () => void;
    t: (text: string, values?: Record<string, string | number>) => string;
}): JSX.Element {
    const { release, status, checkingUpdate, upgrading, rollingBack, onCheckForUpdates, onUpgrade, onRollback, t } = props;
    return <div className="connector-version-panel">
        <div className="connector-version-summary">
            <span>{t('DWS 版本')}</span>
            <strong>{release.installedVersion || status.version || t('未安装')}</strong>
            {release.updateAvailable && release.latestVersion ? <Tag color="blue">{t('可升级至 {version}', { version: release.latestVersion })}</Tag> : null}
        </div>
        <Space wrap size={8}>
            <Button size="small" disabled={!release.checkSupported} loading={checkingUpdate} onClick={onCheckForUpdates}>{t('检查更新')}</Button>
            {release.updateAvailable ? <Button size="small" type="primary" disabled={!release.upgradeSupported} loading={upgrading} onClick={onUpgrade}>{t('升级')}</Button> : null}
            {release.rollbackAvailable ? <Button size="small" danger loading={rollingBack} onClick={onRollback}>{t('回滚')}</Button> : null}
        </Space>
        {release.error ? <div className="connector-version-message is-error">{release.error}</div> : null}
        {release.lastOperation?.message ? <div className={`connector-version-message ${release.lastOperation.status === 'FAILED' ? 'is-error' : ''}`}>{release.lastOperation.message}</div> : null}
    </div>;
}

function DingTalkProfileSelector(props: {
    status: DingTalkConnectorStatus;
    selectedProfile?: string;
    onSelectProfile: (profile: string) => void;
    t: (text: string, values?: Record<string, string | number>) => string;
}): JSX.Element {
    const { status, selectedProfile, onSelectProfile, t } = props;
    return <div className="connector-profile-selector">
        <p>{t('当前账号包含多个钉钉组织，请选择本次连接使用的组织。')}</p>
        <Select
            style={{ width: '100%' }}
            placeholder={t('选择钉钉组织账号')}
            value={selectedProfile}
            onChange={onSelectProfile}
            options={status.profiles.map((profile) => ({
                value: profile.profile,
                label: `${profile.corpName || profile.corpId || t('未知组织')} · ${profile.externalUserName || profile.externalUserId || t('未知用户')}`,
            }))}
        />
    </div>;
}

function connectorErrorStatus(error: unknown, fallback: string): DesktopConnectorStatus {
    return {
        ...EMPTY_STATUS,
        state: 'ERROR',
        recoveryAction: 'RETRY',
        error: error instanceof Error ? error.message : fallback,
    };
}

function toDingTalkStatus(status?: DesktopConnectorStatus): DingTalkConnectorStatus {
    if (!status) return EMPTY_DINGTALK_STATUS;
    const candidate = status as Partial<DingTalkConnectorStatus>;
    return {
        ...EMPTY_DINGTALK_STATUS,
        ...candidate,
        source: candidate.source === 'MANAGED' || candidate.source === 'SYSTEM' ? candidate.source : null,
        profiles: Array.isArray(candidate.profiles) ? candidate.profiles : [],
    };
}

function toTencentMeetingStatus(status?: DesktopConnectorStatus): TencentMeetingConnectorStatus {
    const candidate = status as Partial<TencentMeetingConnectorStatus> | undefined;
    return {
        ...EMPTY_STATUS,
        ...candidate,
        account: candidate?.account ?? null,
        grantedScopes: Array.isArray(candidate?.grantedScopes) ? candidate.grantedScopes : [],
        tokenStatus: candidate?.tokenStatus ?? 'MISSING',
        authorizedAt: candidate?.authorizedAt ?? null,
        tokenExpiresAt: candidate?.tokenExpiresAt ?? null,
    };
}

function connectorGlyph(manifest: DesktopConnectorManifest): string {
    return manifest.id === 'dingtalk' ? '钉' : manifest.name.trim().slice(0, 1).toUpperCase();
}

function connectorProviderGlyph(manifest: DesktopConnectorManifest): JSX.Element | string {
    return manifest.id === 'dingtalk' ? <DingdingOutlined /> : connectorGlyph(manifest);
}
