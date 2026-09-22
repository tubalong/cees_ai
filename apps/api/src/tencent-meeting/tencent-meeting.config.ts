import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { TencentMeetingSettings } from './tencent-meeting.types';

const DEFAULT_AUTHORIZE_URL = 'https://meeting.tencent.com/marketplace/authorize.html';
const DEFAULT_TOKEN_URL = 'https://meeting.tencent.com/wemeet-webapi/v2/oauth2/oauth/access_token';
const DEFAULT_REFRESH_TOKEN_URL = 'https://meeting.tencent.com/wemeet-webapi/v2/oauth2/oauth/refresh_token';
const DEFAULT_USER_INFO_URL = 'https://meeting.tencent.com/wemeet-webapi/v2/oauth2/oauth/user_info';
const DEFAULT_API_BASE_URL = 'https://api.meeting.qq.com';

@Injectable()
export class TencentMeetingConfig {
    isConfigured(): boolean {
        try {
            this.settings();
            this.encryptionKey();
            return true;
        } catch {
            return false;
        }
    }

    assertConfigured(): TencentMeetingSettings {
        try {
            const settings = this.settings();
            this.encryptionKey();
            return settings;
        } catch {
            throw new ServiceUnavailableException({
                code: 'CONNECTOR_NOT_CONFIGURED',
                message: '腾讯会议连接器尚未完成服务端配置',
            });
        }
    }

    settings(): TencentMeetingSettings {
        const sdkId = required('TENCENT_MEETING_SDK_ID');
        const corpId = required('TENCENT_MEETING_CORP_ID');
        const secret = required('TENCENT_MEETING_SECRET');
        const redirectUri = validUrl(required('TENCENT_MEETING_REDIRECT_URI'), 'TENCENT_MEETING_REDIRECT_URI');
        rejectPlaceholder(sdkId, 'TENCENT_MEETING_SDK_ID');
        rejectPlaceholder(corpId, 'TENCENT_MEETING_CORP_ID');
        rejectPlaceholder(secret, 'TENCENT_MEETING_SECRET');
        return {
            sdkId,
            corpId,
            secret,
            redirectUri,
            authorizeUrl: validUrl(process.env.TENCENT_MEETING_AUTHORIZE_URL?.trim() || DEFAULT_AUTHORIZE_URL, 'TENCENT_MEETING_AUTHORIZE_URL'),
            tokenUrl: validUrl(process.env.TENCENT_MEETING_TOKEN_URL?.trim() || DEFAULT_TOKEN_URL, 'TENCENT_MEETING_TOKEN_URL'),
            refreshTokenUrl: validUrl(process.env.TENCENT_MEETING_REFRESH_TOKEN_URL?.trim() || DEFAULT_REFRESH_TOKEN_URL, 'TENCENT_MEETING_REFRESH_TOKEN_URL'),
            userInfoUrl: validUrl(process.env.TENCENT_MEETING_USER_INFO_URL?.trim() || DEFAULT_USER_INFO_URL, 'TENCENT_MEETING_USER_INFO_URL'),
            apiBaseUrl: validUrl(process.env.TENCENT_MEETING_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL, 'TENCENT_MEETING_API_BASE_URL'),
            requestTimeoutMs: positiveInteger(process.env.TENCENT_MEETING_REQUEST_TIMEOUT_MS, 10_000),
            providerResponseMaxBytes: positiveInteger(process.env.TENCENT_MEETING_PROVIDER_RESPONSE_MAX_BYTES, 512 * 1024),
            executionResponseMaxBytes: positiveInteger(process.env.TENCENT_MEETING_EXECUTION_RESPONSE_MAX_BYTES, 256 * 1024),
        };
    }

    encryptionKey(): Buffer {
        const raw = required('TENCENT_MEETING_CREDENTIAL_ENCRYPTION_KEY');
        rejectPlaceholder(raw, 'TENCENT_MEETING_CREDENTIAL_ENCRYPTION_KEY');
        const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
        if (key.length !== 32) {
            throw new Error('TENCENT_MEETING_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64');
        }
        return key;
    }

    stateTtlMs(): number {
        return positiveInteger(process.env.TENCENT_MEETING_OAUTH_STATE_TTL_MS, 10 * 60 * 1000);
    }

    refreshThresholdMs(): number {
        return positiveInteger(process.env.TENCENT_MEETING_REFRESH_THRESHOLD_MS, 5 * 60 * 1000);
    }

    refreshLeaseMs(): number {
        return positiveInteger(process.env.TENCENT_MEETING_REFRESH_LEASE_MS, 30 * 1000);
    }
}

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function rejectPlaceholder(value: string, name: string): void {
    if (value === 'change_me') throw new Error(`${name} must not use the example placeholder`);
}

function validUrl(value: string, name: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
        throw new Error(`${name} must use HTTPS in production`);
    }
    return url.toString();
}

function positiveInteger(value: string | undefined, fallback: number): number {
    if (!value?.trim()) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('Tencent Meeting duration configuration must be a positive integer');
    return parsed;
}
