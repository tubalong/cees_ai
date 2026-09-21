import type { Response } from 'express';
import type { PublicTurnStreamEvent } from '../assistant.types';
import { AssistantController } from './assistant.controller';

describe('AssistantController', () => {
    it('delegates conversation CRUD and turn cancel to services', async () => {
        const harness = createHarness();

        await harness.controller.createConversation({ title: ' 计划 ' });
        expect(harness.conversationService.create).toHaveBeenCalledWith(' 计划 ', undefined, 'GENERAL', null);

        await harness.controller.createConversation({ title: ' 计划 ', mode: 'ultra' });
        expect(harness.conversationService.create).toHaveBeenCalledWith(' 计划 ', 'ultra', 'GENERAL', null);

        await harness.controller.listConversations({ limit: 20, cursor: 'cursor-1' });
        expect(harness.conversationService.list).toHaveBeenCalledWith(20, 'cursor-1', {});

        await harness.controller.getConversation(CONVERSATION_ID);
        expect(harness.conversationService.getDetail).toHaveBeenCalledWith(CONVERSATION_ID);

        await harness.controller.updateConversation(CONVERSATION_ID, { title: '新标题', version: 1 });
        expect(harness.conversationService.updateTitle).toHaveBeenCalledWith(CONVERSATION_ID, '新标题', 1);

        await harness.controller.deleteConversation(CONVERSATION_ID, { version: 1 });
        expect(harness.conversationService.delete).toHaveBeenCalledWith(CONVERSATION_ID, 1);

        await harness.controller.cancelTurn(CONVERSATION_ID, TURN_ID);
        expect(harness.turnRunner.cancelTurn).toHaveBeenCalledWith(CONVERSATION_ID, TURN_ID);
    });

    it('rejects a missing Idempotency-Key header', async () => {
        const harness = createHarness();

        await expect(harness.controller.createTurn(
            CONVERSATION_ID,
            undefined,
            { content: '你好', mode: 'standard' },
            harness.response as unknown as Response,
        )).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
        expect(harness.turnRunner.startTurn).not.toHaveBeenCalled();
    });

    it('rejects an overly long Idempotency-Key header', async () => {
        const harness = createHarness();

        await expect(harness.controller.createTurn(
            CONVERSATION_ID,
            'k'.repeat(129),
            { content: '你好', mode: 'standard' },
            harness.response as unknown as Response,
        )).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_INVALID' } });
        expect(harness.turnRunner.startTurn).not.toHaveBeenCalled();
    });

    it('writes SSE headers and events until the terminal event, then ends the response', async () => {
        const harness = createHarness();
        harness.turnRunner.subscribeTurn.mockResolvedValue(turnEvents());

        await harness.controller.createTurn(
            CONVERSATION_ID,
            'key-1',
            { content: '你好', mode: 'standard' },
            harness.response as unknown as Response,
        );

        expect(harness.response.status).toHaveBeenCalledWith(200);
        expect(harness.response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
        expect(harness.response.flushHeaders).toHaveBeenCalled();
        expect(harness.response.once).toHaveBeenCalledWith('close', expect.any(Function));
        expect(harness.response.write).toHaveBeenCalledTimes(2);
        const firstPayload = harness.response.write.mock.calls[0][0] as string;
        expect(firstPayload).toContain('event: content_delta');
        expect(firstPayload).toContain('"text":"你好"');
        expect(harness.response.end).toHaveBeenCalled();
        // 流结束后解除 close 监听并中止订阅 signal。
        expect(harness.response.removeListener).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('does not write anything when the client already disconnected', async () => {
        const harness = createHarness();
        harness.response.destroyed = true;

        await harness.controller.createTurn(
            CONVERSATION_ID,
            'key-1',
            { content: '你好', mode: 'standard' },
            harness.response as unknown as Response,
        );

        expect(harness.turnRunner.startTurn).toHaveBeenCalled();
        expect(harness.response.status).not.toHaveBeenCalled();
        expect(harness.response.write).not.toHaveBeenCalled();
        expect(harness.response.end).not.toHaveBeenCalled();
    });
});

const CONVERSATION_ID = '60000000-0000-0000-0000-000000000001';
const TURN_ID = '60000000-0000-0000-0000-000000000002';

interface Harness {
    controller: AssistantController;
    conversationService: Record<string, jest.Mock>;
    turnRunner: Record<string, jest.Mock>;
    response: Record<string, any>;
}

function createHarness(): Harness {
    const conversationService = {
        create: jest.fn().mockResolvedValue({}),
        list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
        getDetail: jest.fn().mockResolvedValue({}),
        updateTitle: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue(undefined),
    };
    const turnRunner = {
        startTurn: jest.fn().mockResolvedValue({ turnId: TURN_ID }),
        subscribeTurn: jest.fn(),
        cancelTurn: jest.fn().mockResolvedValue({}),
    };
    const response = {
        destroyed: false,
        headersSent: false,
        writableEnded: false,
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
    };
    const controller = new AssistantController(
        conversationService as never,
        turnRunner as never,
    );
    return { controller, conversationService, turnRunner, response };
}

async function* turnEvents(): AsyncGenerator<PublicTurnStreamEvent> {
    yield { type: 'content_delta', seq: 1, text: '你好' };
    yield { type: 'completed', seq: 2, latencyMs: 100, finishReason: 'stop' };
}
