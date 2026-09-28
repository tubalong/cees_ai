import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantContext } from '../../../tenant/tenant-context';
import { OrchestrationToolsService } from '../../orchestration/orchestration-tools.service';
import { TaskService } from '../../orchestration/task.service';
import { ToolRegistryService } from '../tool-registry';
import {
    runAsTenant,
    ToolExecutionError,
    type ToolDefinition,
    type ToolExecutionContext,
    type ToolExecutionResult,
} from '../tool.types';

const MAX_TITLE_LENGTH = 128;
const MAX_GOAL_LENGTH = 2000;
const MAX_STEP_TITLE_LENGTH = 64;
const MAX_STEP_REQUIREMENT_LENGTH = 2000;
const MAX_EXPECTED_OUTPUT_LENGTH = 500;
const MAX_STEPS = 8;
const MAX_CLARIFICATIONS = 5;
const MAX_QUESTION_LENGTH = 500;
const MAX_OPTION_LABEL_LENGTH = 128;
const MAX_OPTION_DESCRIPTION_LENGTH = 256;
/** 待定项 key 与选项 id 的固定模式：便于模型生成、便于按 key 提交答复。 */
const KEY_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const OPTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParsedStep {
    title?: string;
    requirement: string;
    assignee_agent_id: string;
    expected_output?: string;
    depends_on: number[];
}

interface ParsedClarification {
    key: string;
    question: string;
    options: Array<{ id: string; label: string; description?: string }>;
}

interface ParsedArguments {
    title: string;
    goal: string;
    steps: ParsedStep[];
    clarifications: ParsedClarification[];
}

/**
 * create_orchestration_task 工具：把需要多位 AI 同事协作的复杂请求拆成
 * 多步骤计划，创建 AI 编排任务（PENDING_CONFIRM 待用户确认）。
 *
 * 设计取舍：riskLevel = WRITE 但不声明 buildConfirmation——确认闸门在任务卡片
 * （确认前不派发任何步骤、不产生业务副作用），而 AssistantActionDraft 草稿是
 * 单动作确认的载体，语义不同不可混用。工具直接落库的只是一份「待确认计划」。
 *
 * 无在职 AI 同事时的降级：模型工具列表由 OrchestrationToolsService.gate
 * 在轮次开始时门控（无同事则工具不可见）；工具不可见时模型自然不会调用。
 * 本工具执行器内的名册校验是最后兜底闸（例如会话中途同事被全部归档），
 * 拒绝时给出面向用户的固定文案——对话与其余工具不受任何影响。
 */
@Injectable()
export class CreateOrchestrationTaskTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly tasks: TaskService,
        private readonly orchestrationTools: OrchestrationToolsService,
        private readonly tenantContext: TenantContext,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'create_orchestration_task',
        version: '1.0.0',
        displayName: '创建协作任务',
        description: '把复杂的多环节请求拆成多步骤计划，创建由多位 AI 同事协作完成的编排任务，用户在任务卡片确认后系统才会派发执行。'
            + '适用：需要多个环节、有先后依赖或需要不同专业角色的工作（例如「收集数据 → 分析 → 出报告」）。'
            + '不要用于：普通问答、单个简单操作（直接回答或使用其他工具）。'
            + 'steps 必须给出完整可执行的计划：每步写清要求（做什么、完成标准、输出格式）并指定执行同事，'
            + 'assignee_agent_id 必须从可用名册中选择；depends_on 填写前置步骤序号（1 起，只能引用更早步骤），省略表示可立即开始。'
            + '只有确实影响计划的关键问题才放进 clarifications（0-5 个，每个给 2-6 个候选答案），不要为可有可无的细节创建待定项。'
            + '创建成功后告知用户计划已生成、等待确认；不要重复创建任务，不要声称任务已开始执行。',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: '任务简短标题，最长 128 字' },
                goal: { type: 'string', description: '任务目标（你理解后的完整表述），最长 2000 字' },
                steps: {
                    type: 'array',
                    minItems: 1,
                    maxItems: MAX_STEPS,
                    description: '完整步骤计划（按执行顺序）',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: '步骤简短名，如「收集销售数据」，最长 64 字' },
                            requirement: { type: 'string', description: '本步要求：做什么、完成标准、输出格式，最长 2000 字' },
                            assignee_agent_id: { type: 'string', description: '执行同事 id，必须来自可用名册' },
                            expected_output: { type: 'string', description: '预期产出描述，最长 500 字' },
                            depends_on: {
                                type: 'array',
                                items: { type: 'integer', minimum: 1 },
                                description: '前置步骤序号（1 起），只能引用更早步骤；省略表示可立即开始',
                            },
                        },
                        required: ['requirement', 'assignee_agent_id'],
                        additionalProperties: false,
                    },
                },
                clarifications: {
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
                },
            },
            required: ['title', 'goal', 'steps'],
            additionalProperties: false,
        },
        requiredPermissions: ['ai.task.create'],
        riskLevel: 'WRITE',
        validate: validateCreateOrchestrationTaskArguments,
        execute: (context, input) => this.executeCreate(context, input),
    };

    private async executeCreate(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const args = input as unknown as ParsedArguments;
        // 最后兜底闸：无在职同事时拒绝（列表门控已在轮次开始时隐藏本工具；
        // 会话中途同事被全部归档等变化在这里被拦截）。
        const agents = await this.orchestrationTools.listActiveAgents(context.tenantId);
        if (agents.length === 0) {
            throw new ToolExecutionError(
                'ORCHESTRATION_NO_AGENTS',
                'no active assistant agents available for orchestration',
                '当前企业没有可用的 AI 同事，无法创建多同事协作任务。请告知用户：可以先用对话直接完成本需求，'
                + '或请管理员在「AI 同事」中创建并启用同事后再试。',
            );
        }
        const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
        const unavailable = args.steps.find((step) => !agentNames.has(step.assignee_agent_id));
        if (unavailable) {
            throw new ToolExecutionError(
                'ORCHESTRATION_ASSIGNEE_UNAVAILABLE',
                `assignee ${unavailable.assignee_agent_id} is not an active assistant agent`,
                '计划中有步骤指派给了不可用的 AI 同事。请把每步的 assignee_agent_id 改为当前可用名册中的 id 后重新创建。',
            );
        }

        const detail = await runAsTenant(this.tenantContext, context, () =>
            this.tasks.createFromTool({
                conversationId: context.conversationId,
                toolCallId: context.toolCallId,
                requestHash: hashOrchestrationArguments(args),
                title: args.title,
                goal: args.goal,
                steps: args.steps.map((step) => ({
                    title: step.title,
                    requirement: step.requirement,
                    assigneeAgentId: step.assignee_agent_id,
                    expectedOutput: step.expected_output,
                    dependsOn: step.depends_on,
                })),
                clarifications: args.clarifications.map((clarification) => ({
                    key: clarification.key,
                    question: clarification.question,
                    options: clarification.options.map((option) => ({
                        id: option.id,
                        label: option.label,
                        description: option.description,
                    })),
                })),
                agentNames,
            }));

        const planSteps = detail.currentPlan?.steps ?? [];
        return {
            resourceType: null,
            resourceId: null,
            summary: buildToolSummary(detail.task.id, detail.task.title, planSteps, args.clarifications),
            userSummary: `已生成任务计划草案「${detail.task.title}」，共 ${planSteps.length} 个步骤；`
                + '请在任务卡片中确认或调整，确认后才会开始执行。',
        };
    }
}

/** 回喂模型的工具结果摘要：包含任务 ID 供后续引用，并约束模型行为。 */
function buildToolSummary(
    taskId: string,
    title: string,
    steps: Array<{ stepNo: number; title?: string; assigneeName?: string; dependsOnStepKeys: string[] }>,
    clarifications: ParsedClarification[],
): string {
    const lines = steps.map((step) => {
        const name = step.title ? `「${step.title}」` : '';
        const assignee = step.assigneeName ? ` → ${step.assigneeName}` : '';
        const depends = step.dependsOnStepKeys.length > 0 ? `（依赖第 ${step.dependsOnStepKeys.join('、')} 步）` : '';
        return `${step.stepNo}. ${name}${assignee}${depends}`;
    });
    return [
        `已创建 AI 编排任务草稿（任务 ID: ${taskId}，标题「${title}」，状态：待确认，共 ${steps.length} 个步骤）：`,
        ...lines,
        clarifications.length > 0 ? `关键待定项 ${clarifications.length} 个，用户确认时逐项答复。` : null,
        '任务卡片已展示给用户；用户确认前不会派发任何步骤。',
        '不要重复创建任务；若用户要求调整计划，等用户在对话中说明调整内容后重新调用本工具生成新计划；不要声称任务已开始执行或编造执行进度。',
    ].filter((line): line is string => line !== null).join('\n');
}

function validateCreateOrchestrationTaskArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;

    const title = readText(raw.title, 'title', MAX_TITLE_LENGTH);
    const goal = readText(raw.goal, 'goal', MAX_GOAL_LENGTH);

    if (!Array.isArray(raw.steps) || raw.steps.length === 0) throw new Error('steps 必须是非空数组');
    if (raw.steps.length > MAX_STEPS) throw new Error(`steps 最多 ${MAX_STEPS} 个步骤`);
    const steps = raw.steps.map((step, index) => validateStep(step, index));

    let clarifications: ParsedClarification[] = [];
    if (raw.clarifications !== undefined && raw.clarifications !== null) {
        if (!Array.isArray(raw.clarifications)) throw new Error('clarifications 必须是数组');
        if (raw.clarifications.length > MAX_CLARIFICATIONS) {
            throw new Error(`clarifications 最多 ${MAX_CLARIFICATIONS} 项`);
        }
        const seenKeys = new Set<string>();
        clarifications = raw.clarifications.map((clarification, index) =>
            validateClarification(clarification, index, seenKeys));
    }

    const parsed: ParsedArguments = { title, goal, steps, clarifications };
    return parsed as unknown as Record<string, unknown>;
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

/** 读取必填文本字段：去首尾空白、非空、长度受限。 */
function readText(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`);
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} 不能为空`);
    if (normalized.length > maxLength) throw new Error(`${label} 不能超过 ${maxLength} 字符`);
    return normalized;
}

/** 工具参数幂等哈希：与对象键顺序无关，用于同幂等键的内容一致性校验。 */
function hashOrchestrationArguments(args: ParsedArguments): string {
    return createHash('sha256').update(canonicalJson(args)).digest('hex');
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
