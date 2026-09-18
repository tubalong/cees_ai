import { Injectable, OnModuleInit } from '@nestjs/common';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { ToolPolicyError } from '../tool-policy.service';
import { ToolRegistryService } from '../tool-registry';
import type { KnowledgeToolCitation, ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

const MAX_QUERY_LENGTH = 500;

/**
 * 知识库检索工具：只读，检索范围由 KnowledgeService 按用户可见知识库与
 * 三层权限实时折叠。对话级开关是“读”的闸门：开关关闭时模型拿不到该工具，
 * 这里再做一次兜底校验，防止模型在极端情况下仍然发起调用。
 */
@Injectable()
export class KnowledgeSearchTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly knowledgeService: KnowledgeService,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'knowledge_search',
        version: '1.0.0',
        displayName: '知识库检索',
        description: '检索当前用户可见知识库中的文档内容，返回带引用的回答。'
            + '用户询问公司人员、团队、项目、制度等内部信息时，必须先调用本工具检索知识库；'
            + '没有检索过就不得声称没有信息，也不得向用户反问要求补充线索。',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    minLength: 2,
                    maxLength: MAX_QUERY_LENGTH,
                    description: '要在知识库中检索的具体问题',
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
        requiredPermissions: ['knowledge_base.query'],
        riskLevel: 'READ',
        validate: validateKnowledgeSearchArguments,
        execute: (context, input) => this.executeSearch(context, input),
    };

    private async executeSearch(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        // 开关兜底校验：正常情况下开关关闭时模型拿不到本工具，这里防止任何绕过路径。
        if (!context.knowledgeBaseEnabled) {
            throw new ToolPolicyError(
                'PERMISSION_DENIED',
                'knowledgeBaseEnabled=false 时拒绝执行 knowledge_search',
                '知识库检索未在本轮对话中启用；请告知用户如需查询知识库可在输入框开启相应选项',
                ['knowledge_base.query'],
            );
        }
        const result = await this.knowledgeService.searchKnowledgeForAssistant({
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            permissions: context.permissions,
            requestId: context.requestId,
            query: input.query as string,
        });

        const citations: KnowledgeToolCitation[] = result.citations.map((citation) => ({
            id: citation.id,
            title: citation.title,
            snippet: citation.snippet,
            pageIndex: citation.pageIndex,
            knowledgeBaseId: citation.knowledgeBaseId,
            deletable: citation.deletable,
        }));
        // 回喂模型的摘要只含业务内容：回答正文与引用（标签/标题/片段/页码）；
        // document_id/chunk_id 等内部标识只进结构化字段与审计，不进模型上下文。
        const summary = JSON.stringify({
            type: 'knowledge_search_result',
            answer: result.answer,
            grounded: result.grounded,
            insufficient_evidence: result.insufficientEvidence,
            citations: citations.map((citation, index) => ({
                citation_id: `S${index + 1}`,
                title: citation.title,
                snippet: citation.snippet,
                page_index: citation.pageIndex,
            })),
            citation_instruction: '回答只能引用 citations 中出现的 citation_id（如 S1），不得引用不存在的来源。',
            notice: result.insufficientEvidence
                ? '当前可见知识库中没有足以回答该问题的内容，请如实告知用户。'
                : undefined,
        });

        return {
            resourceType: null,
            resourceId: null,
            summary,
            citations,
        };
    }
}

function validateKnowledgeSearchArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('工具参数必须为对象');
    }
    const raw = input as Record<string, unknown>;
    if (typeof raw.query !== 'string' || raw.query.trim().length < 2) {
        throw new Error('query 必须是至少 2 个字符的非空字符串');
    }
    if (raw.query.length > MAX_QUERY_LENGTH) {
        throw new Error(`query 不能超过 ${MAX_QUERY_LENGTH} 字符`);
    }
    return { query: raw.query.trim() };
}
