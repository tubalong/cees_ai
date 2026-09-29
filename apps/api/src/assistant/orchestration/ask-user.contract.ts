import type { ChatToolDefinition } from '@cees/ai-service-client';
import { ToolExecutionError } from '../tools/tool.types';
import type { PublicTaskInteractionOption } from './orchestration.types';

/**
 * 协议工具 ask_user：任务步骤向用户提问 / 请求裁决的统一入口。
 * 不注册 ToolRegistry（不依赖企业权限），由 step-runner 全生命周期处理：
 * 参数校验 → 决策器判定必要性（防滥用）→ 创建 QUESTION / DECISION 挂起；
 * 答复经交互解决注入步骤窗口，步骤断点续跑（技术设计 §6.2 / §7.2）。
 */
export const ASK_USER_TOOL_NAME = 'ask_user';

const MAX_QUESTION_CHARS = 1000;
const MAX_REASON_CHARS = 1000;
const MAX_OPTION_ID_CHARS = 64;
const MAX_OPTION_LABEL_CHARS = 200;
const MAX_OPTION_DESCRIPTION_CHARS = 500;
/** 候选项上限（与交互 payload 的 MAX_OPTIONS 对齐）。 */
const MAX_ASK_USER_OPTIONS = 10;

/** question 未给候选项时的兜底项：自由填写。 */
const FREE_FORM_OPTION: PublicTaskInteractionOption = { id: 'custom', label: '由用户直接填写' };

/** ask_user 参数解析结果（kind=question 信息澄清 / kind=decision 方案裁决）。 */
export interface AskUserArguments {
  kind: 'question' | 'decision';
  /** 展示给用户的问题 / 分岔说明。 */
  question: string;
  /** 提问背景（为什么需要用户介入）；可空。 */
  reason: string | null;
  /** 候选项：question 缺省时服务端注入自由填写兜底项；decision 至少 2 个。 */
  options: PublicTaskInteractionOption[];
}

/** 发给模型的协议工具定义（parameters 为 JSON Schema）。 */
export function buildAskUserToolDefinition(): ChatToolDefinition {
  return {
    name: ASK_USER_TOOL_NAME,
    description:
      '向用户提问或请求拍板。缺少关键信息、存在歧义、或必须由用户在多个方案间选择时调用；'
      + '同一问题只问一次；可从上下文推断或可用安全默认值解决的问题不要打扰用户。'
      + '调用后本步骤挂起等待用户答复，答复会自动回到执行窗口继续本步骤。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'question'],
      properties: {
        kind: {
          type: 'string',
          enum: ['question', 'decision'],
          description: 'question=需要用户提供信息；decision=需要用户在多个方案间拍板',
        },
        question: {
          type: 'string',
          maxLength: MAX_QUESTION_CHARS,
          description: '问题文本或分岔说明（将展示给用户）',
        },
        reason: {
          type: 'string',
          maxLength: MAX_REASON_CHARS,
          description: '提问背景：为什么需要用户介入（可选）',
        },
        options: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_ASK_USER_OPTIONS,
          description: '候选项；decision 至少 2 个，question 无法枚举时可省略（服务端补充自由填写项）',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'label'],
            properties: {
              id: { type: 'string', maxLength: MAX_OPTION_ID_CHARS, description: '候选的稳定标识（英文短语）' },
              label: { type: 'string', maxLength: MAX_OPTION_LABEL_CHARS, description: '候选展示名' },
              description: {
                type: 'string',
                maxLength: MAX_OPTION_DESCRIPTION_CHARS,
                description: '候选补充说明（可选）',
              },
            },
          },
        },
      },
    },
  };
}

/** 解析 / 校验模型给出的 ask_user 参数；非法抛 ToolExecutionError（调用方映射为工具拒绝）。 */
export function parseAskUserArguments(value: unknown): AskUserArguments {
  if (!isRecord(value)) throw invalid('提问参数必须是对象');
  const kind = value.kind;
  if (kind !== 'question' && kind !== 'decision') {
    throw invalid('kind 必须为 question 或 decision');
  }
  const question = readText(value.question, MAX_QUESTION_CHARS);
  if (!question) throw invalid('提问内容不能为空');
  const reason = readText(value.reason, MAX_REASON_CHARS);
  const options = parseOptions(value.options);
  if (kind === 'decision' && options.length < 2) {
    throw invalid('裁决必须携带至少两个候选项');
  }
  return {
    kind,
    question,
    reason,
    options: options.length > 0 ? options : [FREE_FORM_OPTION],
  };
}

/** 候选项解析：忽略重复 id 与空 label 的条目；未知形状按非法处理。 */
function parseOptions(value: unknown): PublicTaskInteractionOption[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('options 必须是数组');
  const seen = new Set<string>();
  const options: PublicTaskInteractionOption[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) throw invalid('候选项必须是对象');
    const id = readText(entry.id, MAX_OPTION_ID_CHARS);
    const label = readText(entry.label, MAX_OPTION_LABEL_CHARS);
    if (!id || !label) throw invalid('候选项必须携带 id 与 label');
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({
      id,
      label,
      description: readText(entry.description, MAX_OPTION_DESCRIPTION_CHARS),
    });
    if (options.length >= MAX_ASK_USER_OPTIONS) break;
  }
  return options;
}

function readText(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function invalid(message: string): ToolExecutionError {
  return new ToolExecutionError('ASK_USER_INVALID', message, '提问参数不合法，本次提问未送达');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
