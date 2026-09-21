import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardHomepageService } from './homepage.service';
import { DashboardService } from './dashboard.service';
import { DashboardSnapshotService } from './snapshot.service';

@Module({
    controllers: [DashboardController],
    providers: [DashboardService, DashboardHomepageService, DashboardSnapshotService],
    exports: [DashboardService, DashboardSnapshotService],
})
export class DashboardModule { }
