import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ImageService } from './image.service';

const DEFAULT_INTERVAL_MS = 5 * 60_000;

/** 定期清理 COS/数据库双写失败后留下的 ORPHANED 图片对象。 */
@Injectable()
export class ImageMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageMaintenanceService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly images: ImageService) {}

  onModuleInit(): void {
    if (process.env.IMAGE_MAINTENANCE_ENABLED === 'false') return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<number> {
    try {
      const cleaned = await this.images.cleanupOrphanedImages();
      if (cleaned > 0) this.logger.warn(`cleaned ${cleaned} orphaned generated image object(s)`);
      return cleaned;
    } catch (error) {
      this.logger.error(`generated image maintenance failed: ${String(error)}`);
      return 0;
    }
  }
}
