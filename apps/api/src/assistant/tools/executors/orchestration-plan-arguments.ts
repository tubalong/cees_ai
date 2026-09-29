import { createHash } from 'node:crypto';
import type { OrchestrationToolsService } from '../../orchestration/orchestration-tools.service';
import { ToolExecutionError } from '../tool.types';

export const MAX_TITLE_LENGTH = 128;
export const MAX_GOAL_LENGTH = 2000;
export const MAX_STEP_TITLE_LENGTH = 64;
export const MAX_STEP_REQUIREMENT_LENGTH = 2000;
export const MAX_EXPECTED_OUTPUT_LENGTH = 500;
export const MAX_STEPS = 8;
export const MAX_CLARIFICATIONS = 5;
export const MAX_QUESTION_LENGTH = 500;
export const MAX_OPTION_LABEL_LENGTH = 128;
export const MAX_OPTION_DESCRIPTION_LENGTH = 256;
/** 待定项 key 与选项 id 的固定模式：便于模型生成、便于按 key 提交答复。 */
export const KEY_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
export const OPTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 计划内稳定 stepKey 的格式（normalizeSteps 按位置生成 s1、s2……）。 */
const STEP_KEY_PATTERN = /^s[1-9]\d{0,2}$/;

export interface ParsedStep {
    title?: string;
    requirement: string;
    assignee_agent_id: string;
    expected_output?: string;
    depends_on: number[];
    carried_from_step_key?: string;
}

export interface ParsedClarification {
    key: string;
    question: string;
    options: Array<{ id: string; label: string; description?: string }>;
}

/**
 * 编排计划参数（steps / clarifications）的共享 JSON Schema 与校验：
 * create_orchestration_task 与 revise_orchestration_task 两个工具共用，
 * 保证模型在两个入口收到一致的计划描述与参数约束。
 */
export function buildPlanStepsSchema(options: { withCarry: boolean }): Record<string, unknown> {
    const itemProperties: Record<string, unknown> = {
        title: { type: 'string', description: '步骤简短名，如「收集销售数据」，最长 64 字' },
        requirement: { type: 'string', description: '本步要求：做什么、完成标准、输出格式，最长 2000 字' },
        assignee_agent_id: { type: 'string', description: '执行同事 id，必须来自可用名册' },
        expected_output: { type: 'string', description: '预期产出描述，最长 500 字' },
        depends_on: {
            type: 'array',
            items: { type: 'integer', minimum: 1 },
            description: '前置步骤序号（1 起），只能引用更早步骤；省略表示可立即开始',
        },
    };
    if (options.withCarry) {
        itemProperties.carried_from_step_key = {
            type: 'string',
            description: '仅执行中的调整可用：本步直接沿用旧计划中该 stepKey 的已完成产出（不重新执行），'
                + '必须来自「可沿用的已完成步骤」清单；需要重新执行的步骤不要填',
        };
    }
    return {
        type: 'array',
        minItems: 1,
        maxItems: MAX_STEPS,
        description: '完整步骤计划（按执行顺序）',
        items: {
            type: 'object',
            properties: itemProperties,
            required: ['requirement', 'assignee_agent_id'],
            additionalProperties: false,
        },
    };
}

export function buildPlanClarificationsSchema(): Record<string, unknown> {
    return {
        type: 'array',
        maxItems: MAX_CLARIFICATIONS,
        description: '必须先问清的关键待定项；用户确认计划时逐项答复',
        items: {
            type: 'object',
            properties: {
                key: { type: 'string', description: '标识（字母、数字与下划线），答复按 key 提交' },
                question: { type: 'string', description: '要问清的问题，最长 500 字' },
                options: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 6,
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: '选项 id（字母、数字、下划线或连字符）' },
                            label: { type: 'string', description: '选项文案，最长 128 字' },
                            description: { type: 'string', description: '选项补充说明，最长 256 字' },
                        },
                        required: ['id', 'label'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['key', 'question', 'options'],
            additionalProperties: false,
        },
    };
}

/** 校验并规范化 steps 参数：非空、数量受限、逐步校验（含可选沿用锚点格式）。 */
export function parsePlanSteps(raw: unknown): ParsedStep[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('steps 必须是非空数组');
    if (raw.length > MAX_STEPS) throw new Error(`steps 最多 ${MAX_STEPS} 个步骤`);
    return raw.map((step, index) => validateStep(step, index));
}

/** 校验并规范化 clarifications 参数；未给出（undefined/null）返回 undefined。 */
export function parsePlanClarifications(raw: unknown): ParsedClarification[] | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!Array.isArray(raw)) throw new Error('clarifications 必须是数组');
    if (raw.length > MAX_CLARIFICATIONS) {
        throw new Error(`clarifications 最多 ${MAX_CLARIFICATIONS} 项`);
    }
    const seenKeys = new Set<string>();
    return raw.map((clarification, index) => validateClarification(clarification, index, seenKeys));
}

/** 读取必填文本字段：去首尾空白、非空、长度受限。 */
export function readText(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`);
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} 不能为空`);
    if (normalized.length > maxLength) throw new Error(`${label} 不能超过 ${maxLength} 字符`);
    return normalized;
}

/** 工具参数幂等哈希：与对象键顺序无关，用于同幂等键的内容一致性校验。 */
export function hashPlanArguments(args: unknown): string {
    return createHash('sha256').update(canonicalJson(args)).digest('hex');
}

/**
 * 加载在职同事名册并校验每步指派（两个编排工具共用的最后兜底闸）：
 * 无在职同事或指派不可用时抛出面向模型的 ToolExecutionError。
 */
export async function loadAgentRoster(
    tenantId: string,
    orchestrationTools: OrchestrationToolsService,
    steps: ParsedStep[],
): Promise<Map<string, string>> {
    const agents = await orchestrationTools.listActiveAgents(tenantId);
    if (agents.length === 0) {
        throw new ToolExecutionError(
            'ORCHESTRATION_NO_AGENTS',
            'no active assistant agents available for orchestration',
            '当前企业没有可用的 AI 同事，无法编排多同事协作任务。请告知用户：可以先用对话直接完成本需求，'
            + '或请管理员在「AI 同事」中创建并启用同事后再试。',
        );
    }
    const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
    const unavailable = steps.find((step) => !agentNames.has(step.assignee_agent_id));
    if (unavailable) {
        throw new ToolExecutionError(
            'ORCHESTRATION_ASSIGNEE_UNAVAILABLE',
            `assignee ${unavailable.assignee_agent_id} is not an active assistant agent`,
            '计划中有步骤指派给了不可用的 AI 同事。请把每步的 assignee_agent_id 改为当前可用名册中的 id 后重试。',
        );
    }
    return agentNames;
}

function validateStep(value: unknown, index: number): ParsedStep {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`steps[${index}] 必须是对象`);
    }
    const raw = value as Record<string, unknown>;
    const label = `steps[${index}]`;
    const stepNo = index + 1;

    const requirement = readText(raw.requirement, `${label}.requirement`, MAX_STEP_REQUIREMENT_LENGTH);
    if (typeof raw.assignee_agent_id !== 'string' || !UUID_PATTERN.test(raw.assignee_agent_id)) {
        throw new Error(`${label}.assignee_agent_id 必须是名册中的同事 id`);
    }
    const parsed: ParsedStep = {
        requirement,
        assignee_agent_id: raw.assignee_agent_id,
        depends_on: [],
    };
    if (raw.title !== undefined && raw.title !== null) {
        parsed.title = readText(raw.title, `${label}.title`, MAX_STEP_TITLE_LENGTH);
    }
    if (raw.expected_output !== undefined && raw.expected_output !== null) {
        parsed.expected_output = readText(raw.expected_output, `${label}.expected_output`, MAX_EXPECTED_OUTPUT_LENGTH);
    }
    if (raw.depends_on !== undefined && raw.depends_on !== null) {
        if (!Array.isArray(raw.depends_on)) throw new Error(`${label}.depends_on 必须是数组`);
        const refs = new Set<number>();
        for (const ref of raw.depends_on) {
            if (typeof ref !== 'number' || !Number.isInteger(ref) || ref < 1) {
                throw new Error(`${label}.depends_on 的元素必须是正整数（步骤序号）`);
            }
            if (ref >= stepNo) {
                throw new Error(`${label}.depends_on 只能引用更早的步骤（当前是第 ${stepNo} 步）`);
            }
            refs.add(ref);
        }
        parsed.depends_on = [...refs].sort((left, right) => left - right);
    }
    if (raw.carried_from_step_key !== undefined && raw.carried_from_step_key !== null) {
        if (
            typeof raw.carried_from_step_key !== 'string'
            || !STEP_KEY_PATTERN.test(raw.carried_from_step_key)
        ) {
            throw new Error(`${label}.carried_from_step_key 必须是旧计划中的步骤标识（如 s1）`);
        }
        parsed.carried_from_step_key = raw.carried_from_step_key;
    }
    return parsed;
}

function validateClarification(
    value: unknown,
    index: number,
    seenKeys: Set<string>,
): ParsedClarification {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`clarifications[${index}] 必须是对象`);
    }
    const raw = value as Record<string, unknown>;
    const label = `clarifications[${index}]`;

    if (typeof raw.key !== 'string' || !KEY_PATTERN.test(raw.key)) {
        throw new Error(`${label}.key 只能包含字母、数字与下划线`);
    }
    if (seenKeys.has(raw.key)) throw new Error(`${label}.key 与其他待定项重复`);
    seenKeys.add(raw.key);
    const question = readText(raw.question, `${label}.question`, MAX_QUESTION_LENGTH);

    if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 6) {
        throw new Error(`${label}.options 必须包含 2 到 6 个选项`);
    }
    const optionIds = new Set<string>();
    const options = raw.options.map((option, optionIndex) => {
        if (!option || typeof option !== 'object' || Array.isArray(option)) {
            throw new Error(`${label}.options[${optionIndex}] 必须是对象`);
        }
        const rawOption = option as Record<string, unknown>;
        if (typeof rawOption.id !== 'string' || !OPTION_ID_PATTERN.test(rawOption.id)) {
            throw new Error(`${label}.options[${optionIndex}].id 只能包含字母、数字、下划线或连字符`);
        }
        if (optionIds.has(rawOption.id)) {
            throw new Error(`${label}.options[${optionIndex}].id 与其他选项重复`);
        }
        optionIds.add(rawOption.id);
        const parsedOption: ParsedClarification['options'][number] = {
            id: rawOption.id,
            label: readText(rawOption.label, `${label}.options[${optionIndex}].label`, MAX_OPTION_LABEL_LENGTH),
        };
        if (rawOption.description !== undefined && rawOption.description !== null) {
            parsedOption.description = readText(
                rawOption.description,
                `${label}.options[${optionIndex}].description`,
                MAX_OPTION_DESCRIPTION_LENGTH,
            );
        }
        return parsedOption;
    });

    return { key: raw.key, question, options };
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
