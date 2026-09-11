import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AiInvocationRecorderService } from './ai-invocation-recorder.service';
import { AiServiceGateway } from './ai-service-gateway.service';

@Module({
  imports: [DatabaseModule],
  providers: [AiInvocationRecorderService, AiServiceGateway],
  exports: [AiInvocationRecorderService, AiServiceGateway],
})
export class AiOrchestrationModule {}
