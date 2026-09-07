import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { HealthController } from './health.controller';
import { DatabaseModule } from './database/database.module';
import { TenantModule } from './tenant/tenant.module';
import { AuthModule } from './auth/auth.module';
import { BusinessModules } from './modules';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
        }),
        DatabaseModule,
        TenantModule,
        AuthModule,
        ...BusinessModules,
    ],
    controllers: [HealthController],
})
export class AppModule { }
