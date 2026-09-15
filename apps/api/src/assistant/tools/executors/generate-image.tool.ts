import { Injectable, OnModuleInit } from '@nestjs/common';
import { ImageService } from '../../../image/image.service';
import { ToolRegistryService } from '../tool-registry';
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../tool.types';

const SIZE_VALUES = ['1024x1024', '1536x1024', '1024x1536', 'auto'] as const;
const QUALITY_VALUES = ['standard', 'high'] as const;
const MAX_PROMPT_LENGTH = 4000;

/**
 * generate_image 工具执行器：校验模型参数并调用 ImageService 完成正式落库。
 * 只做参数校验与业务调用；权限、循环、批准与额度由 ToolRegistry/ToolPolicy
 * 统一处理，禁止在执行器内重复实现。
 */
@Injectable()
export class GenerateImageTool implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly imageService: ImageService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.definition);
  }

  private readonly definition: ToolDefinition = {
    name: 'generate_image',
    version: '1.1.0',
    description: '根据文字描述生成一张图片并保存为正式资源；成功返回图片临时访问 URL（有时效性，过期后可通过图片资源重新获取）。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片内容描述，具体明确效果更好' },
        size: {
          type: 'string',
          enum: [...SIZE_VALUES],
          description: '输出尺寸，默认 auto',
        },
        quality: {
          type: 'string',
          enum: [...QUALITY_VALUES],
          description: '生成质量，默认 standard',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    requiredPermissions: ['ai.image.generate'],
    riskLevel: 'EXTERNAL',
    validate: validateGenerateImageArguments,
    execute: (context, input) => this.executeGeneration(context, input),
  };

  private async executeGeneration(
    context: ToolExecutionContext,
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const image = await this.imageService.generateImage({
      tenantId: context.tenantId,
      userId: context.userId,
      membershipId: context.membershipId,
      requestId: context.requestId,
      conversationId: context.conversationId,
      turnId: context.turnId,
      toolCallId: context.toolCallId,
      executionOwner: context.executionOwner,
      executionToken: context.executionToken,
      prompt: input.prompt as string,
      size: input.size as (typeof SIZE_VALUES)[number] | undefined,
      quality: input.quality as (typeof QUALITY_VALUES)[number] | undefined,
    });
    return {
      resourceType: 'IMAGE',
      resourceId: image.imageId,
      resourceUrl: image.url,
      // 回喂模型的摘要只放用户关心的信息：内部标识（图片 ID、模型名）不进回喂文本，
      // 否则模型会原样转述给用户；资源引用仅保留在 resourceType/resourceId/resourceUrl 结构化字段中。
      summary: `图片已生成（${image.contentType}，${image.sizeBytes} 字节），临时访问地址（约 ${Math.max(1, Math.round(image.urlTtlSeconds / 60))} 分钟内有效）：${image.url}`,
    };
  }
}

/** 校验并解析模型参数；非法输入抛错，由 ToolPolicy 统一映射为 INVALID_ARGUMENTS 拒绝。 */
function validateGenerateImageArguments(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('工具参数必须为对象');
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw.prompt !== 'string' || raw.prompt.trim().length === 0) {
    throw new Error('prompt 必须是非空字符串');
  }
  if (raw.prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`prompt 不能超过 ${MAX_PROMPT_LENGTH} 字符`);
  }
  const parsed: Record<string, unknown> = { prompt: raw.prompt.trim() };

  if (raw.size !== undefined && raw.size !== null) {
    if (!SIZE_VALUES.includes(raw.size as (typeof SIZE_VALUES)[number])) {
      throw new Error(`size 必须是 ${SIZE_VALUES.join('/')} 之一`);
    }
    parsed.size = raw.size;
  }
  if (raw.quality !== undefined && raw.quality !== null) {
    if (!QUALITY_VALUES.includes(raw.quality as (typeof QUALITY_VALUES)[number])) {
      throw new Error(`quality 必须是 ${QUALITY_VALUES.join('/')} 之一`);
    }
    parsed.quality = raw.quality;
  }
  return parsed;
}
