import { Injectable, OnModuleInit } from '@nestjs/common';
import { TenantContext } from '../../../tenant/tenant-context';
import { OrchestrationToolsService } from '../../orchestration/orchestration-tools.service';
import { TaskService } from '../../orchestration/task.service';
import { ToolRegistryService } from '../tool-registry';
import {
    runAsTenant,
    type ToolDefinition,
    type ToolExecutionContext,
    type ToolExecutionResult,
} from '../tool.types';
import {
    MAX_GOAL_LENGTH,
    MAX_TITLE_LENGTH,
    buildPlanClarificationsSchema,
    buildPlanStepsSchema,
    hashPlanArguments,
    loadAgentRoster,
    parsePlanClarifications,
    parsePlanSteps,
    readText,
    type ParsedClarification,
    type ParsedStep,
} from './orchestration-plan-arguments';

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
                steps: buildPlanStepsSchema({ withCarry: false }),
                clarifications: buildPlanClarificationsSchema(),
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
        // 最后兜底闸：无在职同事或指派不可用时拒绝（列表门控已在轮次开始时隐藏
        // 本工具；会话中途同事被全部归档等变化在这里被拦截）。
        const agentNames = await loadAgentRoster(context.tenantId, this.orchestrationTools, args.steps);

        const detail = await runAsTenant(this.tenantContext, context, () =>
            this.tasks.createFromTool({
                conversationId: context.conversationId,
                toolCallId: context.toolCallId,
                requestHash: hashPlanArguments(args),
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
        '不要重复创建任务；若用户要求调整计划，等用户在对话中说明调整内容后调用 revise_orchestration_task 更新该任务；不要声称任务已开始执行或编造执行进度。',
    ].filter((line): line is string => line !== null).join('\n');
}

function validateCreateOrchestrationTaskArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;

    const title = readText(raw.title, 'title', MAX_TITLE_LENGTH);
    const goal = readText(raw.goal, 'goal', MAX_GOAL_LENGTH);
    const steps = parsePlanSteps(raw.steps);
    const clarifications = parsePlanClarifications(raw.clarifications) ?? [];

    const parsed: ParsedArguments = { title, goal, steps, clarifications };
    return parsed as unknown as Record<string, unknown>;
}
