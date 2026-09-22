import { Injectable } from '@nestjs/common';
import { TencentMeetingConfig } from './tencent-meeting.config';
import { TencentMeetingAccountProfile, TencentMeetingTokenSet } from './tencent-meeting.types';

const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_ACCESS_TOKEN_SECONDS = 2 * 60 * 60;
const DEFAULT_REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

export class TencentMeetingProviderError extends Error {
    constructor(
        readonly providerCode: string,
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

@Injectable()
export class TencentMeetingClient {
    constructor(private readonly config: TencentMeetingConfig) { }

    async exchangeAuthorizationCode(authCode: string): Promise<TencentMeetingTokenSet> {
        const settings = this.config.assertConfigured();
        const payload = await this.request(settings.tokenUrl, {
            method: 'POST',
            body: JSON.stringify({ sdk_id: settings.sdkId, secret: settings.secret, auth_code: authCode }),
        });
        return tokenSet(payload);
    }

    async refresh(refreshToken: string, fallbackExternalUserId: string): Promise<TencentMeetingTokenSet> {
        const settings = this.config.assertConfigured();
        const payload = await this.request(settings.refreshTokenUrl, {
            method: 'POST',
            body: JSON.stringify({ sdk_id: settings.sdkId, secret: settings.secret, refresh_token: refreshToken }),
        });
        return tokenSet(payload, fallbackExternalUserId, refreshToken);
    }

    async getUserInfo(accessToken: string, openId: string | null, fallbackExternalUserId: string): Promise<TencentMeetingAccountProfile> {
        const settings = this.config.assertConfigured();
        const headers: Record<string, string> = { AccessToken: accessToken };
        if (openId) headers.OpenId = openId;
        const payload = await this.request(settings.userInfoUrl, {
            method: 'POST',
            headers,
            body: '{}',
        });
        const data = responseData(payload);
        return {
            externalUserId: firstString(data, ['userid', 'user_id', 'open_id']) ?? fallbackExternalUserId,
            displayName: firstString(data, ['username', 'user_name', 'nickname', 'name']),
            organizationId: firstString(data, ['open_corp_id', 'corp_id']),
            organizationName: firstString(data, ['corp_name', 'organization_name']),
        };
    }

    private async request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
        const settings = this.config.assertConfigured();
        let response: Response;
        try {
            response = await fetch(url, {
                ...init,
                redirect: 'error',
                signal: AbortSignal.timeout(settings.requestTimeoutMs),
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
            });
        } catch {
            throw new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议服务暂时不可用', 503);
        }
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
            throw new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议响应超过安全限制', 502);
        }
        let payload: unknown;
        try {
            payload = text ? JSON.parse(text) : {};
        } catch {
            throw new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议返回了无效响应', 502);
        }
        if (!isRecord(payload)) {
            throw new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议返回了无效响应', 502);
        }
        const providerCode = payload.error_code ?? payload.code;
        if (!response.ok || (typeof providerCode === 'number' && providerCode !== 0) || (typeof providerCode === 'string' && providerCode !== '0')) {
            const status = response.status === 429 ? 429 : response.status >= 500 ? 503 : 502;
            const code = status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE';
            const message = status === 429 ? '腾讯会议请求过于频繁，请稍后重试' : '腾讯会议开放平台调用失败';
            throw new TencentMeetingProviderError(code, message, status);
        }
        return payload;
    }
}

function tokenSet(payload: Record<string, unknown>, fallbackExternalUserId?: string, fallbackRefreshToken?: string): TencentMeetingTokenSet {
    const data = responseData(payload);
    const accessToken = firstString(data, ['access_token']);
    const refreshToken = firstString(data, ['refresh_token']) ?? fallbackRefreshToken ?? null;
    const externalUserId = firstString(data, ['user_id', 'userid', 'open_id']) ?? fallbackExternalUserId ?? null;
    if (!accessToken || !refreshToken || !externalUserId) {
        throw new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议未返回完整授权凭据', 502);
    }
    const now = Date.now();
    return {
        accessToken,
        refreshToken,
        externalUserId,
        openId: firstString(data, ['open_id']),
        scopes: scopes(data.scope ?? data.scopes),
        accessTokenExpiresAt: expiryDate(data.expires_in, now, DEFAULT_ACCESS_TOKEN_SECONDS),
        refreshTokenExpiresAt: expiryDate(data.refresh_expires_in, now, DEFAULT_REFRESH_TOKEN_SECONDS),
    };
}

function responseData(payload: Record<string, unknown>): Record<string, unknown> {
    return isRecord(payload.data) ? payload.data : payload;
}

function expiryDate(value: unknown, now: number, fallbackSeconds: number): Date {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isFinite(numeric) || numeric <= 0) return new Date(now + fallbackSeconds * 1000);
    return new Date(numeric >= 1_000_000_000 ? numeric * 1000 : now + numeric * 1000);
}

function scopes(value: unknown): string[] {
    const values = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/[\s,]+/)
            : [];
    return [...new Set(values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))];
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
