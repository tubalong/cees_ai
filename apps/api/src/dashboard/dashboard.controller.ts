import { Body, Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { DashboardTaskStatisticsQueryDto, DashboardTodosQueryDto, DashboardTrendsQueryDto, DashboardUpcomingMeetingsQueryDto, RebuildDashboardSnapshotDto } from './dto';
import { DashboardHomepageService } from './homepage.service';
import { DashboardHomepageResult, DashboardTrendsResult } from './homepage.types';
import { DashboardSnapshotService } from './snapshot.service';
import { DashboardService } from './dashboard.service';
import { DashboardOverviewResult, DashboardTaskMetrics, DashboardTodoListResult, DashboardUpcomingMeetingListResult } from './dashboard.types';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
@RequirePermissions('dashboard.read')
export class DashboardController {
    constructor(private readonly dashboardService: DashboardService, private readonly homepageService: DashboardHomepageService, private readonly snapshotService: DashboardSnapshotService) { }

    @Get('home')
    @ApiOkResponse({ description: '按当前成员能力位裁剪的角色化首页' })
    home(): Promise<DashboardHomepageResult> { return this.homepageService.home(); }

    @Get('trends')
    @ApiOkResponse({ description: '查询角色化首页历史指标快照' })
    trends(@Query() query: DashboardTrendsQueryDto): Promise<DashboardTrendsResult> { return this.homepageService.trends(query); }

    @Post('snapshots/rebuild')
    @RequirePermissions('dashboard.read', 'role.assign')
    rebuildSnapshot(@Body() input: RebuildDashboardSnapshotDto): Promise<{ periodStart: Date; count: number }> {
        return this.snapshotService.rebuildTenantDay(input.tenantId, input.date);
    }

    @Get('overview')
    @ApiOkResponse({ description: '当前成员工作台概览' })
    overview(): Promise<DashboardOverviewResult> {
        return this.dashboardService.overview();
    }

    @Get('task-statistics')
    @ApiOkResponse({ description: '当前成员可见任务统计' })
    taskStatistics(@Query() query: DashboardTaskStatisticsQueryDto): Promise<DashboardTaskMetrics> {
        return this.dashboardService.taskStatistics(query);
    }

    @Get('todos')
    @ApiOkResponse({ description: '当前成员工作台待办' })
    todos(@Query() query: DashboardTodosQueryDto): Promise<DashboardTodoListResult> {
        return this.dashboardService.todos(query);
    }

    @Get('upcoming-meetings')
    @ApiOkResponse({ description: '当前成员近期会议' })
    upcomingMeetings(@Query() query: DashboardUpcomingMeetingsQueryDto): Promise<DashboardUpcomingMeetingListResult> {
        return this.dashboardService.upcomingMeetings(query);
    }
}
