import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { HealthController } from './health.controller';
import { DatabaseModule } from './database/database.module';
import { TenantModule } from './tenant/tenant.module';
import { AuthModule } from './auth/auth.module';
import { PlatformTenantModule } from './platform-tenant/platform-tenant.module';
import { PlatformAICreditModule } from './platform-ai-credit/platform-ai-credit.module';
import { RedisModule } from './redis/redis.module';
import { BusinessModules } from './modules';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
        }),
        DatabaseModule,
        RedisModule,
        TenantModule,
        AuthModule,
        PlatformTenantModule,
        PlatformAICreditModule,
        ...BusinessModules,
    ],
    controllers: [HealthController],
})
export class AppModule { }
