import { Module, Type } from '@nestjs/common';
import { AiOrchestrationModule } from './ai-orchestration/ai-orchestration.module';

@Module({}) export class OrganizationModule { }
@Module({}) export class RbacModule { }
@Module({}) export class UserModule { }
@Module({}) export class ProjectModule { }
@Module({}) export class TaskModule { }
@Module({}) export class FileModule { }
@Module({}) export class NotificationModule { }
@Module({}) export class IntegrationModule { }
@Module({}) export class AuditModule { }
@Module({}) export class CommonModule { }
@Module({}) export class JobsModule { }

export const BusinessModules: Type[] = [
    OrganizationModule, RbacModule, UserModule, ProjectModule, TaskModule, FileModule,
    NotificationModule, AiOrchestrationModule, IntegrationModule, AuditModule,
    CommonModule, JobsModule,
];
