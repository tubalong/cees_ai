import {
    AuditOutcome,
    TencentMeetingConnectionState,
    TencentMeetingTokenStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { TencentMeetingClient, TencentMeetingProviderError } from './tencent-meeting.client';
import { TencentMeetingConfig } from './tencent-meeting.config';
import { TencentMeetingCredentialCipher } from './tencent-meeting-credential-cipher';
import { TencentMeetingService } from './tencent-meeting.service';

describe('TencentMeetingService', () => {
    const context = {
        tenantId: '00000000-0000-4000-8000-000000000001',
        userId: '00000000-0000-4000-8000-000000000002',
        membershipId: '00000000-0000-4000-8000-000000000003',
        requestId: 'request-1',
        roles: [],
        permissions: [],
    };
    const tenantContext = { require: jest.fn(() => context) } as unknown as TenantContext;
    const settings = {
        sdkId: 'sdk-1',
        secret: 'secret-1',
        redirectUri: 'https://cees.test/api/v1/connectors/tencent-meeting/oauth/callback',
        authorizeUrl: 'https://meeting.test/oauth2/authorize',
        tokenUrl: 'https://meeting.test/access-token',
        refreshTokenUrl: 'https://meeting.test/refresh-token',
        userInfoUrl: 'https://meeting.test/user-info',
        requestTimeoutMs: 1000,
    };
    const config = {
        assertConfigured: jest.fn(() => settings),
        isConfigured: jest.fn(() => true),
        stateTtlMs: jest.fn(() => 600_000),
        refreshThresholdMs: jest.fn(() => 300_000),
        refreshLeaseMs: jest.fn(() => 30_000),
    } as unknown as TencentMeetingConfig;
    const exchangeAuthorizationCode = jest.fn();
    const getUserInfo = jest.fn();
    const refresh = jest.fn();
    const client = { exchangeAuthorizationCode, getUserInfo, refresh } as unknown as TencentMeetingClient;
    const encrypt = jest.fn((value: string) => `encrypted:${value}`);
    const decrypt = jest.fn((value: string) => value.replace('encrypted:', ''));
    const cipher = { encrypt, decrypt } as unknown as TencentMeetingCredentialCipher;
    const prisma = {
        tencentMeetingConnection: {
            findUnique: jest.fn(),
            findFirstOrThrow: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        tencentMeetingOAuthState: {
            findUnique: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
            deleteMany: jest.fn(),
        },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    } as unknown as PrismaService;
    const service = new TencentMeetingService(prisma, tenantContext, config, client, cipher);

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => callback(prisma));
        (prisma.tencentMeetingConnection.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.tencentMeetingConnection.upsert as jest.Mock).mockResolvedValue(connection());
        (prisma.tencentMeetingOAuthState.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
        (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
    });

    it('发起授权时按租户成员隔离并且数据库只保存 State 摘要', async () => {
        const result = await service.startAuthorization();
        const url = new URL(result.authorizationUrl);
        const rawState = url.searchParams.get('state')!;
        const createInput = (prisma.tencentMeetingOAuthState.create as jest.Mock).mock.calls[0][0];

        expect(rawState).toHaveLength(43);
        expect(createInput.data).toMatchObject({ tenantId: context.tenantId, membershipId: context.membershipId });
        expect(createInput.data.stateHash).toBe(createHash('sha256').update(rawState).digest('hex'));
        expect(JSON.stringify(createInput)).not.toContain(rawState);
        expect(url.searchParams.get('sdk_id')).toBe('sdk-1');
    });

    it('已连接成员不能重复发起授权', async () => {
        (prisma.tencentMeetingConnection.findUnique as jest.Mock).mockResolvedValue(connection());

        await expect(service.startAuthorization()).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CONNECTOR_ALREADY_CONNECTED' }),
        });
        expect(prisma.tencentMeetingOAuthState.create).not.toHaveBeenCalled();
    });

    it('拒绝过期 State 并记录失败审计', async () => {
        (prisma.tencentMeetingOAuthState.findUnique as jest.Mock).mockResolvedValue(oauthState({
            expiresAt: new Date(Date.now() - 1000),
        }));

        await expect(service.completeAuthorization({ state: 's'.repeat(43), authCode: 'code-1' }, 'callback-1')).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'OAUTH_STATE_EXPIRED' }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'TENCENT_MEETING_AUTHORIZATION_FAILED', outcome: AuditOutcome.FAILURE }),
        }));
    });

    it('拒绝已经消费的 State 防止回调重放', async () => {
        (prisma.tencentMeetingOAuthState.findUnique as jest.Mock).mockResolvedValue(oauthState({ consumedAt: new Date() }));

        await expect(service.completeAuthorization({ state: 's'.repeat(43), authCode: 'code-1' }, 'callback-1')).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'OAUTH_STATE_ALREADY_USED' }),
        });
        expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it('篡改 State 时不查询或交换授权码', async () => {
        (prisma.tencentMeetingOAuthState.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(service.completeAuthorization({ state: 'x'.repeat(43), authCode: 'code-1' }, 'callback-1')).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'OAUTH_STATE_INVALID' }),
        });
        expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it('用户拒绝授权时消费 State 并记录受控错误', async () => {
        (prisma.tencentMeetingOAuthState.findUnique as jest.Mock).mockResolvedValue(oauthState());

        await expect(service.completeAuthorization({ state: 's'.repeat(43), error: 'access_denied' }, 'callback-1')).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'OAUTH_ACCESS_DENIED' }),
        });
        expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
        expect(prisma.tencentMeetingOAuthState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ failureCode: 'OAUTH_ACCESS_DENIED' }),
        }));
    });

    it('拒绝不一致的新旧授权码字段', async () => {
        await expect(service.completeAuthorization({
            state: 's'.repeat(43),
            authCode: 'official-code',
            legacyCode: 'legacy-code',
        }, 'callback-1')).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'INVALID_ARGUMENTS' }),
        });
        expect(prisma.tencentMeetingOAuthState.findUnique).not.toHaveBeenCalled();
    });

    it('授权成功后仅保存加密 Token 且不写入审计元数据', async () => {
        (prisma.tencentMeetingOAuthState.findUnique as jest.Mock).mockResolvedValue(oauthState());
        exchangeAuthorizationCode.mockResolvedValue({
            accessToken: 'access-plain',
            refreshToken: 'refresh-plain',
            externalUserId: 'meeting-user-1',
            openId: 'open-1',
            scopes: ['meeting.read'],
            accessTokenExpiresAt: new Date(Date.now() + 7_200_000),
            refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
        });
        getUserInfo.mockResolvedValue({
            externalUserId: 'meeting-user-1',
            displayName: '张三',
            organizationId: 'corp-1',
            organizationName: null,
        });

        await service.completeAuthorization({ state: 's'.repeat(43), authCode: 'code-1' }, 'callback-1');

        const upsertInput = (prisma.tencentMeetingConnection.upsert as jest.Mock).mock.calls[0][0];
        expect(upsertInput.update).toMatchObject({
            accessTokenCiphertext: 'encrypted:access-plain',
            refreshTokenCiphertext: 'encrypted:refresh-plain',
        });
        expect(JSON.stringify((prisma.auditLog.create as jest.Mock).mock.calls)).not.toContain('access-plain');
        expect(JSON.stringify((prisma.auditLog.create as jest.Mock).mock.calls)).not.toContain('refresh-plain');
    });

    it('回调失败时不覆盖已经有效的连接', async () => {
        (prisma.tencentMeetingOAuthState.findUnique as jest.Mock).mockResolvedValue(oauthState());
        (prisma.tencentMeetingConnection.findUnique as jest.Mock).mockResolvedValue(connection());
        exchangeAuthorizationCode.mockRejectedValue(new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议开放平台调用失败', 502));

        await expect(service.completeAuthorization({ state: 's'.repeat(43), authCode: 'code-1' }, 'callback-1')).rejects.toBeDefined();

        expect(prisma.tencentMeetingConnection.update).not.toHaveBeenCalled();
    });

    it('状态查询始终使用 tenantId 和 membershipId 联合条件', async () => {
        (prisma.tencentMeetingConnection.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(service.getStatus()).resolves.toMatchObject({ state: 'NOT_CONNECTED', authenticated: false });
        expect(prisma.tencentMeetingConnection.findUnique).toHaveBeenCalledWith({
            where: { tenantId_membershipId: { tenantId: context.tenantId, membershipId: context.membershipId } },
        });
    });

    it('刷新租约被其他请求占用时不重复调用提供方', async () => {
        const expiring = connection({ accessTokenExpiresAt: new Date(Date.now() + 1000) });
        const refreshed = connection({ accessTokenExpiresAt: new Date(Date.now() + 7_200_000), refreshLeaseId: null, refreshLeaseExpiresAt: null });
        (prisma.tencentMeetingConnection.findUnique as jest.Mock).mockResolvedValue(expiring);
        (prisma.tencentMeetingConnection.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
        (prisma.tencentMeetingConnection.findFirstOrThrow as jest.Mock).mockResolvedValue(refreshed);

        await expect(service.getStatus()).resolves.toMatchObject({ state: 'READY', tokenStatus: 'VALID' });
        expect(refresh).not.toHaveBeenCalled();
    });

    it('临近过期时刷新并轮换加密 Token', async () => {
        const expiring = connection({ accessTokenExpiresAt: new Date(Date.now() + 1000) });
        const refreshed = connection({ accessTokenExpiresAt: new Date(Date.now() + 7_200_000) });
        (prisma.tencentMeetingConnection.findUnique as jest.Mock).mockResolvedValue(expiring);
        (prisma.tencentMeetingConnection.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
        (prisma.tencentMeetingConnection.findFirstOrThrow as jest.Mock).mockResolvedValue(expiring);
        (prisma.tencentMeetingConnection.update as jest.Mock).mockResolvedValue(refreshed);
        refresh.mockResolvedValue({
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            externalUserId: 'meeting-user-1',
            openId: 'open-1',
            scopes: ['meeting.read'],
            accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
            refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
        });

        await expect(service.getStatus()).resolves.toMatchObject({ state: 'READY', authenticated: true });

        expect(refresh).toHaveBeenCalledWith('refresh', 'meeting-user-1');
        expect(prisma.tencentMeetingConnection.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                accessTokenCiphertext: 'encrypted:new-access',
                refreshTokenCiphertext: 'encrypted:new-refresh',
            }),
        }));
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'TENCENT_MEETING_TOKEN_REFRESHED', outcome: AuditOutcome.SUCCESS }),
        }));
    });

    it('刷新失败时释放租约并返回需要重新授权的状态', async () => {
        const expiring = connection({ accessTokenExpiresAt: new Date(Date.now() + 1000) });
        const failed = connection({
            state: TencentMeetingConnectionState.ERROR,
            tokenStatus: TencentMeetingTokenStatus.REFRESH_FAILED,
            lastErrorCode: 'TOKEN_REFRESH_FAILED',
        });
        (prisma.tencentMeetingConnection.findUnique as jest.Mock).mockResolvedValue(expiring);
        (prisma.tencentMeetingConnection.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
        (prisma.tencentMeetingConnection.findFirstOrThrow as jest.Mock).mockResolvedValue(expiring);
        (prisma.tencentMeetingConnection.update as jest.Mock).mockResolvedValue(failed);
        refresh.mockRejectedValue(new TencentMeetingProviderError('PROVIDER_UNAVAILABLE', '腾讯会议开放平台调用失败', 502));

        await expect(service.getStatus()).resolves.toMatchObject({
            state: 'ERROR',
            authenticated: false,
            tokenStatus: 'REFRESH_FAILED',
            lastErrorCode: 'TOKEN_REFRESH_FAILED',
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'TENCENT_MEETING_TOKEN_REFRESH_FAILED', outcome: AuditOutcome.FAILURE }),
        }));
    });

    it('解绑不存在的连接仍成功并写审计', async () => {
        (prisma.tencentMeetingConnection.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(service.disconnect()).resolves.toBeUndefined();
        expect(prisma.tencentMeetingConnection.deleteMany).toHaveBeenCalledWith({
            where: { tenantId: context.tenantId, membershipId: context.membershipId },
        });
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ action: 'TENCENT_MEETING_DISCONNECTED', resourceId: null }),
        }));
    });
});

function oauthState(overrides: Record<string, unknown> = {}) {
    return {
        id: '00000000-0000-4000-8000-000000000010',
        tenantId: '00000000-0000-4000-8000-000000000001',
        membershipId: '00000000-0000-4000-8000-000000000003',
        expiresAt: new Date(Date.now() + 600_000),
        consumedAt: null,
        membership: { userId: '00000000-0000-4000-8000-000000000002' },
        ...overrides,
    };
}

function connection(overrides: Record<string, unknown> = {}) {
    return {
        id: '00000000-0000-4000-8000-000000000020',
        tenantId: '00000000-0000-4000-8000-000000000001',
        membershipId: '00000000-0000-4000-8000-000000000003',
        accessTokenCiphertext: 'encrypted:access',
        refreshTokenCiphertext: 'encrypted:refresh',
        accessTokenExpiresAt: new Date(Date.now() + 7_200_000),
        refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
        externalUserId: 'meeting-user-1',
        displayName: '张三',
        organizationId: 'corp-1',
        organizationName: null,
        grantedScopes: ['meeting.read'],
        state: TencentMeetingConnectionState.READY,
        tokenStatus: TencentMeetingTokenStatus.VALID,
        authorizedAt: new Date(),
        lastVerifiedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
        refreshLeaseId: null,
        refreshLeaseExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
        ...overrides,
    };
}
