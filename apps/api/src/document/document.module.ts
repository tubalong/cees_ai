import { Module } from '@nestjs/common';
import { AiOrchestrationModule } from '../ai-orchestration/ai-orchestration.module';
import { AuthModule } from '../auth/auth.module';
import { ResourceModule } from '../resource/resource.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';

@Module({
    imports: [AiOrchestrationModule, AuthModule, ResourceModule],
    controllers: [DocumentController],
    providers: [DocumentService],
    exports: [DocumentService],
})
export class DocumentModule { }
