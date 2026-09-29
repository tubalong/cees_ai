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
    UUID_PATTERN,
    buildPlanClarificationsSchema,
    buildPlanStepsSchema,
    loadAgentRoster,
    parsePlanClarifications,
    parsePlanSteps,
    readText,
    type ParsedClarification,
    type ParsedStep,
} from './orchestration-plan-arguments';

interface ParsedReviseArguments {
    task_id: string;
    title?: string;
    goal?: string;
    steps: ParsedStep[];
    clarifications?: ParsedClarification[];
}

/**
 * revise_orchestration_task 工具：用户要求调整已有任务的计划时，在任务上生成
 * 新版本草案（TaskService.reviseFromTool，createdBy=USER），用户在任务卡片
 * 再次确认后才物化执行；已成功步骤可按「沿用锚点」直接复用产出。
 *
 * 与 create 工具共享计划参数校验与名册兜底闸（orchestration-plan-arguments）；
 * 确认闸门同样在任务卡片——工具落库的只是一份「待确认的新草案」。
 */
@Injectable()
export class ReviseOrchestrationTaskTool implements OnModuleInit {
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
        name: 'revise_orchestration_task',
        version: '1.0.0',
        displayName: '调整协作任务计划',
        description: '用户对已有的 AI 编排任务提出计划调整（修改步骤、增删环节、调整执行同事或要求）时，'
            + '在任务上生成调整后的新计划版本，用户在任务卡片再次确认后才会执行。'
            + '适用：用户按「调整要求」后在对话中补充调整内容；执行中的任务失败后选择「调整计划」并说明如何调整。'
            + '不要用于：新建任务（用 create_orchestration_task）；普通问答。'
            + 'steps 必须给出调整后的完整计划（全量替换）：每步写清要求并指定执行同事，'
            + 'assignee_agent_id 必须从可用名册中选择；depends_on 填写新计划内的前置步骤序号（1 起，只能引用更早步骤）。'
            + '旧计划中已完成的步骤可以不重新执行：在该步填 carried_from_step_key 引用旧计划的步骤标识，'
            + '只允许引用给出的「可沿用的已完成步骤」；需要重新执行的步骤不要填。'
            + '调整完成后告知用户新计划已生成、等待再次确认；不要声称任务已继续执行。',
        parameters: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: '要调整的任务 id（任务卡片上的任务 ID）' },
                title: { type: 'string', description: '任务简短标题，最长 128 字；省略沿用原标题' },
                goal: { type: 'string', description: '任务目标（你理解后的完整表述），最长 2000 字；省略沿用原目标' },
                steps: buildPlanStepsSchema({ withCarry: true }),
                clarifications: {
                    ...buildPlanClarificationsSchema(),
                    description: '调整后的关键待定项（0-5 个）；省略表示沿用当前草案的待定项与已答复',
                },
            },
            required: ['task_id', 'steps'],
            additionalProperties: false,
        },
        requiredPermissions: ['ai.task.create'],
        riskLevel: 'WRITE',
        validate: validateReviseOrchestrationTaskArguments,
        execute: (context, input) => this.executeRevise(context, input),
    };

    private async executeRevise(
        context: ToolExecutionContext,
        input: Record<string, unknown>,
    ): Promise<ToolExecutionResult> {
        const args = input as unknown as ParsedReviseArguments;
        // 与 create 一致的最后兜底闸：无在职同事或指派不可用时拒绝。
        const agentNames = await loadAgentRoster(context.tenantId, this.orchestrationTools, args.steps);

        const detail = await runAsTenant(this.tenantContext, context, () =>
            this.tasks.reviseFromTool({
                taskId: args.task_id,
                toolCallId: context.toolCallId,
                title: args.title,
                goal: args.goal,
                steps: args.steps.map((step) => ({
                    title: step.title,
                    requirement: step.requirement,
                    assigneeAgentId: step.assignee_agent_id,
                    expectedOutput: step.expected_output,
                    dependsOn: step.depends_on,
                    carriedFromStepKey: step.carried_from_step_key,
                })),
                clarifications: args.clarifications?.map((clarification) => ({
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
        const version = detail.currentPlan?.version ?? detail.task.planVersion;
        const clarificationCount = detail.currentPlan?.clarifications.length ?? 0;
        return {
            resourceType: null,
            resourceId: null,
            summary: buildReviseToolSummary(
                detail.task.id, detail.task.title, version, planSteps, clarificationCount,
            ),
            userSummary: `已生成「${detail.task.title}」的调整后计划（第 ${version} 版），`
                + '请在任务卡片中确认或继续调整；确认后才会继续执行。',
        };
    }
}

/** 回喂模型的工具结果摘要：给出新版本步骤与沿用标记，并约束模型行为。 */
function buildReviseToolSummary(
    taskId: string,
    title: string,
    version: number,
    steps: Array<{
        stepNo: number;
        title?: string;
        assigneeName?: string;
        dependsOnStepKeys: string[];
        carriedFromStepKey?: string | null;
    }>,
    clarificationCount: number,
): string {
    const lines = steps.map((step) => {
        const name = step.title ? `「${step.title}」` : '';
        const assignee = step.assigneeName ? ` → ${step.assigneeName}` : '';
        const carried = step.carriedFromStepKey ? `（沿用 ${step.carriedFromStepKey} 的已完成产出）` : '';
        const depends = step.dependsOnStepKeys.length > 0 ? `（依赖第 ${step.dependsOnStepKeys.join('、')} 步）` : '';
        return `${step.stepNo}. ${name}${assignee}${carried}${depends}`;
    });
    return [
        `已更新 AI 编排任务计划（任务 ID: ${taskId}，标题「${title}」，新版本 v${version}，状态：待确认）：`,
        ...lines,
        clarificationCount > 0 ? `关键待定项 ${clarificationCount} 个，用户确认时逐项答复。` : null,
        '任务卡片已展示调整后的计划；用户再次确认前不会派发任何步骤。',
        '不要重复调用本工具；调整已提交，等用户在任务卡片确认后继续执行；不要编造执行进度。',
    ].filter((line): line is string => line !== null).join('\n');
}

function validateReviseOrchestrationTaskArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为对象');
    const raw = input as Record<string, unknown>;

    if (typeof raw.task_id !== 'string' || !UUID_PATTERN.test(raw.task_id)) {
        throw new Error('task_id 必须是任务 id');
    }
    const parsed: ParsedReviseArguments = {
        task_id: raw.task_id,
        steps: parsePlanSteps(raw.steps),
        clarifications: parsePlanClarifications(raw.clarifications),
    };
    if (raw.title !== undefined && raw.title !== null) {
        parsed.title = readText(raw.title, 'title', MAX_TITLE_LENGTH);
    }
    if (raw.goal !== undefined && raw.goal !== null) {
        parsed.goal = readText(raw.goal, 'goal', MAX_GOAL_LENGTH);
    }
    return parsed as unknown as Record<string, unknown>;
}
