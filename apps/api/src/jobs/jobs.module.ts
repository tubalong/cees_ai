import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LegalModule } from '../legal/legal.module';
import { HrModule } from '../hr/hr.module';
import { NotificationModule } from '../notification/notification.module';
import { BackgroundJobsService } from './background-jobs.service';

@Module({
    imports: [NotificationModule, LegalModule, HrModule, AuditModule],
    providers: [BackgroundJobsService],
    exports: [BackgroundJobsService],
})
export class JobsModule { }
