import { AssistantTurnStage, AssistantTurnStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EventService } from '../conversation/event.service';
import type { ConnectorContextInput } from '../assistant.types';
import { TurnStateService } from './turn-state.service';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '10000000-0000-4000-8000-000000000002';
const MEMBERSHIP_ID = '10000000-0000-4000-8000-000000000003';
const CONVERSATION_ID = '20000000-0000-4000-8000-000000000001';
const TURN_ID = '30000000-0000-4000-8000-000000000001';

function createHarness(connectorReadAuditEnabled = false) {
    const tx: Record<string, any> = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        conversation: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ nextTurnSeq: 2 }),
        },
        assistantTurn: {
            create: jest.fn().mockResolvedValue({ id: TURN_ID }),
        },
        conversationMessage: { create: jest.fn().mockResolvedValue({}) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        tenant: { findUnique: jest.fn().mockResolvedValue({ connectorReadAuditEnabled }) },
    };
    const prisma: Record<string, any> = { $transaction: jest.fn() };
    prisma.$transaction.mockImplementation((callback: (transaction: unknown) => unknown) => callback(tx));
    const events = { appendInTransaction: jest.fn().mockResolvedValue(1) };
    const service = new TurnStateService(
        prisma as unknown as PrismaService,
        events as unknown as EventService,
    );
    return { service, tx };
}

function createTurnInput(connectorContexts: ConnectorContextInput[]) {
    return {
        conversationId: CONVERSATION_ID,
        tenantId: TENANT_ID,
        userId: USER_ID,
        membershipId: MEMBERSHIP_ID,
        requestId: 'request-1',
        idempotencyKey: 'idempotency-1',
        requestHash: 'hash-1',
        content: '查看 C 盘剩余空间',
        connectorContexts,
        mode: 'standard' as const,
        knowledgeBaseEnabled: false,
        executionOwner: 'api:test',
        leaseExpiresAt: new Date('2026-09-23T09:00:00.000Z'),
    };
}

/** 取回本事务写出的全部审计行，便于断言条数与分级。 */
function auditCalls(tx: Record<string, any>): Array<Record<string, any>> {
    return tx.auditLog.create.mock.calls.map((call: unknown[]) => (call[0] as { data: Record<string, any> }).data);
}

const volumeScanContext: ConnectorContextInput = {
    provider: 'LOCAL_SYSTEM',
    toolId: 'disk_scan_volumes',
    toolName: '磁盘容量扫描',
    fetchedAt: '2026-09-23T08:00:00.000Z',
    data: {
        volumes: [{ label: 'C:', totalBytes: 511_000_000_000, freeBytes: 91_000_000_000, usedBytes: 420_000_000_000 }],
    },
};

const quarantineContext: ConnectorContextInput = {
    provider: 'LOCAL_SYSTEM',
    toolId: 'local_quarantine',
    toolName: '隔离本地内容',
    fetchedAt: '2026-09-23T08:10:00.000Z',
    data: {
        status: 'QUARANTINED',
        executed: true,
        itemCount: 12,
        totalBytes: 5_242_880,
        resultCounts: { QUARANTINED: 12 },
        manifestHashPrefix: 'a1b2c3d4e5f6',
    },
};

const dingTalkReadContext: ConnectorContextInput = {
    provider: 'DINGTALK',
    toolId: `dws_read_${'a'.repeat(16)}`,
    toolName: '钉钉考勤记录',
    fetchedAt: '2026-09-23T08:00:00.000Z',
    riskLevel: 'READ',
    data: {
        schemaVersion: 'cees.dingtalk.attendance.v1',
        itemCount: 2,
        records: [{ workDate: '2026-09-23' }],
    },
};

const weComReadContext: ConnectorContextInput = {
    provider: 'WECOM',
    toolId: 'contact.list',
    toolName: '企业微信通讯录',
    fetchedAt: '2026-09-23T08:05:00.000Z',
    riskLevel: 'READ',
    data: { itemCount: 5 },
};

const weComWriteContext: ConnectorContextInput = {
    provider: 'WECOM',
    toolId: 'message.send',
    toolName: '企业微信发送消息',
    fetchedAt: '2026-09-23T08:10:00.000Z',
    riskLevel: 'WRITE',
    confirmed: true,
    data: { status: 'SENT', itemCount: 1 },
};

const gitHubDestructiveContext: ConnectorContextInput = {
    provider: 'GITHUB',
    toolId: 'delete_branch',
    toolName: '删除分支',
    fetchedAt: '2026-09-23T08:15:00.000Z',
    riskLevel: 'DESTRUCTIVE',
    confirmed: true,
    data: { status: 'DELETED' },
};

describe('TurnStateService external operation audit', () => {
    it('does not audit turns without any connector context', async () => {
        const { service, tx } = createHarness();

        await service.createTurn(createTurnInput([]));

        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('records one audit event per local system context with aggregate values only', async () => {
        const { service, tx } = createHarness();

        await service.createTurn(createTurnInput([volumeScanContext, quarantineContext]));

        expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
        expect(tx.auditLog.create).toHaveBeenNthCalledWith(1, {
            data: expect.objectContaining({
                tenantId: TENANT_ID,
                actorUserId: USER_ID,
                actorMembershipId: MEMBERSHIP_ID,
                action: 'LOCAL_SYSTEM_OPERATION',
                outcome: 'SUCCESS',
                resourceType: 'LOCAL_SYSTEM',
                resourceId: null,
                requestId: 'request-1',
                metadata: expect.objectContaining({
                    turnId: TURN_ID,
                    toolId: 'disk_scan_volumes',
                    toolName: '磁盘容量扫描',
                    summary: {
                        volumes: [{ label: 'C:', totalBytes: 511_000_000_000, freeBytes: 91_000_000_000 }],
                    },
                }),
            }),
        });
        expect(tx.auditLog.create).toHaveBeenNthCalledWith(2, {
            data: expect.objectContaining({
                metadata: expect.objectContaining({
                    toolId: 'local_quarantine',
                    summary: {
                        status: 'QUARANTINED',
                        executed: true,
                        itemCount: 12,
                        totalBytes: 5_242_880,
                        resultCounts: { QUARANTINED: 12 },
                        manifestHashPrefix: 'a1b2c3d4e5f6',
                    },
                }),
            }),
        });
    });

    it('drops local paths and file names even when a client sends them', async () => {
        const { service, tx } = createHarness();
        const leakyContext: ConnectorContextInput = {
            provider: 'LOCAL_SYSTEM',
            toolId: 'local_cleanup',
            toolName: '永久清理隔离区',
            fetchedAt: '2026-09-23T08:20:00.000Z',
            data: {
                status: 'CLEANED',
                itemCount: 3,
                // 恶意或有缺陷的客户端可能塞进本地明细；字段白名单必须把它们全部丢掉。
                paths: ['C:\\Users\\someone\\.ssh\\id_rsa'],
                originalPath: 'C:\\Users\\someone\\Documents\\secret.xlsx',
                displayName: 'secret.xlsx',
                manifestHashPrefix: 'ffeeddccbbaa',
            },
        };

        await service.createTurn(createTurnInput([leakyContext]));

        const metadata = tx.auditLog.create.mock.calls[0][0].data.metadata as Record<string, unknown>;
        const serialized = JSON.stringify(metadata);
        expect(serialized).not.toContain('id_rsa');
        expect(serialized).not.toContain('.ssh');
        expect(serialized).not.toContain('secret.xlsx');
        expect(serialized).not.toContain('originalPath');
        expect(serialized).not.toContain('paths');
        expect(metadata.summary).toEqual({
            status: 'CLEANED',
            itemCount: 3,
            manifestHashPrefix: 'ffeeddccbbaa',
        });
    });

    it('keeps the turn creation behaviour unchanged when no contexts are sent', async () => {
        const { service, tx } = createHarness();

        const turn = await service.createTurn(createTurnInput([]));

        expect(turn).toEqual({ id: TURN_ID });
        expect(tx.assistantTurn.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                idempotencyKey: 'idempotency-1',
                status: AssistantTurnStatus.RUNNING,
                stage: AssistantTurnStage.QUEUED,
            }),
            select: { id: true },
        });
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('audits connector write and destructive calls one by one with the reported confirmation', async () => {
        const { service, tx } = createHarness();

        await service.createTurn(createTurnInput([weComWriteContext, gitHubDestructiveContext]));

        const audits = auditCalls(tx);
        expect(audits).toHaveLength(2);
        expect(audits[0]).toMatchObject({
            tenantId: TENANT_ID,
            actorUserId: USER_ID,
            actorMembershipId: MEMBERSHIP_ID,
            action: 'CONNECTOR_WRITE_OPERATION',
            outcome: 'SUCCESS',
            resourceType: 'CONNECTOR',
            resourceId: null,
            requestId: 'request-1',
        });
        expect(audits[0].metadata).toMatchObject({
            turnId: TURN_ID,
            provider: 'WECOM',
            toolId: 'message.send',
            toolName: '企业微信发送消息',
            riskLevel: 'WRITE',
            confirmed: true,
            summary: { status: 'SENT', itemCount: 1 },
        });
        expect(audits[0].metadata.resultBytes).toBeGreaterThan(0);
        expect(audits[1].metadata).toMatchObject({
            provider: 'GITHUB',
            toolId: 'delete_branch',
            riskLevel: 'DESTRUCTIVE',
            confirmed: true,
            summary: { status: 'DELETED' },
        });
        // 没有只读调用时不必读取租户开关。
        expect(tx.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('aggregates connector read calls into one turn-level audit by default', async () => {
        const { service, tx } = createHarness();

        await service.createTurn(createTurnInput([dingTalkReadContext, weComReadContext]));

        const audits = auditCalls(tx);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            action: 'CONNECTOR_READ_OPERATION',
            outcome: 'SUCCESS',
            resourceType: 'CONNECTOR',
            resourceId: null,
            requestId: 'request-1',
        });
        expect(audits[0].metadata).toMatchObject({
            turnId: TURN_ID,
            aggregated: true,
            providers: ['DINGTALK', 'WECOM'],
            callCount: 2,
        });
        expect(audits[0].metadata.resultBytes).toBeGreaterThan(0);
        expect(tx.tenant.findUnique).toHaveBeenCalledWith({
            where: { id: TENANT_ID },
            select: { connectorReadAuditEnabled: true },
        });
    });

    it('records connector read calls one by one once the tenant enables the switch', async () => {
        const { service, tx } = createHarness(true);

        await service.createTurn(createTurnInput([dingTalkReadContext, weComReadContext]));

        const audits = auditCalls(tx);
        expect(audits).toHaveLength(2);
        expect(audits[0].metadata).toMatchObject({
            turnId: TURN_ID,
            aggregated: false,
            provider: 'DINGTALK',
            toolId: dingTalkReadContext.toolId,
            riskLevel: 'READ',
            summary: { schemaVersion: 'cees.dingtalk.attendance.v1', itemCount: 2 },
        });
        expect(audits[1].metadata).toMatchObject({
            aggregated: false,
            provider: 'WECOM',
            toolId: 'contact.list',
            riskLevel: 'READ',
        });
    });

    it('treats a missing or unknown risk level as destructive instead of lowering the audit grade', async () => {
        const { service, tx } = createHarness(true);

        await service.createTurn(createTurnInput([
            { ...weComReadContext, riskLevel: undefined },
            { ...weComReadContext, riskLevel: 'UNKNOWN' as never },
        ]));

        const audits = auditCalls(tx);
        expect(audits).toHaveLength(2);
        for (const audit of audits) {
            expect(audit.action).toBe('CONNECTOR_WRITE_OPERATION');
            expect(audit.metadata.riskLevel).toBe('DESTRUCTIVE');
            expect(audit.metadata.confirmed).toBe(false);
        }
        expect(tx.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('keeps connector audit metadata on the field whitelist and truncates long strings', async () => {
        const { service, tx } = createHarness();
        const leakyContext: ConnectorContextInput = {
            provider: 'TENCENT_MEETING',
            toolId: 'meeting.update',
            toolName: '腾讯会议更新会议',
            fetchedAt: '2026-09-23T08:25:00.000Z',
            riskLevel: 'WRITE',
            confirmed: true,
            data: {
                status: 's'.repeat(400),
                itemCount: 3,
                resultCounts: { OK: 3, FAILED: 1 },
                // 客户端可能多传凭据、本地路径或正文；白名单与类型收敛必须全部挡住。
                accessToken: 'secret-token',
                originalPath: 'C:\\Users\\someone\\secret.xlsx',
                records: [{ subject: 'secret-subject' }],
            },
        };

        await service.createTurn(createTurnInput([leakyContext]));

        const audits = auditCalls(tx);
        expect(audits).toHaveLength(1);
        const serialized = JSON.stringify(audits[0].metadata);
        expect(serialized).not.toContain('secret-token');
        expect(serialized).not.toContain('.xlsx');
        expect(serialized).not.toContain('secret-subject');
        expect(serialized).not.toContain('originalPath');
        expect(serialized).not.toContain('accessToken');
        expect(serialized).not.toContain('records');
        expect(audits[0].metadata.summary).toEqual({
            status: 's'.repeat(120),
            itemCount: 3,
            resultCounts: { OK: 3, FAILED: 1 },
        });
    });
});