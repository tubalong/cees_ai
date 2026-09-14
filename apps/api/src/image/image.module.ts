import { Module } from '@nestjs/common';
import { AiOrchestrationModule } from '../ai-orchestration/ai-orchestration.module';
import { AuthModule } from '../auth/auth.module';
import { ResourceModule } from '../resource/resource.module';
import { StorageModule } from '../storage/storage.module';
import { ImageController } from './image.controller';
import { ImageMaintenanceService } from './image-maintenance.service';
import { ImageService } from './image.service';

/**
 * 图片资源模块：AI 图片生成结果的正式落点（COS 落盘、资源落库、动作流水、
 * 审计）与公开访问入口（GET /images/{imageId}）。与 DocumentModule 同模式，
 * 不复制编排逻辑。
 */
@Module({
    imports: [AiOrchestrationModule, AuthModule, ResourceModule, StorageModule],
    controllers: [ImageController],
    providers: [ImageService, ImageMaintenanceService],
    exports: [ImageService],
})
export class ImageModule { }
