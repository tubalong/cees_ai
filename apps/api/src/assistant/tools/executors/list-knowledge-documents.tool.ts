import { Injectable, OnModuleInit } from '@nestjs/common';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

/**
 * list_knowledge_documents 工具执行器：列出当前用户知识库内的文档清单。
 *
 * 存在的理由：知识库检索是「按问题召回片段」，没有答案时用户无法判断「库里
 * 真的没有」还是「检索没命中」。此前助手遇到「我的知识库有哪些文档」只能答
 * “查不出来”，体验上等价于功能缺失。本工具提供确定性的清单视图，让模型能
 * 如实回答库内有什么、哪些文档还没处理完。
 *
 * 可见范围与检索完全一致（真实成员库，或 manage_all/read_all 短路下的租户库），
 * 不含锚点人群虚拟 READER 库，避免「列得出来、检索不到」的不一致。
 * 只做参数校验与业务调用；权限与批准由 ToolRegistry/ToolPolicy 统一处理。
 */
@Injectable()
export class ListKnowledgeDocumentsTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly knowledgeService: KnowledgeService,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'list_knowledge_documents',
        version: '1.0.0',
        displayName: '列出知识库文档',
        description: '列出当前用户在知识库内可读的文档清单，包含文档名称、所属知识库与处理状态，可按知识库名称或文档名称关键词筛选。'
            + '用户询问「我的知识库里有哪些文档」「库里有什么」「某份资料是否已收录」时使用。'
            + '检索式提问（问某个问题的答案）应使用 knowledge_search，而不是本工具。'
            + '只展示真实成员库（或全读权限范围内）的文档，绝不引用结果之外的文档。',
        parameters: {
            type: 'object',
            properties: {
                knowledge_base_name: {
                    type: 'string',
                    description: '知识库名称关键词筛选；省略时跨全部可读知识库列出',
                },
                keyword: {
                    type: 'string',
                    description: '文档名称关键词筛选；省略时列出全部文档',
                },
                limit: {
                    type: 'integer',
                    description: '返回条数上限，默认 20，最大 50',
                },
            },
            additionalProperties: false,
        },
        requiredPermissions: ['knowledge_base.read'],
        riskLevel: 'READ',
        validate: validateListKnowledgeDocumentsArguments,
        execute: (context, input) => this.executeList(context, input),
    };

    private async executeList(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const documents = await this.knowledgeService.listKnowledgeDocumentsForAssistant({
            tenantId: context.tenantId,
            userId: context.userId,
            permissions: context.permissions,
            knowledgeBaseName: typeof input.knowledge_base_name === 'string' ? input.knowledge_base_name : undefined,
            keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
            limit: typeof input.limit === 'number' ? input.limit : DEFAULT_LIST_LIMIT,
        });
        if (documents.length === 0) {
            return {
                resourceType: null,
                resourceId: null,
                summary: JSON.stringify({
                    type: 'knowledge_document_list',
                    total: 0,
                    documents: [],
                    note: '当前可读知识库中没有匹配的文档',
                }),
            };
        }
        // knowledge_base_id / document_id 是后续工具调用（例如存文档、定位引用）的参数
        // 引用，必须进模型上下文；其余只放业务内容。内部标识（文件对象、对象键）不出现。
        const summary = JSON.stringify({
            type: 'knowledge_document_list',
            total: documents.length,
            documents: documents.map((document) => ({
                document_id: document.documentId,
                name: document.name,
                knowledge_base_id: document.knowledgeBaseId,
                knowledge_base_name: document.knowledgeBaseName,
                status: document.status,
                updated_at: document.updatedAt,
            })),
        });
        return { resourceType: null, resourceId: null, summary };
    }
}

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

function validateListKnowledgeDocumentsArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('工具参数必须是对象');
    }
    const raw = input as Record<string, unknown>;
    const allowed = ['knowledge_base_name', 'keyword', 'limit'];
    for (const key of Object.keys(raw)) {
        if (!allowed.includes(key)) throw new Error(`不支持的参数：${key}`);
    }
    const result: Record<string, unknown> = {};
    if (raw.knowledge_base_name !== undefined) {
        if (typeof raw.knowledge_base_name !== 'string' || raw.knowledge_base_name.trim().length === 0) {
            throw new Error('knowledge_base_name 必须是非空字符串');
        }
        result.knowledge_base_name = raw.knowledge_base_name.trim();
    }
    if (raw.keyword !== undefined) {
        if (typeof raw.keyword !== 'string' || raw.keyword.trim().length === 0) {
            throw new Error('keyword 必须是非空字符串');
        }
        result.keyword = raw.keyword.trim();
    }
    if (raw.limit !== undefined) {
        if (typeof raw.limit !== 'number' || !Number.isInteger(raw.limit) || raw.limit < 1) {
            throw new Error('limit 必须是大于 0 的整数');
        }
        result.limit = Math.min(raw.limit, MAX_LIST_LIMIT);
    }
    return result;
}
