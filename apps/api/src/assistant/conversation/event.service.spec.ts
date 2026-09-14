import { AssistantEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EventService } from './event.service';

describe('EventService', () => {
    it('allocates sequential numbers starting from one', async () => {
        const prisma = createPrismaMock();
        const service = new EventService(prisma as unknown as PrismaService);
        mockAppendTransaction(prisma, 3);

        const seq = await service.append(TURN_ID, TENANT_ID, AssistantEventType.STATUS, {
            type: 'status',
            phase: 'answering',
        });

        expect(seq).toBe(3);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('uses the turn counter and writes the event in the same transaction', async () => {
        const prisma = createPrismaMock();
        const service = new EventService(prisma as unknown as PrismaService);
        const tx = {
            assistantTurn: {
                update: jest.fn().mockResolvedValue({ nextEventSeq: 4 }),
            },
            assistantEvent: { create: jest.fn().mockResolvedValue({ seq: 3 }) },
        };
        prisma.$transaction.mockImplementation((callback: (transaction: unknown) => unknown) => callback(tx));

        const seq = await service.append(TURN_ID, TENANT_ID, AssistantEventType.ERROR, {
            type: 'error',
            error: { code: 'X', message: 'y', retryable: false },
        });

        expect(seq).toBe(3);
        expect(tx.assistantTurn.update).toHaveBeenCalledWith({
            where: { id: TURN_ID },
            data: { nextEventSeq: { increment: 1 } },
            select: { nextEventSeq: true },
        });
        expect(tx.assistantEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ turnId: TURN_ID, tenantId: TENANT_ID, seq: 3 }),
        }));
    });

    it('yields persisted events above afterSeq in order', async () => {
        const prisma = createPrismaMock();
        const service = new EventService(prisma as unknown as PrismaService);
        const second = eventRecord(2, AssistantEventType.CONTENT_DELTA, { type: 'content_delta', text: '片段', seq: 2 });
        prisma.assistantEvent.findMany
            .mockResolvedValueOnce([second])
            .mockResolvedValueOnce([]);
        prisma.assistantTurn.findUnique.mockResolvedValue({ status: 'COMPLETED' });

        const polled = service.poll(TURN_ID, 1);
        const first = await polled.next();

        expect(first.done).toBe(false);
        expect(first.value).toEqual({ type: 'content_delta', text: '片段', seq: 2 });
        const ended = await polled.next();
        expect(ended.done).toBe(true);
    });

    it('ends when the turn reaches a terminal state without new events', async () => {
        const prisma = createPrismaMock();
        const service = new EventService(prisma as unknown as PrismaService);
        prisma.assistantEvent.findMany.mockResolvedValue([]);
        prisma.assistantTurn.findUnique.mockResolvedValue({ status: 'FAILED' });

        const polled = service.poll(TURN_ID, 0);

        expect((await polled.next()).done).toBe(true);
        expect(prisma.assistantTurn.findUnique).toHaveBeenCalledWith({
            where: { id: TURN_ID },
            select: { status: true },
        });
    });

    it('keeps polling while the turn is still running', async () => {
        jest.useFakeTimers();
        try {
            const prisma = createPrismaMock();
            const service = new EventService(prisma as unknown as PrismaService);
            prisma.assistantEvent.findMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);
            prisma.assistantTurn.findUnique
                .mockResolvedValueOnce({ status: 'RUNNING' })
                .mockResolvedValueOnce({ status: 'COMPLETED' });

            const polled = service.poll(TURN_ID, 0);
            const pending = polled.next();
            await jest.advanceTimersByTimeAsync(300);

            expect((await pending).done).toBe(true);
            expect(prisma.assistantEvent.findMany).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const TURN_ID = '60000000-0000-0000-0000-000000000001';

function createPrismaMock(): Record<string, any> {
    return {
        $transaction: jest.fn(),
        assistantEvent: {
            aggregate: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
        },
        assistantTurn: {
            findUnique: jest.fn(),
        },
    };
}

function mockAppendTransaction(prisma: Record<string, any>, maxSeq: number): void {
    const tx = {
        assistantTurn: {
            update: jest.fn().mockResolvedValue({ nextEventSeq: maxSeq + 1 }),
        },
        assistantEvent: {
            create: jest.fn(),
        },
    };
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(tx));
}

function eventRecord(seq: number, type: AssistantEventType, payload: Record<string, unknown>): Record<string, unknown> {
    return { seq, type, payload };
}
