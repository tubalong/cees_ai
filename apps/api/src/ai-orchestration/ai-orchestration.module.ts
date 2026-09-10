import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AiInvocationRecorderService } from './ai-invocation-recorder.service';
import { AiServiceClientService } from './ai-service-client.service';

@Module({
  imports: [DatabaseModule],
  providers: [AiInvocationRecorderService, AiServiceClientService],
  exports: [AiInvocationRecorderService, AiServiceClientService],
})
export class AiOrchestrationModule {}
