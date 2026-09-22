import {
    BadRequestException,
    ConflictException,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';
import {
    AuditOutcome,
    Prisma,
    TencentMeetingConnectionState,
    TencentMeetingTokenStatus,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { RequestTenantContext, TenantContext } from '../tenant/tenant-context';
import { TencentMeetingClient, TencentMeetingProviderError } from './tencent-meeting.client';
import { TencentMeetingConfig } from './tencent-meeting.config';
import { TencentMeetingCredentialCipher } from './tencent-meeting-credential-cipher';
import {
    TencentMeetingAuthorizationResult,
    TencentMeetingCallbackInput,
    TencentMeetingCallbackResult,
    TencentMeetingConnectionResult,
} from './tencent-meeting.types';

const RESOURCE_TYPE = 'TENCENT_MEETING_CONNECTION';
const POLL_AFTER_MS = 1500;

@Injectable()
export class TencentMeetingService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly config: TencentMeetingConfig,
        private readonly client: TencentMeetingClient,
        private readonly credentialCipher: TencentMeetingCredentialCipher,
    ) { }

    async startAuthorization(): Promise<TencentMeetingAuthorizationResult> {
        const context = this.tenantContext.require();
        const settings = this.config.assertConfigured();
        const rawState = randomBytes(32).toString('base64url');
        const stateHash = hashState(rawState);
        const expiresAt = new Date(Date.now() + this.config.stateTtlMs());

        await this.prisma.$transaction(async (transaction) => {
            const current = await transaction.tencentMeetingConnection.findUnique({
                where: { tenantId_membershipId: { tenantId: context.tenantId, membershipId: context.membershipId } },
            });
            if (current?.state === TencentMeetingConnectionState.READY && current.tokenStatus !== TencentMeetingTokenStatus.REVOKED) {
                throw new ConflictException({
                    code: 'CONNECTOR_ALREADY_CONNECTED',
                    message: '当前成员已经连接腾讯会议，请先解绑后再重新授权',
                });
            }
            await transaction.tencentMeetingOAuthState.deleteMany({
                where: { tenantId: context.tenantId, membershipId: context.membershipId, consumedAt: null },
            });
            await transaction.tencentMeetingOAuthState.create({
                data: {
                    tenantId: context.tenantId,
                    membershipId: context.membershipId,
                    stateHash,
                    expiresAt,
                },
            });
            const connection = await transaction.tencentMeetingConnection.upsert({
                where: { tenantId_membershipId: { tenantId: context.tenantId, membershipId: context.membershipId } },
                create: {
                    tenantId: context.tenantId,
                    membershipId: context.membershipId,
                    state: TencentMeetingConnectionState.AUTHORIZING,
                },
                update: {
                    state: TencentMeetingConnectionState.AUTHORIZING,
                    tokenStatus: null,
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    version: { increment: 1 },
                },
            });
            await this.writeAudit(transaction, context, 'TENCENT_MEETING_AUTHORIZATION_STARTED', AuditOutcome.SUCCESS, connection.id, {
                expiresAt: expiresAt.toISOString(),
            });
        });

        const authorizationUrl = new URL(settings.authorizeUrl);
        authorizationUrl.searchParams.set('sdk_id', settings.sdkId);
        authorizationUrl.searchParams.set('redirect_uri', settings.redirectUri);
        authorizationUrl.searchParams.set('response_type', 'code');
        authorizationUrl.searchParams.set('state', rawState);
        return { authorizationUrl: authorizationUrl.toString(), expiresAt: expiresAt.toISOString(), pollAfterMs: POLL_AFTER_MS };
    }

    async completeAuthorization(input: TencentMeetingCallbackInput, requestId: string): Promise<TencentMeetingCallbackResult> {
        this.config.assertConfigured();
        validateCallbackInput(input);
        const authCode = resolveAuthorizationCode(input);
        if (!authCode && !input.error) {
            throw callbackException('INVALID_ARGUMENTS', '腾讯会议回调缺少授权结果');
        }
        const state = await this.prisma.tencentMeetingOAuthState.findUnique({
            where: { stateHash: hashState(input.state) },
            include: { membership: { select: { userId: true } } },
        });
        if (!state) throw callbackException('OAUTH_STATE_INVALID', '授权请求无效，请返回 CEES 重新连接');
        const actor = callbackContext(state.tenantId, state.membershipId, state.membership.userId, requestId);
        if (state.consumedAt) {
            await this.auditCallbackFailure(actor, null, 'OAUTH_STATE_ALREADY_USED');
            throw callbackException('OAUTH_STATE_ALREADY_USED', '本次授权请求已经处理，请返回 CEES 查看连接状态');
        }
        if (state.expiresAt.getTime() <= Date.now()) {
            await this.consumeFailedState(state.id, actor, 'OAUTH_STATE_EXPIRED', '授权请求已过期');
            throw callbackException('OAUTH_STATE_EXPIRED', '授权请求已过期，请返回 CEES 重新连接');
        }
        const consumed = await this.prisma.tencentMeetingOAuthState.updateMany({
            where: { id: state.id, consumedAt: null },
            data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1) {
            await this.auditCallbackFailure(actor, null, 'OAUTH_STATE_ALREADY_USED');
            throw callbackException('OAUTH_STATE_ALREADY_USED', '本次授权请求已经处理，请返回 CEES 查看连接状态');
        }
        if (input.error) {
            await this.recordCallbackFailure(state.id, actor, 'OAUTH_ACCESS_DENIED', '用户未同意腾讯会议授权');
            throw callbackException('OAUTH_ACCESS_DENIED', '腾讯会议授权未完成，请返回 CEES 后重试');
        }

        try {
            const tokens = await this.client.exchangeAuthorizationCode(authCode!);
            const account = await this.client.getUserInfo(tokens.accessToken, tokens.openId, tokens.externalUserId);
            const authorizedAt = new Date();
            await this.prisma.$transaction(async (transaction) => {
                const connection = await transaction.tencentMeetingConnection.upsert({
                    where: { tenantId_membershipId: { tenantId: state.tenantId, membershipId: state.membershipId } },
                    create: {
                        tenantId: state.tenantId,
                        membershipId: state.membershipId,
                        accessTokenCiphertext: this.credentialCipher.encrypt(tokens.accessToken),
                        refreshTokenCiphertext: this.credentialCipher.encrypt(tokens.refreshToken),
                        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
                        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
                        externalUserId: account.externalUserId,
                        displayName: account.displayName,
                        organizationId: account.organizationId,
                        organizationName: account.organizationName,
                        grantedScopes: tokens.scopes,
                        state: TencentMeetingConnectionState.READY,
                        tokenStatus: TencentMeetingTokenStatus.VALID,
                        authorizedAt,
                        lastVerifiedAt: authorizedAt,
                    },
                    update: {
                        accessTokenCiphertext: this.credentialCipher.encrypt(tokens.accessToken),
                        refreshTokenCiphertext: this.credentialCipher.encrypt(tokens.refreshToken),
                        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
                        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
                        externalUserId: account.externalUserId,
                        displayName: account.displayName,
                        organizationId: account.organizationId,
                        organizationName: account.organizationName,
                        grantedScopes: tokens.scopes,
                        state: TencentMeetingConnectionState.READY,
                        tokenStatus: TencentMeetingTokenStatus.VALID,
                        authorizedAt,
                        lastVerifiedAt: authorizedAt,
                        lastErrorCode: null,
                        lastErrorMessage: null,
                        refreshLeaseId: null,
                        refreshLeaseExpiresAt: null,
                        version: { increment: 1 },
                    },
                });
                await this.writeAudit(transaction, actor, 'TENCENT_MEETING_AUTHORIZATION_SUCCEEDED', AuditOutcome.SUCCESS, connection.id, {
                    externalUserId: account.externalUserId,
                    organizationId: account.organizationId,
                    grantedScopeCount: tokens.scopes.length,
                });
            });
            return { success: true, title: '腾讯会议连接成功', message: '授权已完成，可以关闭此页面并返回 CEES。' };
        } catch (error) {
            const mapped = providerHttpException(error);
            const code = exceptionCode(mapped);
            await this.recordCallbackFailure(state.id, actor, code, exceptionMessage(mapped));
            throw mapped;
        }
    }

    async getStatus(): Promise<TencentMeetingConnectionResult> {
        const context = this.tenantContext.require();
        if (!this.config.isConfigured()) return configurationErrorStatus();
        let connection = await this.prisma.tencentMeetingConnection.findUnique({
            where: { tenantId_membershipId: { tenantId: context.tenantId, membershipId: context.membershipId } },
        });
        if (!connection) return notConnectedStatus();
        if (shouldRefresh(connection.accessTokenExpiresAt, connection.state, this.config.refreshThresholdMs())) {
            connection = await this.refreshConnection(connection.id, context);
        }
        return connectionStatus(connection, this.config.refreshThresholdMs());
    }

    async disconnect(): Promise<void> {
        const context = this.tenantContext.require();
        await this.prisma.$transaction(async (transaction) => {
            const connection = await transaction.tencentMeetingConnection.findUnique({
                where: { tenantId_membershipId: { tenantId: context.tenantId, membershipId: context.membershipId } },
                select: { id: true },
            });
            await transaction.tencentMeetingOAuthState.deleteMany({
                where: { tenantId: context.tenantId, membershipId: context.membershipId },
            });
            await transaction.tencentMeetingConnection.deleteMany({
                where: { tenantId: context.tenantId, membershipId: context.membershipId },
            });
            await this.writeAudit(transaction, context, 'TENCENT_MEETING_DISCONNECTED', AuditOutcome.SUCCESS, connection?.id ?? null, {
                localCredentialsDeleted: true,
            });
        });
    }

    private async refreshConnection(connectionId: string, context: RequestTenantContext) {
        const leaseId = randomUUID();
        const leaseExpiresAt = new Date(Date.now() + this.config.refreshLeaseMs());
        const threshold = new Date(Date.now() + this.config.refreshThresholdMs());
        const acquired = await this.prisma.tencentMeetingConnection.updateMany({
            where: {
                id: connectionId,
                tenantId: context.tenantId,
                membershipId: context.membershipId,
                state: TencentMeetingConnectionState.READY,
                accessTokenExpiresAt: { lte: threshold },
                OR: [{ refreshLeaseExpiresAt: null }, { refreshLeaseExpiresAt: { lte: new Date() } }],
            },
            data: { refreshLeaseId: leaseId, refreshLeaseExpiresAt: leaseExpiresAt },
        });
        if (acquired.count !== 1) return this.waitForRefresh(connectionId, context);
        const connection = await this.prisma.tencentMeetingConnection.findFirstOrThrow({
            where: { id: connectionId, tenantId: context.tenantId, membershipId: context.membershipId, refreshLeaseId: leaseId },
        });
        if (!connection.refreshTokenCiphertext || !connection.externalUserId || expired(connection.refreshTokenExpiresAt)) {
            return this.markRefreshFailed(connectionId, leaseId, context, 'AUTH_REQUIRED', '腾讯会议授权已过期，请重新连接');
        }
        try {
            const tokens = await this.client.refresh(
                this.credentialCipher.decrypt(connection.refreshTokenCiphertext),
                connection.externalUserId,
            );
            const updated = await this.prisma.$transaction(async (transaction) => {
                const refreshed = await transaction.tencentMeetingConnection.update({
                    where: { id: connectionId, refreshLeaseId: leaseId },
                    data: {
                        accessTokenCiphertext: this.credentialCipher.encrypt(tokens.accessToken),
                        refreshTokenCiphertext: this.credentialCipher.encrypt(tokens.refreshToken),
                        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
                        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
                        externalUserId: tokens.externalUserId,
                        grantedScopes: tokens.scopes.length > 0 ? tokens.scopes : jsonStringArray(connection.grantedScopes),
                        state: TencentMeetingConnectionState.READY,
                        tokenStatus: TencentMeetingTokenStatus.VALID,
                        lastVerifiedAt: new Date(),
                        lastErrorCode: null,
                        lastErrorMessage: null,
                        refreshLeaseId: null,
                        refreshLeaseExpiresAt: null,
                        version: { increment: 1 },
                    },
                });
                await this.writeAudit(transaction, context, 'TENCENT_MEETING_TOKEN_REFRESHED', AuditOutcome.SUCCESS, connectionId, {
                    tokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
                });
                return refreshed;
            });
            return updated;
        } catch (error) {
            return this.markRefreshFailed(connectionId, leaseId, context, 'TOKEN_REFRESH_FAILED', exceptionMessage(providerHttpException(error)));
        }
    }

    private async waitForRefresh(connectionId: string, context: RequestTenantContext) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await delay(100);
            const connection = await this.prisma.tencentMeetingConnection.findFirstOrThrow({
                where: { id: connectionId, tenantId: context.tenantId, membershipId: context.membershipId },
            });
            if (!connection.refreshLeaseId || !connection.refreshLeaseExpiresAt || connection.refreshLeaseExpiresAt.getTime() <= Date.now()) {
                return connection;
            }
        }
        return this.prisma.tencentMeetingConnection.findFirstOrThrow({
            where: { id: connectionId, tenantId: context.tenantId, membershipId: context.membershipId },
        });
    }

    private async markRefreshFailed(
        connectionId: string,
        leaseId: string,
        context: RequestTenantContext,
        code: string,
        message: string,
    ) {
        return this.prisma.$transaction(async (transaction) => {
            const failed = await transaction.tencentMeetingConnection.update({
                where: { id: connectionId, refreshLeaseId: leaseId },
                data: {
                    state: TencentMeetingConnectionState.ERROR,
                    tokenStatus: TencentMeetingTokenStatus.REFRESH_FAILED,
                    lastErrorCode: code,
                    lastErrorMessage: message.slice(0, 2000),
                    refreshLeaseId: null,
                    refreshLeaseExpiresAt: null,
                    version: { increment: 1 },
                },
            });
            await this.writeAudit(transaction, context, 'TENCENT_MEETING_TOKEN_REFRESH_FAILED', AuditOutcome.FAILURE, connectionId, {
                errorCode: code,
            });
            return failed;
        });
    }

    private async consumeFailedState(stateId: string, actor: RequestTenantContext, code: string, message: string): Promise<void> {
        await this.prisma.tencentMeetingOAuthState.updateMany({
            where: { id: stateId, consumedAt: null },
            data: { consumedAt: new Date(), failureCode: code },
        });
        await this.recordCallbackFailure(stateId, actor, code, message);
    }

    private async recordCallbackFailure(
        stateId: string,
        actor: RequestTenantContext,
        code: string,
        message: string,
    ): Promise<void> {
        await this.prisma.$transaction(async (transaction) => {
            await transaction.tencentMeetingOAuthState.updateMany({
                where: { id: stateId },
                data: { failureCode: code },
            });
            const connection = await transaction.tencentMeetingConnection.findUnique({
                where: { tenantId_membershipId: { tenantId: actor.tenantId, membershipId: actor.membershipId } },
                select: { id: true, state: true },
            });
            if (connection && connection.state !== TencentMeetingConnectionState.READY) {
                await transaction.tencentMeetingConnection.update({
                    where: { id: connection.id },
                    data: {
                        state: TencentMeetingConnectionState.ERROR,
                        tokenStatus: null,
                        lastErrorCode: code,
                        lastErrorMessage: message.slice(0, 2000),
                        version: { increment: 1 },
                    },
                });
            }
            await this.writeAudit(transaction, actor, 'TENCENT_MEETING_AUTHORIZATION_FAILED', AuditOutcome.FAILURE, connection?.id ?? null, {
                errorCode: code,
            });
        });
    }

    private async auditCallbackFailure(actor: RequestTenantContext, resourceId: string | null, code: string): Promise<void> {
        await this.prisma.auditLog.create({
            data: auditData(actor, 'TENCENT_MEETING_AUTHORIZATION_FAILED', AuditOutcome.FAILURE, resourceId, { errorCode: code }),
        });
    }

    private writeAudit(
        transaction: Prisma.TransactionClient,
        context: RequestTenantContext,
        action: string,
        outcome: AuditOutcome,
        resourceId: string | null,
        metadata: Prisma.InputJsonValue,
    ) {
        return transaction.auditLog.create({ data: auditData(context, action, outcome, resourceId, metadata) });
    }
}

function resolveAuthorizationCode(input: TencentMeetingCallbackInput): string | null {
    if (input.authCode && input.legacyCode && input.authCode !== input.legacyCode) {
        throw callbackException('INVALID_ARGUMENTS', '腾讯会议回调授权码不一致');
    }
    return input.authCode ?? input.legacyCode ?? null;
}

function validateCallbackInput(input: TencentMeetingCallbackInput): void {
    if (input.state.length < 32 || input.state.length > 64) {
        throw callbackException('OAUTH_STATE_INVALID', '授权请求无效，请返回 CEES 重新连接');
    }
    if (input.authCode && input.authCode.length > 2048) throw callbackException('INVALID_ARGUMENTS', '腾讯会议回调授权码无效');
    if (input.legacyCode && input.legacyCode.length > 2048) throw callbackException('INVALID_ARGUMENTS', '腾讯会议回调授权码无效');
    if (input.error && input.error.length > 200) throw callbackException('INVALID_ARGUMENTS', '腾讯会议回调错误码无效');
    if (input.errorDescription && input.errorDescription.length > 2000) throw callbackException('INVALID_ARGUMENTS', '腾讯会议回调错误说明无效');
}

function hashState(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function callbackContext(tenantId: string, membershipId: string, userId: string, requestId: string): RequestTenantContext {
    return { tenantId, membershipId, userId, requestId, roles: [], permissions: [] };
}

function callbackException(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message });
}

function providerHttpException(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof TencentMeetingProviderError) {
        return new HttpException({ code: error.providerCode, message: error.message }, error.status);
    }
    return new HttpException({ code: 'PROVIDER_UNAVAILABLE', message: '腾讯会议服务暂时不可用' }, HttpStatus.BAD_GATEWAY);
}

function exceptionCode(error: HttpException): string {
    const response = error.getResponse();
    return typeof response === 'object' && response !== null && typeof (response as { code?: unknown }).code === 'string'
        ? (response as { code: string }).code
        : 'PROVIDER_UNAVAILABLE';
}

function exceptionMessage(error: HttpException): string {
    const response = error.getResponse();
    return typeof response === 'object' && response !== null && typeof (response as { message?: unknown }).message === 'string'
        ? (response as { message: string }).message
        : '腾讯会议服务暂时不可用';
}

function auditData(
    context: RequestTenantContext,
    action: string,
    outcome: AuditOutcome,
    resourceId: string | null,
    metadata: Prisma.InputJsonValue,
): Prisma.AuditLogCreateInput {
    return {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorMembershipId: context.membershipId,
        action,
        outcome,
        resourceType: RESOURCE_TYPE,
        resourceId,
        requestId: context.requestId,
        metadata,
    };
}

function configurationErrorStatus(): TencentMeetingConnectionResult {
    return {
        state: 'ERROR',
        authenticated: false,
        account: null,
        grantedScopes: [],
        tokenStatus: 'MISSING',
        authorizedAt: null,
        tokenExpiresAt: null,
        lastVerifiedAt: null,
        lastErrorCode: 'CONNECTOR_NOT_CONFIGURED',
        lastErrorMessage: '腾讯会议连接器尚未完成服务端配置',
        updatedAt: new Date().toISOString(),
    };
}

function notConnectedStatus(): TencentMeetingConnectionResult {
    return {
        state: 'NOT_CONNECTED',
        authenticated: false,
        account: null,
        grantedScopes: [],
        tokenStatus: 'MISSING',
        authorizedAt: null,
        tokenExpiresAt: null,
        lastVerifiedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date().toISOString(),
    };
}

function connectionStatus(
    connection: {
        state: TencentMeetingConnectionState;
        tokenStatus: TencentMeetingTokenStatus | null;
        externalUserId: string | null;
        displayName: string | null;
        organizationId: string | null;
        organizationName: string | null;
        grantedScopes: Prisma.JsonValue;
        authorizedAt: Date | null;
        accessTokenExpiresAt: Date | null;
        lastVerifiedAt: Date | null;
        lastErrorCode: string | null;
        lastErrorMessage: string | null;
        updatedAt: Date;
    },
    refreshThresholdMs: number,
): TencentMeetingConnectionResult {
    const tokenStatus = connection.tokenStatus ?? 'MISSING';
    const effectiveTokenStatus = connection.state === TencentMeetingConnectionState.READY
        && connection.accessTokenExpiresAt
        && connection.accessTokenExpiresAt.getTime() <= Date.now() + refreshThresholdMs
        ? 'EXPIRING'
        : tokenStatus;
    const authenticated = connection.state === TencentMeetingConnectionState.READY
        && (effectiveTokenStatus === 'VALID' || effectiveTokenStatus === 'EXPIRING')
        && Boolean(connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now());
    return {
        state: connection.state,
        authenticated,
        account: connection.externalUserId ? {
            externalUserId: connection.externalUserId,
            displayName: connection.displayName,
            organizationId: connection.organizationId,
            organizationName: connection.organizationName,
        } : null,
        grantedScopes: jsonStringArray(connection.grantedScopes),
        tokenStatus: effectiveTokenStatus,
        authorizedAt: connection.authorizedAt?.toISOString() ?? null,
        tokenExpiresAt: connection.accessTokenExpiresAt?.toISOString() ?? null,
        lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
        lastErrorCode: connection.lastErrorCode,
        lastErrorMessage: connection.lastErrorMessage,
        updatedAt: connection.updatedAt.toISOString(),
    };
}

function shouldRefresh(expiresAt: Date | null, state: TencentMeetingConnectionState, thresholdMs: number): boolean {
    return state === TencentMeetingConnectionState.READY
        && Boolean(expiresAt && expiresAt.getTime() <= Date.now() + thresholdMs);
}

function expired(value: Date | null): boolean {
    return !value || value.getTime() <= Date.now();
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
