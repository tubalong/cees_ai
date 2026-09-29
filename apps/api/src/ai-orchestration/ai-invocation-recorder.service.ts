import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface AiInvocationTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface AiInvocationExecution {
  profile: string;
  provider: string;
  model: string;
  fallbackCount: number;
  latencyMs: number;
  finishReason: string | null;
  tokenUsage: AiInvocationTokenUsage;
}

export interface AiInvocationAttributes {
  mode?: string;
  contextStrategy?: string;
  receivedMessageCount?: number;
  includedMessageCount?: number;
  historyTruncated?: boolean;
  estimatedInputTokens?: number;
  /** 图片生成等工具调用的提示词长度指标。 */
  promptLength?: number;
  /** 文档组合等工具调用的指令长度指标。 */
  instructionLength?: number;
  /** 推荐问题生成返回的问题条数指标。 */
  questionCount?: number;
  /**
   * 任务步骤执行载体的任务 ID；步骤窗口的模型调用以 metadata 记录（不新增列，技术文档 §2.3）。
   */
  taskId?: string;
  /** 任务步骤执行载体的步骤 ID；同上。 */
  stepId?: string;
  outcome?: 'completed' | 'error' | 'cancelled';
  errorCode?: string;
}

export type AiInvocationOperation =
  | 'generic.invoke'
  | 'chat.invoke'
  | 'chat.stream'
  | 'chat.compact'
  | 'chat.tool_turn'
  | 'chat.related_questions'
  | 'image.generate'
  | 'document.compose'
  | 'spreadsheet.compose';

export interface RecordAiInvocationInput {
  tenantId: string;
  userId: string;
  membershipId?: string | null;
  conversationId?: string | null;
  turnId?: string | null;
  requestId: string;
  traceId?: string | null;
  /** 工具执行对应的 ToolCall ID；图片生成等工具调用填写，配合 request_id 做幂等。 */
  toolCallId?: string | null;
  operation: AiInvocationOperation;
  execution: AiInvocationExecution;
  metadata?: AiInvocationAttributes;
}

/**
 * 统一记录 AI 模型调用指标。该服务只接收身份、关联 ID、Token 和执行元数据，
 * 接口中没有消息正文或摘要字段，避免业务模块误把对话内容写入审计指标表。
 */
@Injectable()
export class AiInvocationRecorderService {
  constructor(private readonly prisma: PrismaService) { }

  async record(input: RecordAiInvocationInput): Promise<void> {
    const { execution } = input;
    const metadata: Prisma.InputJsonObject = {
      ...(input.metadata ?? {}),
      profile: execution.profile,
      provider: execution.provider,
      fallbackCount: execution.fallbackCount,
      finishReason: execution.finishReason,
      totalTokens: execution.tokenUsage.totalTokens,
    };

    await this.prisma.aIInvocationLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        membershipId: input.membershipId ?? null,
        conversationId: input.conversationId ?? null,
        turnId: input.turnId ?? null,
        requestId: input.requestId,
        traceId: input.traceId ?? null,
        toolCallId: input.toolCallId ?? null,
        model: execution.model,
        latencyMs: execution.latencyMs,
        inputTokens: execution.tokenUsage.inputTokens,
        outputTokens: execution.tokenUsage.outputTokens,
        operation: input.operation,
        metadata,
      },
    });
  }
}
