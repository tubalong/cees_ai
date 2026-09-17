import { Injectable, OnModuleInit } from '@nestjs/common';
import { KnowledgeDocumentService } from '../../../knowledge/knowledge-document.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

const SOURCE_TYPES = ['FILE_OBJECT', 'DOCUMENT', 'MESSAGE'] as const;
const VISIBILITY_VALUES = ['PRIVATE', 'DEPARTMENT', 'PROJECT', 'TENANT'] as const;
const MAX_NAME_LENGTH = 200;

/**
 * save_to_knowledge 工具执行器（块 7c）：把对话中已存在的资源（附件 / AI 生成文档 /
 * 对话消息）转存到用户确认的目标知识库。只做参数校验与业务调用；权限、循环、批准与
 * 额度由 ToolRegistry/ToolPolicy 统一处理，禁止在执行器内重复实现。
 * 三条红线写入描述：无明确存储意图不调用、只引用真实资源 ID、目标库由后端校验 EDITOR。
 */
@Injectable()
export class SaveToKnowledgeTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly knowledgeDocumentService: KnowledgeDocumentService,
    ) {}

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'save_to_knowledge',
        version: '1.0.0',
        displayName: '存入知识库',
        description: '把用户指定的对话资源（附件文件、AI 生成文档或对话消息）存入用户指定的知识库。'
            + '仅在用户明确表达保存/存入/收录意图时调用；sourceType 与 sourceId 必须引用已存在的真实资源；'
            + '目标知识库须经用户确认（可先用 list_knowledge_bases 列出候选库），绝不替用户挑选。',
        parameters: {
            type: 'object',
            properties: {
                sourceType: {
                    type: 'string',
                    enum: [...SOURCE_TYPES],
                    description: '来源类型：FILE_OBJECT 附件文件，DOCUMENT AI 生成文档，MESSAGE 对话消息',
                },
                sourceId: {
                    type: 'string',
                    description: '来源资源 ID（附件文件 ID / 生成文档 ID / 对话消息 ID），必须引用已存在的资源',
                },
                knowledgeBaseId: {
                    type: 'string',
                    description: '目标知识库 ID，必须是当前用户有编辑权限（EDITOR）的知识库',
                },
                name: {
                    type: 'string',
                    description: '存入后的文档名称；省略时沿用来源资源名称',
                },
                visibilityScope: {
                    type: 'string',
                    enum: [...VISIBILITY_VALUES],
                    description: '可见范围：PRIVATE 仅知识库成员，DEPARTMENT 部门，PROJECT 项目，TENANT 租户全部成员；默认 PRIVATE',
                },
                departmentId: {
                    type: 'string',
                    description: '可见范围为 DEPARTMENT 时必填的部门 ID',
                },
                projectId: {
                    type: 'string',
                    description: '可见范围为 PROJECT 时必填的项目 ID',
                },
            },
            required: ['sourceType', 'sourceId', 'knowledgeBaseId'],
            additionalProperties: false,
        },
        requiredPermissions: ['knowledge_base.document.manage'],
        riskLevel: 'WRITE',
        validate: validateSaveToKnowledgeArguments,
        execute: (context, input) => this.executeSave(context, input),
    };

    private async executeSave(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const document = await this.knowledgeDocumentService.saveFromSource({
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            permissions: context.permissions,
            requestId: context.requestId,
            // 工具红线：MESSAGE 来源必须属于当前会话，不允许跨会话引用。
            conversationId: context.conversationId,
        }, {
            knowledgeBaseId: input.knowledgeBaseId as string,
            sourceType: input.sourceType as (typeof SOURCE_TYPES)[number],
            sourceId: input.sourceId as string,
            name: input.name as string | undefined,
            visibilityScope: input.visibilityScope as (typeof VISIBILITY_VALUES)[number],
            departmentId: input.departmentId as string | undefined,
            projectId: input.projectId as string | undefined,
        });
        return {
            resourceType: null,
            resourceId: null,
            // 回喂模型的摘要只放业务内容（文档名称与处理状态）；内部标识不进回喂文本，
            // 否则模型会原样转述给用户。
            summary: `已存入知识库：文档《${document.name}》正在解析索引，处理完成后即可被知识库检索引用。`,
        };
    }
}

/** 校验并解析模型参数；非法输入抛错，由 ToolPolicy 统一映射为 INVALID_ARGUMENTS 拒绝。 */
function validateSaveToKnowledgeArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('工具参数必须为对象');
    }
    const raw = input as Record<string, unknown>;

    if (!SOURCE_TYPES.includes(raw.sourceType as (typeof SOURCE_TYPES)[number])) {
        throw new Error(`sourceType 必须是 ${SOURCE_TYPES.join('/')} 之一`);
    }
    if (typeof raw.sourceId !== 'string' || raw.sourceId.trim().length === 0) {
        throw new Error('sourceId 必须是非空字符串');
    }
    if (typeof raw.knowledgeBaseId !== 'string' || raw.knowledgeBaseId.trim().length === 0) {
        throw new Error('knowledgeBaseId 必须是非空字符串');
    }
    const parsed: Record<string, unknown> = {
        sourceType: raw.sourceType,
        sourceId: raw.sourceId.trim(),
        knowledgeBaseId: raw.knowledgeBaseId.trim(),
    };

    if (raw.name !== undefined && raw.name !== null) {
        if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
            throw new Error('name 必须是非空字符串');
        }
        if (raw.name.length > MAX_NAME_LENGTH) {
            throw new Error(`name 不能超过 ${MAX_NAME_LENGTH} 字符`);
        }
        parsed.name = raw.name.trim();
    }
    if (raw.visibilityScope !== undefined && raw.visibilityScope !== null) {
        if (!VISIBILITY_VALUES.includes(raw.visibilityScope as (typeof VISIBILITY_VALUES)[number])) {
            throw new Error(`visibilityScope 必须是 ${VISIBILITY_VALUES.join('/')} 之一`);
        }
        parsed.visibilityScope = raw.visibilityScope;
    } else {
        parsed.visibilityScope = 'PRIVATE';
    }
    if (raw.departmentId !== undefined && raw.departmentId !== null) {
        if (typeof raw.departmentId !== 'string' || raw.departmentId.trim().length === 0) {
            throw new Error('departmentId 必须是非空字符串');
        }
        parsed.departmentId = raw.departmentId.trim();
    }
    if (raw.projectId !== undefined && raw.projectId !== null) {
        if (typeof raw.projectId !== 'string' || raw.projectId.trim().length === 0) {
            throw new Error('projectId 必须是非空字符串');
        }
        parsed.projectId = raw.projectId.trim();
    }
    return parsed;
}
