import { Injectable, OnModuleInit } from '@nestjs/common';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { ToolRegistryService } from '../tool-registry';
import {
    ToolExecutionError,
    type ToolConfirmationContext,
    type ToolConfirmationRequest,
    type ToolDefinition,
    type ToolExecutionContext,
    type ToolExecutionResult,
} from '../tool.types';

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * create_knowledge_base 工具执行器（块 7c 扩展）：在用户明确要求创建知识库时，
 * 以用户确认的名称与说明创建知识库（创建者自动成为 MANAGER）。只做参数校验与
 * 业务调用；权限、批准与额度由 ToolRegistry/ToolPolicy 统一处理，禁止在执行器内
 * 重复实现。红线写入描述：无明确创建意图不调用、名称与说明须经用户确认。
 */
@Injectable()
export class CreateKnowledgeBaseTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly knowledgeService: KnowledgeService,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'create_knowledge_base',
        version: '1.0.0',
        displayName: '创建知识库',
        description: '在当前用户所属租户内创建新的知识库，创建后当前用户自动成为该库管理员（MANAGER）。'
            + '仅在用户明确要求创建/新建知识库时调用；name 与 description 必须来自用户表达或经用户确认，'
            + '不得替用户编造。同一租户内知识库名称不能重复，重名会被拒绝：此时应问用户换一个名称，'
            + '而不是重复提交同一个名称。创建成功后可用 save_to_knowledge 把对话内容存入新库。'
            + '本工具不会立即写入：系统会让用户在对话中确认参数后再执行。',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '知识库名称，必须经用户确认',
                },
                description: {
                    type: 'string',
                    description: '知识库说明，可选；省略时为空',
                },
            },
            required: ['name'],
            additionalProperties: false,
        },
        requiredPermissions: ['knowledge_base.create'],
        riskLevel: 'WRITE',
        validate: validateCreateKnowledgeBaseArguments,
        /**
         * 写操作确认：知识库属于组织可见的业务对象，创建后会被其他成员看到，
         * 因此不直接落库，先把参数与预览交给用户确认（与其他 WRITE 工具一致）。
         */
        buildConfirmation: (context, input) => this.buildConfirmation(context, input),
        execute: (context, input) => this.executeCreate(context, input),
    };

    /**
     * 生成确认预览前先做名称可用性预检。
     *
     * 抛 ToolExecutionError 而不是通用 Error：toToolFailure 对通用错误只会给
     * 模型一句「请稍后重试」，模型不会去问用户要新名称；这里需要把「重名」
     * 明确告知模型，同时把可执行的文案给用户。
     */
    private async buildConfirmation(
        context: ToolConfirmationContext,
        input: Record<string, unknown>,
    ): Promise<ToolConfirmationRequest> {
        const name = input.name as string;
        const available = await this.knowledgeService.isKnowledgeBaseNameAvailable(context.tenantId, name);
        if (!available) {
            throw new ToolExecutionError(
                'KNOWLEDGE_BASE_NAME_TAKEN',
                `当前租户下已存在同名知识库「${name}」，请换一个名称`,
                '知识库名称已被占用。请告知用户该名称已存在，询问用户换一个名称后重新创建；不要重复提交同一名称。',
            );
        }
        return {
            title: '创建知识库',
            fields: [
                { label: '知识库名称', value: name },
                { label: '知识库说明', value: (input.description as string | undefined) ?? '（未填写）' },
            ],
            summary: `已生成待确认草稿：创建知识库「${name}」。`
                + '请告知用户这一步还没有真正创建，需要用户在对话中确认后才会写入。',
        };
    }

    private async executeCreate(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const knowledgeBase = await this.knowledgeService.createKnowledgeBaseForAssistant({
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            requestId: context.requestId,
            name: input.name as string,
            description: input.description as string | undefined,
        });
        // knowledge_base_id 是后续 save_to_knowledge 的参数引用，必须进模型上下文；
        // 其余只放业务内容（名称），供用户确认创建结果。instruction 同时约束模型
        // 不得把内部标识转述给用户（内部 ID 与权限枚举只用于工具调用）。
        return {
            resourceType: null,
            resourceId: null,
            summary: JSON.stringify({
                type: 'knowledge_base_created',
                knowledge_base_id: knowledgeBase.id,
                name: knowledgeBase.name,
                instruction: '知识库已创建，当前用户是该库管理员。'
                    + '回答用户时只提及知识库名称与创建成功，用「管理员」等中文表述权限，'
                    + '不得向用户展示 knowledge_base_id 或任何权限枚举值（如 MANAGER）。'
                    + '用户想继续把对话内容存入新库时调用 save_to_knowledge 并传对应 knowledge_base_id。',
            }),
            userSummary: `知识库「${knowledgeBase.name}」已创建，你是该知识库的管理员。`,
        };
    }
}

/** 校验并解析模型参数；非法输入抛错，由 ToolPolicy 统一映射为 INVALID_ARGUMENTS 拒绝。 */
function validateCreateKnowledgeBaseArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('工具参数必须为对象');
    }
    const raw = input as Record<string, unknown>;

    if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
        throw new Error('name 必须是非空字符串');
    }
    if (raw.name.length > MAX_NAME_LENGTH) {
        throw new Error(`name 不能超过 ${MAX_NAME_LENGTH} 字符`);
    }
    const parsed: Record<string, unknown> = { name: raw.name.trim() };

    if (raw.description !== undefined && raw.description !== null) {
        if (typeof raw.description !== 'string') {
            throw new Error('description 必须是字符串');
        }
        if (raw.description.length > MAX_DESCRIPTION_LENGTH) {
            throw new Error(`description 不能超过 ${MAX_DESCRIPTION_LENGTH} 字符`);
        }
        const trimmed = raw.description.trim();
        if (trimmed.length > 0) parsed.description = trimmed;
    }
    return parsed;
}
