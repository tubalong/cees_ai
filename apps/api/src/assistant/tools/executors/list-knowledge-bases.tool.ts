import { Injectable, OnModuleInit } from '@nestjs/common';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

/**
 * list_knowledge_bases 工具执行器（块 7c）：列出当前用户可见的全部知识库及
 * 当前用户对每个库的成员权限（READER / EDITOR / MANAGER）。既回答“我有哪些
 * 知识库”，也为 save_to_knowledge 提供转存目标库候选（仅 EDITOR 及以上可写）。
 * 目标库由用户决定，工具只提供候选，绝不替用户挑选；只做参数校验与业务调用，
 * 权限与批准由 ToolRegistry/ToolPolicy 统一处理。
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
        displayName: '列出可见知识库',
        description: '列出当前用户可见的全部知识库，以及当前用户对每个库的成员权限（READER 只读 / EDITOR 可编辑 / MANAGER 管理）。'
            + '用户询问自己有哪些知识库时使用；用户想把对话内容存入知识库时也可先用本工具展示候选库供用户确认，'
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
            membershipId: context.membershipId,
            permissions: context.permissions,
        });
        // knowledge_base_id 是后续 save_to_knowledge 的参数引用，必须进模型上下文；
        // my_permission 是转存门槛判断依据（仅 EDITOR/MANAGER 可写），retrievable
        // 标注该库是否参与 search_knowledge 检索，其余只放业务内容。
        const summary = JSON.stringify({
            type: 'knowledge_base_candidates',
            candidates: candidates.map((candidate) => ({
                knowledge_base_id: candidate.id,
                name: candidate.name,
                description: candidate.description ?? '',
                member_count: candidate.memberCount,
                my_permission: candidate.myPermission,
                retrievable: candidate.retrievable,
            })),
            instruction: candidates.length === 0
                ? '当前用户不在任何知识库的成员列表中，请如实告知用户，不要调用 save_to_knowledge。'
                : '用户询问有哪些知识库时，如实列出全部候选（含只读库，可附带说明权限）。'
                    + '向用户说明权限时只用中文表述（只读 / 可编辑 / 管理员），不要输出 READER/EDITOR/MANAGER 等枚举词，'
                    + '也不要向用户展示 knowledge_base_id。'
                    + 'retrievable 为 false 的库（部门/项目/全员可见但用户非成员）仅供浏览清单，不参与 search_knowledge 检索：'
                    + '用户想检索这类库内容时，如实说明需要先成为该库成员。'
                    + '用户想保存内容时，只能选择 my_permission 为 EDITOR 或 MANAGER 的库：'
                    + '用户确认后调用 save_to_knowledge 并传对应 knowledge_base_id；'
                    + '若用户尚未确认，先展示可写候选并询问用户选择，绝不替用户挑选。',
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
