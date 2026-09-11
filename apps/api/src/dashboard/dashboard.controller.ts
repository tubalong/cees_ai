import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import { DashboardTaskStatisticsQueryDto, DashboardTodosQueryDto, DashboardUpcomingMeetingsQueryDto } from './dto';
import { DashboardService } from './dashboard.service';
import { DashboardOverviewResult, DashboardTaskMetrics, DashboardTodoListResult, DashboardUpcomingMeetingListResult } from './dashboard.types';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
@RequirePermissions('dashboard.read')
export class DashboardController {
    constructor(private readonly dashboardService: DashboardService) { }

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
