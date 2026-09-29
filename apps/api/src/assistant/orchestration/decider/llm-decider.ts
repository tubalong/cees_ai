import { Injectable, Logger } from '@nestjs/common';
import type { InvokeRequest, InvokeResponse } from '@cees/ai-service-client';
import { AiServiceGateway } from '../../../ai-orchestration/ai-service-gateway.service';
import { SUFFICIENCY_CHOICES, type Decision, type DecisionInput } from './decider.types';

/** 结构化输出约束名（JSON Schema 校验 + 失败重试一次，技术设计 §6.2）。 */
const DECISION_SCHEMA_NAME = 'orchestration_decision';
/** 单次判定的输出上限：选项 + 置信度 + 一句理由，不需要长文本。 */
const DECISION_MAX_OUTPUT_TOKENS = 512;
/** 理由字段截断上限（展示与审计）。 */
const MAX_RATIONALE_CHARS = 500;

/**
 * LLM 路径（技术设计 §6.2：模糊场景）。走 ai-service 通用 invoke 接口与
 * `orchestration_decision` 模型角色，结构化输出 { choice, confidence, rationale }；
 * 解析 / 校验失败重试一次，仍失败抛错由装配层兜底。本服务不做分流，
 * 原始决策由工厂按置信度阈值裁决。
 */
@Injectable()
export class LlmDeciderService {
  private readonly logger = new Logger(LlmDeciderService.name);

  constructor(private readonly gateway: AiServiceGateway) { }

  async decide(input: DecisionInput): Promise<Decision> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.invoke(input, attempt);
        return toDecision(response);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `orchestration decision invocation failed (attempt ${attempt + 1}): ${String(error)}`,
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`orchestration decision failed: ${String(lastError)}`);
  }

  private invoke(input: DecisionInput, attempt: number): Promise<InvokeResponse> {
    const request: InvokeRequest = {
      request_id: `${input.context.requestId}:decider:${attempt}`,
      tenant_id: input.context.tenantId,
      user_id: input.context.userId,
      role: 'orchestration_decision',
      temperature: 0,
      max_output_tokens: DECISION_MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: [{ type: 'text', text: buildSystemPrompt() }] },
        { role: 'user', content: [{ type: 'text', text: buildUserContent(input) }] },
      ],
      response_format: {
        type: 'json_schema',
        name: DECISION_SCHEMA_NAME,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['choice', 'confidence', 'rationale'],
          properties: {
            choice: { type: 'string', enum: [...SUFFICIENCY_CHOICES] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            rationale: { type: 'string', maxLength: MAX_RATIONALE_CHARS },
          },
        },
      },
    };
    return this.gateway.invoke(request);
  }
}

function buildSystemPrompt(): string {
  return [
    '你是企业 AI 任务编排的决策器，只做原子判断，不生成给用户的文案，不执行任务。',
    '当前判定类型：SUFFICIENCY_CHECK（信息充分性）——判断执行同事是否必须向用户提问。',
    '判定标准：缺少关键信息、存在歧义或必须由用户拍板（两类方案都可行）→ 选择 ask_user；',
    '信息可从已有上下文合理推断、可用安全默认值继续、或属确认性提问 → 选择 proceed。',
    '只输出结构化结果：choice、confidence（0~1 的把握程度）、rationale（一句中文理由）。',
  ].join('');
}

function buildUserContent(input: DecisionInput): string {
  const payload = {
    decisionType: input.decisionType,
    taskGoal: input.taskSnapshot.goal,
    steps: input.taskSnapshot.steps.map((step) => ({
      stepKey: step.stepKey,
      title: step.title,
      status: step.status,
      summary: step.summary,
    })),
    currentStep: input.stepResult
      ? {
        stepKey: input.stepResult.stepKey,
        stepTitle: input.stepResult.stepTitle,
        summary: input.stepResult.summary,
      }
      : null,
    question: input.stepResult?.question ?? null,
  };
  return `判定输入（JSON）：\n${JSON.stringify(payload)}`;
}

/** 解析模型输出；形状不符抛错（由调用层按「失败重试一次」处理）。 */
function toDecision(response: InvokeResponse): Decision {
  if (response.output.type !== 'json') {
    throw new Error('orchestration decision returned non-json output');
  }
  const value = response.output.value;
  if (!isRecord(value)) {
    throw new Error('orchestration decision output is not an object');
  }
  const choice = value.choice;
  if (typeof choice !== 'string' || !(SUFFICIENCY_CHOICES as readonly string[]).includes(choice)) {
    throw new Error(`orchestration decision returned unknown choice: ${String(choice)}`);
  }
  const confidence = value.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`orchestration decision returned invalid confidence: ${String(confidence)}`);
  }
  const rationale = typeof value.rationale === 'string' ? value.rationale.trim() : '';
  return {
    choice,
    confidence,
    ...(rationale ? { rationale: truncate(rationale, MAX_RATIONALE_CHARS) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
