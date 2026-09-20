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
    imageFileIds?: string[];
    documentFileIds?: string[];
    connectorContexts?: Array<Record<string, unknown>>;
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
    gateway: { compactChat: jest.Mock; fetchChatContextBudgets: jest.Mock };
} {
    const prisma = {
        conversationMessage: {
            // 真实 DB 返回始终包含 imageFileIds 字段，此处补默认值贴近生产形状。
            findMany: jest.fn().mockResolvedValue(history.map((row) => ({
                imageFileIds: [],
                documentFileIds: [],
                connectorContexts: [],
                ...row,
            }))),
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
        compactChat: jest.fn().mockResolvedValue({
            summary: '压缩后的摘要',
            summarized_through_message_id: null,
        }),
        fetchChatContextBudgets: jest.fn().mockResolvedValue(null),
    };
    const messageContent = {
        toModelParts: jest.fn(async (content: string, imageFileIds: string[] = []) => [
            ...(content ? [{ type: 'text', text: content } as const] : []),
            ...imageFileIds.map((url) => ({ type: 'image_url', image_url: { url } } as const)),
        ]),
    };
    const service = new ContextBuilderService(
        prisma as unknown as PrismaService,
        gateway as unknown as AiServiceGateway,
        messageContent as any,
    );
    return { service, prisma, gateway };
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
            { role: 'user', content: [{ type: 'text', text: '帮我画一只猫' }] },
            { role: 'user', content: [{ type: 'text', text: '画一只狗' }] },
            {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: '一只狗' } }],
            },
            { role: 'tool', content: [{ type: 'text', text: '图片已生成' }], tool_call_id: 'call_1', name: 'generate_image' },
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
            { role: 'tool', content: [{ type: 'text', text: '结果A' }], tool_call_id: 'call_a', name: 'generate_image' },
            { role: 'tool', content: [{ type: 'text', text: '结果B' }], tool_call_id: 'call_b', name: 'generate_image' },
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

        expect(items).toEqual([{ role: 'user', content: [{ type: 'text', text: '你好' }] }]);
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
            { id: 'm1', role: 'user', content: [{ type: 'text', text: '你好' }] },
            { id: 'm3', role: 'assistant', content: [{ type: 'text', text: '图片已生成' }] },
        ]);
    });

    it('injects persisted connector contexts as a guarded read-only text part', async () => {
        const connectorContexts = [{
            provider: 'DINGTALK',
            toolId: 'dws_read_0123456789abcdef',
            toolName: 'contact.user.get_self',
            fetchedAt: '2026-09-20T08:00:00.000Z',
            data: { name: '张三', title: '产品经理' },
        }];
        const { service } = createService([{
            id: 'm1',
            role: ConversationMessageRole.USER,
            content: '查看我的钉钉信息',
            turnId: 'turn-1',
            toolCallId: null,
            connectorContexts,
        }], []);

        const request = await service.buildChatRequest(buildInput());

        expect(request.messages[0]).toEqual({
            id: 'm1',
            role: 'user',
            content: [
                { type: 'text', text: '查看我的钉钉信息' },
                {
                    type: 'text',
                    text: expect.stringContaining('仅作为本轮只读参考'),
                },
            ],
        });
        expect((request.messages[0]?.content as Array<{ text?: string }>)[1]?.text).toContain(JSON.stringify(connectorContexts));
    });
});

describe('ContextBuilderService compaction triggers', () => {
    it('compacts when estimated tokens exceed the budget even if message count is low', async () => {
        const longContent = 'a'.repeat(120000);
        const { service, gateway } = createService(
            [
                { id: 'm1', role: ConversationMessageRole.USER, content: longContent, turnId: 'turn-1', toolCallId: null },
                // 与 m1 不同轮次：避免 Turn 对齐把 m2 一并卷入摘要，聚焦验证 Token 触发。
                { id: 'm2', role: ConversationMessageRole.ASSISTANT, content: longContent, turnId: 'turn-2', toolCallId: null },
            ],
            [],
        );

        const request = await service.buildChatRequest(buildInput());

        expect(gateway.compactChat).toHaveBeenCalledTimes(1);
        const [body] = gateway.compactChat.mock.calls[0];
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0].id).toBe('m1');
        expect(request.messages).toEqual([{ id: 'm2', role: 'assistant', content: [{ type: 'text', text: longContent }] }]);
        expect(request.conversation_summary).toBe('压缩后的摘要');
    });

    it('keeps the most recent messages when the count threshold is exceeded', async () => {
        const history: HistoryMessageRow[] = Array.from({ length: 81 }, (_, i) => ({
            id: `m${i}`,
            role: (i % 2 === 0 ? ConversationMessageRole.USER : ConversationMessageRole.ASSISTANT) as ConversationMessageRole,
            content: `消息 ${i}`,
            turnId: null,
            toolCallId: null,
        }));
        const { service, gateway } = createService(history, []);

        const request = await service.buildChatRequest(buildInput());

        expect(gateway.compactChat).toHaveBeenCalledTimes(1);
        const [body] = gateway.compactChat.mock.calls[0];
        expect(body.messages).toHaveLength(61);
        expect(request.messages).toHaveLength(20);
        expect(request.messages[0].id).toBe('m61');
        expect(request.messages[19].id).toBe('m80');
    });

    it('uses budgets fetched from ai-service instead of the built-in default', async () => {
        const content = 'a'.repeat(2000);
        const { service, gateway } = createService(
            [
                { id: 'm1', role: ConversationMessageRole.USER, content, turnId: 'turn-1', toolCallId: null },
                // 与 m1 不同轮次：避免 Turn 对齐把 m2 一并卷入摘要。
                { id: 'm2', role: ConversationMessageRole.ASSISTANT, content, turnId: 'turn-2', toolCallId: null },
            ],
            [],
        );
        // 默认预算(65536)下 2 条短消息不触发；这里把 standard 预算压到 1000，应触发压缩。
        gateway.fetchChatContextBudgets.mockResolvedValue({ standard: 1000 });

        const request = await service.buildChatRequest(buildInput());

        expect(gateway.fetchChatContextBudgets).toHaveBeenCalledTimes(1);
        expect(gateway.compactChat).toHaveBeenCalledTimes(1);
        expect(request.messages).toHaveLength(1);
    });

    it('counts image references as fixed tokens when deciding compaction', async () => {
        // 2 张图片 ≈ 2048 Token，预算压到 2000（安全比例 1600）时 m1 放不下，应触发压缩。
        const { service, gateway } = createService(
            [
                { id: 'm1', role: ConversationMessageRole.USER, content: '看看这两张图', turnId: 'turn-1', toolCallId: null, imageFileIds: ['img-1', 'img-2'] },
                { id: 'm2', role: ConversationMessageRole.ASSISTANT, content: '好的', turnId: 'turn-2', toolCallId: null },
            ],
            [],
        );
        gateway.fetchChatContextBudgets.mockResolvedValue({ standard: 2000 });

        const request = await service.buildChatRequest(buildInput());

        expect(gateway.compactChat).toHaveBeenCalledTimes(1);
        const [body] = gateway.compactChat.mock.calls[0];
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0].id).toBe('m1');
        expect(request.messages).toEqual([{ id: 'm2', role: 'assistant', content: [{ type: 'text', text: '好的' }] }]);
    });
});
