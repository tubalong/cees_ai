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
import { WorkReportModule } from './work-report/work-report.module';
import { NotificationModule } from './notification/notification.module';
import { JobsModule } from './jobs/jobs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AssistantModule } from './assistant/assistant.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { DingTalkModule } from './dingtalk/dingtalk.module';
import { AssignmentModule } from './assignment/assignment.module';
import { HrModule } from './hr/hr.module';
import { FinanceModule } from './finance/finance.module';

@Module({}) export class IntegrationModule { }
@Module({}) export class CommonModule { }

export const BusinessModules: Type[] = [
    OrganizationModule, RbacModule, UserModule, ProjectModule, TaskModule, AssistantModule, WorkReportModule,
    FileModule, KnowledgeModule, ResourceModule, DocumentModule, MeetingModule, NotificationModule, DashboardModule,
    AiOrchestrationModule, IntegrationModule, AuditModule, CommonModule, JobsModule, DingTalkModule, AssignmentModule,
    HrModule, FinanceModule,
];
