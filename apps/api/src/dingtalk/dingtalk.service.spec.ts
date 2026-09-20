import {
    DingTalkIntegrationMode,
    DingTalkIntegrationStatus,
    DingTalkSyncJobStatus,
    DingTalkSyncScope,
    DingTalkSyncSource,
    DingTalkSyncType,
} from '@prisma/client';
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
            update: jest.fn(),
        },
        dingTalkSyncJob: { create: jest.fn(), update: jest.fn() },
        dingTalkDepartment: { upsert: jest.fn(), updateMany: jest.fn() },
        dingTalkUser: { upsert: jest.fn(), updateMany: jest.fn() },
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
            mode: DingTalkIntegrationMode.SELF_MANAGED_APP,
            corpId: 'corp-1',
            appKey: 'app-key',
            appSecretCiphertext: 'encrypted:secret',
            authorizedByMembershipId: null,
            authorizedExternalUserId: null,
            authorizedProfile: null,
            grantedCapabilities: null,
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

    it('拒绝非租户管理员导入 DWS 可见组织快照', async () => {
        const originalRoles = context.roles;
        context.roles = ['employee'];
        await expect(service.importVisibleOrganizationSnapshot(visibleSnapshot())).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'DINGTALK_TENANT_ADMIN_REQUIRED' }),
        });
        expect(prisma.dingTalkIntegration.create).not.toHaveBeenCalled();
        context.roles = originalRoles;
    });

    it('拒绝没有人员的空组织快照', async () => {
        await expect(service.importVisibleOrganizationSnapshot({
            ...visibleSnapshot(),
            users: [],
        })).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'DINGTALK_SNAPSHOT_EMPTY' }),
        });
        expect(prisma.dingTalkIntegration.create).not.toHaveBeenCalled();
        expect(prisma.dingTalkDepartment.upsert).not.toHaveBeenCalled();
    });

    it('导入 DWS 快照时保留已有企业应用凭证和连接模式', async () => {
        const currentIntegration = {
            id: 'integration-1',
            tenantId: 'tenant-1',
            mode: DingTalkIntegrationMode.SELF_MANAGED_APP,
            corpId: 'corp-1',
            appKey: 'app-key',
            appSecretCiphertext: 'encrypted:secret',
            authorizedByMembershipId: null,
            authorizedExternalUserId: null,
            authorizedProfile: null,
            grantedCapabilities: null,
            status: DingTalkIntegrationStatus.ACTIVE,
            lastVerifiedAt: new Date('2026-09-19T00:00:00.000Z'),
            lastSyncedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            version: 2,
            createdAt: new Date('2026-09-19T00:00:00.000Z'),
            updatedAt: new Date('2026-09-19T00:00:00.000Z'),
        };
        (prisma.dingTalkIntegration.findUnique as jest.Mock).mockResolvedValue(currentIntegration);
        (prisma.dingTalkIntegration.update as jest.Mock).mockResolvedValue(currentIntegration);
        (prisma.dingTalkSyncJob.create as jest.Mock).mockResolvedValue({ id: 'job-1' });
        (prisma.dingTalkSyncJob.update as jest.Mock).mockResolvedValue({
            id: 'job-1',
            integrationId: 'integration-1',
            type: DingTalkSyncType.FULL_ORGANIZATION,
            source: DingTalkSyncSource.DWS_MCP,
            scope: DingTalkSyncScope.VISIBLE_SCOPE,
            authorizedByMembershipId: 'membership-1',
            authorizedExternalUserId: 'ding-user-1',
            status: DingTalkSyncJobStatus.SUCCEEDED,
            departmentCount: 1,
            userCount: 1,
            errorCode: null,
            errorMessage: null,
            startedAt: new Date('2026-09-20T01:00:00.000Z'),
            completedAt: new Date('2026-09-20T01:01:00.000Z'),
            createdAt: new Date('2026-09-20T01:00:00.000Z'),
        });

        await service.importVisibleOrganizationSnapshot(visibleSnapshot());

        expect(prisma.dingTalkIntegration.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ mode: DingTalkIntegrationMode.SELF_MANAGED_APP }),
        }));
        const updateInput = (prisma.dingTalkIntegration.update as jest.Mock).mock.calls[0][0];
        expect(updateInput.data).not.toHaveProperty('appKey');
        expect(updateInput.data).not.toHaveProperty('appSecretCiphertext');
    });

    it('合并 DWS 可见组织快照时不标记未返回镜像删除', async () => {
        (prisma.dingTalkIntegration.create as jest.Mock).mockResolvedValue({
            id: 'integration-1',
            tenantId: 'tenant-1',
            mode: DingTalkIntegrationMode.DWS_LOCAL,
            corpId: 'corp-1',
            appKey: null,
            appSecretCiphertext: null,
            authorizedByMembershipId: 'membership-1',
            authorizedExternalUserId: 'ding-user-1',
            authorizedProfile: 'corp-1:ding-user-1',
            grantedCapabilities: ['contact.organization.visible.read'],
            status: DingTalkIntegrationStatus.ACTIVE,
            lastVerifiedAt: new Date('2026-09-20T01:00:00.000Z'),
            lastSyncedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            version: 1,
            createdAt: new Date('2026-09-20T01:00:00.000Z'),
            updatedAt: new Date('2026-09-20T01:00:00.000Z'),
        });
        (prisma.dingTalkSyncJob.create as jest.Mock).mockResolvedValue({ id: 'job-1' });
        (prisma.dingTalkSyncJob.update as jest.Mock).mockResolvedValue({
            id: 'job-1',
            integrationId: 'integration-1',
            type: DingTalkSyncType.FULL_ORGANIZATION,
            source: DingTalkSyncSource.DWS_MCP,
            scope: DingTalkSyncScope.VISIBLE_SCOPE,
            authorizedByMembershipId: 'membership-1',
            authorizedExternalUserId: 'ding-user-1',
            status: DingTalkSyncJobStatus.SUCCEEDED,
            departmentCount: 1,
            userCount: 1,
            errorCode: null,
            errorMessage: null,
            startedAt: new Date('2026-09-20T01:00:00.000Z'),
            completedAt: new Date('2026-09-20T01:01:00.000Z'),
            createdAt: new Date('2026-09-20T01:00:00.000Z'),
        });

        const result = await service.importVisibleOrganizationSnapshot(visibleSnapshot());

        expect(result.scope).toBe(DingTalkSyncScope.VISIBLE_SCOPE);
        expect(prisma.dingTalkDepartment.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.dingTalkUser.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.dingTalkDepartment.updateMany).not.toHaveBeenCalled();
        expect(prisma.dingTalkUser.updateMany).not.toHaveBeenCalled();
    });
});

function visibleSnapshot() {
    return {
        corpId: 'corp-1',
        externalUserId: 'ding-user-1',
        externalUserName: '管理员',
        profile: 'corp-1:ding-user-1',
        fetchedAt: '2026-09-20T01:00:00.000Z',
        capabilities: ['contact.organization.visible.read'],
        departments: [{ externalDepartmentId: '2', parentExternalDepartmentId: '1', name: '技术部', displayOrder: 1 }],
        users: [{
            externalUserId: 'staff-1',
            unionId: null,
            name: '张三',
            title: '工程师',
            jobNumber: '001',
            departmentExternalIds: ['2'],
            active: true,
            admin: false,
            boss: false,
        }],
    };
}
