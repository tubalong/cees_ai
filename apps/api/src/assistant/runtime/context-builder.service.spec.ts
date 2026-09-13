import { ConversationMessageRole } from '@prisma/client';
import { ContextBuilderService } from './context-builder.service';
import type { PrismaService } from '../../database/prisma.service';
import type { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const CONVERSATION_ID = '60000000-0000-0000-0000-000000000001';

interface HistoryMessageRow {
    id: string;
    role: ConversationMessageRole;
    content: string;
    turnId: string | null;
    toolCallId: string | null;
}

interface ToolCallRow {
    id: string;
    turnId: string;
    upstreamCallId: string;
    name: string;
    arguments: Record<string, unknown>;
}

function createService(history: HistoryMessageRow[], toolCalls: ToolCallRow[]): {
    service: ContextBuilderService;
    prisma: Record<string, any>;
} {
    const prisma = {
        conversationMessage: {
            findMany: jest.fn().mockResolvedValue(history),
        },
        conversationSummary: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
        },
        toolCall: {
            findMany: jest.fn().mockResolvedValue(toolCalls),
        },
    };
    const gateway = {
        compactChat: jest.fn(),
    };
    const service = new ContextBuilderService(
        prisma as unknown as PrismaService,
        gateway as unknown as AiServiceGateway,
    );
    return { service, prisma };
}

function buildInput() {
    return {
        conversation: { id: CONVERSATION_ID, tenantId: TENANT_ID },
        turnId: 'turn-3',
        membershipId: '50000000-0000-0000-0000-000000000001',
        userId: USER_ID,
        requestId: 'request-1',
        mode: 'standard' as const,
    };
}

describe('ContextBuilderService buildToolTurnMessages', () => {
    it('maps public toolCallIds to upstream ids and synthesizes assistant(tool_calls) before the TOOL message', async () => {
        const { service } = createService(
            [
                { id: 'm1', role: ConversationMessageRole.USER, content: '帮我画一只猫', turnId: 'turn-1', toolCallId: null },
                { id: 'm2', role: ConversationMessageRole.USER, content: '画一只狗', turnId: 'turn-2', toolCallId: null },
                { id: 'm3', role: ConversationMessageRole.TOOL, content: '图片已生成', turnId: 'turn-2', toolCallId: 'tool-call-1' },
            ],
            [
                {
                    id: 'tool-call-1',
                    turnId: 'turn-2',
                    upstreamCallId: 'call_1',
                    name: 'generate_image',
                    arguments: { prompt: '一只狗' },
                },
            ],
        );

        const { summary, items } = await service.buildToolTurnMessages(buildInput());

        expect(summary).toBeNull();
        expect(items).toEqual([
            { role: 'user', content: '帮我画一只猫' },
            { role: 'user', content: '画一只狗' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: '一只狗' } }],
            },
            { role: 'tool', content: '图片已生成', tool_call_id: 'call_1', name: 'generate_image' },
        ]);
    });

    it('synthesizes the assistant prefix once per turn when a turn has multiple TOOL messages', async () => {
        const { service } = createService(
            [
                { id: 'm1', role: ConversationMessageRole.TOOL, content: '结果A', turnId: 'turn-1', toolCallId: 'tc-a' },
                { id: 'm2', role: ConversationMessageRole.TOOL, content: '结果B', turnId: 'turn-1', toolCallId: 'tc-b' },
            ],
            [
                { id: 'tc-a', turnId: 'turn-1', upstreamCallId: 'call_a', name: 'generate_image', arguments: { prompt: 'A' } },
                { id: 'tc-b', turnId: 'turn-1', upstreamCallId: 'call_b', name: 'generate_image', arguments: { prompt: 'B' } },
            ],
        );

        const { items } = await service.buildToolTurnMessages(buildInput());

        expect(items).toEqual([
            {
                role: 'assistant',
                content: null,
                tool_calls: [
                    { id: 'call_a', name: 'generate_image', arguments: { prompt: 'A' } },
                    { id: 'call_b', name: 'generate_image', arguments: { prompt: 'B' } },
                ],
            },
            { role: 'tool', content: '结果A', tool_call_id: 'call_a', name: 'generate_image' },
            { role: 'tool', content: '结果B', tool_call_id: 'call_b', name: 'generate_image' },
        ]);
    });

    it('skips TOOL messages whose toolCall record is missing instead of emitting orphan tool messages', async () => {
        const { service } = createService(
            [
                { id: 'm1', role: ConversationMessageRole.USER, content: '你好', turnId: 'turn-1', toolCallId: null },
                { id: 'm2', role: ConversationMessageRole.TOOL, content: '孤立结果', turnId: 'turn-1', toolCallId: 'ghost' },
            ],
            [],
        );

        const { items } = await service.buildToolTurnMessages(buildInput());

        expect(items).toEqual([{ role: 'user', content: '你好' }]);
    });

    it('filters TOOL messages out of the plain chat request', async () => {
        const { service } = createService(
            [
                { id: 'm1', role: ConversationMessageRole.USER, content: '你好', turnId: 'turn-1', toolCallId: null },
                { id: 'm2', role: ConversationMessageRole.TOOL, content: '结果A', turnId: 'turn-1', toolCallId: 'tc-a' },
                { id: 'm3', role: ConversationMessageRole.ASSISTANT, content: '图片已生成', turnId: 'turn-1', toolCallId: null },
            ],
            [],
        );

        const request = await service.buildChatRequest(buildInput());

        expect(request.messages).toEqual([
            { id: 'm1', role: 'user', content: '你好' },
            { id: 'm3', role: 'assistant', content: '图片已生成' },
        ]);
    });
});
