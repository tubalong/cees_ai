import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AclController } from './acl.controller';
import { AclService } from './acl.service';
import { ResourceAccessService } from './resource-access.service';

@Module({
    imports: [AuthModule],
    controllers: [AclController],
    providers: [ResourceAccessService, AclService],
    exports: [ResourceAccessService, AclService],
})
export class ResourceModule { }
