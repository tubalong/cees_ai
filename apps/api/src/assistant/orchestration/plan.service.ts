import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AssistantTaskPlan, AssistantTaskStepStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  PublicTaskClarification,
  PublicTaskPlanCreatedBy,
  PublicTaskPlanStep,
} from './orchestration.types';

/** 模型给出的步骤草稿：依赖用「更早步骤的序号（1-based）」表达。 */
export interface PlannedStepDraft {
  title?: string;
  requirement: string;
  assigneeAgentId: string;
  expectedOutput?: string;
  /** 前置步骤序号，必须全部小于当前步骤序号，天然排除自引用与环。 */
  dependsOn?: number[];
  /**
   * 执行中重排的沿用锚点：引用旧执行版本（task.planVersion）中已成功步骤的
   * stepKey，该步骤产出直接沿用、不再执行；引用合法性由 TaskService 按库校验。
   */
  carriedFromStepKey?: string;
}

/** 模型给出的关键待定项草稿。 */
export interface ClarificationDraft {
  key: string;
  question: string;
  options: Array<{ id: string; label: string; description?: string }>;
}

/** 用户提交的待定项答复。 */
export interface AnswerInput {
  key: string;
  value: string;
}

/**
 * 计划版本与运行时步骤的领域服务。模型草稿在这里被规范化为可确认快照
 * （生成 stepKey、把依赖序号转成 stepKey、快照执行同事名称），
 * 用户答复在这里合并与校验；DB 写入供 TaskService 在自己的事务中调用。
 */
@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * 规范化步骤草稿：按顺序生成 stepKey（s1、s2……），把依赖序号转成 stepKey，
   * 并快照执行同事名称。草稿应已经过工具参数校验；这里的不合法输入
   * 属于服务端防御，抛普通 Error 交执行链兜底。
   */
  normalizeSteps(
    steps: PlannedStepDraft[],
    agentNames: ReadonlyMap<string, string>,
  ): PublicTaskPlanStep[] {
    const stepKeys = steps.map((_, index) => `s${index + 1}`);
    return steps.map((step, index) => {
      const stepNo = index + 1;
      const dependsOn = step.dependsOn ?? [];
      for (const ref of dependsOn) {
        if (!Number.isInteger(ref) || ref < 1 || ref >= stepNo) {
          throw new Error(`步骤 ${stepNo} 的依赖引用 ${String(ref)} 无效：只能引用更早步骤`);
        }
      }
      const assigneeName = agentNames.get(step.assigneeAgentId);
      if (assigneeName === undefined) {
        throw new Error(`步骤 ${stepNo} 的执行同事不在可用名单中`);
      }
      return {
        stepNo,
        stepKey: stepKeys[index],
        ...(step.title ? { title: step.title } : {}),
        requirement: step.requirement,
        assigneeAgentId: step.assigneeAgentId,
        assigneeName,
        expectedOutput: step.expectedOutput ?? null,
        dependsOnStepKeys: [...new Set(dependsOn)].map((ref) => stepKeys[ref - 1]),
        ...(step.carriedFromStepKey ? { carriedFromStepKey: step.carriedFromStepKey } : {}),
      };
    });
  }

  /** 规范化待定项草稿：key 必须唯一，初始 answer 为 null。 */
  normalizeClarifications(clarifications: ClarificationDraft[]): PublicTaskClarification[] {
    const seen = new Set<string>();
    return clarifications.map((clarification) => {
      if (seen.has(clarification.key)) {
        throw new Error(`待定项 key「${clarification.key}」重复`);
      }
      seen.add(clarification.key);
      return {
        key: clarification.key,
        question: clarification.question,
        options: clarification.options.map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.description ? { description: option.description } : {}),
        })),
        answer: null,
      };
    });
  }

  /**
   * 校验提交的答复：key 必须来自当前待定项且不重复，value 必须是该待定项的选项 id。
   * start 与 revise 都必须先通过本校验；完整性由 assertAnswersComplete 另判。
   */
  assertAnswersSubmittable(
    clarifications: PublicTaskClarification[],
    answers: AnswerInput[],
  ): void {
    const byKey = new Map(clarifications.map((clarification) => [clarification.key, clarification]));
    const seen = new Set<string>();
    for (const answer of answers) {
      const clarification = byKey.get(answer.key);
      if (!clarification) {
        throw new BadRequestException({
          code: 'TASK_ANSWER_UNKNOWN',
          message: `答复包含未知的待定项「${answer.key}」`,
        });
      }
      if (seen.has(answer.key)) {
        throw new BadRequestException({
          code: 'TASK_ANSWER_DUPLICATED',
          message: `待定项「${answer.key}」的答复重复`,
        });
      }
      seen.add(answer.key);
      if (!clarification.options.some((option) => option.id === answer.value)) {
        throw new BadRequestException({
          code: 'TASK_ANSWER_INVALID',
          message: `待定项「${clarification.key}」的答复不是有效选项`,
        });
      }
    }
  }

  /** start 确认时必须覆盖全部待定项（待定项为空时无须答复）。 */
  assertAnswersComplete(
    clarifications: PublicTaskClarification[],
    answers: AnswerInput[],
  ): void {
    const answered = new Set(answers.map((answer) => answer.key));
    const missing = clarifications.find((clarification) => !answered.has(clarification.key));
    if (missing) {
      throw new BadRequestException({
        code: 'TASK_ANSWERS_INCOMPLETE',
        message: `关键待定项「${missing.question}」尚未答复`,
      });
    }
  }

  /** 合并答复到待定项快照；未提交的待定项保留原答复（revise 允许部分提交）。 */
  mergeAnswers(
    clarifications: PublicTaskClarification[],
    answers: AnswerInput[],
  ): PublicTaskClarification[] {
    const byKey = new Map(answers.map((answer) => [answer.key, answer.value]));
    return clarifications.map((clarification) => {
      const value = byKey.get(clarification.key);
      return value === undefined ? clarification : { ...clarification, answer: value };
    });
  }

  /** 在调用方事务内创建计划版本行；无待定项时 clarifications 落 NULL。 */
  async createPlanVersion(
    transaction: Prisma.TransactionClient,
    input: {
      tenantId: string;
      taskId: string;
      version: number;
      steps: PublicTaskPlanStep[];
      clarifications: PublicTaskClarification[];
      createdBy: PublicTaskPlanCreatedBy;
    },
  ): Promise<AssistantTaskPlan> {
    return transaction.assistantTaskPlan.create({
      data: {
        tenantId: input.tenantId,
        taskId: input.taskId,
        version: input.version,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        clarifications: input.clarifications.length > 0
          ? (input.clarifications as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        createdBy: input.createdBy,
      },
    });
  }

  /**
   * 计划确认后把快照物化为运行时步骤行：无依赖的步骤为 READY，
   * 其余 PENDING（依赖满足由任务运行器在 M2 调度时转换）。
   * 执行中重排的再次确认（carryFromPlanVersion）下，「沿用锚点」步骤直接落
   * SUCCEEDED 并复制锚点版本同 stepKey 的已完成产出（摘要 / 产出引用 / 起止
   * 时间），无需重新执行；锚点已不是已完成步骤时中止确认。
   */
  async materializeSteps(
    transaction: Prisma.TransactionClient,
    input: {
      tenantId: string;
      taskId: string;
      planVersion: number;
      steps: PublicTaskPlanStep[];
      /** 沿用锚点的来源版本（执行中重排确认时传已物化版本）；缺省不复制产出。 */
      carryFromPlanVersion?: number;
    },
  ): Promise<void> {
    const carriedKeys = input.steps
      .map((step) => step.carriedFromStepKey)
      .filter((key): key is string => typeof key === 'string' && key.length > 0);
    const carriedByKey = new Map<string, {
      summary: string | null;
      outputRefs: Prisma.JsonValue;
      startedAt: Date | null;
      completedAt: Date | null;
    }>();
    if (carriedKeys.length > 0) {
      if (input.carryFromPlanVersion === undefined) {
        throw new ConflictException({
          code: 'TASK_REVISE_CARRY_UNAVAILABLE',
          message: '任务尚无已执行版本，不能沿用历史产出',
        });
      }
      const anchors = await transaction.assistantTaskStep.findMany({
        where: {
          taskId: input.taskId,
          planVersion: input.carryFromPlanVersion,
          stepKey: { in: carriedKeys },
          status: AssistantTaskStepStatus.SUCCEEDED,
        },
        select: { stepKey: true, summary: true, outputRefs: true, startedAt: true, completedAt: true },
      });
      for (const anchor of anchors) carriedByKey.set(anchor.stepKey, anchor);
      const missing = carriedKeys.find((key) => !carriedByKey.has(key));
      if (missing) {
        throw new ConflictException({
          code: 'TASK_REVISE_CARRY_INVALID',
          message: `沿用锚点「${missing}」已不是已完成步骤，无法沿用`,
        });
      }
    }
    await transaction.assistantTaskStep.createMany({
      data: input.steps.map((step) => {
        const anchor = step.carriedFromStepKey
          ? carriedByKey.get(step.carriedFromStepKey)
          : undefined;
        return {
          tenantId: input.tenantId,
          taskId: input.taskId,
          planVersion: input.planVersion,
          stepKey: step.stepKey,
          stepNo: step.stepNo,
          assigneeAgentId: step.assigneeAgentId,
          dependsOn: step.dependsOnStepKeys as unknown as Prisma.InputJsonValue,
          ...(anchor
            ? {
              status: AssistantTaskStepStatus.SUCCEEDED,
              summary: anchor.summary,
              outputRefs: anchor.outputRefs === null ? Prisma.JsonNull : anchor.outputRefs,
              startedAt: anchor.startedAt,
              completedAt: anchor.completedAt,
            }
            : {
              status: step.dependsOnStepKeys.length === 0
                ? AssistantTaskStepStatus.READY
                : AssistantTaskStepStatus.PENDING,
            }),
        };
      }),
    });
  }
}
