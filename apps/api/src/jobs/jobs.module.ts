import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { BackgroundJobsService } from './background-jobs.service';

@Module({
    imports: [NotificationModule],
    providers: [BackgroundJobsService],
    exports: [BackgroundJobsService],
})
export class JobsModule { }
