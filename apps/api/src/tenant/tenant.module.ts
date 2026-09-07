import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { TenantContext } from './tenant-context';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantController } from './tenant.controller';
import { TenantGuard } from './tenant.guard';
import { TenantService } from './tenant.service';

@Global()
@Module({
    imports: [AuthModule, RbacModule],
    controllers: [TenantController],
    providers: [TenantContext, TenantContextInterceptor, TenantGuard, TenantService],
    exports: [TenantContext, TenantContextInterceptor, TenantGuard, TenantService],
})
export class TenantModule { }
