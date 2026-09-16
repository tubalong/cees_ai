import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AssistantTurnStage, AssistantTurnStatus, ToolCallStatus } from '@prisma/client';
import type { ChatStreamEvent, ToolCall, ToolTurnStreamEvent } from '@cees/ai-service-client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import { AiServiceGateway, AiServiceInvocationError } from '../../ai-orchestration/ai-service-gateway.service';
import type { PublicTurnStreamEvent } from '../assistant.types';
import { ConversationService } from '../conversation/conversation.service';
import { EventService } from '../conversation/event.service';
import { ToolPolicyError, ToolPolicyService } from '../tools/tool-policy.service';
import { ToolRegistryService } from '../tools/tool-registry';
import type { ToolExecutionResult } from '../tools/tool.types';
import { AssistantMessageContentService } from './message-content.service';
import { ContextBuilderService } from './context-builder.service';
import { TurnRunnerService } from './turn-runner.service';
import { TurnStateService } from './turn-state.service';

describe('TurnRunnerService', () => {
    it('creates a multimodal turn, sends parts to ai-service and persists a terminal answer', async () => {
        const harness = createHarness();
        harness.messageContent.validateImageFileIds.mockResolvedValue([IMAGE_FILE_ID]);
        harness.contextBuilder.buildChatRequest.mockResolvedValue({
            request_id: REQUEST_ID,
            tenant_id: TENANT_ID,
            user_id: USER_ID,
            conversation_id: CONVERSATION_ID,
            mode: 'standard',
            conversation_summary: null,
            messages: [{
                id: 'message-1',
                role: 'user',
                content: [
                    { type: 'text', text: '这张图是什么？' },
                    { type: 'image_url', image_url: { url: 'https://cos.example/input' } },
                ],
            }],
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-multimodal',
            content: '这张图是什么？',
            imageFileIds: [IMAGE_FILE_ID],
            mode: 'standard',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        expect(events.map((event) => event.type)).toEqual([
            'started', 'status', 'content_delta', 'usage', 'completed',
        ]);
        expect(harness.state.createTurn).toHaveBeenCalledWith(expect.objectContaining({
            content: '这张图是什么？',
            imageFileIds: [IMAGE_FILE_ID],
        }));
        expect(harness.gateway.streamChat).toHaveBeenCalledWith(
            expect.objectContaining({
                messages: [expect.objectContaining({
                    content: [
                        { type: 'text', text: '这张图是什么？' },
                        { type: 'image_url', image_url: { url: 'https://cos.example/input' } },
                    ],
                })],
            }),
            expect.objectContaining({ turnId: TURN_ID }),
            expect.any(AbortSignal),
        );
        expect(harness.state.completeTurn).toHaveBeenCalledWith(expect.objectContaining({
            turnId: TURN_ID,
            content: '你好！',
        }));
    });

    it('rejects a turn that has neither text nor image references', async () => {
        const harness = createHarness();

        await expect(harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-empty',
            content: '   ',
            imageFileIds: [],
            mode: 'standard',
        })).rejects.toMatchObject({
            response: { code: 'MESSAGE_CONTENT_EMPTY' },
        });
        expect(harness.state.createTurn).not.toHaveBeenCalled();
    });

    it('uses the conversation default mode when the request omits mode', async () => {
        const harness = createHarness({ conversationMode: 'ultra' });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-inherit-mode',
            content: '你好',
        });

        expect(harness.state.createTurn).toHaveBeenCalledWith(expect.objectContaining({ mode: 'ultra' }));
    });

    it('hides the knowledge_search tool from the model when the turn-level switch is off', async () => {
        const harness = createHarness({ allowedTools: [chatTool('knowledge_search')] });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-kb-off',
            content: '内部文档里怎么写的？',
            mode: 'standard',
        });
        await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        // 开关关闭：过滤后无可用工具，走纯文本轮次；模型从未拿到知识库工具。
        expect(harness.gateway.streamChat).toHaveBeenCalled();
        expect(harness.gateway.streamToolTurn).not.toHaveBeenCalled();
        expect(harness.state.createTurn).toHaveBeenCalledWith(expect.objectContaining({
            knowledgeBaseEnabled: false,
        }));
    });

    it('exposes knowledge_search to the model when the turn-level switch is on', async () => {
        const harness = createHarness({ allowedTools: [chatTool('knowledge_search')] });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-kb-on',
            content: '内部文档里怎么写的？',
            mode: 'standard',
            knowledgeBaseEnabled: true,
        });
        await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        expect(harness.gateway.streamToolTurn).toHaveBeenCalledWith(
            expect.objectContaining({ tools: [chatTool('knowledge_search')] }),
            expect.anything(),
            expect.any(AbortSignal),
        );
    });

    it('reuses an idempotent turn only when the multimodal request hash matches', async () => {
        const harness = createHarness();
        const request = {
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-replay',
            content: '看图',
            imageFileIds: [IMAGE_FILE_ID],
            mode: 'standard' as const,
        };
        harness.prisma.assistantTurn.findUnique.mockResolvedValue({
            id: TURN_ID,
            requestHash: hashTurnRequestForTest(CONVERSATION_ID, 'standard', '看图', [IMAGE_FILE_ID]),
        });

        await expect(harness.service.startTurn(request)).resolves.toEqual({ turnId: TURN_ID });
        expect(harness.state.createTurn).not.toHaveBeenCalled();

        harness.prisma.assistantTurn.findUnique.mockResolvedValue({
            id: TURN_ID,
            requestHash: hashTurnRequestForTest(CONVERSATION_ID, 'standard', '另一句话', [IMAGE_FILE_ID]),
        });
        await expect(harness.service.startTurn(request)).rejects.toBeInstanceOf(ConflictException);
    });

    it('executes a tool loop, keeps a stable database toolCallId and feeds parts back on the next model call', async () => {
        const harness = createHarness({
            allowedTools: [chatTool('generate_image')],
            toolTurnStreams: [toolCallProposalStream(true), () => secondRoundCompletedStream()],
        });
        // The production runner rebuilds the tool context from durable
        // ConversationMessage/ToolCall rows before every model call.  Mirror
        // that checkpoint in the unit-test harness instead of returning only
        // the initial user message on every invocation.
        harness.contextBuilder.buildToolTurnMessages
            .mockResolvedValueOnce({
                summary: null,
                items: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
            })
            .mockResolvedValueOnce({
                summary: null,
                items: [
                    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
                    {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: 'cat' } }],
                    },
                    {
                        role: 'tool',
                        content: [{ type: 'text', text: 'image generated' }],
                        tool_call_id: 'call_1',
                        name: 'generate_image',
                    },
                ],
            });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-tool',
            content: '帮我画一只猫',
            mode: 'standard',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        expect(events.map((event) => event.type)).toEqual([
            'started', 'status', 'tool_call', 'tool_result', 'started', 'content_delta', 'usage', 'completed',
        ]);
        const toolCallEvent = events.find((event) => event.type === 'tool_call');
        const toolResultEvent = events.find((event) => event.type === 'tool_result');
        expect(toolCallEvent).toMatchObject({ type: 'tool_call', name: 'generate_image' });
        expect(toolResultEvent).toMatchObject({
            type: 'tool_result',
            status: 'completed',
            resource: { type: 'IMAGE', id: 'image-1' },
            error: null,
        });
        expect(toolCallEvent && toolResultEvent && toolCallEvent.toolCallId).toBe(
            toolResultEvent && toolResultEvent.toolCallId,
        );

        const secondRequest = harness.gateway.streamToolTurn.mock.calls[1][0] as { messages: unknown[] };
        expect(secondRequest.messages).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'hello' }] },
            {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: 'cat' } }],
            },
            {
                role: 'tool',
                content: [{ type: 'text', text: 'image generated' }],
                tool_call_id: 'call_1',
                name: 'generate_image',
            },
        ]);
        // 公开事件只携带稳定资源引用，不携带任何签名 URL；
        // 下载地址一律由前端经 GET /v1/images/{imageId} 按需签发。
        expect(JSON.stringify(events)).not.toContain('signed-image-url');
    });

    it('executes web search and publishes structured sources through the tool result', async () => {
        const sources = [{
            id: 'source-1',
            title: 'CEES 文档',
            url: 'https://example.com/cees',
            domain: 'example.com',
            snippet: '公开资料摘要',
            publishedAt: '2026-09-14T00:00:00.000Z',
        }];
        const harness = createHarness({
            allowedTools: [chatTool('web_search')],
            toolTurnStreams: [webSearchProposalStream(true), () => secondRoundCompletedStream()],
            toolExecutionResult: {
                resourceType: null,
                resourceId: null,
                summary: JSON.stringify({
                    type: 'web_search_result',
                    query: 'CEES',
                    results: [{ source_id: 'source-1', title: 'CEES 文档', url: 'https://example.com/cees' }],
                }),
                sources,
            },
        });
        harness.contextBuilder.buildToolTurnMessages
            .mockResolvedValueOnce({
                summary: null,
                items: [{ role: 'user', content: [{ type: 'text', text: '搜索 CEES' }] }],
            })
            .mockResolvedValueOnce({
                summary: null,
                items: [
                    { role: 'user', content: [{ type: 'text', text: '搜索 CEES' }] },
                    {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{ id: 'call_search', name: 'web_search', arguments: { query: 'CEES' } }],
                    },
                    {
                        role: 'tool',
                        content: [{ type: 'text', text: 'search result' }],
                        tool_call_id: 'call_search',
                        name: 'web_search',
                    },
                ],
            });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-web-search',
            content: '搜索 CEES',
            mode: 'standard',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        const toolResult = events.find((event) => event.type === 'tool_result');
        expect(toolResult).toMatchObject({
            type: 'tool_result',
            status: 'completed',
            resource: null,
            sources,
            error: null,
        });
        expect(harness.state.completeToolCall).toHaveBeenCalledWith(expect.objectContaining({ sources }));
        expect(harness.gateway.streamToolTurn).toHaveBeenCalledTimes(2);
    });
    it('does not execute tool calls beyond the hard step limit', async () => {
        const execute = jest.fn().mockResolvedValue({
            resourceType: 'IMAGE',
            resourceId: 'image-1',
            summary: '图片已生成',
        });
        const harness = createHarness({
            allowedTools: [chatTool('generate_image')],
            toolTurnStreams: [manyToolCallsStream(11)],
        });
        harness.toolPolicy.approve.mockReturnValue({
            definition: { execute },
            parsedArguments: { prompt: '一只猫' },
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-limit',
            content: '批量画图',
            mode: 'standard',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        expect(execute).toHaveBeenCalledTimes(10);
        expect(harness.state.rejectToolCall).toHaveBeenCalledTimes(1);
        expect(harness.state.failTurn).toHaveBeenCalledWith(TURN_ID, expect.objectContaining({
            code: 'TOOL_LOOP_LIMIT_EXCEEDED',
        }), expect.any(String));
        expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'TOOL_LOOP_LIMIT_EXCEEDED' } });
    });

    it('turns a policy rejection into a tool result and lets the model explain it', async () => {
        const harness = createHarness({
            allowedTools: [chatTool('generate_image')],
            toolTurnStreams: [toolCallProposalStream(true), () => secondRoundCompletedStream()],
        });
        harness.toolPolicy.approve.mockImplementation(() => {
            throw new ToolPolicyError(
                'PERMISSION_DENIED',
                '缺少工具权限',
                '该操作需要相关功能权限，请告知用户联系租户管理员开通后重试',
            );
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-denied',
            content: '帮我画一只猫',
            mode: 'standard',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'tool_result',
                status: 'rejected',
                error: expect.objectContaining({ code: 'PERMISSION_DENIED' }),
            }),
        ]));
        expect(harness.gateway.streamToolTurn).toHaveBeenCalledTimes(2);
        expect(harness.state.completeTurn).toHaveBeenCalled();
    });

    it('keeps upstream technical errors out of the model reply while persisting them for diagnostics', async () => {
        const harness = createHarness({
            allowedTools: [chatTool('generate_image')],
            toolTurnStreams: [toolCallProposalStream(true), () => secondRoundCompletedStream()],
        });
        harness.toolPolicy.approve.mockReturnValue({
            definition: {
                execute: jest.fn().mockRejectedValue(
                    new AiServiceInvocationError(
                        'AI_SERVICE_UNAVAILABLE',
                        'connect ECONNREFUSED 127.0.0.1:8000',
                        true,
                        503,
                    ),
                ),
            },
            parsedArguments: { prompt: '一只猫' },
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-upstream-error',
            content: '帮我画一只猫',
            mode: 'standard',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        // 回喂模型的是通用用户友好文案，上游技术细节不进模型上下文。
        expect(harness.state.failToolCall).toHaveBeenCalledWith(expect.objectContaining({
            summary: 'AI 服务暂时不可用，本次操作未能完成；请告知用户稍后重试',
            errorMessage: expect.stringContaining('127.0.0.1'),
        }));
        // 公开事件保留技术细节供客户端/排障使用。
        const toolResultEvent = events.find((event) => event.type === 'tool_result');
        expect(toolResultEvent).toMatchObject({
            status: 'failed',
            error: {
                code: 'TOOL_EXECUTION_FAILED',
                message: expect.stringContaining('127.0.0.1') as unknown,
            },
        });
        expect(harness.state.completeTurn).toHaveBeenCalled();
    });

    it('stops the loop when a terminal tool rejection loses execution ownership', async () => {
        const harness = createHarness({
            allowedTools: [chatTool('generate_image')],
            toolTurnStreams: [toolCallProposalStream(true)],
        });
        // 让策略审批抛出异常，执行器走拒绝路径；拒绝落库又失败（竞争方已终态），
        // 当前 worker 失去执行所有权，应停止循环且不再做模型调用。
        harness.toolPolicy.approve.mockImplementation(() => {
            throw new Error('permission denied');
        });
        harness.state.rejectToolCall.mockImplementation(async (input: { toolCallId: string; code: string; summary: string }) => {
            // 模拟竞争方已写入终态事件：拒绝落库失败，但事件流已经终态化。
            harness.events.push({
                type: 'error',
                seq: 999,
                error: { code: input.code, message: input.summary, retryable: false },
            } as PublicTurnStreamEvent);
            return false;
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-reject-race',
            content: '帮我画一只猫',
            mode: 'standard',
        });
        await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        expect(harness.gateway.streamToolTurn).toHaveBeenCalledTimes(1);
        expect(harness.state.failTurn).not.toHaveBeenCalled();
    });

    it('rejects an unsafe event replay cursor before querying the database', async () => {
        const harness = createHarness();

        await expect(harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: Number.MAX_SAFE_INTEGER + 1,
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(harness.prisma.assistantTurn.findFirst).not.toHaveBeenCalled();
    });

    it('hides a turn that is not part of the requested conversation', async () => {
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
const IMAGE_FILE_ID = '70000000-0000-0000-0000-000000000001';
const REQUEST_ID = 'request-1';

function createHarness(options: {
    allowedTools?: ReturnType<ToolRegistryService['listAllowed']>;
    toolTurnStreams?: Array<(signal?: AbortSignal) => AsyncGenerator<ToolTurnStreamEvent>>;
    toolExecutionResult?: ToolExecutionResult;
    conversationMode?: 'standard' | 'ultra';
} = {}) {
    const events: PublicTurnStreamEvent[] = [];
    const records = new Map<string, {
        id: string;
        status: ToolCallStatus;
        result: unknown;
        errorCode: string | null;
        errorMessage: string | null;
        name: string;
        arguments: Record<string, unknown>;
    }>();
    let terminal = false;
    let nextSeq = 1;
    const appendEvent = (event: Record<string, unknown>): void => {
        events.push({ ...event, seq: nextSeq++ } as PublicTurnStreamEvent);
    };

    const prisma: Record<string, any> = {
        assistantTurn: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue({ tenantId: TENANT_ID }),
        },
        membershipRole: {
            findMany: jest.fn().mockResolvedValue([{ roleId: 'role-1' }]),
        },
        role: {
            findMany: jest.fn().mockResolvedValue([{ id: 'role-1', code: 'assistant_user' }]),
        },
        rolePermission: {
            findMany: jest.fn().mockResolvedValue([{ permissionId: 'permission-1' }]),
        },
        permission: {
            findMany: jest.fn().mockResolvedValue([
                { code: 'ai.image.generate' },
                { code: 'ai.document.generate' },
            ]),
        },
        tenantMembership: {
            findUnique: jest.fn().mockResolvedValue({
                tenantId: TENANT_ID,
                status: 'ACTIVE',
                deletedAt: null,
                tenant: { status: 'ACTIVE', deletedAt: null },
                user: { status: 'ACTIVE', deletedAt: null },
            }),
        },
    };
    const tenantContext = {
        require: jest.fn().mockReturnValue({
            tenantId: TENANT_ID,
            userId: USER_ID,
            membershipId: MEMBERSHIP_ID,
            requestId: REQUEST_ID,
            roles: [],
            permissions: ['ai.image.generate'],
        }),
    } as unknown as TenantContext;
    const conversationService = {
        requireMemberConversation: jest.fn().mockResolvedValue({
            id: CONVERSATION_ID,
            tenantId: TENANT_ID,
            title: '',
            ownerMembershipId: MEMBERSHIP_ID,
            mode: options.conversationMode ?? 'standard',
        }),
        setTitleFromFirstUserMessage: jest.fn().mockResolvedValue(undefined),
    };
    const eventService = {
        append: jest.fn(async (_turnId: string, _tenantId: string, _type: string, event: Record<string, unknown>) => {
            appendEvent(event);
            return events.at(-1)?.seq ?? 0;
        }),
        poll: jest.fn(async function* poll(_turnId: string, afterSeq: number, signal?: AbortSignal) {
            let lastSeq = afterSeq;
            while (!signal?.aborted) {
                const pending = events.filter((event) => event.seq > lastSeq);
                for (const event of pending) {
                    lastSeq = event.seq;
                    yield event;
                }
                // 与生产 poll 对齐：最近已消费事件为终态（或内部 terminal 标志）即结束订阅。
                const lastConsumed = events.filter((event) => event.seq <= lastSeq).at(-1);
                const isTerminalEvent = lastConsumed
                    && (lastConsumed.type === 'completed' || lastConsumed.type === 'error');
                if ((terminal || isTerminalEvent) && events.every((event) => event.seq <= lastSeq)) return;
                await delay(1);
            }
        }),
    };
    const contextBuilder = {
        buildChatRequest: jest.fn().mockResolvedValue({
            request_id: REQUEST_ID,
            tenant_id: TENANT_ID,
            user_id: USER_ID,
            conversation_id: CONVERSATION_ID,
            mode: 'standard',
            conversation_summary: null,
            messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: '你好' }] }],
        }),
        buildToolTurnMessages: jest.fn().mockResolvedValue({
            summary: null,
            items: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
        }),
    };
    const messageContent = {
        validateImageFileIds: jest.fn((fileIds?: string[]) => Promise.resolve(fileIds ?? [])),
    };
    const gateway = {
        streamChat: jest.fn(async (_input: unknown, _tracking: unknown, signal?: AbortSignal) => completedStream(signal)),
        streamToolTurn: jest.fn(async (_input: unknown, _tracking: unknown, signal?: AbortSignal) => {
            const factory = options.toolTurnStreams?.shift();
            return factory ? factory(signal) : secondRoundCompletedStream();
        }),
    };
    const toolRegistry = {
        listAllowed: jest.fn().mockReturnValue(options.allowedTools ?? []),
    };
    const toolPolicy = {
        approve: jest.fn().mockReturnValue({
            definition: { execute: jest.fn().mockResolvedValue(options.toolExecutionResult ?? EXECUTED_IMAGE_RESULT) },
            parsedArguments: { prompt: '一只猫' },
        }),
    };
    const state = {
        createTurn: jest.fn().mockResolvedValue({ id: TURN_ID }),
        heartbeat: jest.fn().mockResolvedValue(true),
        createToolCall: jest.fn(async (input: {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
            assistantContent?: string | null;
        }) => {
            const record = {
                id: input.id,
                status: ToolCallStatus.PROPOSED,
                result: null,
                errorCode: null,
                errorMessage: null,
                name: input.name,
                arguments: input.arguments,
                assistantContent: input.assistantContent ?? null,
            };
            records.set(input.id, record);
            appendEvent({ type: 'tool_call', toolCallId: input.id, name: input.name, arguments: input.arguments });
            return record;
        }),
        claimToolExecution: jest.fn().mockResolvedValue(true),
        rejectToolCall: jest.fn(async (input: { toolCallId: string; code: string; summary: string }) => {
            const record = records.get(input.toolCallId);
            if (record) {
                record.status = ToolCallStatus.REJECTED;
                record.errorCode = input.code;
                record.errorMessage = input.summary;
            }
            appendEvent({
                type: 'tool_result',
                toolCallId: input.toolCallId,
                status: 'rejected',
                resource: null,
                error: { code: input.code, message: input.summary },
            });
            return true;
        }),
        completeToolCall: jest.fn(async (input: {
            toolCallId: string;
            summary: string;
            resourceType: 'IMAGE' | 'DOCUMENT' | null;
            resourceId: string | null;
            sources?: ToolExecutionResult['sources'];
        }) => {
            const record = records.get(input.toolCallId);
            if (record) {
                record.status = ToolCallStatus.COMPLETED;
                record.result = {
                    summary: input.summary,
                    resourceType: input.resourceType,
                    resourceId: input.resourceId,
                    sources: input.sources ?? [],
                };
            }
            appendEvent({
                type: 'tool_result',
                toolCallId: input.toolCallId,
                status: 'completed',
                resource: input.resourceType && input.resourceId
                    ? { type: input.resourceType, id: input.resourceId }
                    : null,
                sources: input.sources ?? [],
                error: null,
            });
            return true;
        }),
        failToolCall: jest.fn(async (input: { toolCallId: string; code: string; summary: string; errorMessage?: string }) => {
            const record = records.get(input.toolCallId);
            if (record) {
                record.status = ToolCallStatus.FAILED;
                record.errorCode = input.code;
                record.errorMessage = input.errorMessage ?? input.summary;
            }
            appendEvent({
                type: 'tool_result',
                toolCallId: input.toolCallId,
                status: 'failed',
                resource: null,
                sources: [],
                error: { code: input.code, message: input.errorMessage ?? input.summary },
            });
            return true;
        }),
        completeTurn: jest.fn(async (input: { content: string }) => {
            appendEvent({ type: 'completed', latencyMs: 1, finishReason: 'stop' });
            terminal = true;
            return true;
        }),
        failTurn: jest.fn(async (_turnId: string, error: { code: string; message: string; retryable: boolean }) => {
            appendEvent({ type: 'error', error });
            terminal = true;
            return true;
        }),
        cancelTurn: jest.fn(async () => {
            appendEvent({ type: 'error', error: { code: 'TURN_CANCELLED', message: '已取消', retryable: false } });
            terminal = true;
            return true;
        }),
    };

    const service = new TurnRunnerService(
        prisma as unknown as PrismaService,
        tenantContext,
        conversationService as unknown as ConversationService,
        eventService as unknown as EventService,
        contextBuilder as unknown as ContextBuilderService,
        gateway as unknown as AiServiceGateway,
        toolRegistry as unknown as ToolRegistryService,
        toolPolicy as unknown as ToolPolicyService,
        state as unknown as TurnStateService,
        messageContent as unknown as AssistantMessageContentService,
    );
    return {
        service,
        prisma,
        contextBuilder,
        gateway,
        state,
        toolPolicy,
        messageContent,
        events,
    };
}

function chatTool(name: string): { name: string; description: string; parameters: Record<string, unknown> } {
    return { name, description: name, parameters: { type: 'object', properties: {} } };
}

const EXECUTED_IMAGE_RESULT = {
    resourceType: 'IMAGE' as const,
    resourceId: 'image-1',
    summary: '图片已生成',
};

function completedStream(_signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    return (async function* stream() {
        yield {
            type: 'started',
            request_id: REQUEST_ID,
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
        yield { type: 'usage', token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } as ChatStreamEvent;
        yield { type: 'completed', latency_ms: 1, finish_reason: 'stop' } as ChatStreamEvent;
    })();
}

function toolTurnStartedEvent(): ToolTurnStreamEvent {
    return {
        type: 'started',
        request_id: REQUEST_ID,
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

function toolCallProposalStream(withCompleted: boolean): (signal?: AbortSignal) => AsyncGenerator<ToolTurnStreamEvent> {
    return function streamFactory() {
        return (async function* stream() {
            yield toolTurnStartedEvent();
            yield {
                type: 'tool_calls',
                tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: '一只猫' } }],
            } as ToolTurnStreamEvent;
            if (withCompleted) yield { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' } as ToolTurnStreamEvent;
        })();
    };
}

function webSearchProposalStream(withCompleted: boolean): (signal?: AbortSignal) => AsyncGenerator<ToolTurnStreamEvent> {
    return function streamFactory() {
        return (async function* stream() {
            yield toolTurnStartedEvent();
            yield {
                type: 'tool_calls',
                tool_calls: [{ id: 'call_search', name: 'web_search', arguments: { query: 'CEES' } }],
            } as ToolTurnStreamEvent;
            if (withCompleted) yield { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' } as ToolTurnStreamEvent;
        })();
    };
}
function secondRoundCompletedStream(_signal?: AbortSignal): AsyncGenerator<ToolTurnStreamEvent> {
    return (async function* stream() {
        yield toolTurnStartedEvent();
        yield { type: 'content_delta', text: '图片已经生成好了！' } as ToolTurnStreamEvent;
        yield { type: 'usage', token_usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 } } as ToolTurnStreamEvent;
        yield { type: 'completed', latency_ms: 1, finish_reason: 'stop' } as ToolTurnStreamEvent;
    })();
}

function manyToolCallsStream(count: number): (signal?: AbortSignal) => AsyncGenerator<ToolTurnStreamEvent> {
    return function streamFactory() {
        return (async function* stream() {
            yield toolTurnStartedEvent();
            const toolCalls: ToolCall[] = Array.from({ length: count }, (_, index) => ({
                id: `call_${index + 1}`,
                name: 'generate_image',
                arguments: { prompt: `图片 ${index + 1}` },
            }));
            yield { type: 'tool_calls', tool_calls: toolCalls } as ToolTurnStreamEvent;
            yield { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' } as ToolTurnStreamEvent;
        })();
    };
}

async function consumeAll(generator: AsyncGenerator<PublicTurnStreamEvent>): Promise<PublicTurnStreamEvent[]> {
    const result: PublicTurnStreamEvent[] = [];
    for await (const event of generator) result.push(event);
    return result;
}

function hashTurnRequestForTest(
    conversationId: string,
    mode: string,
    content: string,
    imageFileIds: string[] = [],
    knowledgeBaseEnabled = false,
): string {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256')
        .update(JSON.stringify({ conversationId, mode, content, imageFileIds, knowledgeBaseEnabled }))
        .digest('hex');
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
