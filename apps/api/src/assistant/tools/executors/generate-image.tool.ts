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
    version: '1.2.0',
    displayName: '生成图片',
    description: '根据文字描述生成一张图片并保存为正式资源；成功后图片可通过资源接口随时获取。',
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
      // 回喂模型的摘要只放用户关心的信息；不嵌签名 URL、图片 ID、模型名等
      // 内部信息（防模型转述泄露，且历史消息不能依赖会过期的临时地址）；
      // 稳定资源引用仅保留在 resourceType/resourceId 结构化字段中，前端按需
      // 经 GET /v1/images/{imageId} 换取访问 URL。
      summary: `图片已生成（${image.contentType}，约 ${formatSizeMegaBytes(image.sizeBytes)} MB）。`,
    };
  }
}

/** 字节数转 MB 的友好展示，最小 1 MB。 */
function formatSizeMegaBytes(sizeBytes: number): number {
  return Math.max(1, Math.round(sizeBytes / (1024 * 1024)));
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
