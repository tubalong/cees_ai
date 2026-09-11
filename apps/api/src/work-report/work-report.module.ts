import { Module } from '@nestjs/common';
import { WorkReportController } from './work-report.controller';
import { WorkReportService } from './work-report.service';

@Module({ controllers: [WorkReportController], providers: [WorkReportService], exports: [WorkReportService] })
export class WorkReportModule { }
