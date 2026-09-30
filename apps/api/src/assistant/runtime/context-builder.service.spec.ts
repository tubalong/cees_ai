import { ConversationMessageRole } from '@prisma/client';
import { ContextBuilderService, MODEL_MESSAGE_LIMIT, trimToModelMessageLimit } from './context-builder.service';
import type { PrismaService } from '../../database/prisma.service';
import type { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { UserMemoryService } from '../../user-memory/user-memory.service';
import type { ToolTurnMessage } from '@cees/ai-service-client';

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
    userMemory: { applyCandidates: jest.Mock; listActiveContents: jest.Mock };
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
            memory_candidates: [],
        }),
        fetchChatContextBudgets: jest.fn().mockResolvedValue(null),
    };
    const messageContent = {
        toModelParts: jest.fn(async (content: string, imageFileIds: string[] = []) => [
            ...(content ? [{ type: 'text', text: content } as const] : []),
            ...imageFileIds.map((url) => ({ type: 'image_url', image_url: { url } } as const)),
        ]),
    };
    const userMemory = {
        applyCandidates: jest.fn().mockResolvedValue(undefined),
        listActiveContents: jest.fn().mockResolvedValue([]),
    };
    const service = new ContextBuilderService(
        prisma as unknown as PrismaService,
        gateway as unknown as AiServiceGateway,
        messageContent as any,
        userMemory as unknown as UserMemoryService,
    );
    return { service, prisma, gateway, userMemory };
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

    it('injects active memories into the plain chat request', async () => {
        const { service, userMemory } = createService(
            [{ id: 'm1', role: ConversationMessageRole.USER, content: '你好', turnId: 'turn-1', toolCallId: null }],
            [],
        );
        userMemory.listActiveContents.mockResolvedValue(['用户偏好简洁回答', '用户在 CEES 项目负责产品设计']);

        const request = await service.buildChatRequest(buildInput());

        expect(userMemory.listActiveContents).toHaveBeenCalledWith(TENANT_ID, buildInput().membershipId);
        expect(request.user_memories).toEqual(['用户偏好简洁回答', '用户在 CEES 项目负责产品设计']);
    });

    it('omits user_memories from the plain chat request when there are no active memories', async () => {
        const { service } = createService(
            [{ id: 'm1', role: ConversationMessageRole.USER, content: '你好', turnId: 'turn-1', toolCallId: null }],
            [],
        );

        const request = await service.buildChatRequest(buildInput());

        expect(request.user_memories).toBeNull();
    });

    it('returns active memories from buildToolTurnMessages for the tool turn request', async () => {
        const { service, userMemory } = createService(
            [{ id: 'm1', role: ConversationMessageRole.USER, content: '你好', turnId: 'turn-1', toolCallId: null }],
            [],
        );
        userMemory.listActiveContents.mockResolvedValue(['用户喜欢猫咪主题']);

        const { userMemories } = await service.buildToolTurnMessages(buildInput());

        expect(userMemories).toEqual(['用户喜欢猫咪主题']);
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
        expect((request.messages[0]?.content as Array<{ text?: string }>)[1]?.text).toContain('不得重新解释数字时间戳');
        expect((request.messages[0]?.content as Array<{ text?: string }>)[1]?.text).toContain('complete=false、hasMore=true 或 nextPageToken 非空表示结果不完整');
        expect((request.messages[0]?.content as Array<{ text?: string }>)[1]?.text).toContain('只有 complete=true 且返回列表为空时，才能说“在本次查询范围内没有数据”');
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
        // 单批压缩有上限：一次只压最老的 20 条，剩余前缀留到后续轮次继续压缩。
        // 把 61 条一次性交给固定输出预算（compaction_max_output_tokens=2048）的摘要调用，
        // 必然被截断成 CHAT_COMPACTION_TRUNCATED，而且失败不落库会让该会话每一轮都失败。
        expect(body.messages).toHaveLength(20);
        expect(body.messages[0].id).toBe('m0');
        expect(request.messages).toHaveLength(61);
        expect(request.messages[0].id).toBe('m20');
        expect(request.messages[60].id).toBe('m80');
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

    it('applies memory candidates returned by compaction', async () => {
        const history: HistoryMessageRow[] = Array.from({ length: 81 }, (_, i) => ({
            id: `m${i}`,
            role: (i % 2 === 0 ? ConversationMessageRole.USER : ConversationMessageRole.ASSISTANT) as ConversationMessageRole,
            content: `消息 ${i}`,
            turnId: null,
            toolCallId: null,
        }));
        const { service, gateway, userMemory } = createService(history, []);
        gateway.compactChat.mockResolvedValue({
            summary: '压缩后的摘要',
            summarized_through_message_id: 'm60',
            memory_candidates: [{ type: 'FACT', content: '用户在 CEES 项目负责产品设计' }],
        });

        await service.buildChatRequest(buildInput());

        expect(userMemory.applyCandidates).toHaveBeenCalledWith(
            [{ type: 'FACT', content: '用户在 CEES 项目负责产品设计' }],
            { conversationId: CONVERSATION_ID },
        );
    });

    it('skips memory persistence when compaction returns no candidates', async () => {
        const history: HistoryMessageRow[] = Array.from({ length: 81 }, (_, i) => ({
            id: `m${i}`,
            role: (i % 2 === 0 ? ConversationMessageRole.USER : ConversationMessageRole.ASSISTANT) as ConversationMessageRole,
            content: `消息 ${i}`,
            turnId: null,
            toolCallId: null,
        }));
        const { service, userMemory } = createService(history, []);

        await service.buildChatRequest(buildInput());

        expect(userMemory.applyCandidates).not.toHaveBeenCalled();
    });

    it('bounds the assembled tool-turn messages to the model message limit', async () => {
        // 工具调用密集的会话会先在「总条数」上越界：压缩阈值只看文本消息，
        // 而这里统计的是文本 + TOOL 消息 + 为每个工具步骤合成的 assistant(tool_calls)。
        // 越界后 ai-service 以 INVALID_INVOCATION_REQUEST 拒绝该会话的每一轮。
        const history: HistoryMessageRow[] = [
            { id: 'u0', role: ConversationMessageRole.USER, content: '统计所有项目', turnId: null, toolCallId: null },
            ...Array.from({ length: 70 }, (_, index) => ({
                id: `t${index}`,
                role: ConversationMessageRole.TOOL,
                content: `结果 ${index}`,
                turnId: `turn-${index}`,
                toolCallId: `tc-${index}`,
            })),
        ];
        const toolCalls = Array.from({ length: 70 }, (_, index) => ({
            id: `tc-${index}`,
            turnId: `turn-${index}`,
            upstreamCallId: `call_${index}`,
            name: 'list_projects',
            arguments: {},
        }));
        const { service } = createService(history, toolCalls);

        const result = await service.buildToolTurnMessages(buildInput());

        expect(result.items.length).toBeLessThanOrEqual(MODEL_MESSAGE_LIMIT);
        // 首条不能是悬空的 tool 结果（缺少配对的 assistant(tool_calls) 会被 provider 拒绝）。
        expect(result.items[0].role).not.toBe('tool');
        // 保留最新一段：最后一条工具结果必须还在。
        expect(result.items[result.items.length - 1]).toEqual(expect.objectContaining({ role: 'tool' }));
    });

    it('bounds the history handed to a single compaction call', async () => {
        // ai-service 用固定输出预算**一次性**为整批消息生成摘要：输入过大必然被截断，
        // 返回 CHAT_COMPACTION_TRUNCATED 且不落库，于是该会话每一轮都失败。
        const history: HistoryMessageRow[] = Array.from({ length: 120 }, (_, index) => ({
            id: `m${index}`,
            role: (index % 2 === 0 ? ConversationMessageRole.USER : ConversationMessageRole.ASSISTANT) as ConversationMessageRole,
            content: '内容'.repeat(50),
            turnId: `turn-${index}`,
            toolCallId: null,
        }));
        const { service, gateway } = createService(history, []);

        await service.buildChatRequest(buildInput());

        const [request] = gateway.compactChat.mock.calls[0] as [{ messages: unknown[] }];
        expect(request.messages.length).toBeLessThanOrEqual(20);
    });

    it('keeps whole turns in a compaction batch', async () => {
        // 每轮 3 条消息：批次必须按整轮收敛，不能把某一轮从中间切开，
        // 否则会把用户请求压进摘要、却把该轮回答留在增量区间。
        const history: HistoryMessageRow[] = Array.from({ length: 120 }, (_, index) => ({
            id: `m${index}`,
            role: (index % 3 === 0 ? ConversationMessageRole.USER : ConversationMessageRole.ASSISTANT) as ConversationMessageRole,
            content: '内容',
            turnId: `turn-${Math.floor(index / 3)}`,
            toolCallId: null,
        }));
        const { service, gateway } = createService(history, []);

        await service.buildChatRequest(buildInput());

        const [request] = gateway.compactChat.mock.calls[0] as [{ messages: unknown[] }];
        expect(request.messages.length % 3).toBe(0);
        expect(request.messages.length).toBeLessThanOrEqual(20);
    });

    it('continues the turn when compaction fails instead of failing the conversation', async () => {
        // 压缩是上下文优化，不是本轮的必要条件：失败必须降级继续，
        // 否则一次压缩故障会让该会话每一轮都失败，用户无法自救。
        const history: HistoryMessageRow[] = Array.from({ length: 90 }, (_, index) => ({
            id: `m${index}`,
            role: (index % 2 === 0 ? ConversationMessageRole.USER : ConversationMessageRole.ASSISTANT) as ConversationMessageRole,
            content: `消息 ${index}`,
            turnId: `turn-${index}`,
            toolCallId: null,
        }));
        const { service, gateway, prisma } = createService(history, []);
        gateway.compactChat.mockRejectedValue(new Error('CHAT_COMPACTION_TRUNCATED'));

        const request = await service.buildChatRequest(buildInput());

        expect(gateway.compactChat).toHaveBeenCalled();
        expect(request.messages.length).toBeGreaterThan(0);
        // 没有成功摘要就不应写入摘要边界，否则会丢掉未被摘要覆盖的历史。
        expect(request.conversation_summary).toBeNull();
        expect(prisma.conversationSummary.create).not.toHaveBeenCalled();
    });
});

describe('trimToModelMessageLimit', () => {
    /** 构造「assistant(tool_calls) + tool 结果」交替的工具步骤消息。 */
    function toolStepItems(steps: number): ToolTurnMessage[] {
        const items: ToolTurnMessage[] = [];
        for (let index = 0; index < steps; index += 1) {
            items.push({
                role: 'assistant',
                content: null,
                tool_calls: [{ id: `call_${index}`, name: 'list_projects', arguments: {} }],
            });
            items.push({
                role: 'tool',
                content: [{ type: 'text', text: `结果 ${index}` }],
                tool_call_id: `call_${index}`,
                name: 'list_projects',
            });
        }
        return items;
    }

    it('keeps the newest slice within the limit', () => {
        const items = toolStepItems(80);
        const trimmed = trimToModelMessageLimit(items);

        expect(items.length).toBeGreaterThan(MODEL_MESSAGE_LIMIT);
        expect(trimmed.length).toBeLessThanOrEqual(MODEL_MESSAGE_LIMIT);
        expect(trimmed[trimmed.length - 1]).toEqual(items[items.length - 1]);
    });

    it('never leaves a leading tool result without its assistant(tool_calls)', () => {
        // 裁剪点落在轮次中间时，开头悬空的 tool 结果必须一并丢弃；
        // provider 只接受「tool 消息紧随其配对的 assistant(tool_calls)」的结构。
        const items: ToolTurnMessage[] = [
            { role: 'user', content: [{ type: 'text', text: '开始' }] },
            { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
            ...toolStepItems(80),
        ];
        const trimmed = trimToModelMessageLimit(items);

        expect(trimmed.length).toBeLessThanOrEqual(MODEL_MESSAGE_LIMIT);
        expect(trimmed[0].role).not.toBe('tool');
    });

    it('returns the same array when already within the limit', () => {
        const items = toolStepItems(2);

        expect(trimToModelMessageLimit(items)).toBe(items);
    });
});
