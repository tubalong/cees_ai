import { Module, Type } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { DocumentModule } from './document/document.module';
import { RbacModule } from './rbac/rbac.module';
import { ResourceModule } from './resource/resource.module';
import { AiOrchestrationModule } from './ai-orchestration/ai-orchestration.module';

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
@Module({}) export class IntegrationModule { }
@Module({}) export class CommonModule { }
@Module({}) export class JobsModule { }

export const BusinessModules: Type[] = [
    OrganizationModule, RbacModule, UserModule, ProjectModule, TaskModule, WorkReportModule,
    FileModule, KnowledgeModule, ResourceModule, DocumentModule, MeetingModule, NotificationModule, DashboardModule,
    AiOrchestrationModule, IntegrationModule, AuditModule, CommonModule, JobsModule,
];
