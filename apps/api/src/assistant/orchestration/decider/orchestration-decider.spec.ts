import type { InvokeResponse } from '@cees/ai-service-client';
import type { AiServiceGateway } from '../../../ai-orchestration/ai-service-gateway.service';
import type { Decision, DecisionInput } from './decider.types';
import { LlmDeciderService } from './llm-decider';
import {
  adjudicateSufficiencyChoice,
  loadOrchestrationDeciderConfig,
} from './orchestration-decider.config';
import { createOrchestrationDecider } from './orchestration-decider.factory';
import { RuleDeciderService } from './rule-decider';

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '40000000-0000-0000-0000-000000000001';
const TASK_ID = '20000000-0000-0000-0000-000000000001';

function decisionInput(options?: {
  decisionType?: DecisionInput['decisionType'];
  sufficiency?: { askedCount: number; maxQuestions: number; duplicatePending: boolean };
}): DecisionInput {
  return {
    decisionType: options?.decisionType ?? 'SUFFICIENCY_CHECK',
    context: { tenantId: TENANT_ID, userId: USER_ID, requestId: `task:${TASK_ID}:step:1` },
    taskSnapshot: {
      taskId: TASK_ID,
      goal: '完成季度销售分析',
      planVersion: 1,
      steps: [{ stepKey: 's1', title: '收集数据', status: 'WAITING_USER', summary: null }],
    },
    stepResult: {
      stepKey: 's1',
      stepTitle: '收集数据',
      summary: null,
      question: { kind: 'question', summary: '要包含去年同期对比吗？', optionCount: 0 },
      sufficiency: options?.sufficiency ?? {
        askedCount: 0,
        maxQuestions: 10,
        duplicatePending: false,
      },
    },
  };
}

describe('RuleDeciderService', () => {
  const service = new RuleDeciderService();

  it('rules to proceed when the per-task question budget is exhausted', () => {
    const decision = service.tryDecide(
      decisionInput({ sufficiency: { askedCount: 10, maxQuestions: 10, duplicatePending: false } }),
    );

    expect(decision).toEqual(expect.objectContaining({ choice: 'proceed', confidence: 1 }));
    expect(decision?.rationale).toContain('提问次数已达上限');
  });

  it('rules to proceed when a duplicate pending question exists', () => {
    const decision = service.tryDecide(
      decisionInput({ sufficiency: { askedCount: 1, maxQuestions: 10, duplicatePending: true } }),
    );

    expect(decision).toEqual(expect.objectContaining({ choice: 'proceed', confidence: 1 }));
    expect(decision?.rationale).toContain('避免重复打扰用户');
  });

  it('defers to the llm path when no deterministic rule applies', () => {
    expect(service.tryDecide(decisionInput())).toBeNull();
    expect(service.tryDecide(decisionInput({ decisionType: 'ROUTING' }))).toBeNull();
    const withoutSufficiency = decisionInput();
    delete withoutSufficiency.stepResult!.sufficiency;
    expect(service.tryDecide(withoutSufficiency)).toBeNull();
  });

  it('treats a non-positive budget as unlimited', () => {
    expect(
      service.tryDecide(
        decisionInput({ sufficiency: { askedCount: 5, maxQuestions: 0, duplicatePending: false } }),
      ),
    ).toBeNull();
  });

  it('rules to retry while a retryable failure still has attempts left', () => {
    const input = decisionInput({ decisionType: 'FAILURE_HANDLING' });
    input.stepResult!.failure = {
      code: 'STEP_EXECUTION_ERROR',
      attemptNo: 1,
      maxAttempts: 3,
      retryable: true,
    };

    const decision = service.tryDecide(input);

    expect(decision).toEqual(expect.objectContaining({ choice: 'retry', confidence: 1 }));
    expect(decision?.rationale).toContain('第 1/3 次');
  });

  it('rules to escalate when retries are exhausted or the error is not retryable', () => {
    const exhausted = decisionInput({ decisionType: 'FAILURE_HANDLING' });
    exhausted.stepResult!.failure = {
      code: 'STEP_EXECUTION_ERROR',
      attemptNo: 3,
      maxAttempts: 3,
      retryable: true,
    };
    const first = service.tryDecide(exhausted);
    expect(first).toEqual(expect.objectContaining({ choice: 'escalate', confidence: 1 }));
    expect(first?.rationale).toContain('尝试次数已达上限');

    const permanent = decisionInput({ decisionType: 'FAILURE_HANDLING' });
    permanent.stepResult!.failure = {
      code: 'STEP_TOOL_FORBIDDEN',
      attemptNo: 1,
      maxAttempts: 3,
      retryable: false,
    };
    const second = service.tryDecide(permanent);
    expect(second).toEqual(expect.objectContaining({ choice: 'escalate', confidence: 1 }));
    expect(second?.rationale).toContain('错误不可自动重试');
  });

  it('defers a failure handling decision when the failure context is absent', () => {
    expect(service.tryDecide(decisionInput({ decisionType: 'FAILURE_HANDLING' }))).toBeNull();
  });
});

describe('loadOrchestrationDeciderConfig', () => {
  it('defaults to rule_llm with 0.9/0.6 confidence thresholds', () => {
    expect(loadOrchestrationDeciderConfig({})).toEqual({
      mode: 'rule_llm',
      confidenceHigh: 0.9,
      confidenceLow: 0.6,
    });
  });

  it('reads explicit mode and thresholds from the environment', () => {
    expect(
      loadOrchestrationDeciderConfig({
        ORCHESTRATION_DECIDER: 'rule',
        ORCHESTRATION_CONFIDENCE_HIGH: '0.8',
        ORCHESTRATION_CONFIDENCE_LOW: '0.5',
      } as NodeJS.ProcessEnv),
    ).toEqual({ mode: 'rule', confidenceHigh: 0.8, confidenceLow: 0.5 });
  });

  it('falls back to defaults on unknown mode and out-of-range thresholds', () => {
    expect(
      loadOrchestrationDeciderConfig({
        ORCHESTRATION_DECIDER: 'jev',
        ORCHESTRATION_CONFIDENCE_HIGH: '1.5',
        ORCHESTRATION_CONFIDENCE_LOW: 'abc',
      } as NodeJS.ProcessEnv),
    ).toEqual({ mode: 'rule_llm', confidenceHigh: 0.9, confidenceLow: 0.6 });
  });
});

describe('adjudicateSufficiencyChoice', () => {
  const config = { mode: 'rule_llm', confidenceHigh: 0.9, confidenceLow: 0.6 } as const;

  it('lets ask_user through at any confidence', () => {
    const decision = { choice: 'ask_user', confidence: 0.3, rationale: '缺关键信息' };
    expect(adjudicateSufficiencyChoice(decision, config)).toEqual(decision);
  });

  it('keeps a high-confidence proceed', () => {
    const decision = { choice: 'proceed', confidence: 0.9, rationale: '可推断' };
    expect(adjudicateSufficiencyChoice(decision, config)).toEqual(decision);
  });

  it('downgrades mid and low confidence proceeds to ask_user', () => {
    const mid = adjudicateSufficiencyChoice(
      { choice: 'proceed', confidence: 0.7, rationale: '大致可推断' },
      config,
    );
    expect(mid.choice).toBe('ask_user');
    expect(mid.rationale).toContain('中置信且不足以自主继续');

    const low = adjudicateSufficiencyChoice({ choice: 'proceed', confidence: 0.2 }, config);
    expect(low.choice).toBe('ask_user');
    expect(low.rationale).toContain('低置信且不足以自主继续');
  });

  it('maps an unrecognized choice to ask_user', () => {
    const decision = adjudicateSufficiencyChoice({ choice: 'abort', confidence: 1 }, config);
    expect(decision).toEqual(expect.objectContaining({ choice: 'ask_user', confidence: 0 }));
    expect(decision.rationale).toContain('choice=abort');
  });
});

describe('createOrchestrationDecider', () => {
  function harness() {
    const rule = { tryDecide: jest.fn() } as unknown as RuleDeciderService;
    const llm = { decide: jest.fn() } as unknown as LlmDeciderService;
    const ruleTryDecide = jest.mocked(rule.tryDecide);
    const llmDecide = jest.mocked(llm.decide);
    return { ruleTryDecide, llmDecide };
  }

  const config = { mode: 'rule_llm', confidenceHigh: 0.9, confidenceLow: 0.6 } as const;

  it('returns the deterministic rule decision without calling the llm', async () => {
    const { ruleTryDecide, llmDecide } = harness();
    const ruled: Decision = { choice: 'proceed', confidence: 1, rationale: '已达上限' };
    ruleTryDecide.mockReturnValue(ruled);
    const decider = createOrchestrationDecider({
      rule: { tryDecide: ruleTryDecide } as unknown as RuleDeciderService,
      llm: { decide: llmDecide } as unknown as LlmDeciderService,
      config,
    });

    await expect(decider.decide(decisionInput())).resolves.toEqual(ruled);
    expect(llmDecide).not.toHaveBeenCalled();
  });

  it('allows questions directly in pure rule mode when no rule applies', async () => {
    const { ruleTryDecide, llmDecide } = harness();
    ruleTryDecide.mockReturnValue(null);
    const decider = createOrchestrationDecider({
      rule: { tryDecide: ruleTryDecide } as unknown as RuleDeciderService,
      llm: { decide: llmDecide } as unknown as LlmDeciderService,
      config: { ...config, mode: 'rule' },
    });

    const decision = await decider.decide(decisionInput());

    expect(decision.choice).toBe('ask_user');
    expect(decision.rationale).toContain('规则模式');
    expect(llmDecide).not.toHaveBeenCalled();
  });

  it('adjudicates the llm decision by confidence thresholds', async () => {
    const { ruleTryDecide, llmDecide } = harness();
    ruleTryDecide.mockReturnValue(null);
    llmDecide.mockResolvedValue({ choice: 'proceed', confidence: 0.4, rationale: '倾向继续' });
    const decider = createOrchestrationDecider({
      rule: { tryDecide: ruleTryDecide } as unknown as RuleDeciderService,
      llm: { decide: llmDecide } as unknown as LlmDeciderService,
      config,
    });

    const decision = await decider.decide(decisionInput());

    expect(llmDecide).toHaveBeenCalledWith(expect.objectContaining({ decisionType: 'SUFFICIENCY_CHECK' }));
    // 低置信 proceed 不足以自主继续：转用户确认（安全方向）。
    expect(decision.choice).toBe('ask_user');
  });

  it('falls back to allowing the question when the llm path throws', async () => {
    const { ruleTryDecide, llmDecide } = harness();
    ruleTryDecide.mockReturnValue(null);
    llmDecide.mockRejectedValue(new Error('ai-service unavailable'));
    const decider = createOrchestrationDecider({
      rule: { tryDecide: ruleTryDecide } as unknown as RuleDeciderService,
      llm: { decide: llmDecide } as unknown as LlmDeciderService,
      config,
    });

    const decision = await decider.decide(decisionInput());

    expect(decision).toEqual(expect.objectContaining({ choice: 'ask_user', confidence: 0 }));
    expect(decision.rationale).toContain('决策器不可用');
  });

  it('escalates a failure handling decision without context instead of calling the llm', async () => {
    const { ruleTryDecide, llmDecide } = harness();
    ruleTryDecide.mockReturnValue(null);
    const decider = createOrchestrationDecider({
      rule: { tryDecide: ruleTryDecide } as unknown as RuleDeciderService,
      llm: { decide: llmDecide } as unknown as LlmDeciderService,
      config,
    });

    const decision = await decider.decide(decisionInput({ decisionType: 'FAILURE_HANDLING' }));

    // 失败处置无上下文时升级用户是安全方向：不静默重试、不静默跳过、不调模型。
    expect(decision).toEqual(expect.objectContaining({ choice: 'escalate', confidence: 0 }));
    expect(decision.rationale).toContain('缺少可判定上下文');
    expect(llmDecide).not.toHaveBeenCalled();
  });
});

describe('LlmDeciderService', () => {
  function harness() {
    const invoke = jest.fn();
    const service = new LlmDeciderService({ invoke } as unknown as AiServiceGateway);
    return { service, invoke };
  }

  function response(patch: { type: string; value: unknown }): InvokeResponse {
    return { output: patch } as unknown as InvokeResponse;
  }

  it('projects a structured decision request with the orchestration_decision role', async () => {
    const { service, invoke } = harness();
    invoke.mockResolvedValue(
      response({ type: 'json', value: { choice: 'proceed', confidence: 0.95, rationale: '可推断' } }),
    );

    const decision = await service.decide(decisionInput());

    expect(decision).toEqual({ choice: 'proceed', confidence: 0.95, rationale: '可推断' });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      request_id: `task:${TASK_ID}:step:1:decider:0`,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      role: 'orchestration_decision',
      temperature: 0,
      response_format: expect.objectContaining({
        type: 'json_schema',
        name: 'orchestration_decision',
      }),
    }));
    const request = invoke.mock.calls[0]![0] as Record<string, any>;
    expect(request.messages).toHaveLength(2);
    expect(request.messages[1].content[0].text).toContain('要包含去年同期对比吗？');
  });

  it('drops an empty rationale and truncates an overlong one', async () => {
    const { service, invoke } = harness();
    invoke
      .mockResolvedValueOnce(
        response({ type: 'json', value: { choice: 'ask_user', confidence: 0.8, rationale: '  ' } }),
      )
      .mockResolvedValueOnce(
        response({ type: 'json', value: { choice: 'ask_user', confidence: 1, rationale: 'x'.repeat(600) } }),
      );

    expect((await service.decide(decisionInput())).rationale).toBeUndefined();
    expect((await service.decide(decisionInput())).rationale).toHaveLength(500);
  });

  it('retries once on a malformed output and then succeeds', async () => {
    const { service, invoke } = harness();
    invoke
      .mockResolvedValueOnce(response({ type: 'text', value: 'not json' }))
      .mockResolvedValueOnce(
        response({ type: 'json', value: { choice: 'proceed', confidence: 1, rationale: 'ok' } }),
      );

    const decision = await service.decide(decisionInput());

    expect(decision.choice).toBe('proceed');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect((invoke.mock.calls[1]![0] as Record<string, any>).request_id).toContain(':decider:1');
  });

  it('throws after a second malformed output and rejects invalid values', async () => {
    const { service, invoke } = harness();
    invoke.mockResolvedValue(response({ type: 'json', value: { choice: 'abort', confidence: 1 } }));

    await expect(service.decide(decisionInput())).rejects.toThrow('unknown choice');
    expect(invoke).toHaveBeenCalledTimes(2);

    invoke.mockReset();
    invoke.mockResolvedValue(
      response({ type: 'json', value: { choice: 'proceed', confidence: 2 } }),
    );
    await expect(service.decide(decisionInput())).rejects.toThrow('invalid confidence');
  });
});
