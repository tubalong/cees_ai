import { Injectable, OnModuleInit } from '@nestjs/common';
import { DocumentService } from '../../../document/document.service';
import { AssistantMessageContentService } from '../../runtime/message-content.service';
import { ToolRegistryService } from '../tool-registry';
import {
    ToolExecutionError,
    type ToolDefinition,
    type ToolExecutionContext,
    type ToolExecutionResult,
} from '../tool.types';

const MAX_CAPTION_LENGTH = 300;
const MAX_TITLE_LENGTH = 200;

/**
 * insert_document_image 工具执行器：把当前会话里已有的一张图片，插入到本会话内
 * 某份「AI 生成文档」的指定章节末尾。它只做参数校验、把会话图片解析为稳定引用，
 * 再调用 DocumentService 完成落库；正文与既有块完全不被改写。权限、循环、批准
 * 与额度由 ToolRegistry/ToolPolicy 统一处理，禁止在执行器内重复实现。
 */
@Injectable()
export class InsertDocumentImageTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly documentService: DocumentService,
        private readonly messageContent: AssistantMessageContentService,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'insert_document_image',
        version: '1.0.0',
        displayName: '在文档章节插入图片',
        description:
            '把当前会话中已有的图片插入到本会话某份已生成文档的指定章节末尾，正文保持不变。'
            + '图片可以来自当前或历史轮次的用户上传附件，也可以是当前会话早前生成的图片；不适用于新建文档。'
            + '系统会在 instructions 中提供当前会话可用图片清单；优先用 image_file_id 精确引用。'
            + '省略 section_title 时插入到最后一节末尾。',
        parameters: {
            type: 'object',
            properties: {
                section_title: {
                    type: 'string',
                    description: '目标章节标题；省略时插入到最后一节末尾',
                },
                caption: {
                    type: 'string',
                    description: '图注文字；省略时不显示图注',
                },
                image_index: {
                    type: 'integer',
                    minimum: 1,
                    description: '使用会话图片清单中的第几张图片（从 1 开始）；省略时使用会话最近一张图片',
                },
                image_file_id: {
                    type: 'string',
                    description: '会话图片清单中的稳定图片文件 ID；与 image_index 二选一，优先使用该参数精确选择',
                },
                document_title: {
                    type: 'string',
                    description: '目标文档标题；本会话存在多份生成文档时用于消歧，省略时使用最近生成的一份',
                },
            },
            required: [],
            additionalProperties: false,
        },
        requiredPermissions: ['ai.document.generate'],
        riskLevel: 'WRITE',
        validate: validateInsertDocumentImageArguments,
        execute: (context, input) => this.executeInsertion(context, input),
    };

    private async executeInsertion(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        // 本工具依赖当前会话中的图片；任务步骤执行窗口没有轮次输入，
        // 工具面已排除 WRITE 工具，这里兜底防御绕过（模型编造调用时拒绝）。
        if (context.turnId === null) {
            throw new ToolExecutionError(
                'TURN_INPUT_REQUIRED',
                'insert_document_image requires an active turn with image references',
                '插入图片需要基于当前会话中的图片。请告知用户：在对话中上传或生成图片后重试。',
            );
        }
        const imageObjectKey = await this.resolveImageObjectKey(
            context,
            input.image_file_id as string | undefined,
            input.image_index as number | undefined,
        );
        const result = await this.documentService.insertDocumentImage({
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            requestId: context.requestId,
            conversationId: context.conversationId,
            turnId: context.turnId,
            toolCallId: context.toolCallId,
            executionOwner: context.executionOwner,
            executionToken: context.executionToken,
            imageObjectKey,
            sectionTitle: input.section_title as string | undefined,
            caption: input.caption as string | undefined,
            documentTitle: input.document_title as string | undefined,
        });
        return {
            resourceType: 'DOCUMENT',
            resourceId: result.documentId,
            // 回喂模型的摘要只放用户关心的信息；文档 ID、对象键等内部信息不进上下文，
            // 稳定资源引用仅保留在 resourceType/resourceId 结构化字段中。
            summary: `已在《${result.title}》的「${result.sectionHeading}」章节末尾插入图片（${result.format.toUpperCase()}），正文未改动。`,
        };
    }

    /** 把模型给出的稳定文件 ID 或 1-based 会话图片序号解析为对象键。 */
    private async resolveImageObjectKey(
        context: ToolExecutionContext,
        imageFileId: string | undefined,
        imageIndex: number | undefined,
    ): Promise<string> {
        const references = await this.messageContent.resolveConversationImageReferences(context.conversationId, {
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            requestId: context.requestId,
        });
        if (references.length === 0) {
            throw new Error('当前会话没有可供插入的图片，请先上传图片或生成一张图片');
        }
        if (imageFileId) {
            const selected = references.find((reference) => reference.fileId === imageFileId);
            if (!selected) {
                throw new Error('image_file_id 不属于当前会话或图片已不可用');
            }
            return selected.objectKey;
        }
        const index = imageIndex ?? references.length;
        if (index < 1 || index > references.length) {
            throw new Error(`image_index 必须在 1 到 ${references.length} 之间`);
        }
        return references[index - 1].objectKey;
    }
}

/** 校验并解析模型参数；非法输入抛错，由 ToolPolicy 统一映射为 INVALID_ARGUMENTS 拒绝。 */
function validateInsertDocumentImageArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('工具参数必须为对象');
    }
    const raw = input as Record<string, unknown>;
    const parsed: Record<string, unknown> = {};

    for (const key of ['section_title', 'document_title'] as const) {
        const value = raw[key];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`${key} 必须是非空字符串`);
        }
        if (value.length > MAX_TITLE_LENGTH) {
            throw new Error(`${key} 不能超过 ${MAX_TITLE_LENGTH} 字符`);
        }
        parsed[key] = value.trim();
    }

    if (raw.caption !== undefined && raw.caption !== null) {
        if (typeof raw.caption !== 'string' || raw.caption.trim().length === 0) {
            throw new Error('caption 必须是非空字符串');
        }
        if (raw.caption.length > MAX_CAPTION_LENGTH) {
            throw new Error(`caption 不能超过 ${MAX_CAPTION_LENGTH} 字符`);
        }
        parsed.caption = raw.caption.trim();
    }

    if (raw.image_index !== undefined && raw.image_index !== null) {
        const value = raw.image_index;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
            throw new Error('image_index 必须是不小于 1 的整数');
        }
        parsed.image_index = value;
    }

    if (raw.image_file_id !== undefined && raw.image_file_id !== null) {
        if (typeof raw.image_file_id !== 'string' || raw.image_file_id.trim().length === 0) {
            throw new Error('image_file_id 必须是非空字符串');
        }
        parsed.image_file_id = raw.image_file_id.trim();
    }
    if (parsed.image_index !== undefined && parsed.image_file_id !== undefined) {
        throw new Error('image_file_id 与 image_index 只能提供一个');
    }

    return parsed;
}
