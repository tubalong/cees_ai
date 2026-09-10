import { Module } from '@nestjs/common';
import { AiOrchestrationModule } from '../ai-orchestration/ai-orchestration.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [AiOrchestrationModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
