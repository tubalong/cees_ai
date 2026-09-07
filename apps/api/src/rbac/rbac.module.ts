import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DataScopeGuard } from './data-scope.guard';
import { PermissionGuard } from './permission.guard';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

@Global()
@Module({
    imports: [AuthModule],
    controllers: [RbacController],
    providers: [PermissionGuard, DataScopeGuard, RbacService],
    exports: [PermissionGuard, DataScopeGuard, RbacService],
})
export class RbacModule { }
