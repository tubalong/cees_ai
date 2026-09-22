import {
    disconnectTencentMeeting,
    getTencentMeetingConnection,
    startTencentMeetingAuthorization,
} from '../../core/api';
import {
    toTencentMeetingConnectorStatus,
    type TencentMeetingConnectorStatus,
} from '../../../electron/connectors/tencent-meeting/tencent-meeting-status';

const MIN_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 5_000;

export async function getTencentMeetingStatus(): Promise<TencentMeetingConnectorStatus> {
    return toTencentMeetingConnectorStatus(await getTencentMeetingConnection());
}

export async function connectTencentMeeting(
    onAuthorizing?: (status: TencentMeetingConnectorStatus) => void,
): Promise<TencentMeetingConnectorStatus> {
    const authorization = await startTencentMeetingAuthorization();
    const expiresAt = Date.parse(authorization.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('腾讯会议授权地址已经过期，请重新发起连接');
    }
    const opened = await window.cees?.openExternal(authorization.authorizationUrl);
    if (!opened) throw new Error('无法打开系统浏览器，请检查桌面运行环境');
    onAuthorizing?.(await getTencentMeetingStatus());

    const pollInterval = Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, authorization.pollAfterMs));
    let lastError: unknown;
    while (Date.now() < expiresAt) {
        await delay(pollInterval);
        try {
            const status = await getTencentMeetingStatus();
            if (status.state === 'READY' || status.state === 'ERROR') return status;
        } catch (error) {
            lastError = error;
        }
    }
    let status: TencentMeetingConnectorStatus;
    try {
        status = await getTencentMeetingStatus();
    } catch (error) {
        throw lastError ?? error;
    }
    return status.state === 'READY' ? status : {
        ...status,
        state: 'AUTH_REQUIRED',
        authenticated: false,
        issueCode: 'OAUTH_STATE_EXPIRED',
        recoveryAction: 'AUTHORIZE',
        error: '腾讯会议授权等待超时，请重新连接',
    };
}

export async function disconnectTencentMeetingConnector(): Promise<TencentMeetingConnectorStatus> {
    await disconnectTencentMeeting();
    return getTencentMeetingStatus();
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
