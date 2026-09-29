import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PlanService } from './plan.service';
import type { PublicTaskClarification, PublicTaskPlanStep } from './orchestration.types';

/**
 * 计划规范化与答复校验是「模型草稿 → 可确认快照」的纯逻辑防御层，
 * 不依赖数据库；DB 写入由 TaskService 的事务测试场景覆盖。
 */
describe('PlanService', () => {
  const service = new PlanService({} as unknown as PrismaService);

  describe('normalizeSteps', () => {
    it('assigns step keys, rewrites dependency numbers and snapshots assignee names', () => {
      const steps = service.normalizeSteps(
        [
          { requirement: '收集销售数据', assigneeAgentId: 'agent-1' },
          { requirement: '汇总分析', assigneeAgentId: 'agent-2', expectedOutput: '分析报告', dependsOn: [1, 1] },
        ],
        roster(),
      );

      expect(steps).toEqual([
        {
          stepNo: 1, stepKey: 's1', requirement: '收集销售数据', assigneeAgentId: 'agent-1',
          assigneeName: '数据助理', expectedOutput: null, dependsOnStepKeys: [],
        },
        {
          stepNo: 2, stepKey: 's2', requirement: '汇总分析', assigneeAgentId: 'agent-2',
          assigneeName: '分析助理', expectedOutput: '分析报告', dependsOnStepKeys: ['s1'],
        },
      ]);
    });

    it('rejects a dependency that does not reference an earlier step', () => {
      expect(() => service.normalizeSteps(
        [
          { requirement: '第一步', assigneeAgentId: 'agent-1', dependsOn: [2] },
          { requirement: '第二步', assigneeAgentId: 'agent-1' },
        ],
        roster(),
      )).toThrow('只能引用更早步骤');
    });

    it('rejects a step assigned to an agent outside the roster', () => {
      expect(() => service.normalizeSteps(
        [{ requirement: '任务', assigneeAgentId: 'agent-x' }],
        roster(),
      )).toThrow('不在可用名单中');
    });

    it('passes through the carry anchor of a replanned step', () => {
      const steps = service.normalizeSteps(
        [{ requirement: '重新汇总', assigneeAgentId: 'agent-2', carriedFromStepKey: 's1' }],
        roster(),
      );

      expect(steps[0].carriedFromStepKey).toBe('s1');
    });

    it('omits the carry anchor when no history step is reused', () => {
      const steps = service.normalizeSteps(
        [{ requirement: '收集', assigneeAgentId: 'agent-1' }],
        roster(),
      );

      expect('carriedFromStepKey' in steps[0]).toBe(false);
    });
  });

  describe('normalizeClarifications', () => {
    it('normalizes clarifications and rejects duplicated keys', () => {
      const clarifications = service.normalizeClarifications([
        { key: 'currency', question: '币种？', options: [{ id: 'CNY', label: '人民币', description: '默认结算币种' }] },
      ]);
      expect(clarifications).toEqual([
        {
          key: 'currency', question: '币种？', answer: null,
          options: [{ id: 'CNY', label: '人民币', description: '默认结算币种' }],
        },
      ]);

      expect(() => service.normalizeClarifications([
        { key: 'dup', question: 'A？', options: [] },
        { key: 'dup', question: 'B？', options: [] },
      ])).toThrow('重复');
    });
  });

  describe('answer validation', () => {
    it('accepts answers matching the clarification options and rejects invalid ones', () => {
      const clarifications = clarificationsFixture();

      expect(() => service.assertAnswersSubmittable(
        clarifications,
        [{ key: 'currency', value: 'USD' }],
      )).not.toThrow();

      expectBadRequest(() => service.assertAnswersSubmittable(
        clarifications,
        [{ key: 'missing', value: 'USD' }],
      ), 'TASK_ANSWER_UNKNOWN');

      expectBadRequest(() => service.assertAnswersSubmittable(
        clarifications,
        [{ key: 'currency', value: 'USD' }, { key: 'currency', value: 'CNY' }],
      ), 'TASK_ANSWER_DUPLICATED');

      expectBadRequest(() => service.assertAnswersSubmittable(
        clarifications,
        [{ key: 'currency', value: 'EUR' }],
      ), 'TASK_ANSWER_INVALID');
    });

    it('requires start confirmation to answer every clarification', () => {
      const clarifications = clarificationsFixture();

      expectBadRequest(() => service.assertAnswersComplete(
        clarifications,
        [{ key: 'currency', value: 'USD' }],
      ), 'TASK_ANSWERS_INCOMPLETE');

      expect(() => service.assertAnswersComplete(clarifications, [
        { key: 'currency', value: 'USD' },
        { key: 'scope', value: 'all' },
      ])).not.toThrow();
      expect(() => service.assertAnswersComplete([], [])).not.toThrow();
    });
  });

  describe('mergeAnswers', () => {
    it('merges submitted answers and keeps the rest untouched', () => {
      const clarifications = clarificationsFixture();

      const merged = service.mergeAnswers(clarifications, [{ key: 'currency', value: 'USD' }]);

      expect(merged[0]).toEqual({ ...clarifications[0], answer: 'USD' });
      expect(merged[1]).toBe(clarifications[1]);
      // 合并生成新快照，不修改传入的原对象。
      expect(clarifications[0].answer).toBeNull();
    });
  });

  describe('materializeSteps', () => {
    it('materializes steps as READY/PENDING by their dependencies', async () => {
      const transaction = materializeTransaction();

      await service.materializeSteps(transaction.client, {
        tenantId: 'tenant-1',
        taskId: 'task-1',
        planVersion: 1,
        steps: [
          planStep({ stepNo: 1, stepKey: 's1' }),
          planStep({ stepNo: 2, stepKey: 's2', dependsOnStepKeys: ['s1'] }),
        ],
      });

      expect(transaction.stepDelegate.findMany).not.toHaveBeenCalled();
      expect(transaction.stepDelegate.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ stepKey: 's1', status: 'READY' }),
          expect.objectContaining({ stepKey: 's2', status: 'PENDING', dependsOn: ['s1'] }),
        ],
      });
    });

    it('copies the succeeded anchor outputs for carried steps on re-confirmation', async () => {
      const transaction = materializeTransaction({
        anchors: [{
          stepKey: 's1',
          summary: '上一版产出：销售汇总表',
          outputRefs: [{ resourceType: 'document', resourceId: 'r-1' }],
          startedAt: new Date('2026-09-29T07:00:00.000Z'),
          completedAt: new Date('2026-09-29T07:30:00.000Z'),
        }],
      });

      await service.materializeSteps(transaction.client, {
        tenantId: 'tenant-1',
        taskId: 'task-1',
        planVersion: 2,
        steps: [
          planStep({ stepNo: 1, stepKey: 's1', carriedFromStepKey: 's1' }),
          planStep({ stepNo: 2, stepKey: 's2', dependsOnStepKeys: ['s1'] }),
        ],
        carryFromPlanVersion: 1,
      });

      // 锚点按旧执行版本读取：只接受已成功步骤。
      expect(transaction.stepDelegate.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          planVersion: 1,
          status: 'SUCCEEDED',
          stepKey: { in: ['s1'] },
        }),
      }));
      expect(transaction.stepDelegate.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            stepKey: 's1',
            status: 'SUCCEEDED',
            summary: '上一版产出：销售汇总表',
            outputRefs: [{ resourceType: 'document', resourceId: 'r-1' }],
          }),
          expect.objectContaining({ stepKey: 's2', status: 'PENDING' }),
        ],
      });
    });

    it('rejects a carried step without a source version', async () => {
      const transaction = materializeTransaction();

      await expect(service.materializeSteps(transaction.client, {
        tenantId: 'tenant-1',
        taskId: 'task-1',
        planVersion: 2,
        steps: [planStep({ stepNo: 1, stepKey: 's1', carriedFromStepKey: 's1' })],
      })).rejects.toMatchObject({ response: { code: 'TASK_REVISE_CARRY_UNAVAILABLE' } });
      expect(transaction.stepDelegate.createMany).not.toHaveBeenCalled();
    });

    it('rejects a carried step whose anchor is no longer succeeded', async () => {
      const transaction = materializeTransaction({ anchors: [] });

      await expect(service.materializeSteps(transaction.client, {
        tenantId: 'tenant-1',
        taskId: 'task-1',
        planVersion: 2,
        steps: [planStep({ stepNo: 1, stepKey: 's1', carriedFromStepKey: 's1' })],
        carryFromPlanVersion: 1,
      })).rejects.toMatchObject({ response: { code: 'TASK_REVISE_CARRY_INVALID' } });
      expect(transaction.stepDelegate.createMany).not.toHaveBeenCalled();
    });
  });
});

function clarificationsFixture(): PublicTaskClarification[] {
  return [
    {
      key: 'currency', question: '用哪种币种结算？', answer: null,
      options: [{ id: 'CNY', label: '人民币' }, { id: 'USD', label: '美元' }],
    },
    {
      key: 'scope', question: '覆盖哪些部门？', answer: 'all',
      options: [{ id: 'all', label: '全部部门' }],
    },
  ];
}

function roster(): Map<string, string> {
  return new Map([['agent-1', '数据助理'], ['agent-2', '分析助理']]);
}

function expectBadRequest(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  expect((caught as BadRequestException).getResponse()).toMatchObject({ code });
}

function planStep(
  overrides: Partial<PublicTaskPlanStep> & Pick<PublicTaskPlanStep, 'stepNo' | 'stepKey'>,
): PublicTaskPlanStep {
  return {
    requirement: '完成本步',
    assigneeAgentId: 'agent-1',
    assigneeName: '数据助理',
    expectedOutput: null,
    dependsOnStepKeys: [],
    ...overrides,
  };
}

function materializeTransaction(options: {
  anchors?: Array<{
    stepKey: string;
    summary: string | null;
    outputRefs: unknown;
    startedAt: Date | null;
    completedAt: Date | null;
  }>;
} = {}) {
  const stepDelegate = {
    findMany: jest.fn().mockResolvedValue(options.anchors ?? []),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const client = { assistantTaskStep: stepDelegate } as unknown as Parameters<PlanService['materializeSteps']>[0];
  return { client, stepDelegate };
}
