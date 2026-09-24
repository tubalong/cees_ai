import { DocumentVisibility } from '@prisma/client';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DocumentService } from '../../../document/document.service';
import { AssistantMessageContentService } from '../../runtime/message-content.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

const VISIBILITY_VALUES = [DocumentVisibility.PRIVATE, DocumentVisibility.TENANT] as const;
const MAX_INSTRUCTION_LENGTH = 8000;
const MAX_TITLE_LENGTH = 200;

type DocumentFormat = 'docx' | 'pdf' | 'pptx' | 'xlsx';

interface FormatDescriptor {
  format: DocumentFormat;
  name: string;
  displayName: string;
  description: string;
  summary: (title: string, length: number) => string;
}

const FORMATS: Record<DocumentFormat, FormatDescriptor> = {
  docx: {
    format: 'docx',
    name: 'generate_docx',
    displayName: '生成 DOCX 文档',
    description: '根据指令生成一份结构化文档并保存到文档库，可导出为 DOCX；成功返回文档标题与篇幅。',
    summary: (title, length) => `DOCX 文档已生成：《${title}》（共 ${length} 字）`,
  },
  pdf: {
    format: 'pdf',
    name: 'generate_pdf',
    displayName: '生成 PDF 文档',
    description: '根据指令生成一份结构化文档并保存到文档库，可导出为 PDF；成功返回文档标题与篇幅。',
    summary: (title, length) => `PDF 文档已生成：《${title}》（共 ${length} 字）`,
  },
  pptx: {
    format: 'pptx',
    name: 'generate_pptx',
    displayName: '生成 PPTX 演示',
    description: '根据指令生成一份结构化演示文稿并保存到文档库，可导出为 PPTX；成功返回标题与篇幅。',
    summary: (title, length) => `PPTX 演示已生成：《${title}》（共 ${length} 字）`,
  },
  xlsx: {
    format: 'xlsx',
    name: 'generate_xlsx',
    displayName: '生成 XLSX 表格',
    description: '根据本轮上传的 Excel/CSV 与用户修改指令生成一份新的 XLSX 文件；不会覆盖原文件。',
    summary: (title, length) => `XLSX 表格已生成：《${title}》（预览共 ${length} 字）`,
  },
};

/**
 * generate_docx / generate_pdf / generate_pptx 三个独立工具执行器：
 * 校验模型参数并调用 DocumentService 完成正式落库（DocumentSpec + Markdown）。
 * 只做参数校验与业务调用；权限、循环、批准与额度由 ToolRegistry/ToolPolicy
 * 统一处理，禁止在执行器内重复实现。
 */
@Injectable()
export class GenerateDocumentTool implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly documentService: DocumentService,
    private readonly messageContent: AssistantMessageContentService,
  ) { }

  onModuleInit(): void {
    for (const format of Object.values(FORMATS)) {
      this.registry.register(this.definitionFor(format));
    }
  }

  private definitionFor(format: FormatDescriptor): ToolDefinition {
    return {
      name: format.name,
      version: '1.3.0',
      displayName: format.displayName,
      description: format.description,
      parameters: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: '文档生成指令，描述主题、用途、结构与要点' },
          title: { type: 'string', description: '期望的文档标题；省略时由 AI 自行拟定' },
          visibility: {
            type: 'string',
            enum: [...VISIBILITY_VALUES],
            description: '可见范围：PRIVATE 仅本人可见，TENANT 租户内可见；默认 PRIVATE',
          },
        },
        required: ['instruction'],
        additionalProperties: false,
      },
      requiredPermissions: ['ai.document.generate'],
      riskLevel: 'EXTERNAL',
      validate: validateGenerateDocumentArguments,
      execute: (context, input) => this.executeGeneration(context, input, format),
    };
  }

  private async executeGeneration(
    context: ToolExecutionContext,
    input: Record<string, unknown>,
    format: FormatDescriptor,
  ): Promise<ToolExecutionResult> {
    const command = {
      tenantId: context.tenantId,
      userId: context.userId,
      membershipId: context.membershipId,
      requestId: context.requestId,
      conversationId: context.conversationId,
      turnId: context.turnId,
      toolCallId: context.toolCallId,
      executionOwner: context.executionOwner,
      executionToken: context.executionToken,
      instruction: input.instruction as string,
      title: input.title as string | undefined,
      visibility: input.visibility as (typeof VISIBILITY_VALUES)[number],
      format: format.format,
    } as const;
    const document = format.format === 'xlsx'
      ? await this.documentService.createGeneratedSpreadsheet({
        ...command,
        sourceMaterials: await this.messageContent.resolveTurnDocumentSourceMaterials(
          context.turnId,
          {
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            requestId: context.requestId,
          },
        ),
      })
      : await this.documentService.createGeneratedDocument({
        ...command,
        format: format.format as Exclude<DocumentFormat, 'xlsx'>,
      });
    return {
      resourceType: 'DOCUMENT',
      resourceId: document.documentId,
      // 回喂模型的摘要只放用户关心的信息：内部标识（文档 ID、模型名）不进回喂文本，
      // 否则模型会原样转述给用户；资源引用仅保留在 resourceType/resourceId 结构化字段中。
      summary: format.summary(document.title, document.contentLength),
    };
  }
}

/** 校验并解析模型参数；非法输入抛错，由 ToolPolicy 统一映射为 INVALID_ARGUMENTS 拒绝。 */
function validateGenerateDocumentArguments(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('工具参数必须为对象');
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw.instruction !== 'string' || raw.instruction.trim().length === 0) {
    throw new Error('instruction 必须是非空字符串');
  }
  if (raw.instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new Error(`instruction 不能超过 ${MAX_INSTRUCTION_LENGTH} 字符`);
  }
  const parsed: Record<string, unknown> = { instruction: raw.instruction.trim() };

  if (raw.title !== undefined && raw.title !== null) {
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
      throw new Error('title 必须是非空字符串');
    }
    if (raw.title.length > MAX_TITLE_LENGTH) {
      throw new Error(`title 不能超过 ${MAX_TITLE_LENGTH} 字符`);
    }
    parsed.title = raw.title.trim();
  }
  if (raw.visibility !== undefined && raw.visibility !== null) {
    if (!VISIBILITY_VALUES.includes(raw.visibility as (typeof VISIBILITY_VALUES)[number])) {
      throw new Error(`visibility 必须是 ${VISIBILITY_VALUES.join('/')} 之一`);
    }
    parsed.visibility = raw.visibility;
  } else {
    parsed.visibility = DocumentVisibility.PRIVATE;
  }
  return parsed;
}
