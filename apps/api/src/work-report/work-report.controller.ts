import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe,
    Patch, Post, Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import {
    CreateDailyWorkReportDto, CreateWeeklyWorkReportDto, ListWorkReportsQueryDto,
    ReviewWorkReportDto, UpdateWorkReportDto, WorkReportStatisticsQueryDto, WorkReportVersionDto,
} from './dto';
import { WorkReportService } from './work-report.service';
import { WorkReportListResult, WorkReportResult, WorkReportStatisticsResult } from './work-report.types';

@ApiTags('work-report')
@ApiBearerAuth()
@Controller('work-reports')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class WorkReportController {
    constructor(private readonly workReportService: WorkReportService) { }

    @Get()
    @RequirePermissions('work_report.read')
    @ApiOkResponse({ description: '日报和周报列表' })
    list(@Query() query: ListWorkReportsQueryDto): Promise<WorkReportListResult> {
        return this.workReportService.list(query);
    }

    @Post('daily')
    @RequirePermissions('work_report.create')
    @ApiCreatedResponse({ description: '日报已创建' })
    createDaily(@Body() input: CreateDailyWorkReportDto): Promise<WorkReportResult> {
        return this.workReportService.createDaily(input);
    }

    @Post('weekly')
    @RequirePermissions('work_report.create')
    @ApiCreatedResponse({ description: '周报已创建' })
    createWeekly(@Body() input: CreateWeeklyWorkReportDto): Promise<WorkReportResult> {
        return this.workReportService.createWeekly(input);
    }

    @Get('statistics')
    @RequirePermissions('work_report.read')
    @ApiOkResponse({ description: '日报和周报状态统计' })
    statistics(@Query() query: WorkReportStatisticsQueryDto): Promise<WorkReportStatisticsResult> {
        return this.workReportService.statistics(query);
    }

    @Get(':workReportId')
    @RequirePermissions('work_report.read')
    @ApiOkResponse({ description: '日报或周报详情' })
    get(@Param('workReportId', new ParseUUIDPipe()) id: string): Promise<WorkReportResult> {
        return this.workReportService.get(id);
    }

    @Patch(':workReportId')
    @RequirePermissions('work_report.update')
    @ApiOkResponse({ description: '报告已修改' })
    update(
        @Param('workReportId', new ParseUUIDPipe()) id: string,
        @Body() input: UpdateWorkReportDto,
    ): Promise<WorkReportResult> {
        return this.workReportService.update(id, input);
    }

    @Delete(':workReportId')
    @RequirePermissions('work_report.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiNoContentResponse({ description: '报告已软删除' })
    delete(
        @Param('workReportId', new ParseUUIDPipe()) id: string,
        @Query() query: WorkReportVersionDto,
    ): Promise<void> {
        return this.workReportService.delete(id, query.version);
    }

    @Post(':workReportId/submit')
    @RequirePermissions('work_report.submit')
    @ApiOkResponse({ description: '报告已提交' })
    submit(
        @Param('workReportId', new ParseUUIDPipe()) id: string,
        @Body() input: WorkReportVersionDto,
    ): Promise<WorkReportResult> {
        return this.workReportService.submit(id, input.version);
    }

    @Post(':workReportId/withdraw')
    @RequirePermissions('work_report.submit')
    @ApiOkResponse({ description: '报告已撤回' })
    withdraw(
        @Param('workReportId', new ParseUUIDPipe()) id: string,
        @Body() input: WorkReportVersionDto,
    ): Promise<WorkReportResult> {
        return this.workReportService.withdraw(id, input.version);
    }

    @Post(':workReportId/review')
    @RequirePermissions('work_report.review')
    @ApiOkResponse({ description: '报告审核完成' })
    review(
        @Param('workReportId', new ParseUUIDPipe()) id: string,
        @Body() input: ReviewWorkReportDto,
    ): Promise<WorkReportResult> {
        return this.workReportService.review(id, input);
    }
}
