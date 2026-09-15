import {
  AssistantEventType,
  AssistantTurnStage,
  AssistantTurnStatus,
  ManagedImageStatus,
  ToolCallStatus,
} from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import { EventService } from '../conversation/event.service';
import { TurnStateService } from './turn-state.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const CONVERSATION_ID = '20000000-0000-0000-0000-000000000001';
const TURN_ID = '30000000-0000-0000-0000-000000000001';
const TOOL_CALL_ID = '40000000-0000-0000-0000-000000000001';
const EXECUTION_OWNER = 'api:test';

describe('TurnStateService', () => {
  it('renews the turn lease and all executing tool leases atomically', async () => {
    const harness = createHarness();
    const leaseExpiresAt = new Date('2026-09-14T10:01:00.000Z');

    await expect(harness.service.heartbeat({
      turnId: TURN_ID,
      executionOwner: EXECUTION_OWNER,
      stage: AssistantTurnStage.TOOL_EXECUTION,
      leaseExpiresAt,
    })).resolves.toBe(true);

    expect(harness.tx.assistantTurn.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: TURN_ID,
        status: AssistantTurnStatus.RUNNING,
        executionOwner: EXECUTION_OWNER,
      }),
      data: expect.objectContaining({ stage: AssistantTurnStage.TOOL_EXECUTION }),
    }));
    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith({
      where: {
        turnId: TURN_ID,
        status: ToolCallStatus.EXECUTING,
        executionToken: { not: null },
      },
      data: { leaseExpiresAt },
    });
  });

  it('persists and publishes web-search sources without creating a formal resource', async () => {
    const harness = createHarness();
    const sources = [{
      id: `${TOOL_CALL_ID}:1`,
      title: 'CEES 文档',
      url: 'https://example.com/cees',
      domain: 'example.com',
      snippet: '公开资料摘要',
      publishedAt: '2026-09-14T00:00:00.000Z',
    }];

    await expect(harness.service.completeToolCall({
      toolCallId: TOOL_CALL_ID,
      turnId: TURN_ID,
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      executionOwner: EXECUTION_OWNER,
      executionToken: '50000000-0000-0000-0000-000000000001',
      summary: '{"type":"web_search_result"}',
      resourceType: null,
      resourceId: null,
      sources,
    })).resolves.toBe(true);

    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        result: expect.objectContaining({
          resourceType: null,
          resourceId: null,
          sources,
        }),
      }),
    }));
    expect(harness.events.appendInTransaction).toHaveBeenCalledWith(
      harness.tx,
      TURN_ID,
      TENANT_ID,
      AssistantEventType.TOOL_RESULT,
      expect.objectContaining({
        type: 'tool_result',
        status: 'completed',
        resource: null,
        sources,
        error: null,
      }),
    );
  });
  it('reconciles pending and executing tools when a turn is cancelled', async () => {
    const harness = createHarness({
      interruptedCalls: [
        { id: 'tool-proposed', conversationId: CONVERSATION_ID, status: ToolCallStatus.PROPOSED },
        { id: 'tool-approved', conversationId: CONVERSATION_ID, status: ToolCallStatus.APPROVED },
        { id: TOOL_CALL_ID, conversationId: CONVERSATION_ID, status: ToolCallStatus.EXECUTING },
      ],
      unfinishedImages: [
        { id: 'image-pending', status: ManagedImageStatus.PENDING },
        { id: 'image-generating', status: ManagedImageStatus.GENERATING },
        { id: 'image-uploading', status: ManagedImageStatus.UPLOADING },
      ],
    });

    await expect(harness.service.cancelTurn(TURN_ID, TENANT_ID)).resolves.toBe(true);

    expect(harness.tx.assistantTurn.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: TURN_ID, tenantId: TENANT_ID, status: AssistantTurnStatus.RUNNING },
      data: expect.objectContaining({
        status: AssistantTurnStatus.CANCELLED,
        executionOwner: null,
        leaseExpiresAt: null,
      }),
    }));
    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledTimes(3);
    expect(harness.tx.conversationMessage.create).toHaveBeenCalledTimes(3);
    expect(harness.events.appendInTransaction).toHaveBeenCalledTimes(3 + 1);
    expect(harness.tx.managedImage.updateMany).toHaveBeenCalledTimes(3);
    expect(harness.tx.resource.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['image-pending', 'image-generating', 'image-uploading'] } }),
    }));
  });

  it('recovers a stale turn and uses the same reconciliation path for all unfinished tools', async () => {
    const harness = createHarness({
      staleTurn: true,
      interruptedCalls: [
        { id: TOOL_CALL_ID, conversationId: CONVERSATION_ID, status: ToolCallStatus.EXECUTING },
        { id: 'tool-proposed', conversationId: CONVERSATION_ID, status: ToolCallStatus.PROPOSED },
      ],
      unfinishedImages: [{ id: 'image-1', status: ManagedImageStatus.GENERATING }],
    });
    const now = new Date('2026-09-14T10:00:00.000Z');

    await expect(harness.service.recoverStaleTurns(now)).resolves.toBe(1);

    expect(harness.tx.assistantTurn.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: TURN_ID,
        status: AssistantTurnStatus.RUNNING,
        leaseExpiresAt: { lte: now },
      }),
      data: expect.objectContaining({ status: AssistantTurnStatus.FAILED }),
    }));
    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: ToolCallStatus.RECOVERY_REQUIRED,
        errorCode: 'TOOL_EXECUTION_RECOVERY_REQUIRED',
      }),
    }));
    expect(harness.tx.toolCall.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: ToolCallStatus.REJECTED,
        errorCode: 'TURN_EXECUTION_LOST',
      }),
    }));
    expect(harness.events.appendInTransaction).toHaveBeenLastCalledWith(
      harness.tx,
      TURN_ID,
      TENANT_ID,
      AssistantEventType.ERROR,
      expect.objectContaining({ type: 'error' }),
    );
  });
});

function createHarness(options: {
  staleTurn?: boolean;
  interruptedCalls?: Array<{ id: string; conversationId: string; status: ToolCallStatus }>;
  unfinishedImages?: Array<{ id: string; status: ManagedImageStatus }>;
} = {}) {
  const interruptedCalls = options.interruptedCalls ?? [];
  const unfinishedImages = options.unfinishedImages ?? [];
  const tx: Record<string, any> = {
    assistantTurn: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(options.staleTurn
        ? {
            tenantId: TENANT_ID,
            status: AssistantTurnStatus.RUNNING,
            leaseExpiresAt: new Date('2026-09-14T09:59:00.000Z'),
            toolCalls: interruptedCalls.map((call) => ({ status: call.status })),
          }
        : null),
    },
    toolCall: {
      findMany: jest.fn().mockResolvedValue(interruptedCalls),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    managedImage: {
      findMany: jest.fn().mockResolvedValue(unfinishedImages),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    resource: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    aIActionDraft: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    conversationMessage: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: Record<string, any> = {
    $transaction: jest.fn(),
    assistantTurn: {
      findMany: jest.fn().mockResolvedValue(options.staleTurn ? [{ id: TURN_ID }] : []),
    },
  };
  prisma.$transaction.mockImplementation((callback: (transaction: unknown) => unknown) => callback(tx));
  const events = { appendInTransaction: jest.fn().mockResolvedValue(1) };
  const service = new TurnStateService(
    prisma as unknown as PrismaService,
    events as unknown as EventService,
  );
  return { service, prisma, tx, events };
}
