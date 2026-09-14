import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TurnStateService } from './turn-state.service';
import { ASSISTANT_RECOVERY_INTERVAL_MS } from './turn-execution.config';

/**
 * 多实例安全的失联轮次收束器。它不盲目重放可能收费或写业务数据的工具；
 * 租约过期后由数据库条件更新抢占，并把不确定的工具标记为 RECOVERY_REQUIRED。
 */
@Injectable()
export class TurnRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TurnRecoveryService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly state: TurnStateService) {}

  onModuleInit(): void {
    if (process.env.ASSISTANT_RECOVERY_ENABLED === 'false') return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), ASSISTANT_RECOVERY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<number> {
    try {
      const recovered = await this.state.recoverStaleTurns(now);
      if (recovered > 0) {
        this.logger.warn(`reconciled ${recovered} stale assistant turn(s)`);
      }
      return recovered;
    } catch (error) {
      this.logger.error(`assistant turn recovery scan failed: ${String(error)}`);
      return 0;
    }
  }
}
