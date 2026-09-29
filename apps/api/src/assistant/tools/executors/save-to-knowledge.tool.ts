import { Injectable, OnModuleInit } from '@nestjs/common';
import { KnowledgeDocumentService } from '../../../knowledge/knowledge-document.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

const SOURCE_TYPES = ['FILE_OBJECT', 'DOCUMENT', 'MESSAGE'] as const;
const VISIBILITY_VALUES = ['PRIVATE', 'DEPARTMENT', 'PROJECT', 'TENANT'] as const;
const MAX_NAME_LENGTH = 200;
/**
 * 内联 content 的上限。
 *
 * 这个值不是随便定的：content 是模型以**流式工具参数**形式逐段吐出来的，
 * 受工具调用模型 `default_max_output_tokens`（当前 2048）约束。一旦内容超过输出
 * 预算，JSON 会在中途被截断，整轮直接以「工具参数不是合法 JSON」失败——
 * 历史上 20000 字符的上限永远不可能被模型触达，等于没有限制。
 * 因此这里压到明显低于输出预算，让超长内容在**参数校验**阶段就被拒掉：
 * 那是一条模型能看懂并自我纠正的工具级拒绝，而不是整个轮次崩掉。
 * 长文档必须走 sourceType / sourceId 引用已有资源。
 */
const MAX_CONTENT_LENGTH = 800;

/**
 * save_to_knowledge 工具执行器（块 7c）：把对话资源（附件 / AI 生成文档 / 对话消息）
 * 或模型整理好的内容文本存入用户确认的目标知识库。只做参数校验与业务调用；权限、循环、
 * 批准与额度由 ToolRegistry/ToolPolicy 统一处理，禁止在执行器内重复实现。
 * 三条红线写入描述：无明确存储意图不调用、只引用真实资源 ID、目标库由后端校验 EDITOR。
 * 用户口述要保存的内容（并非已存在的资源）时，模型整理为文本走 content 直存路径。
 */
@Injectable()
export class SaveToKnowledgeTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly knowledgeDocumentService: KnowledgeDocumentService,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'save_to_knowledge',
        version: '1.0.0',
        displayName: '存入知识库',
        description: '把用户指定的对话资源（附件文件、AI 生成文档或对话消息）或模型整理好的内容文本存入用户指定的知识库。'
            + '仅在用户明确表达保存/存入/收录意图时调用；引用已存在资源时用 sourceType 与 sourceId，必须引用真实存在的资源；'
            + '要保存的是一份较长文档（用户上传的附件、AI 生成文档、对话中的长内容）时，必须用 sourceType/sourceId 引用它，'
            + '绝不要把文档正文改写成 content——工具参数的输出预算装不下长文档，会因中途截断而整轮失败；'
            + '只有当用户口述了一段较短内容（几百字以内）要保存时，才把它整理为纯文本通过 content 传入；'
            + '目标知识库须经用户确认（可先用 list_knowledge_bases 列出候选库），绝不替用户挑选。',
        parameters: {
            type: 'object',
            properties: {
                sourceType: {
                    type: 'string',
                    enum: [...SOURCE_TYPES],
                    description: '来源类型：FILE_OBJECT 附件文件，DOCUMENT AI 生成文档，MESSAGE 对话消息；与 sourceId 成对使用，不能与 content 同时提供',
                },
                sourceId: {
                    type: 'string',
                    description: '来源资源 ID（附件文件 ID / 生成文档 ID / 对话消息 ID），必须引用已存在的资源',
                },
                content: {
                    type: 'string',
                    description: `用户口述、需要保存的短文本内容（不超过 ${MAX_CONTENT_LENGTH} 字符）；`
                        + '保存已有文档或附件时不要使用该参数，改用 sourceType/sourceId 引用；'
                        + '与 sourceType/sourceId 二选一，不能同时提供',
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
            required: ['knowledgeBaseId'],
            additionalProperties: false,
        },
        requiredPermissions: ['knowledge_base.read'],
        riskLevel: 'WRITE',
        validate: validateSaveToKnowledgeArguments,
        execute: (context, input) => this.executeSave(context, input),
    };

    private async executeSave(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const actor = {
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            permissions: context.permissions,
            requestId: context.requestId,
            // 工具红线：MESSAGE 来源必须属于当前会话，不允许跨会话引用。
            conversationId: context.conversationId,
        };
        const document = typeof input.content === 'string'
            ? await this.knowledgeDocumentService.saveDirectContent(actor, {
                knowledgeBaseId: input.knowledgeBaseId as string,
                content: input.content,
                name: input.name as string | undefined,
                visibilityScope: input.visibilityScope as (typeof VISIBILITY_VALUES)[number],
                departmentId: input.departmentId as string | undefined,
                projectId: input.projectId as string | undefined,
            })
            : await this.knowledgeDocumentService.saveFromSource(actor, {
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

    if (typeof raw.knowledgeBaseId !== 'string' || raw.knowledgeBaseId.trim().length === 0) {
        throw new Error('knowledgeBaseId 必须是非空字符串');
    }
    const hasSourceType = raw.sourceType !== undefined && raw.sourceType !== null;
    const hasSourceId = typeof raw.sourceId === 'string' && raw.sourceId.trim().length > 0;
    const hasContent = typeof raw.content === 'string' && raw.content.trim().length > 0;
    // 两条路径二选一：引用已存在资源（sourceType+sourceId），或直存整理后的内容文本。
    if (hasSourceType !== hasSourceId) {
        throw new Error('sourceType 与 sourceId 必须成对提供');
    }
    if (hasSourceType === hasContent) {
        throw new Error('sourceType/sourceId 与 content 必须且只能提供一组');
    }
    const parsed: Record<string, unknown> = {
        knowledgeBaseId: raw.knowledgeBaseId.trim(),
    };
    if (hasSourceType) {
        if (!SOURCE_TYPES.includes(raw.sourceType as (typeof SOURCE_TYPES)[number])) {
            throw new Error(`sourceType 必须是 ${SOURCE_TYPES.join('/')} 之一`);
        }
        parsed.sourceType = raw.sourceType;
        parsed.sourceId = (raw.sourceId as string).trim();
    } else {
        const content = (raw.content as string).trim();
        if (content.length > MAX_CONTENT_LENGTH) {
            // 提示必须是模型能据此改药的措辞：告诉它改用引用路径，而不是只报“超长”。
            throw new Error(
                `content 不能超过 ${MAX_CONTENT_LENGTH} 字符（当前 ${content.length}）。`
                + '要保存的是较长文档时，请改用 sourceType/sourceId 引用已存在的附件、生成文档或对话消息；'
                + '若确实需要保存长文本，请先按内容生成文档，再引用该文档。',
            );
        }
        parsed.content = content;
    }

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
