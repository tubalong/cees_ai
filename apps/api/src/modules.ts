import { Module, Type } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { RbacModule } from './rbac/rbac.module';

@Module({}) export class OrganizationModule { }
@Module({}) export class UserModule { }
@Module({}) export class ProjectModule { }
@Module({}) export class TaskModule { }
@Module({}) export class WorkReportModule { }
@Module({}) export class FileModule { }
@Module({}) export class KnowledgeModule { }
@Module({}) export class MeetingModule { }
@Module({}) export class NotificationModule { }
@Module({}) export class DashboardModule { }
@Module({}) export class AiOrchestrationModule { }
@Module({}) export class IntegrationModule { }
@Module({}) export class CommonModule { }
@Module({}) export class JobsModule { }

export const BusinessModules: Type[] = [
    OrganizationModule, RbacModule, UserModule, ProjectModule, TaskModule, WorkReportModule,
    FileModule, KnowledgeModule, MeetingModule, NotificationModule, DashboardModule,
    AiOrchestrationModule, IntegrationModule, AuditModule, CommonModule, JobsModule,
];
