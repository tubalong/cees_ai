import { DingTalkIntegrationStatus } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import { TenantContext } from '../tenant/tenant-context';
import { DingTalkClient } from './dingtalk.client';
import { DingTalkCredentialCipher } from './dingtalk-credential-cipher';
import { DingTalkService } from './dingtalk.service';

describe('DingTalkService', () => {
    const context = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        membershipId: 'membership-1',
        requestId: 'request-1',
        roles: ['tenant_admin'],
        permissions: [],
    };
    const tenantContext = { require: jest.fn(() => context) } as unknown as TenantContext;
    const verify = jest.fn();
    const fetchOrganization = jest.fn();
    const encrypt = jest.fn((value: string) => `encrypted:${value}`);
    const decrypt = jest.fn((value: string) => value.replace('encrypted:', ''));
    const prisma = {
        dingTalkIntegration: {
            findUnique: jest.fn(),
            create: jest.fn(),
        },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    } as unknown as PrismaService;
    const client = { verify, fetchOrganization } as unknown as DingTalkClient;
    const cipher = { encrypt, decrypt } as unknown as DingTalkCredentialCipher;
    const service = new DingTalkService(prisma, tenantContext, client, cipher);

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.dingTalkIntegration.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.dingTalkIntegration.create as jest.Mock).mockResolvedValue({
            id: 'integration-1',
            tenantId: 'tenant-1',
            corpId: 'corp-1',
            appKey: 'app-key',
            appSecretCiphertext: 'encrypted:secret',
            status: DingTalkIntegrationStatus.ACTIVE,
            lastVerifiedAt: new Date('2026-09-14T00:00:00.000Z'),
            lastSyncedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            version: 1,
            createdAt: new Date('2026-09-14T00:00:00.000Z'),
            updatedAt: new Date('2026-09-14T00:00:00.000Z'),
        });
        (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => callback(prisma));
        verify.mockResolvedValue(undefined);
        (prisma.auditLog.create as jest.Mock).mockResolvedValue({});
    });

    it('创建绑定时验证凭证，并且不会把明文密钥返回给调用方', async () => {
        const result = await service.createIntegration({ corpId: 'corp-1', appKey: 'app-key', appSecret: 'secret' });

        expect(verify).toHaveBeenCalledWith({ appKey: 'app-key', appSecret: 'secret' });
        expect(prisma.dingTalkIntegration.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                tenantId: 'tenant-1',
                appSecretCiphertext: 'encrypted:secret',
            }),
        }));
        expect(result).not.toHaveProperty('appSecret');
        expect(result).not.toHaveProperty('appSecretCiphertext');
        expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                tenantId: 'tenant-1',
                actorUserId: 'user-1',
                action: 'DINGTALK_INTEGRATION_CREATED',
            }),
        }));
    });
});
