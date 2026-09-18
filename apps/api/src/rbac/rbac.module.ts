import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DataScopeGuard } from './data-scope.guard';
import { DataScopeResolverService } from './data-scope-resolver.service';
import { PermissionGuard } from './permission.guard';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

@Global()
@Module({
    imports: [AuthModule],
    controllers: [RbacController],
    providers: [PermissionGuard, DataScopeGuard, RbacService, DataScopeResolverService],
    exports: [PermissionGuard, DataScopeGuard, RbacService, DataScopeResolverService],
})
export class RbacModule { }
