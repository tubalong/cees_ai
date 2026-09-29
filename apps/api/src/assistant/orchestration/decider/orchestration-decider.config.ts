import { Logger } from '@nestjs/common';

/**
 * 决策器配置（技术设计 §11）：实现选择与置信度阈值。
 * 阈值按租户可配置是目标形态；v1 先以环境变量提供全局默认，租户级配置
 * 待租户设置机制接入后在装配处覆盖（替换点集中在工厂）。
 */
export type OrchestrationDeciderMode = 'rule_llm' | 'rule';

export interface OrchestrationDeciderConfig {
  mode: OrchestrationDeciderMode;
  /** 高置信阈值：达到才自动采纳（否则走保守分支）。 */
  confidenceHigh: number;
  /** 低置信阈值：低于则升级用户裁决（v1 的 SUFFICIENCY_CHECK 映射为放行提问）。 */
  confidenceLow: number;
}

const DEFAULT_MODE: OrchestrationDeciderMode = 'rule_llm';
const DEFAULT_CONFIDENCE_HIGH = 0.9;
const DEFAULT_CONFIDENCE_LOW = 0.6;

const logger = new Logger('OrchestrationDeciderConfig');

export function loadOrchestrationDeciderConfig(
  env: NodeJS.ProcessEnv = process.env,
): OrchestrationDeciderConfig {
  return {
    mode: readMode(env.ORCHESTRATION_DECIDER),
    confidenceHigh: readThreshold(env.ORCHESTRATION_CONFIDENCE_HIGH, DEFAULT_CONFIDENCE_HIGH),
    confidenceLow: readThreshold(env.ORCHESTRATION_CONFIDENCE_LOW, DEFAULT_CONFIDENCE_LOW),
  };
}

function readMode(value: string | undefined): OrchestrationDeciderMode {
  if (!value || value === 'rule_llm') return 'rule_llm';
  if (value === 'rule') return 'rule';
  // 未知取值（含未来的 jev）回退默认组合实现，不因配置漂移中断编排。
  logger.warn(`unknown ORCHESTRATION_DECIDER value "${value}", falling back to rule_llm`);
  return DEFAULT_MODE;
}

/** 阈值解析：非法值（非数字 / 越界）回退默认，避免配置错误放大为判定漂移。 */
function readThreshold(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    logger.warn(`invalid confidence threshold "${value}", falling back to ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * 置信度分流（技术设计 §6.2）：>= high 自动执行；[low, high) 保守分支；
 * < low 升级用户裁决。SUFFICIENCY_CHECK 的具体映射：
 * - ask_user 无论置信度都放行（提问是安全方向，等价保守 / 升级）；
 * - proceed 仅在高置信时采纳，否则转为放行提问（不自行冒险替用户决定）。
 */
export function adjudicateSufficiencyChoice(
  decision: { choice: string; confidence: number; rationale?: string },
  config: OrchestrationDeciderConfig,
): { choice: string; confidence: number; rationale?: string } {
  if (decision.choice === 'ask_user') return decision;
  if (decision.choice === 'proceed' && decision.confidence >= config.confidenceHigh) {
    return decision;
  }
  if (decision.choice === 'proceed') {
    const band = decision.confidence >= config.confidenceLow ? '中置信' : '低置信';
    return {
      choice: 'ask_user',
      confidence: decision.confidence,
      rationale: `${decision.rationale ?? ''}（${band}且不足以自主继续，转用户确认）`.trim(),
    };
  }
  return {
    choice: 'ask_user',
    confidence: 0,
    rationale: `决策器输出不可识别（choice=${decision.choice}），按提问放行`,
  };
}
