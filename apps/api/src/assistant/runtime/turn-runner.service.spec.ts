import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AssistantTurnStage, AssistantTurnStatus, ToolCallStatus } from '@prisma/client';
import type { ChatStreamEvent, ToolCall, ToolTurnStreamEvent } from '@cees/ai-service-client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../tenant/tenant-context';
import { AiServiceGateway, AiServiceInvocationError } from '../../ai-orchestration/ai-service-gateway.service';
import type { PublicTurnStreamEvent } from '../assistant.types';
import { ConversationService } from '../conversation/conversation.service';
import { EventService } from '../conversation/event.service';
import { AssistantActionDraftService } from '../drafts/assistant-action-draft.service';
import { ToolPolicyError, ToolPolicyService } from '../tools/tool-policy.service';
import { ToolRegistryService } from '../tools/tool-registry';
import type { ToolExecutionResult } from '../tools/tool.types';
import { AssistantMessageContentService } from './message-content.service';
import { ContextBuilderService } from './context-builder.service';
import { IntentCapabilityService } from './intent-capability.service';
import { TurnRunnerService } from './turn-runner.service';
import { TurnStateService } from './turn-state.service';
import { UserMemoryService } from '../../user-memory/user-memory.service';

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

    it('rejects connector contexts that contain credentials', async () => {
        const harness = createHarness();

        await expect(harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-connector-secret',
            content: '查看我的钉钉信息',
            mode: 'standard',
            connectorContexts: [{
                provider: 'DINGTALK',
                toolId: 'dws_read_0123456789abcdef',
                toolName: 'contact.user.get_self',
                fetchedAt: '2026-09-20T00:00:00.000Z',
                data: { accessToken: 'must-not-pass' },
            }],
        })).rejects.toMatchObject({ response: { code: 'CONNECTOR_CONTEXT_SECRET_REJECTED' } });
        expect(harness.state.createTurn).not.toHaveBeenCalled();
    });

    it('rejects oversized connector contexts before creating a turn', async () => {
        const harness = createHarness();

        await expect(harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-connector-large',
            content: '查看我的钉钉信息',
            mode: 'standard',
            connectorContexts: [{
                provider: 'DINGTALK',
                toolId: 'dws_read_0123456789abcdef',
                toolName: 'contact.user.get_self',
                fetchedAt: '2026-09-20T00:00:00.000Z',
                data: { value: 'x'.repeat(70 * 1024) },
            }],
        })).rejects.toMatchObject({ response: { code: 'CONNECTOR_CONTEXT_TOO_LARGE' } });
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
            content: '请按常规方式回答这个问题',
            mode: 'standard',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        // 开关关闭且消息未提知识库：过滤后无可用工具，走纯文本轮次；模型从未拿到知识库工具。
        expect(harness.gateway.streamChat).toHaveBeenCalled();
        expect(harness.gateway.streamToolTurn).not.toHaveBeenCalled();
        expect(harness.state.createTurn).toHaveBeenCalledWith(expect.objectContaining({
            knowledgeBaseEnabled: false,
        }));
        expect(startedCapabilities(events)).toEqual({
            webSearch: false,
            knowledgeBase: false,
            autoEnabled: [],
        });
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

    it('auto-enables web_search for a turn whose message explicitly asks to search online', async () => {
        const harness = createHarness({ allowedTools: [chatTool('web_search')] });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-web-intent',
            content: '联网查一下奥特之王的最新消息',
            mode: 'standard',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        // 未显式开启开关，但消息明确提到“联网”：本轮自动启用并把 autoEnabled 回传前端。
        expect(startedCapabilities(events)).toEqual({
            webSearch: true,
            knowledgeBase: false,
            autoEnabled: ['web_search'],
        });
        expect(harness.gateway.streamToolTurn).toHaveBeenCalledWith(
            expect.objectContaining({ tools: [chatTool('web_search')] }),
            expect.anything(),
            expect.any(AbortSignal),
        );
    });

    it('does not mark an explicitly enabled capability as auto-enabled', async () => {
        const harness = createHarness({ allowedTools: [chatTool('web_search')] });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-web-explicit',
            content: '帮我看看这个',
            mode: 'standard',
            webSearchEnabled: true,
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        // 用户显式开启不计入 autoEnabled，避免前端提示“自动启用”。
        expect(startedCapabilities(events)).toEqual({
            webSearch: true,
            knowledgeBase: false,
            autoEnabled: [],
        });
    });

    it('forwards active user memories into the tool turn request', async () => {
        const harness = createHarness({ allowedTools: [chatTool('knowledge_search')] });
        harness.contextBuilder.buildToolTurnMessages.mockResolvedValue({
            summary: null,
            items: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
            userMemories: ['用户偏好简洁回答'],
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-memories',
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
            expect.objectContaining({ user_memories: ['用户偏好简洁回答'] }),
            expect.anything(),
            expect.any(AbortSignal),
        );
    });

    it('passes null user_memories when no active memories exist', async () => {
        const harness = createHarness({ allowedTools: [chatTool('knowledge_search')] });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-no-memories',
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
            expect.objectContaining({ user_memories: null }),
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
                userMemories: [],
                items: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
            })
            .mockResolvedValueOnce({
                summary: null,
                userMemories: [],
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

        // 第二轮纯回答轮的 content_delta 为延迟补发（见 turn-runner 工具轮缓存逻辑），
        // 排在实时发布的 usage 之后。
        expect(events.map((event) => event.type)).toEqual([
            'started', 'status', 'tool_call', 'tool_result', 'started', 'usage', 'content_delta', 'completed',
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

    it('hides tool-call preamble text and still streams the final answer', async () => {
        const harness = createHarness({
            allowedTools: [chatTool('generate_image')],
            toolTurnStreams: [
                // 第一轮：模型在调用工具前输出英文预告语（真实场景里这类文本不应展示给用户）。
                () => (async function* preambleStream() {
                    yield toolTurnStartedEvent();
                    yield {
                        type: 'content_delta',
                        text: 'I will generate the image for you.',
                    } as ToolTurnStreamEvent;
                    yield {
                        type: 'tool_calls',
                        tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: '一只猫' } }],
                    } as ToolTurnStreamEvent;
                    yield { type: 'completed', latency_ms: 1, finish_reason: 'tool_calls' } as ToolTurnStreamEvent;
                })(),
                () => secondRoundCompletedStream(),
            ],
        });
        harness.contextBuilder.buildToolTurnMessages
            .mockResolvedValueOnce({
                summary: null,
                userMemories: [],
                items: [{ role: 'user', content: [{ type: 'text', text: '帮我画一只猫' }] }],
            })
            .mockResolvedValueOnce({
                summary: null,
                userMemories: [],
                items: [
                    { role: 'user', content: [{ type: 'text', text: '帮我画一只猫' }] },
                    {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: '一只猫' } }],
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
            idempotencyKey: 'key-preamble',
            content: '帮我画一只猫',
            mode: 'standard',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
        }));

        // 工具调用轮的预告语不得发布；纯回答轮的最终答复仍以 content_delta 流式发布。
        const contents = events.filter((event) => event.type === 'content_delta');
        expect(contents).toHaveLength(1);
        expect(contents[0]).toMatchObject({ type: 'content_delta', text: '图片已经生成好了！' });
        expect(JSON.stringify(events)).not.toContain('I will generate');
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
                userMemories: [],
                items: [{ role: 'user', content: [{ type: 'text', text: '搜索 CEES' }] }],
            })
            .mockResolvedValueOnce({
                summary: null,
                userMemories: [],
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
            // 联网工具受本轮对话级开关门控；显式开启后模型工具列表才包含 web_search。
            webSearchEnabled: true,
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

    it('persists and emits related questions carried on the completed event', async () => {
        const harness = createHarness();
        harness.gateway.streamChat.mockImplementation(async () => (async function* stream() {
            yield {
                type: 'completed',
                latency_ms: 1,
                finish_reason: 'stop',
                related_questions: ['怎么申请试用？', '有免费额度吗？', '如何邀请同事？'],
            } as ChatStreamEvent;
        })());

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-related-ok',
            content: '你好',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
            // 与生产相同：poll 会等满宽限期才结束；测试用短窗口保持快速。
            lingerMs: 200,
        }));

        expect(events.map((event) => event.type)).toEqual(['completed', 'related_questions']);
        expect(events.at(-1)).toEqual({
            type: 'related_questions',
            seq: 2,
            questions: ['怎么申请试用？', '有免费额度吗？', '如何邀请同事？'],
        });
        expect(harness.state.completeTurn).toHaveBeenCalledWith(
            expect.objectContaining({
                relatedQuestions: ['怎么申请试用？', '有免费额度吗？', '如何邀请同事？'],
            }),
        );
        // 异步二次生成链路已删除：网关不再暴露 relatedQuestions 方法。
        expect((harness.gateway as unknown as Record<string, unknown>).relatedQuestions).toBeUndefined();
    });

    it('omits the related_questions event when the completed event carries none', async () => {
        const harness = createHarness();
        harness.gateway.streamChat.mockImplementation(async () => (async function* stream() {
            yield { type: 'completed', latency_ms: 1, finish_reason: 'stop' } as ChatStreamEvent;
        })());

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-related-none',
            content: '你好',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
            lingerMs: 200,
        }));

        expect(events.map((event) => event.type)).toEqual(['completed']);
        expect(harness.state.completeTurn).toHaveBeenCalledWith(
            expect.objectContaining({ relatedQuestions: null }),
        );
    });

    it('drops follow-up questions from tool-calling rounds but keeps them from the final answer round', async () => {
        const harness = createHarness({
            allowedTools: [chatTool('generate_image')],
            toolTurnStreams: [
                (() => (async function* stream() {
                    yield toolTurnStartedEvent();
                    yield {
                        type: 'tool_calls',
                        tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: '一只猫' } }],
                    } as ToolTurnStreamEvent;
                    // 工具轮次不应携带追问；即使上游带出也必须丢弃。
                    yield {
                        type: 'completed',
                        latency_ms: 1,
                        finish_reason: 'tool_calls',
                        related_questions: ['这轮不该出现'],
                    } as ToolTurnStreamEvent;
                })()),
                (() => (async function* stream() {
                    yield toolTurnStartedEvent();
                    yield { type: 'content_delta', text: '图片已经生成好了！' } as ToolTurnStreamEvent;
                    yield {
                        type: 'completed',
                        latency_ms: 1,
                        finish_reason: 'stop',
                        related_questions: ['需要调整风格吗？'],
                    } as ToolTurnStreamEvent;
                })()),
            ],
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-related-tool',
            content: '帮我画一只猫',
        });
        const events = await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
            lingerMs: 200,
        }));

        expect(events.at(-1)).toEqual({
            type: 'related_questions',
            seq: events.length,
            questions: ['需要调整风格吗？'],
        });
        expect(harness.state.completeTurn).toHaveBeenCalledWith(
            expect.objectContaining({ relatedQuestions: ['需要调整风格吗？'] }),
        );
    });

    it('persists memory candidates carried on the completed event', async () => {
        const harness = createHarness();
        harness.gateway.streamChat.mockImplementation(async () => (async function* stream() {
            yield {
                type: 'completed',
                latency_ms: 1,
                finish_reason: 'stop',
                memory_candidates: [{ type: 'PREFERENCE', content: '用户偏好简洁回答' }],
            } as ChatStreamEvent;
        })());

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-memory-ok',
            content: '你好',
        });
        await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
            lingerMs: 200,
        }));

        expect(harness.userMemory.applyCandidates).toHaveBeenCalledWith(
            [{ type: 'PREFERENCE', content: '用户偏好简洁回答' }],
            { conversationId: CONVERSATION_ID, turnId: TURN_ID },
        );
    });

    it('skips memory candidate persistence when the completed event carries none', async () => {
        const harness = createHarness();

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-memory-none',
            content: '你好',
        });
        await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
            lingerMs: 200,
        }));

        expect(harness.userMemory.applyCandidates).not.toHaveBeenCalled();
    });

    it('drops memory candidates from tool-calling rounds but keeps them from the final answer round', async () => {
        const harness = createHarness({
            allowedTools: [chatTool('generate_image')],
            toolTurnStreams: [
                () => (async function* stream() {
                    yield toolTurnStartedEvent();
                    yield {
                        type: 'tool_calls',
                        tool_calls: [{ id: 'call_1', name: 'generate_image', arguments: { prompt: '一只猫' } }],
                    } as ToolTurnStreamEvent;
                    // 工具轮次不应携带记忆候选；即使上游带出也必须丢弃。
                    yield {
                        type: 'completed',
                        latency_ms: 1,
                        finish_reason: 'tool_calls',
                        memory_candidates: [{ type: 'FACT', content: '这轮不该出现' }],
                    } as ToolTurnStreamEvent;
                })(),
                () => (async function* stream() {
                    yield toolTurnStartedEvent();
                    yield { type: 'content_delta', text: '图片已经生成好了！' } as ToolTurnStreamEvent;
                    yield {
                        type: 'completed',
                        latency_ms: 1,
                        finish_reason: 'stop',
                        memory_candidates: [{ type: 'PREFERENCE', content: '用户喜欢猫咪主题' }],
                    } as ToolTurnStreamEvent;
                })(),
            ],
        });

        await harness.service.startTurn({
            conversationId: CONVERSATION_ID,
            idempotencyKey: 'key-memory-tool',
            content: '帮我画一只猫',
        });
        await consumeAll(await harness.service.subscribeTurn({
            conversationId: CONVERSATION_ID,
            turnId: TURN_ID,
            afterSeq: 0,
            lingerMs: 200,
        }));

        expect(harness.userMemory.applyCandidates).toHaveBeenCalledTimes(1);
        expect(harness.userMemory.applyCandidates).toHaveBeenCalledWith(
            [{ type: 'PREFERENCE', content: '用户喜欢猫咪主题' }],
            { conversationId: CONVERSATION_ID, turnId: TURN_ID },
        );
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
        conversationMessage: {
            findFirst: jest.fn().mockResolvedValue({ content: '你好' }),
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
        poll: jest.fn(async function* poll(
            _turnId: string,
            afterSeq: number,
            signal?: AbortSignal,
            pollOptions?: { lingerMs?: number },
        ) {
            const lingerMs = pollOptions?.lingerMs ?? 0;
            let lingerUntil: number | null = null;
            let lastSeq = afterSeq;
            while (!signal?.aborted) {
                const pending = events.filter((event) => event.seq > lastSeq);
                for (const event of pending) {
                    lastSeq = event.seq;
                    yield event;
                }
                // 与生产 poll 对齐：最近已消费事件为终态（或内部 terminal 标志）即结束订阅；
                // 指定 lingerMs 时，终态后进入宽限期，等待 completed 之后追加的 related_questions。
                const lastConsumed = events.filter((event) => event.seq <= lastSeq).at(-1);
                const isTerminalEvent = lastConsumed
                    && (lastConsumed.type === 'completed' || lastConsumed.type === 'error');
                if ((terminal || isTerminalEvent) && events.every((event) => event.seq <= lastSeq)) {
                    if (lingerMs <= 0) return;
                    if (lingerUntil === null) lingerUntil = Date.now() + lingerMs;
                    if (Date.now() >= lingerUntil) return;
                }
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
            userMemories: [],
            items: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
        }),
    };
    const messageContent = {
        validateImageFileIds: jest.fn((fileIds?: string[]) => Promise.resolve(fileIds ?? [])),
    };
    const userMemory = {
        applyCandidates: jest.fn().mockResolvedValue(undefined),
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
        /** 写操作确认：把 ToolCall 置为 AWAITING_CONFIRMATION 并推送确认预览。 */
        awaitToolConfirmation: jest.fn(async (input: {
            toolCallId: string;
            summary: string;
            confirmation: { draftId: string; toolName: string; title: string; fields: Array<{ label: string; value: string }>; expiresAt: string };
        }) => {
            const record = records.get(input.toolCallId);
            if (record) record.status = ToolCallStatus.AWAITING_CONFIRMATION;
            appendEvent({
                type: 'tool_result',
                toolCallId: input.toolCallId,
                status: 'awaiting_confirmation',
                resource: null,
                sources: [],
                confirmation: input.confirmation,
                error: null,
            });
            return true;
        }),
    };

    const actionDrafts = {
        createDraft: jest.fn(async () => ({ draftId: 'draft-1', expiresAt: new Date(Date.now() + 15 * 60 * 1000) })),
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
        new IntentCapabilityService(),
        userMemory as unknown as UserMemoryService,
        actionDrafts as unknown as AssistantActionDraftService,
    );
    return {
        service,
        prisma,
        contextBuilder,
        gateway,
        state,
        toolPolicy,
        messageContent,
        userMemory,
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

/** 取出 started 事件里的“本轮有效能力”，便于断言显式开关与意图自动启用的合并结果。 */
function startedCapabilities(events: PublicTurnStreamEvent[]): unknown {
    const started = events.find((event): event is Extract<PublicTurnStreamEvent, { type: 'started' }> => event.type === 'started');
    return started?.capabilities;
}

function hashTurnRequestForTest(
    conversationId: string,
    mode: string,
    content: string,
    imageFileIds: string[] = [],
    documentFileIds: string[] = [],
    connectorContexts: unknown[] = [],
    knowledgeBaseEnabled = false,
    webSearchEnabled = false,
): string {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256')
        .update(JSON.stringify({ conversationId, mode, content, imageFileIds, documentFileIds, connectorContexts, knowledgeBaseEnabled, webSearchEnabled }))
        .digest('hex');
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
