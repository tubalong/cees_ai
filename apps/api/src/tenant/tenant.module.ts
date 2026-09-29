import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import {
    TenantInvitationAcceptanceController,
    TenantInvitationController,
} from '../tenant-invitation/tenant-invitation.controller';
import { TenantInvitationService } from '../tenant-invitation/tenant-invitation.service';
import { TenantContext } from './tenant-context';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantController } from './tenant.controller';
import { TenantGuard } from './tenant.guard';
import { TenantService } from './tenant.service';
import { TenantTimeZoneService } from './tenant-time-zone.service';

@Global()
@Module({
    imports: [AuthModule, RbacModule],
    controllers: [TenantController, TenantInvitationController, TenantInvitationAcceptanceController],
    providers: [TenantContext, TenantContextInterceptor, TenantGuard, TenantService, TenantInvitationService, TenantTimeZoneService],
    exports: [TenantContext, TenantContextInterceptor, TenantGuard, TenantService, TenantInvitationService, TenantTimeZoneService],
})
export class TenantModule { }
