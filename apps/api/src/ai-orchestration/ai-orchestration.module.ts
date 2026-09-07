import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AiServiceClientService } from './ai-service-client.service';

@Module({
  imports: [DatabaseModule],
  providers: [AiServiceClientService],
  exports: [AiServiceClientService],
})
export class AiOrchestrationModule {}
