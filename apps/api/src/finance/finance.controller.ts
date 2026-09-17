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
    CreateFinanceExpenseCategoryDto,
    CreateFinanceExpenseReportDto,
    DeleteFinanceVersionQueryDto,
    FinanceExpenseActionDto,
    FinanceExpenseSummaryQueryDto,
    FinanceExpenseVersionDto,
    FinanceProjectSpendQueryDto,
    ListFinanceExpenseReportsQueryDto,
    MarkFinanceExpenseReportPaidDto,
    ReviewFinanceExpenseReportDto,
    UpdateFinanceExpenseCategoryDto,
    UpdateFinanceExpenseReportDto,
} from './dto';
import { FinanceService } from './finance.service';

@ApiTags('Finance')
@ApiBearerAuth()
@Controller('finance')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class FinanceController {
    constructor(private readonly financeService: FinanceService) { }

    @Get('expense-categories')
    @RequirePermissions('finance.expense.read')
    listCategories(): Promise<unknown> { return this.financeService.listCategories(); }

    @Post('expense-categories')
    @RequirePermissions('finance.expense.manage_all')
    createCategory(@Body() input: CreateFinanceExpenseCategoryDto): Promise<unknown> { return this.financeService.createCategory(input); }

    @Patch('expense-categories/:categoryId')
    @RequirePermissions('finance.expense.manage_all')
    updateCategory(@Param('categoryId', new ParseUUIDPipe()) categoryId: string, @Body() input: UpdateFinanceExpenseCategoryDto): Promise<unknown> {
        return this.financeService.updateCategory(categoryId, input);
    }

    @Delete('expense-categories/:categoryId')
    @RequirePermissions('finance.expense.manage_all')
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteCategory(@Param('categoryId', new ParseUUIDPipe()) categoryId: string, @Query() query: DeleteFinanceVersionQueryDto): Promise<void> {
        return this.financeService.deleteCategory(categoryId, query.version);
    }

    @Get('expense-reports')
    @RequirePermissions('finance.expense.read')
    listReports(@Query() query: ListFinanceExpenseReportsQueryDto): Promise<unknown> { return this.financeService.listReports(query); }

    @Post('expense-reports')
    @RequirePermissions('finance.expense.request')
    createReport(@Body() input: CreateFinanceExpenseReportDto): Promise<unknown> { return this.financeService.createReport(input); }

    @Get('expense-reports/:reportId')
    @RequirePermissions('finance.expense.read')
    getReport(@Param('reportId', new ParseUUIDPipe()) reportId: string): Promise<unknown> { return this.financeService.getReport(reportId); }

    @Patch('expense-reports/:reportId')
    @RequirePermissions('finance.expense.request')
    updateReport(@Param('reportId', new ParseUUIDPipe()) reportId: string, @Body() input: UpdateFinanceExpenseReportDto): Promise<unknown> {
        return this.financeService.updateReport(reportId, input);
    }

    @Delete('expense-reports/:reportId')
    @RequirePermissions('finance.expense.request')
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteReport(@Param('reportId', new ParseUUIDPipe()) reportId: string, @Query() query: DeleteFinanceVersionQueryDto): Promise<void> {
        return this.financeService.deleteReport(reportId, query.version);
    }

    @Post('expense-reports/:reportId/submit')
    @RequirePermissions('finance.expense.request')
    submitReport(@Param('reportId', new ParseUUIDPipe()) reportId: string, @Body() input: FinanceExpenseVersionDto): Promise<unknown> {
        return this.financeService.submitReport(reportId, input.version);
    }

    @Post('expense-reports/:reportId/withdraw')
    @RequirePermissions('finance.expense.request')
    withdrawReport(@Param('reportId', new ParseUUIDPipe()) reportId: string, @Body() input: FinanceExpenseActionDto): Promise<unknown> {
        return this.financeService.withdrawReport(reportId, input);
    }

    @Post('expense-reports/:reportId/cancel')
    @RequirePermissions('finance.expense.manage_all')
    cancelReport(@Param('reportId', new ParseUUIDPipe()) reportId: string, @Body() input: FinanceExpenseActionDto): Promise<unknown> {
        return this.financeService.cancelReport(reportId, input);
    }

    @Post('expense-reports/:reportId/review')
    @RequirePermissions('finance.expense.approve')
    reviewReport(@Param('reportId', new ParseUUIDPipe()) reportId: string, @Body() input: ReviewFinanceExpenseReportDto): Promise<unknown> {
        return this.financeService.reviewReport(reportId, input);
    }

    @Post('expense-reports/:reportId/mark-paid')
    @RequirePermissions('finance.expense.manage_all')
    markPaid(@Param('reportId', new ParseUUIDPipe()) reportId: string, @Body() input: MarkFinanceExpenseReportPaidDto): Promise<unknown> {
        return this.financeService.markPaid(reportId, input);
    }

    @Get('reports/expense-summary')
    @RequirePermissions('finance.expense.read')
    expenseSummary(@Query() query: FinanceExpenseSummaryQueryDto): Promise<unknown> { return this.financeService.expenseSummary(query); }

    @Get('reports/project-spend')
    @RequirePermissions('finance.expense.read')
    projectSpend(@Query() query: FinanceProjectSpendQueryDto): Promise<unknown> { return this.financeService.projectSpend(query); }
}
