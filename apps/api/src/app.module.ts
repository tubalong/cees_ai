import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseModule } from './database/database.module';
import { TenantModule } from './tenant/tenant.module';
import { AuthModule } from './auth/auth.module';
import { BusinessModules } from './modules';

@Module({
    imports: [DatabaseModule, TenantModule, AuthModule, ...BusinessModules],
    controllers: [HealthController],
})
export class AppModule { }