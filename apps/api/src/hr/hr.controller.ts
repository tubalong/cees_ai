import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import {
    AdjustHrLeaveBalanceDto,
    CancelHrLeaveRequestDto,
    CreateHrAttendanceRecordDto,
    CreateHrEmployeeChangeDto,
    CreateHrLeaveRequestDto,
    CreateHrLeaveTypeDto,
    CreateHrOvertimeRequestDto,
    CreateHrProfileDto,
    DateRangeReportQueryDto,
    DeleteVersionQueryDto,
    HeadcountReportQueryDto,
    ImportHrAttendanceRecordsDto,
    LeaveSummaryReportQueryDto,
    ListHrAttendanceRecordsQueryDto,
    ListHrEmployeeChangesQueryDto,
    ListHrLeaveBalancesQueryDto,
    ListHrLeaveRequestsQueryDto,
    ListHrOvertimeRequestsQueryDto,
    ListHrProfilesQueryDto,
    ReviewRequestDto,
    UpdateHrAttendanceRecordDto,
    UpdateHrLeaveTypeDto,
    UpdateHrProfileDto,
} from './dto';
import { HrService } from './hr.service';

@ApiTags('HR')
@ApiBearerAuth()
@Controller('hr')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class HrController {
    constructor(private readonly hrService: HrService) { }

    @Get('profiles')
    @RequirePermissions('hr.profile.read')
    listProfiles(@Query() query: ListHrProfilesQueryDto): Promise<unknown> {
        return this.hrService.listProfiles(query);
    }

    @Post('profiles')
    @RequirePermissions('hr.profile.manage')
    createProfile(@Body() input: CreateHrProfileDto): Promise<unknown> {
        return this.hrService.createProfile(input);
    }

    @Get('profiles/:membershipId')
    @RequirePermissions('hr.profile.read')
    getProfile(@Param('membershipId', new ParseUUIDPipe()) membershipId: string): Promise<unknown> {
        return this.hrService.getProfile(membershipId);
    }

    @Patch('profiles/:membershipId')
    @RequirePermissions('hr.profile.manage')
    updateProfile(
        @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
        @Body() input: UpdateHrProfileDto,
    ): Promise<unknown> {
        return this.hrService.updateProfile(membershipId, input);
    }

    @Get('leave-types')
    @RequirePermissions('hr.leave.read')
    listLeaveTypes(): Promise<unknown> {
        return this.hrService.listLeaveTypes();
    }

    @Post('leave-types')
    @RequirePermissions('hr.leave.manage_all')
    createLeaveType(@Body() input: CreateHrLeaveTypeDto): Promise<unknown> {
        return this.hrService.createLeaveType(input);
    }

    @Patch('leave-types/:leaveTypeId')
    @RequirePermissions('hr.leave.manage_all')
    updateLeaveType(
        @Param('leaveTypeId', new ParseUUIDPipe()) leaveTypeId: string,
        @Body() input: UpdateHrLeaveTypeDto,
    ): Promise<unknown> {
        return this.hrService.updateLeaveType(leaveTypeId, input);
    }

    @Delete('leave-types/:leaveTypeId')
    @RequirePermissions('hr.leave.manage_all')
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteLeaveType(
        @Param('leaveTypeId', new ParseUUIDPipe()) leaveTypeId: string,
        @Query() query: DeleteVersionQueryDto,
    ): Promise<void> {
        return this.hrService.deleteLeaveType(leaveTypeId, query.version);
    }

    @Get('leave-balances')
    @RequirePermissions('hr.leave.read')
    listLeaveBalances(@Query() query: ListHrLeaveBalancesQueryDto): Promise<unknown> {
        return this.hrService.listLeaveBalances(query);
    }

    @Post('leave-balances/adjust')
    @RequirePermissions('hr.leave.manage_all')
    adjustLeaveBalance(@Body() input: AdjustHrLeaveBalanceDto): Promise<unknown> {
        return this.hrService.adjustLeaveBalance(input);
    }

    @Get('leave-requests')
    @RequirePermissions('hr.leave.read')
    listLeaveRequests(@Query() query: ListHrLeaveRequestsQueryDto): Promise<unknown> {
        return this.hrService.listLeaveRequests(query);
    }

    @Post('leave-requests')
    @RequirePermissions('hr.leave.request')
    createLeaveRequest(@Body() input: CreateHrLeaveRequestDto): Promise<unknown> {
        return this.hrService.createLeaveRequest(input);
    }

    @Get('leave-requests/:leaveRequestId')
    @RequirePermissions('hr.leave.read')
    getLeaveRequest(@Param('leaveRequestId', new ParseUUIDPipe()) leaveRequestId: string): Promise<unknown> {
        return this.hrService.getLeaveRequest(leaveRequestId);
    }

    @Post('leave-requests/:leaveRequestId/review')
    @RequirePermissions('hr.leave.approve')
    reviewLeaveRequest(
        @Param('leaveRequestId', new ParseUUIDPipe()) leaveRequestId: string,
        @Body() input: ReviewRequestDto,
    ): Promise<unknown> {
        return this.hrService.reviewLeaveRequest(leaveRequestId, input);
    }

    @Post('leave-requests/:leaveRequestId/cancel')
    @RequirePermissions('hr.leave.manage_all')
    cancelLeaveRequest(
        @Param('leaveRequestId', new ParseUUIDPipe()) leaveRequestId: string,
        @Body() input: CancelHrLeaveRequestDto,
    ): Promise<unknown> {
        return this.hrService.cancelLeaveRequest(leaveRequestId, input);
    }

    @Post('leave-requests/:leaveRequestId/withdraw')
    @RequirePermissions('hr.leave.request')
    withdrawLeaveRequest(
        @Param('leaveRequestId', new ParseUUIDPipe()) leaveRequestId: string,
        @Body() input: DeleteVersionQueryDto,
    ): Promise<unknown> {
        return this.hrService.withdrawLeaveRequest(leaveRequestId, input.version);
    }

    @Get('attendance-records')
    @RequirePermissions('hr.attendance.read')
    listAttendanceRecords(@Query() query: ListHrAttendanceRecordsQueryDto): Promise<unknown> {
        return this.hrService.listAttendanceRecords(query);
    }

    @Post('attendance-records')
    @RequirePermissions('hr.attendance.manage')
    createAttendanceRecord(@Body() input: CreateHrAttendanceRecordDto): Promise<unknown> {
        return this.hrService.createAttendanceRecord(input);
    }

    @Post('attendance-records/import')
    @RequirePermissions('hr.attendance.manage')
    createAttendanceRecords(@Body() input: ImportHrAttendanceRecordsDto): Promise<unknown> {
        return this.hrService.importAttendanceRecords(input);
    }

    @Get('attendance-records/:attendanceRecordId')
    @RequirePermissions('hr.attendance.read')
    getAttendanceRecord(@Param('attendanceRecordId', new ParseUUIDPipe()) attendanceRecordId: string): Promise<unknown> {
        return this.hrService.getAttendanceRecord(attendanceRecordId);
    }

    @Patch('attendance-records/:attendanceRecordId')
    @RequirePermissions('hr.attendance.manage')
    updateAttendanceRecord(
        @Param('attendanceRecordId', new ParseUUIDPipe()) attendanceRecordId: string,
        @Body() input: UpdateHrAttendanceRecordDto,
    ): Promise<unknown> {
        return this.hrService.updateAttendanceRecord(attendanceRecordId, input);
    }

    @Post('attendance-records/:attendanceRecordId/review')
    @RequirePermissions('hr.attendance.approve')
    reviewAttendanceRecord(
        @Param('attendanceRecordId', new ParseUUIDPipe()) attendanceRecordId: string,
        @Body() input: ReviewRequestDto,
    ): Promise<unknown> {
        return this.hrService.reviewAttendanceRecord(attendanceRecordId, input);
    }

    @Get('overtime-requests')
    @RequirePermissions('hr.overtime.read')
    listOvertimeRequests(@Query() query: ListHrOvertimeRequestsQueryDto): Promise<unknown> {
        return this.hrService.listOvertimeRequests(query);
    }

    @Post('overtime-requests')
    @RequirePermissions('hr.overtime.request')
    createOvertimeRequest(@Body() input: CreateHrOvertimeRequestDto): Promise<unknown> {
        return this.hrService.createOvertimeRequest(input);
    }

    @Get('overtime-requests/:overtimeRequestId')
    @RequirePermissions('hr.overtime.read')
    getOvertimeRequest(@Param('overtimeRequestId', new ParseUUIDPipe()) overtimeRequestId: string): Promise<unknown> {
        return this.hrService.getOvertimeRequest(overtimeRequestId);
    }

    @Post('overtime-requests/:overtimeRequestId/cancel')
    @RequirePermissions('hr.overtime.request')
    cancelOvertimeRequest(
        @Param('overtimeRequestId', new ParseUUIDPipe()) overtimeRequestId: string,
        @Body() input: DeleteVersionQueryDto,
    ): Promise<unknown> {
        return this.hrService.cancelOvertimeRequest(overtimeRequestId, input.version);
    }

    @Post('overtime-requests/:overtimeRequestId/review')
    @RequirePermissions('hr.overtime.approve')
    reviewOvertimeRequest(
        @Param('overtimeRequestId', new ParseUUIDPipe()) overtimeRequestId: string,
        @Body() input: ReviewRequestDto,
    ): Promise<unknown> {
        return this.hrService.reviewOvertimeRequest(overtimeRequestId, input);
    }

    @Get('employee-changes')
    @RequirePermissions('hr.employee_change.read')
    listEmployeeChanges(@Query() query: ListHrEmployeeChangesQueryDto): Promise<unknown> {
        return this.hrService.listEmployeeChanges(query);
    }

    @Post('employee-changes')
    @RequirePermissions('hr.employee_change.manage')
    createEmployeeChange(@Body() input: CreateHrEmployeeChangeDto): Promise<unknown> {
        return this.hrService.createEmployeeChange(input);
    }

    @Get('employee-changes/:employeeChangeId')
    @RequirePermissions('hr.employee_change.read')
    getEmployeeChange(@Param('employeeChangeId', new ParseUUIDPipe()) employeeChangeId: string): Promise<unknown> {
        return this.hrService.getEmployeeChange(employeeChangeId);
    }

    @Post('employee-changes/:employeeChangeId/cancel')
    @RequirePermissions('hr.employee_change.manage')
    cancelEmployeeChange(
        @Param('employeeChangeId', new ParseUUIDPipe()) employeeChangeId: string,
        @Body() input: DeleteVersionQueryDto,
    ): Promise<unknown> {
        return this.hrService.cancelEmployeeChange(employeeChangeId, input.version);
    }

    @Post('employee-changes/:employeeChangeId/review')
    @RequirePermissions('hr.employee_change.approve')
    reviewEmployeeChange(
        @Param('employeeChangeId', new ParseUUIDPipe()) employeeChangeId: string,
        @Body() input: ReviewRequestDto,
    ): Promise<unknown> {
        return this.hrService.reviewEmployeeChange(employeeChangeId, input);
    }

    @Get('reports/headcount')
    @RequirePermissions('hr.report.read')
    getHeadcountReport(@Query() query: HeadcountReportQueryDto): Promise<unknown> {
        return this.hrService.getHeadcountReport(query);
    }

    @Get('reports/leave-summary')
    @RequirePermissions('hr.report.read')
    getLeaveSummaryReport(@Query() query: LeaveSummaryReportQueryDto): Promise<unknown> {
        return this.hrService.getLeaveSummaryReport(query);
    }

    @Get('reports/attendance-summary')
    @RequirePermissions('hr.report.read')
    getAttendanceSummaryReport(@Query() query: DateRangeReportQueryDto): Promise<unknown> {
        return this.hrService.getAttendanceSummaryReport(query);
    }

    @Get('reports/overtime-summary')
    @RequirePermissions('hr.report.read')
    getOvertimeSummaryReport(@Query() query: DateRangeReportQueryDto): Promise<unknown> {
        return this.hrService.getOvertimeSummaryReport(query);
    }
}
