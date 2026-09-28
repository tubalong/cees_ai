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
 * insert_document_image 工具执行器：把本轮对话里已有的一张图片，插入到本会话内
 * 某份「AI 生成文档」的指定章节末尾。它只做参数校验、把本轮图片解析为稳定引用，
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
            '把本条消息中已有的图片插入到本会话某份已生成文档的指定章节末尾，正文保持不变。'
            + '图片来自用户本轮上传的附件或本轮船次刚生成的图片；不适用于新建文档。'
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
                    description: '使用本轮第几张图片（从 1 开始）；省略时使用本轮最后一张图片',
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
        // 本工具依赖「本轮上传或生成的图片」；任务步骤执行窗口没有轮次输入，
        // 工具面已排除 WRITE 工具，这里兜底防御绕过（模型编造调用时拒绝）。
        if (context.turnId === null) {
            throw new ToolExecutionError(
                'TURN_INPUT_REQUIRED',
                'insert_document_image requires an active turn with image references',
                '插入图片需要基于当前消息中的图片。请告知用户：在对话中上传或生成图片后重试。',
            );
        }
        const imageObjectKey = await this.resolveImageObjectKey(
            context,
            context.turnId,
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

    /** 把模型给出的 1-based 图片序号解析为本轮图片的稳定对象键。 */
    private async resolveImageObjectKey(
        context: ToolExecutionContext,
        turnId: string,
        imageIndex: number | undefined,
    ): Promise<string> {
        const references = await this.messageContent.resolveTurnImageReferences(turnId, {
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            requestId: context.requestId,
        });
        if (references.length === 0) {
            throw new Error('本条消息没有可供插入的图片，请先上传图片或先生成一张图片');
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

    return parsed;
}
