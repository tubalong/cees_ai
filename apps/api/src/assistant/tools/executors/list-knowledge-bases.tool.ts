import { Injectable, OnModuleInit } from '@nestjs/common';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

/**
 * list_knowledge_bases 工具执行器（块 7c）：列出当前用户有编辑权限（EDITOR 及以上）
 * 的知识库候选，供 save_to_knowledge 转存目标库选择。目标库由用户决定，工具只提供候选，
 * 绝不替用户挑选；只做参数校验与业务调用，权限与批准由 ToolRegistry/ToolPolicy 统一处理。
 */
@Injectable()
export class ListKnowledgeBasesTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly knowledgeService: KnowledgeService,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'list_knowledge_bases',
        version: '1.0.0',
        displayName: '列出候选知识库',
        description: '列出当前用户有编辑权限（EDITOR 及以上）的知识库。'
            + '用户想把对话内容存入知识库但未指明目标库时使用；返回候选知识库供用户确认，'
            + '确认后调用 save_to_knowledge 并传入对应 knowledge_base_id。',
        parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        requiredPermissions: ['knowledge_base.read'],
        riskLevel: 'READ',
        validate: validateListKnowledgeBasesArguments,
        execute: (context) => this.executeList(context),
    };

    private async executeList(context: ToolExecutionContext): Promise<ToolExecutionResult> {
        const candidates = await this.knowledgeService.listKnowledgeBasesForAssistant({
            tenantId: context.tenantId,
            userId: context.userId,
            permissions: context.permissions,
        });
        // knowledge_base_id 是后续 save_to_knowledge 的参数引用，必须进模型上下文；
        // 其余只放业务内容（名称与说明），供用户确认目标库。
        const summary = JSON.stringify({
            type: 'knowledge_base_candidates',
            candidates: candidates.map((candidate) => ({
                knowledge_base_id: candidate.id,
                name: candidate.name,
                description: candidate.description ?? '',
                member_count: candidate.memberCount,
            })),
            instruction: candidates.length === 0
                ? '当前用户没有可写入的知识库，请如实告知用户，不要调用 save_to_knowledge。'
                : '把用户想保存的内容存入用户确认的知识库：用户确认后调用 save_to_knowledge 并传对应 knowledge_base_id；'
                    + '若用户尚未确认，先展示候选并询问用户选择，绝不替用户挑选。',
        });
        return { resourceType: null, resourceId: null, summary };
    }
}

function validateListKnowledgeBasesArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('工具参数必须为对象');
    }
    return {};
}
