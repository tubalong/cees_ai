import { AssistantAgentStatus, PrismaClient } from '@prisma/client';

/**
 * 默认 AI 同事种子（仅开发环境 full seed 执行，生产环境不会运行——见 seed.ts）。
 *
 * 为什么需要：M1 阶段尚无同事管理入口（创建与配置界面在后续里程碑），
 * 开发与联调环境需要一个 ACTIVE 同事，才能端到端走通「编排工具可见 →
 * 创建任务 → 确认/取消」链路。
 *
 * 与运行时门控的关系：编排工具只在企业存在 ACTIVE 同事时进入模型工具列表；
 * 本种子让开发环境具备编排能力，归档或删除该同事即可验证「无同事降级」——
 * 对话与其余工具完全不受影响，只少了多子 agent 任务能力。
 * 生产环境的企业需要同事时，由管理员通过管理入口显式创建。
 */

/** 种子同事名称：同一租户内按名称识别，重跑 seed 不重复创建。 */
const DEFAULT_AGENT_NAME = '通用助理';

export async function seedDefaultAssistantAgent(
    prisma: PrismaClient,
    input: { tenantId: string; createdBy: string | null },
): Promise<void> {
    // 幂等且不覆盖手工调整：已存在同名同事（含被归档的）时原样保留，
    // 避免重跑 seed 复活测试「无同事降级」时手工归档的同事。
    const existing = await prisma.assistantAgent.findFirst({
        where: { tenantId: input.tenantId, name: DEFAULT_AGENT_NAME },
        select: { id: true },
    });
    if (existing) return;

    await prisma.assistantAgent.create({
        data: {
            tenantId: input.tenantId,
            name: DEFAULT_AGENT_NAME,
            title: '通用任务执行',
            description: '开发环境种子同事：用于联调多步骤任务编排链路。',
            instructions: '按派发书要求完成步骤任务，聚焦本步要求；输出先给结论再给依据，并标注数据来源。',
            status: AssistantAgentStatus.ACTIVE,
            createdBy: input.createdBy,
        },
    });
}
