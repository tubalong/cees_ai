import { Module, Type } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { DocumentModule } from './document/document.module';
import { RbacModule } from './rbac/rbac.module';
import { ResourceModule } from './resource/resource.module';
import { AiOrchestrationModule } from './ai-orchestration/ai-orchestration.module';
import { OrganizationModule } from './organization/organization.module';
import { UserModule } from './user/user.module';
import { FileModule } from './file/file.module';
import { ProjectModule } from './project/project.module';
import { TaskModule } from './task/task.module';
import { MeetingModule } from './meeting/meeting.module';
import { ChatModule } from './chat/chat.module';

@Module({}) export class WorkReportModule { }
@Module({}) export class KnowledgeModule { }
@Module({}) export class NotificationModule { }
@Module({}) export class DashboardModule { }
@Module({}) export class IntegrationModule { }
@Module({}) export class CommonModule { }
@Module({}) export class JobsModule { }

export const BusinessModules: Type[] = [
    OrganizationModule, RbacModule, UserModule, ProjectModule, TaskModule, ChatModule, WorkReportModule,
    FileModule, KnowledgeModule, ResourceModule, DocumentModule, MeetingModule, NotificationModule, DashboardModule,
    AiOrchestrationModule, IntegrationModule, AuditModule, CommonModule, JobsModule,
];
