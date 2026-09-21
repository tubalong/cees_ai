import { CheckCircleFilled, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Modal, Select, Space, Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../core/i18n';

const DINGTALK_DESCRIPTION = '通过命令行管理钉钉全产品能力：AI 表格、考勤、日历、群聊与机器人、通讯录、开放平台文档、DING 消息、钉钉文档、钉钉云盘、AI 听记、邮箱、OA 审批、日志、待办。';

const EMPTY_STATUS: DingTalkConnectorStatus = {
    state: 'NOT_INSTALLED',
    installed: false,
    authenticated: false,
    source: null,
    installSupported: false,
    version: null,
    profile: null,
    corpId: null,
    corpName: null,
    externalUserId: null,
    externalUserName: null,
    profiles: [],
    checkedAt: '',
    issueCode: null,
    recoveryAction: 'INSTALL',
    error: null,
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
    const [status, setStatus] = useState<DingTalkConnectorStatus>(EMPTY_STATUS);
    const [release, setRelease] = useState<DingTalkConnectorReleaseStatus>(EMPTY_RELEASE);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [upgrading, setUpgrading] = useState(false);
    const [rollingBack, setRollingBack] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState<string>();

    const refresh = async (): Promise<void> => {
        const connector = window.cees?.connectors?.dingtalk;
        if (!connector) {
            setStatus({ ...EMPTY_STATUS, error: t('当前环境不支持本地连接器') });
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const [nextStatus, nextRelease] = await Promise.all([connector.status(), connector.release()]);
            setStatus(nextStatus);
            setRelease(nextRelease);
        } catch (error) {
            setStatus({ ...EMPTY_STATUS, error: error instanceof Error ? error.message : t('读取连接器状态失败') });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
        const connector = window.cees?.connectors?.dingtalk;
        return connector?.onStatusChanged((nextStatus) => {
            setStatus(nextStatus);
            if (nextStatus.state !== 'PROFILE_REQUIRED') setSelectedProfile(undefined);
        });
    }, []);

    const connect = async (): Promise<void> => {
        const connector = window.cees?.connectors?.dingtalk;
        if (!connector) return;
        setConnecting(true);
        try {
            const nextStatus = status.state === 'PROFILE_REQUIRED'
                ? await connector.selectProfile(selectedProfile ?? '')
                : await connector.connect();
            setStatus(nextStatus);
            if (nextStatus.state === 'PROFILE_REQUIRED') return;
            setDialogOpen(false);
            if (nextStatus.authenticated) message.success(t('钉钉连接器已连接'));
            else message.warning(nextStatus.error || t('DWS 已安装，请继续完成钉钉授权'));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('钉钉连接器安装或授权失败'));
        } finally {
            setConnecting(false);
        }
    };

    const retry = async (): Promise<void> => {
        await refresh();
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

    const tryConnector = (): void => {
        setDialogOpen(false);
        navigate('/assistant');
    };

    const confirmDisconnect = (): void => {
        modal.confirm({
            title: t('解绑钉钉连接器'),
            content: t('解绑会清除本机保存的全部钉钉登录授权，但不会卸载 DWS，也不会删除已导入 CEES 的组织或业务数据。解绑后需要重新授权才能继续使用。'),
            okText: t('确认解绑'),
            cancelText: t('取消'),
            okButtonProps: { danger: true },
            onOk: async () => {
                const connector = window.cees?.connectors?.dingtalk;
                if (!connector) return;
                setDisconnecting(true);
                try {
                    const nextStatus = await connector.disconnect();
                    setStatus(nextStatus);
                    setSelectedProfile(undefined);
                    setDialogOpen(false);
                    message.success(t('钉钉连接器已解绑'));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t('钉钉连接器解绑失败'));
                } finally {
                    setDisconnecting(false);
                }
            },
        });
    };

    const connected = status.state === 'READY';
    const statusText = status.state === 'READY'
        ? t('已连接')
        : status.state === 'PROFILE_REQUIRED'
            ? t('需要选择组织')
            : status.state === 'AUTH_REQUIRED'
                ? t('待授权')
                : status.state === 'ERROR'
                    ? t('连接异常')
                    : status.installed ? t('已安装') : t('未安装');

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
                <div><h2>{t('办公协作')}</h2><p>{t('当前仅开放钉钉连接器，技能与专家将在后续版本提供。')}</p></div>
                <Tag>{t('1 个连接器')}</Tag>
            </div>
            <div className="connector-grid">
                <article className={`connector-card ${connected ? 'is-connected' : ''}`}>
                    <button className="connector-add-button" type="button" aria-label={t('安装或授权钉钉连接器')} onClick={() => setDialogOpen(true)}>
                        {connected ? <CheckCircleFilled /> : <PlusOutlined />}
                    </button>
                    <div className="connector-logo" aria-hidden="true">钉</div>
                    <div className="connector-card-copy">
                        <div className="connector-card-title"><h3>{t('钉钉')}</h3><span className={`connector-status ${connected ? 'is-connected' : ''}`}>{statusText}</span></div>
                        <p>{t(DINGTALK_DESCRIPTION)}</p>
                    </div>
                    <div className="connector-card-meta">
                        {loading ? <Spin size="small" /> : <>
                            <span>{status.corpName || status.profile || t('尚未授权组织')}</span>
                            <small>{status.externalUserName || status.version || release.version}</small>
                        </>}
                    </div>
                    {status.error && !connected ? <div className="connector-card-error">{status.error}</div> : null}
                    {status.state === 'ERROR' ? <Button size="small" onClick={() => void retry()}>{t('重试检查')}</Button> : null}
                    <div className="connector-version-panel">
                        <div className="connector-version-summary">
                            <span>{t('DWS 版本')}</span>
                            <strong>{release.installedVersion || status.version || t('未安装')}</strong>
                            {release.updateAvailable && release.latestVersion ? <Tag color="blue">{t('可升级至 {version}', { version: release.latestVersion })}</Tag> : null}
                        </div>
                        <Space wrap size={8}>
                            <Button size="small" disabled={!release.checkSupported} loading={checkingUpdate} onClick={() => void checkForUpdates()}>{t('检查更新')}</Button>
                            {release.updateAvailable && <Button size="small" type="primary" disabled={!release.upgradeSupported} loading={upgrading} onClick={confirmUpgrade}>{t('升级')}</Button>}
                            {release.rollbackAvailable && <Button size="small" danger loading={rollingBack} onClick={confirmRollback}>{t('回滚')}</Button>}
                        </Space>
                        {release.error ? <div className="connector-version-message is-error">{release.error}</div> : null}
                        {release.lastOperation?.message ? <div className={`connector-version-message ${release.lastOperation.status === 'FAILED' ? 'is-error' : ''}`}>{release.lastOperation.message}</div> : null}
                    </div>
                </article>
            </div>
        </section>

        <Modal
            open={dialogOpen}
            title={connected ? undefined : status.state === 'PROFILE_REQUIRED' ? t('选择当前钉钉组织') : t('安装并连接钉钉')}
            footer={connected ? null : undefined}
            okText={status.state === 'PROFILE_REQUIRED' ? t('使用此组织') : t('安装并授权')}
            cancelText={t('取消')}
            confirmLoading={connecting}
            okButtonProps={{ disabled: status.state === 'PROFILE_REQUIRED' ? !selectedProfile : !status.installSupported && !status.installed }}
            onOk={() => void connect()}
            onCancel={() => !connecting && !disconnecting && setDialogOpen(false)}
            maskClosable={!connecting && !disconnecting}
            closable={!connecting && !disconnecting}
            centered
        >
            {connected ? <div className="connector-connected-dialog">
                <div className="connector-connected-visual" aria-hidden="true">
                    <div className="connector-connected-node connector-connected-cees">CEES</div>
                    <div className="connector-connected-link"><span /><CheckCircleFilled /></div>
                    <div className="connector-connected-node connector-connected-dingtalk">钉</div>
                </div>
                <h2>{t('连接 钉钉')}</h2>
                <p className="connector-connected-description">{t(DINGTALK_DESCRIPTION)}</p>
                <div className="connector-connected-account">
                    <strong>{status.corpName || t('当前钉钉组织')}</strong>
                    <span>{status.externalUserName || status.profile || t('已完成授权')}</span>
                </div>
                <div className="connector-connected-actions">
                    <Button type="primary" size="large" onClick={tryConnector}>{t('去试试')}</Button>
                    <Button danger size="large" loading={disconnecting} onClick={confirmDisconnect}>{t('解绑')}</Button>
                </div>
            </div> : <div className="connector-install-dialog">
                    <div className="connector-install-logo">钉</div>
                    <div>
                        {status.state === 'PROFILE_REQUIRED'
                            ? <>
                                <p>{t('当前账号已授权多个钉钉组织，请明确选择本次使用的组织。CEES 不会默认选择第一项。')}</p>
                                <Select
                                    style={{ width: '100%', marginBottom: 12 }}
                                    placeholder={t('选择钉钉组织账号')}
                                    value={selectedProfile}
                                    onChange={setSelectedProfile}
                                    options={status.profiles.map((profile) => ({
                                        value: profile.profile,
                                        label: `${profile.corpName || profile.corpId || t('未知组织')} · ${profile.externalUserName || profile.externalUserId || t('未知用户')}`,
                                    }))}
                                />
                            </>
                            : <p>{t('CEES 将下载并校验钉钉官方 DWS，然后安装到当前用户的 CEES 数据目录。安装完成后会自动打开钉钉授权流程。')}</p>}
                        {status.state !== 'PROFILE_REQUIRED' && <ul>
                            <li>{t('固定版本：{version}', { version: release.version })}</li>
                            <li>{t('开源许可：{license}', { license: release.license })}</li>
                            <li>{t('当前版本仅在 Windows 支持自动安装')}</li>
                            <li>{t('授权凭据仅保存在本机，不会上传到 CEES API')}</li>
                            <li>{t('暂不安装 DWS 技能与专家能力')}</li>
                        </ul>}
                        {!status.installSupported && !status.installed ? <p className="connector-install-warning">{t('当前系统不支持自动安装，请先手动安装 DWS。')}</p> : null}
                    </div>
                </div>}
        </Modal>
    </div>;
}
