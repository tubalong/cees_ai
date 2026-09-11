import { ConflictException, NotFoundException } from '@nestjs/common';
import { AssistantTurnStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ChatStreamEvent, ToolTurnStreamEvent } from '@cees/ai-service-client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import { AiServiceGateway } from '../../ai-orchestration/ai-service-gateway.service';
import type { PublicTurnStreamEvent } from '../assistant.types';
import { ConversationService } from '../conversation/conversation.service';
import { EventService } from '../conversation/event.service';
import { ContextBuilderService } from './context-builder.service';
import { TurnRunnerService } from './turn-runner.service';
import { ToolRegistryService } from '../tools/tool-registry';
import { ToolPolicyService } from '../tools/tool-policy.service';

describe('TurnRunnerService', () => {
    it('creates a turn, streams mapped events and completes the state machine', async () => {
        const harness = createHarness();
        harness.eventStore.gatewayStream = completedStream;
        // 幂等检查（conversationId_idempotencyKey）与订阅终态检测（id）共用 findUnique，需按 where 区分。
        harness.prisma.assistantTurn.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
            if (where && 'conversationId_idempotencyKey' in where) return null;
            // 终态检测与后台执行并发：completed 事件落库前保持 RUNNING，避免订阅提前结束。
            return {
                id: TURN_ID,
                tenantId: TENANT_ID,
                status: harness.eventStore.events.some((event) => event.type === 'completed')
                    ? 'COMPLETED' as AssistantTurnStatus
                    : 'RUNNING' as AssistantTurnStatus,
            };
        });

        const started = await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-1',
            content: '你好',
            mode: 'standard',
        });
        expect(started.turnId).toBe(TURN_ID);

        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));
        expect(events.map((event) => event.type)).toEqual([
            'started', 'status', 'content_delta', 'usage', 'completed',
        ]);
        expect(events[0]).toMatchObject({ seq: 1, type: 'started', conversationId: CONVERSATION_ID, turnId: TURN_ID });

        await waitUntil(() => harness.eventStore.assistantMessages > 0);
        expect(harness.prisma.assistantTurn.updateMany).toHaveBeenCalledWith({
            where: { id: TURN_ID, status: AssistantTurnStatus.RUNNING },
            data: { status: AssistantTurnStatus.COMPLETED, completedAt: expect.any(Date) },
        });
        expect(harness.conversationService.setTitleFromFirstUserMessage).toHaveBeenCalledWith(CONVERSATION_ID);
    });

    it('returns the original turn for a repeated idempotency key with the same content', async () => {
        const harness = createHarness();
        harness.prisma.assistantTurn.findUnique.mockResolvedValue({
            id: TURN_ID,
            requestHash: hashTurnRequestForTest(CONVERSATION_ID, 'standard', '你好'),
        });

        const started = await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-1',
            content: '你好',
            mode: 'standard',
        });

        expect(started.turnId).toBe(TURN_ID);
        expect(harness.conversationService.appendUserMessage).not.toHaveBeenCalled();
    });

    it('rejects a repeated idempotency key with different content', async () => {
        const harness = createHarness();
        harness.prisma.assistantTurn.findUnique.mockResolvedValue({
            id: TURN_ID,
            requestHash: hashTurnRequestForTest(CONVERSATION_ID, 'standard', '其他内容'),
        });

        await expect(harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-1',
            content: '你好',
            mode: 'standard',
        })).rejects.toBeInstanceOf(ConflictException);
    });

    it('finalizes the turn as failed when startup message persistence throws', async () => {
        const harness = createHarness();
        harness.conversationService.appendUserMessage.mockRejectedValue(new Error('db down'));
        // 幂等检查与失败兜底的终态检测共用 findUnique：幂等键查询无命中，id 查询返回 RUNNING。
        harness.prisma.assistantTurn.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
            if (where && 'conversationId_idempotencyKey' in where) return null;
            return { id: TURN_ID, tenantId: TENANT_ID, status: 'RUNNING' as AssistantTurnStatus };
        });

        await expect(harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-startup-fail',
            content: '你好',
            mode: 'standard',
        })).rejects.toThrow('db down');

        // Turn 已创建但执行从未启动：兜底终态化为 FAILED，避免重试命中幂等后订阅端无限等待。
        expect(harness.prisma.assistantTurn.update).toHaveBeenCalledWith({
            where: { id: TURN_ID },
            data: expect.objectContaining({
                status: AssistantTurnStatus.FAILED,
                error: { code: 'TURN_STARTUP_FAILED', message: '轮次启动失败，请重试', retryable: true },
            }),
        });
    });

    it('executes a tool loop: persists tool_call/tool_result events, feeds the TOOL message back and completes', async () => {
        const harness = createHarness({
            allowedTools: [{
                name: 'generate_image',
                description: '生成图片',
                parameters: { type: 'object', properties: {} },
            }],
            toolTurnStreams: [
                () => toolCallProposalStream(),
                () => secondRoundCompletedStream(),
            ],
        });
        // 幂等检查（conversationId_idempotencyKey）与订阅终态检测（id）共用 findUnique，需按 where 区分。
        harness.prisma.assistantTurn.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
            if (where && 'conversationId_idempotencyKey' in where) return null;
            // 终态检测与后台执行并发：completed 事件落库前保持 RUNNING，避免订阅提前结束。
            return {
                id: TURN_ID,
                tenantId: TENANT_ID,
                status: harness.eventStore.events.some((event) => event.type === 'completed')
                    ? 'COMPLETED' as AssistantTurnStatus
                    : 'RUNNING' as AssistantTurnStatus,
            };
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-tools',
            content: '帮我画一只猫',
            mode: 'standard',
        });

        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));
        // 第一轮：started + 模型建议执行产物；第二轮：started + 最终回答。
        expect(events.map((event) => event.type)).toEqual([
            'started', 'tool_call', 'tool_result', 'started', 'content_delta', 'usage', 'completed',
        ]);
        expect(events[1]).toMatchObject({
            type: 'tool_call',
            toolCallId: expect.any(String),
            name: 'generate_image',
            arguments: { prompt: '一只猫' },
        });
        expect(events[2]).toMatchObject({
            type: 'tool_result',
            status: 'completed',
            resourceId: 'image-1',
            resourceUrl: 'https://cos.example/signed',
            error: null,
        });

        // 工具调用先落库（含上游 id 映射），执行成功后结果与资源信息一并写入。
        expect(harness.prisma.toolCall.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                upstreamCallId: 'call_1',
                name: 'generate_image',
                status: 'APPROVED',
                arguments: { prompt: '一只猫' },
            }),
            select: { id: true },
        });
        expect(harness.prisma.toolCall.update).toHaveBeenCalledWith({
            where: { id: 'tool-call-1' },
            data: expect.objectContaining({
                status: 'COMPLETED',
                executedResourceType: 'IMAGE',
                executedResourceId: 'image-1',
            }),
        });
        expect(harness.conversationService.appendToolMessage).toHaveBeenCalledWith({
            conversation: expect.objectContaining({ id: CONVERSATION_ID }),
            turnId: TURN_ID,
            toolCallId: expect.any(String),
            content: '图片已生成：https://cos.example/signed',
        });

        // 第二轮请求把 assistant(tool_calls) 与 TOOL 结果回喂给模型。
        expect(harness.gateway.streamToolTurn).toHaveBeenCalledTimes(2);
        const secondRoundRequest = harness.gateway.streamToolTurn.mock.calls[1][0] as { messages: unknown };
        expect(secondRoundRequest.messages).toEqual([
            { role: 'user', content: '你好' },
            {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: '一只猫' } }],
            },
            {
                role: 'tool',
                content: '图片已生成：https://cos.example/signed',
                tool_call_id: 'call_1',
                name: 'generate_image',
            },
        ]);
        expect(harness.conversationService.appendAssistantMessage).toHaveBeenCalledWith({
            conversation: expect.objectContaining({ id: CONVERSATION_ID }),
            turnId: TURN_ID,
            content: '图片已经生成好了！',
        });
    });

    it('cancels a running turn, appends a terminal event and aborts the upstream call', async () => {
        const harness = createHarness();
        let capturedSignal: AbortSignal | undefined;
        harness.eventStore.gatewayStream = (signal) => {
            capturedSignal = signal;
            return infiniteContentStream(signal);
        };
        harness.prisma.assistantTurn.updateMany.mockResolvedValue({ count: 1 });
        harness.prisma.assistantTurn.findUniqueOrThrow.mockResolvedValue(turnRecord({ status: 'CANCELLED' }));

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-cancel',
            content: '你好',
            mode: 'standard',
        });
        const cancelled = await harness.service.cancelTurn(CONVERSATION_ID, TURN_ID);

        expect(cancelled.status).toBe('CANCELLED');
        expect(harness.prisma.assistantTurn.updateMany).toHaveBeenCalledWith({
            where: { id: TURN_ID, status: AssistantTurnStatus.RUNNING },
            data: { status: AssistantTurnStatus.CANCELLED, completedAt: expect.any(Date) },
        });
        const errorPayload = harness.eventStore.events.find((event) => event.type === 'error');
        expect(errorPayload).toMatchObject({
            error: { code: 'TURN_CANCELLED', retryable: false },
        });
        expect(capturedSignal?.aborted).toBe(true);
    });

    it('rejects cancel when the turn already reached a terminal state', async () => {
        const harness = createHarness();
        harness.prisma.assistantTurn.updateMany.mockResolvedValue({ count: 0 });

        await expect(harness.service.cancelTurn(CONVERSATION_ID, TURN_ID))
            .rejects.toMatchObject({ response: { code: 'TURN_NOT_CANCELLABLE' } });
        expect(harness.eventStore.events).toHaveLength(0);
    });

    it('marks the turn failed with an error event when the upstream stream ends without a terminal event', async () => {
        const harness = createHarness();
        harness.eventStore.gatewayStream = streamEndingWithoutTerminalEvent;
        harness.prisma.assistantTurn.findUniqueOrThrow.mockResolvedValue({
            id: TURN_ID, status: 'RUNNING' as AssistantTurnStatus,
        });
        // 幂等检查与失败终态检测共用 findUnique：幂等键查询无命中，id 查询返回 RUNNING。
        harness.prisma.assistantTurn.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
            if (where && 'conversationId_idempotencyKey' in where) return null;
            return { id: TURN_ID, tenantId: TENANT_ID, status: 'RUNNING' as AssistantTurnStatus };
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-2',
            content: '你好',
            mode: 'standard',
        });

        await waitUntil(() => harness.eventStore.events.some((event) => event.type === 'error'));
        expect(harness.prisma.assistantTurn.update).toHaveBeenCalledWith({
            where: { id: TURN_ID },
            data: {
                status: AssistantTurnStatus.FAILED,
                completedAt: expect.any(Date),
                error: expect.objectContaining({ code: 'AI_SERVICE_INVALID_RESPONSE' }),
            },
        });
    });

    it('preserves upstream error details when a tool turn stream fails', async () => {
        const harness = createHarness({
            allowedTools: [{
                name: 'generate_image',
                description: '生成图片',
                parameters: { type: 'object', properties: {} },
            }],
            toolTurnStreams: [() => toolTurnErrorStream()],
        });
        // 幂等检查与失败终态检测共用 findUnique：幂等键查询无命中，id 查询返回 RUNNING。
        harness.prisma.assistantTurn.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
            if (where && 'conversationId_idempotencyKey' in where) return null;
            return { id: TURN_ID, tenantId: TENANT_ID, status: 'RUNNING' as AssistantTurnStatus };
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-tool-error',
            content: '帮我画一只猫',
            mode: 'standard',
        });

        await waitUntil(() => harness.eventStore.events.some((event) => event.type === 'error'));
        // 上游原始错误信息（code/message/retryable）应原样保留到失败终态。
        expect(harness.prisma.assistantTurn.update).toHaveBeenCalledWith({
            where: { id: TURN_ID },
            data: expect.objectContaining({
                status: AssistantTurnStatus.FAILED,
                error: { code: 'UPSTREAM_BAD_GATEWAY', message: '上游网关错误', retryable: true },
            }),
        });
    });

    it('hides a turn that does not belong to the conversation', async () => {
        const harness = createHarness();
        harness.prisma.assistantTurn.findFirst.mockResolvedValue(null);

        await expect(harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        })).rejects.toBeInstanceOf(NotFoundException);
    });
});

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '10000000-0000-0000-0000-000000000002';
const MEMBERSHIP_ID = '50000000-0000-0000-0000-000000000001';
const CONVERSATION_ID = '60000000-0000-0000-0000-000000000001';
const TURN_ID = '60000000-0000-0000-0000-000000000002';

interface Harness {
    service: TurnRunnerService;
    prisma: Record<string, any>;
    conversationService: Record<string, any>;
    eventStore: EventStoreMock;
    toolRegistry: Record<string, any>;
    toolPolicy: Record<string, any>;
    gateway: Record<string, any>;
}

interface EventStoreMock {
    events: PublicTurnStreamEvent[];
    assistantMessages: number;
    gatewayStream: (signal?: AbortSignal) => AsyncGenerator<ChatStreamEvent>;
    append: jest.Mock;
    poll: jest.Mock;
}

function createHarness(options: {
    allowedTools?: ReturnType<ToolRegistryService['listAllowed']>;
    toolTurnStreams?: Array<(signal?: AbortSignal) => AsyncGenerator<ToolTurnStreamEvent>>;
} = {}): Harness {
    const prisma = createPrismaMock();
    const toolTurnStreams = [...(options.toolTurnStreams ?? [])];
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: 'public-request-id',
            roles: [],
            permissions: [],
        }),
    } as unknown as TenantContext;
    const eventStore: EventStoreMock = {
        events: [],
        assistantMessages: 0,
        gatewayStream: completedStream,
        append: jest.fn(async (
            _turnId: string,
            _tenantId: string,
            _type: string,
            payload: Record<string, unknown>,
        ) => {
            const seq = eventStore.events.length + 1;
            eventStore.events.push({ ...payload, seq } as PublicTurnStreamEvent);
            return seq;
        }),
        poll: jest.fn(async function* poll(_turnId: string, afterSeq: number) {
            let lastSeq = afterSeq;
            for (let round = 0; round < 200; round++) {
                const next = eventStore.events.filter((event) => event.seq > lastSeq);
                for (const event of next) {
                    lastSeq = event.seq;
                    yield event;
                }
                if (next.length > 0) continue;
                const terminal = prisma.assistantTurn.findUnique
                    ? await prisma.assistantTurn.findUnique({ where: { id: _turnId } })
                    : null;
                if (terminal && isTerminal(terminal.status)) return;
                await sleep(5);
            }
        }),
    };
    const conversationService = {
        requireMemberConversation: jest.fn().mockResolvedValue({
            id: CONVERSATION_ID,
            tenantId: TENANT_ID,
            title: '',
            ownerMembershipId: MEMBERSHIP_ID,
        }),
        appendAssistantMessage: jest.fn(async () => {
            eventStore.assistantMessages++;
        }),
        setTitleFromFirstUserMessage: jest.fn().mockResolvedValue(undefined),
        appendUserMessage: jest.fn().mockResolvedValue(undefined),
        appendToolMessage: jest.fn().mockResolvedValue(undefined),
        touchLastTurnAt: jest.fn().mockResolvedValue(undefined),
    };
    const eventService = {
        append: eventStore.append,
        poll: eventStore.poll,
    } as unknown as EventService;
    const contextBuilder = {
        buildChatRequest: jest.fn().mockResolvedValue({
            request_id: 'internal-request-id',
            tenant_id: TENANT_ID,
            user_id: USER_ID,
            conversation_id: CONVERSATION_ID,
            mode: 'standard',
            conversation_summary: null,
            messages: [{ id: 'm1', role: 'user', content: '你好' }],
        }),
        buildToolTurnMessages: jest.fn().mockResolvedValue({
            summary: null,
            items: [{ role: 'user', content: '你好' }],
        }),
    } as unknown as ContextBuilderService;
    const gateway = {
        streamChat: jest.fn(async (_input: unknown, _tracking: unknown, signal?: AbortSignal) => {
            return eventStore.gatewayStream(signal);
        }),
        streamToolTurn: jest.fn(async (_input: unknown, _tracking: unknown, signal?: AbortSignal) => {
            const stream = toolTurnStreams.shift();
            return stream ? stream(signal) : toolTurnStreamEndingWithoutToolCalls();
        }),
    } as unknown as AiServiceGateway;
    // 默认未注册任何工具：走纯文本轮次分支，工具轮次用单独用例覆盖。
    const toolRegistry = {
        listAllowed: jest.fn().mockReturnValue(options.allowedTools ?? []),
    } as unknown as ToolRegistryService;
    const toolPolicy = {
        approve: jest.fn().mockReturnValue({
            definition: { execute: jest.fn().mockResolvedValue(EXECUTED_IMAGE_RESULT) },
            parsedArguments: { prompt: '一只猫' },
        }),
    } as unknown as ToolPolicyService;

    const service = new TurnRunnerService(
        prisma as unknown as PrismaService,
        tenantContext,
        conversationService as unknown as ConversationService,
        eventService,
        contextBuilder,
        gateway,
        toolRegistry,
        toolPolicy,
    );
    return { service, prisma, conversationService, eventStore, toolRegistry, toolPolicy, gateway };
}

function createPrismaMock(): Record<string, any> {
    const mock: Record<string, any> = {
        $transaction: jest.fn(async (arg: unknown) => {
            if (Array.isArray(arg)) {
                await Promise.all(arg);
                return;
            }
            const tx = {
                assistantTurn: {
                    count: jest.fn().mockResolvedValue(0),
                    create: jest.fn().mockResolvedValue({ id: TURN_ID }),
                },
                conversationMessage: {
                    create: jest.fn().mockResolvedValue({}),
                },
                conversation: {
                    update: jest.fn().mockResolvedValue({}),
                },
            };
            return (arg as (tx: unknown) => unknown)(tx);
        }),
        assistantTurn: {
            findUnique: jest.fn(),
            findUniqueOrThrow: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({ tenantId: TENANT_ID }),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            create: jest.fn().mockResolvedValue({ id: TURN_ID }),
            count: jest.fn().mockResolvedValue(0),
        },
        conversationMessage: {
            create: jest.fn().mockResolvedValue({}),
        },
        conversation: {
            update: jest.fn().mockResolvedValue({}),
        },
        toolCall: {
            create: jest.fn().mockResolvedValue({ id: 'tool-call-1' }),
            update: jest.fn().mockResolvedValue({}),
            count: jest.fn().mockResolvedValue(0),
        },
        assistantEvent: {
            findMany: jest.fn().mockResolvedValue([]),
        },
    };
    return mock;
}

function completedStream(_signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    return (async function* stream() {
        yield {
            type: 'started',
            request_id: 'internal-request-id',
            conversation_id: CONVERSATION_ID,
            mode: 'standard',
            context_usage: {
                strategy: 'full',
                received_message_count: 1,
                included_message_count: 1,
                history_truncated: false,
                estimated_input_tokens: 10,
            },
        } as ChatStreamEvent;
        yield { type: 'status', phase: 'answering' } as ChatStreamEvent;
        yield { type: 'content_delta', text: '你好！' } as ChatStreamEvent;
        yield {
            type: 'usage',
            token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        } as ChatStreamEvent;
        yield { type: 'completed', latency_ms: 120, finish_reason: 'stop' } as ChatStreamEvent;
    })();
}

function streamEndingWithoutTerminalEvent(_signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    return (async function* stream() {
        yield { type: 'content_delta', text: '未完成' } as ChatStreamEvent;
    })();
}

/** 工具执行成功的结果摘要，由 toolPolicy.approve 的 execute mock 返回。 */
const EXECUTED_IMAGE_RESULT = {
    resourceType: 'IMAGE',
    resourceId: 'image-1',
    resourceUrl: 'https://cos.example/signed',
    summary: '图片已生成：https://cos.example/signed',
};

function toolTurnStartedEvent(): ToolTurnStreamEvent {
    return {
        type: 'started',
        request_id: 'internal-request-id',
        conversation_id: CONVERSATION_ID,
        mode: 'standard',
        context_usage: {
            strategy: 'full',
            received_message_count: 1,
            included_message_count: 1,
            history_truncated: false,
            estimated_input_tokens: 10,
        },
    } as ToolTurnStreamEvent;
}

/** 第一轮：模型返回 generate_image 建议后流结束，由 NestJS 执行并回喂。 */
function toolCallProposalStream(): AsyncGenerator<ToolTurnStreamEvent> {
    return (async function* stream() {
        yield toolTurnStartedEvent();
        yield {
            type: 'tool_calls',
            tool_calls: [{
                id: 'call_1',
                name: 'generate_image',
                arguments: { prompt: '一只猫' },
            }],
        } as ToolTurnStreamEvent;
    })();
}

/** 第二轮：模型基于 TOOL 结果给出最终回答。 */
function secondRoundCompletedStream(): AsyncGenerator<ToolTurnStreamEvent> {
    return (async function* stream() {
        yield toolTurnStartedEvent();
        yield { type: 'content_delta', text: '图片已经生成好了！' } as ToolTurnStreamEvent;
        yield {
            type: 'usage',
            token_usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
        } as ToolTurnStreamEvent;
        yield { type: 'completed', latency_ms: 120, finish_reason: 'stop' } as ToolTurnStreamEvent;
    })();
}

/** 工具轮次缺省流：无建议且无终态事件，触发流意外结束失败路径。 */
function toolTurnStreamEndingWithoutToolCalls(): AsyncGenerator<ToolTurnStreamEvent> {
    return (async function* stream() {
        yield { type: 'content_delta', text: '无建议' } as ToolTurnStreamEvent;
    })();
}

/** 工具轮次上游错误：模型流中途返回 error 事件，携带原始错误信息。 */
function toolTurnErrorStream(): AsyncGenerator<ToolTurnStreamEvent> {
    return (async function* stream() {
        yield toolTurnStartedEvent();
        yield {
            type: 'error',
            error: { code: 'UPSTREAM_BAD_GATEWAY', message: '上游网关错误', retryable: true },
        } as ToolTurnStreamEvent;
    })();
}

function infiniteContentStream(signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    return (async function* stream() {
        let index = 0;
        while (true) {
            if (signal?.aborted) return;
            yield { type: 'content_delta', text: `片段${index++}` } as ChatStreamEvent;
            await sleep(5);
        }
    })();
}

async function consumeAll(generator: AsyncGenerator<PublicTurnStreamEvent>): Promise<PublicTurnStreamEvent[]> {
    const events: PublicTurnStreamEvent[] = [];
    for await (const event of generator) events.push(event);
    return events;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('waitUntil timed out');
        await sleep(10);
    }
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTerminal(status: string): boolean {
    return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

function hashTurnRequestForTest(conversationId: string, mode: string, content: string): string {
    return createHash('sha256').update(`${conversationId}\n${mode}\n${content}`).digest('hex');
}

function turnRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: TURN_ID,
        tenantId: TENANT_ID,
        conversationId: CONVERSATION_ID,
        seq: 1,
        idempotencyKey: 'key-1',
        requestHash: 'hash',
        status: 'RUNNING',
        mode: 'standard',
        error: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        completedAt: null,
        ...overrides,
    };
}
