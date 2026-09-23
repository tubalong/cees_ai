import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../platform-auth/platform-auth.module';
import { AICreditCapabilityController } from './platform-ai-credit.controller';
import { AICreditCapabilityService } from './platform-ai-credit.service';

@Module({
    imports: [PlatformAuthModule],
    controllers: [AICreditCapabilityController],
    providers: [AICreditCapabilityService],
    exports: [AICreditCapabilityService],
})
export class PlatformAICreditModule { }
