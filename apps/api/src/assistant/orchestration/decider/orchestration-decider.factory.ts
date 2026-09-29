import { Logger, type Provider } from '@nestjs/common';
import type { Decision, DecisionInput, OrchestrationDecider } from './decider.types';
import { ORCHESTRATION_DECIDER } from './decider.types';
import { LlmDeciderService } from './llm-decider';
import {
  adjudicateSufficiencyChoice,
  loadOrchestrationDeciderConfig,
  type OrchestrationDeciderConfig,
} from './orchestration-decider.config';
import { RuleDeciderService } from './rule-decider';

const logger = new Logger('OrchestrationDeciderFactory');

/**
 * 工厂装配：按配置装配 v1 实现（rule_llm=规则先判、不可判交 LLM；rule=纯规则）。
 * v2 接入 JEV 时只在本文件增加实现分支，编排流程代码零改动（技术设计 §6.3）。
 */
export function createOrchestrationDecider(deps: {
  rule: RuleDeciderService;
  llm: LlmDeciderService;
  config: OrchestrationDeciderConfig;
}): OrchestrationDecider {
  return {
    async decide(input: DecisionInput): Promise<Decision> {
      const deterministic = deps.rule.tryDecide(input);
      if (deterministic) return deterministic;

      if (deps.config.mode === 'rule') {
        return {
          choice: 'ask_user',
          confidence: 0.5,
          rationale: '规则模式默认放行提问（无确定性抑制条件）',
        };
      }

      try {
        const llmDecision = await deps.llm.decide(input);
        return adjudicateSufficiencyChoice(llmDecision, deps.config);
      } catch (error) {
        // 决策器不可用不阻塞流程：放行提问（安全方向），由审计留痕。
        logger.warn(`orchestration decider llm path failed, allowing question: ${String(error)}`);
        return {
          choice: 'ask_user',
          confidence: 0,
          rationale: '决策器不可用，按提问放行（需人工关注）',
        };
      }
    },
  };
}

/** 决策器装配 Provider；业务通过 ORCHESTRATION_DECIDER 令牌注入。 */
export const orchestrationDeciderProvider: Provider = {
  provide: ORCHESTRATION_DECIDER,
  inject: [RuleDeciderService, LlmDeciderService],
  useFactory: (rule: RuleDeciderService, llm: LlmDeciderService) =>
    createOrchestrationDecider({ rule, llm, config: loadOrchestrationDeciderConfig() }),
};
