import { CheckCircleFilled, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Modal, Select, Spin, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useI18n } from '../../core/i18n';

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

export default function ConnectorMarketplacePage(): JSX.Element {
    const { t } = useI18n();
    const { message } = AntdApp.useApp();
    const [status, setStatus] = useState<DingTalkConnectorStatus>(EMPTY_STATUS);
    const [release, setRelease] = useState({ version: 'v1.0.62', license: 'Apache-2.0' });
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
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

    const connected = status.installed && status.authenticated;
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
                        <p>{t('动态读取当前账号授权范围内的 DWS 安全只读能力，并在对话中作为只读上下文使用。')}</p>
                    </div>
                    <div className="connector-card-meta">
                        {loading ? <Spin size="small" /> : <>
                            <span>{status.corpName || status.profile || t('尚未授权组织')}</span>
                            <small>{status.externalUserName || status.version || release.version}</small>
                        </>}
                    </div>
                    {status.error && !connected ? <div className="connector-card-error">{status.error}</div> : null}
                    {status.state === 'ERROR' ? <Button size="small" onClick={() => void retry()}>{t('重试检查')}</Button> : null}
                </article>
            </div>
        </section>

        <Modal
            open={dialogOpen}
            title={status.state === 'PROFILE_REQUIRED' ? t('选择当前钉钉组织') : connected ? t('重新授权钉钉连接器') : t('安装并连接钉钉')}
            okText={status.state === 'PROFILE_REQUIRED' ? t('使用此组织') : connected ? t('重新授权') : t('安装并授权')}
            cancelText={t('取消')}
            confirmLoading={connecting}
            okButtonProps={{ disabled: status.state === 'PROFILE_REQUIRED' ? !selectedProfile : !status.installSupported && !status.installed }}
            onOk={() => void connect()}
            onCancel={() => !connecting && setDialogOpen(false)}
            maskClosable={!connecting}
            closable={!connecting}
        >
            <div className="connector-install-dialog">
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
            </div>
        </Modal>
    </div>;
}
