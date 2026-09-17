import { Module } from '@nestjs/common';
import { LegalModule } from '../legal/legal.module';
import { NotificationModule } from '../notification/notification.module';
import { BackgroundJobsService } from './background-jobs.service';

@Module({
    imports: [NotificationModule, LegalModule],
    providers: [BackgroundJobsService],
    exports: [BackgroundJobsService],
})
export class JobsModule { }
