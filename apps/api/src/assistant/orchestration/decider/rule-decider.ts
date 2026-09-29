import { Injectable } from '@nestjs/common';
import type { Decision, DecisionInput } from './decider.types';

/**
 * 规则路径（技术设计 §6.2：确定性场景不调模型）。v1 仅覆盖 SUFFICIENCY_CHECK
 * 的“防滥用”类确定性判定（超限 / 重复）；“该问题是否真的必要”属模糊场景，
 * 返回 null 交 LLM 路径。其余决策类型（ROUTING / COMPLETION_CHECK 等）本期
 * 由代码路径直接确定性处理，未接入本决策器，同样返回 null。
 */
@Injectable()
export class RuleDeciderService {
  /** 返回确定性判定；不确定返回 null（交后续路径）。 */
  tryDecide(input: DecisionInput): Decision | null {
    if (input.decisionType !== 'SUFFICIENCY_CHECK') return null;
    const sufficiency = input.stepResult?.sufficiency;
    if (!sufficiency) return null;

    if (sufficiency.maxQuestions > 0 && sufficiency.askedCount >= sufficiency.maxQuestions) {
      return {
        choice: 'proceed',
        confidence: 1,
        rationale: `本任务提问次数已达上限（${sufficiency.maxQuestions}），需基于现有信息继续`,
      };
    }
    if (sufficiency.duplicatePending) {
      return {
        choice: 'proceed',
        confidence: 1,
        rationale: '同类问题已有未决请求，避免重复打扰用户',
      };
    }
    return null;
  }
}
