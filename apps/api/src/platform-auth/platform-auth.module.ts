import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformJwtAuthGuard } from './platform-jwt-auth.guard';
import { PlatformJwtStrategy } from './platform-jwt.strategy';
import { PlatformPermissionGuard } from './platform-permission.guard';

@Module({
    imports: [JwtModule.register({})],
    controllers: [PlatformAuthController],
    providers: [PlatformAuthService, PlatformJwtStrategy, PlatformJwtAuthGuard, PlatformPermissionGuard],
    exports: [PlatformAuthService, PlatformJwtAuthGuard, PlatformPermissionGuard],
})
export class PlatformAuthModule { }
