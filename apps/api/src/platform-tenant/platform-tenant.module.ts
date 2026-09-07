import { Module } from '@nestjs/common';
import { PlatformAuthModule } from '../platform-auth/platform-auth.module';
import { PlatformAuditController, PlatformTenantController } from './platform-tenant.controller';
import { PlatformTenantService } from './platform-tenant.service';

@Module({
    imports: [PlatformAuthModule],
    controllers: [PlatformTenantController, PlatformAuditController],
    providers: [PlatformTenantService],
    exports: [PlatformTenantService],
})
export class PlatformTenantModule { }
