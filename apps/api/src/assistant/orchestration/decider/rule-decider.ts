import { Injectable } from '@nestjs/common';
import type { Decision, DecisionInput } from './decider.types';

/**
 * 规则路径（技术设计 §6.2：确定性场景不调模型）。v1 覆盖两类确定性判定：
 * - SUFFICIENCY_CHECK 的“防滥用”类判定（超限 / 重复）；“该问题是否真的必要”
 *   属模糊场景，返回 null 交 LLM 路径；
 * - FAILURE_HANDLING 的失败阶梯判定（重试余额与错误可重试性均已知，永远可判）。
 * 其余决策类型（ROUTING / COMPLETION_CHECK 等）本期由代码路径直接确定性处理，
 * 未接入本决策器，同样返回 null。
 */
@Injectable()
export class RuleDeciderService {
  /** 返回确定性判定；不确定返回 null（交后续路径）。 */
  tryDecide(input: DecisionInput): Decision | null {
    if (input.decisionType === 'FAILURE_HANDLING') {
      return this.decideFailureHandling(input);
    }
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

  /**
   * 失败阶梯判定（需求 §8.1）：可重试错误且尝试未达上限→自动重试；
   * 其余（不可重试错误 / 尝试超限）→升级用户裁决。
   */
  private decideFailureHandling(input: DecisionInput): Decision | null {
    const failure = input.stepResult?.failure;
    if (!failure) return null;
    if (failure.retryable && failure.attemptNo < failure.maxAttempts) {
      return {
        choice: 'retry',
        confidence: 1,
        rationale: `第 ${failure.attemptNo}/${failure.maxAttempts} 次尝试失败（${failure.code}），`
          + '错误可重试且余额充足，将按退避自动重试',
      };
    }
    const reason = failure.retryable
      ? '尝试次数已达上限'
      : '错误不可自动重试';
    return {
      choice: 'escalate',
      confidence: 1,
      rationale: `${reason}（第 ${failure.attemptNo}/${failure.maxAttempts} 次尝试失败），升级用户裁决`,
    };
  }
}
