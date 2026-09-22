import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { TencentMeetingConfig } from './tencent-meeting.config';
import { TencentMeetingAccountProfile, TencentMeetingTokenSet } from './tencent-meeting.types';

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

    async refresh(refreshToken: string, openId: string): Promise<TencentMeetingTokenSet> {
        const settings = this.config.assertConfigured();
        const payload = await this.request(settings.refreshTokenUrl, {
            method: 'POST',
            body: JSON.stringify({ sdk_id: settings.sdkId, refresh_token: refreshToken, open_id: openId }),
        });
        return tokenSet(payload, openId, refreshToken);
    }

    async getUserInfo(accessToken: string, openId: string | null, fallbackExternalUserId: string): Promise<TencentMeetingAccountProfile> {
        const settings = this.config.assertConfigured();
        const effectiveOpenId = openId ?? fallbackExternalUserId;
        const payload = await this.request(settings.userInfoUrl, {
            method: 'POST',
            body: JSON.stringify({ access_token: accessToken, open_id: effectiveOpenId }),
        });
        const data = responseData(payload);
        return {
            externalUserId: firstString(data, ['open_id', 'userid', 'user_id']) ?? fallbackExternalUserId,
            displayName: firstString(data, ['username', 'user_name', 'nickname', 'name']),
            organizationId: firstString(data, ['open_corp_id', 'corp_id']),
            organizationName: firstString(data, ['corp_name', 'organization_name']),
        };
    }

    listMeetings(
        accessToken: string,
        openId: string,
        cursor?: { pos: number; cursory: number },
    ): Promise<Record<string, unknown>> {
        return this.openApiRequest('/v1/meetings', accessToken, openId, compactQuery({
            userid: openId,
            instanceid: '1',
            pos: cursor ? String(cursor.pos) : undefined,
            cursory: cursor ? String(cursor.cursory) : undefined,
        }));
    }

    getMeeting(accessToken: string, openId: string, meetingId: string): Promise<Record<string, unknown>> {
        return this.openApiRequest(`/v1/meetings/${encodeURIComponent(meetingId)}`, accessToken, openId, {
            instanceid: '1',
            operator_id: openId,
            operator_id_type: '2',
        });
    }

    listParticipants(
        accessToken: string,
        openId: string,
        meetingId: string,
        page: number,
        pageSize: number,
    ): Promise<Record<string, unknown>> {
        return this.openApiRequest(`/v1/meetings/${encodeURIComponent(meetingId)}/real-time-participants`, accessToken, openId, {
            operator_id: openId,
            operator_id_type: '2',
            page: String(page),
            page_size: String(pageSize),
        });
    }

    listRecordings(
        accessToken: string,
        openId: string,
        meetingId: string,
        startTime: number,
        endTime: number,
        page: number,
    ): Promise<Record<string, unknown>> {
        return this.openApiRequest('/v1/records', accessToken, openId, {
            meeting_id: meetingId,
            operator_id: openId,
            operator_id_type: '2',
            start_time: String(startTime),
            end_time: String(endTime),
            page: String(page),
            page_size: '20',
        });
    }

    private openApiRequest(
        path: string,
        accessToken: string,
        openId: string,
        query: Record<string, string>,
    ): Promise<Record<string, unknown>> {
        const settings = this.config.assertConfigured();
        const url = new URL(path, settings.apiBaseUrl);
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
        return this.request(url.toString(), {
            method: 'GET',
            headers: {
                'X-TC-Timestamp': String(Math.floor(Date.now() / 1000)),
                'X-TC-Nonce': String(randomInt(1, 2_147_483_647)),
                'X-TC-Registered': '1',
                AccessToken: accessToken,
                OpenId: openId,
            },
        });
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
        if (Buffer.byteLength(text, 'utf8') > settings.providerResponseMaxBytes) {
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
        const providerCode = extractProviderCode(payload);
        if (!response.ok || failedProviderCode(providerCode)) {
            throw providerError(response.status, providerCode);
        }
        return payload;
    }
}

function tokenSet(payload: Record<string, unknown>, fallbackOpenId?: string, fallbackRefreshToken?: string): TencentMeetingTokenSet {
    const data = responseData(payload);
    const accessToken = firstString(data, ['access_token']);
    const refreshToken = firstString(data, ['refresh_token']) ?? fallbackRefreshToken ?? null;
    const openId = firstString(data, ['open_id']) ?? fallbackOpenId ?? null;
    if (!accessToken || !refreshToken || !openId) {
        throw new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议未返回完整授权凭据', 502);
    }
    const now = Date.now();
    return {
        accessToken,
        refreshToken,
        externalUserId: openId,
        openId,
        openCorpId: firstString(data, ['open_corp_id']),
        scopes: scopes(data.scopes ?? data.scope),
        accessTokenExpiresAt: absoluteExpiryDate(data.expires, now, DEFAULT_ACCESS_TOKEN_SECONDS),
        refreshTokenExpiresAt: absoluteExpiryDate(data.refresh_expires, now, DEFAULT_REFRESH_TOKEN_SECONDS),
    };
}

function providerError(status: number, providerCode: unknown): TencentMeetingProviderError {
    const normalizedCode = String(providerCode ?? '').toLowerCase();
    if (['9042', '500014'].includes(normalizedCode) || normalizedCode.includes('permission') || normalizedCode.includes('forbidden')) {
        return new TencentMeetingProviderError('RESOURCE_FORBIDDEN', '当前腾讯会议账号无权访问该资源', 403);
    }
    if (normalizedCode === '190310') {
        return new TencentMeetingProviderError('PROVIDER_RATE_LIMITED', '腾讯会议请求过于频繁，请稍后重试', 429);
    }
    if (['202004', '9108'].includes(normalizedCode)) {
        return new TencentMeetingProviderError('AUTH_REQUIRED', '腾讯会议授权已失效，请重新连接', 409);
    }
    if (status === 401) return new TencentMeetingProviderError('AUTH_REQUIRED', '腾讯会议授权已失效，请重新连接', 409);
    if (status === 403) return new TencentMeetingProviderError('RESOURCE_FORBIDDEN', '当前腾讯会议账号无权访问该资源', 403);
    if (status === 429) return new TencentMeetingProviderError('PROVIDER_RATE_LIMITED', '腾讯会议请求过于频繁，请稍后重试', 429);
    if (status >= 500) return new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议服务暂时不可用', 503);
    return new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议开放平台调用失败', 502);
}

function extractProviderCode(payload: Record<string, unknown>): unknown {
    if (isRecord(payload.error_info)) return payload.error_info.error_code ?? payload.error_info.code;
    return payload.error_code ?? payload.code;
}

function failedProviderCode(value: unknown): boolean {
    return (typeof value === 'number' && value !== 0)
        || (typeof value === 'string' && value !== '' && value !== '0');
}

function responseData(payload: Record<string, unknown>): Record<string, unknown> {
    return isRecord(payload.data) ? payload.data : payload;
}

function absoluteExpiryDate(value: unknown, now: number, fallbackSeconds: number): Date {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isFinite(numeric) || numeric <= 0) return new Date(now + fallbackSeconds * 1000);
    return new Date(numeric * 1000);
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
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactQuery(value: Record<string, string | undefined>): Record<string, string> {
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
