import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../platform-auth/platform-auth.module';
import { AICreditCapabilityController } from './platform-ai-credit.controller';
import { AICreditCapabilityService } from './platform-ai-credit.service';
import { AICreditTierController } from './tier.controller';
import { AICreditTierService } from './tier.service';

@Module({
    imports: [PlatformAuthModule],
    controllers: [AICreditCapabilityController, AICreditTierController],
    providers: [AICreditCapabilityService, AICreditTierService],
    exports: [AICreditCapabilityService, AICreditTierService],
})
export class PlatformAICreditModule { }
