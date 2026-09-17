import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post,
    Query, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard, RequirePermissions } from '../rbac/permission.guard';
import { TenantContextInterceptor } from '../tenant/tenant-context.interceptor';
import { TenantGuard } from '../tenant/tenant.guard';
import {
    CreateLegalContractDto, LegalContractActionDto, LegalContractSummaryQueryDto,
    LegalContractVersionQueryDto, ListLegalContractsQueryDto, RenewLegalContractDto,
    TerminateLegalContractDto, UpdateLegalContractDto,
} from './dto';
import { LegalService } from './legal.service';

@ApiTags('Legal')
@ApiBearerAuth()
@Controller('legal')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@UseInterceptors(TenantContextInterceptor)
export class LegalController {
    constructor(private readonly legalService: LegalService) { }

    @Get('contracts')
    @RequirePermissions('legal.contract.read')
    listContracts(@Query() query: ListLegalContractsQueryDto): Promise<unknown> {
        return this.legalService.listContracts(query);
    }

    @Post('contracts')
    @RequirePermissions('legal.contract.create')
    createContract(@Body() input: CreateLegalContractDto): Promise<unknown> {
        return this.legalService.createContract(input);
    }

    @Get('contracts/:contractId')
    @RequirePermissions('legal.contract.read')
    getContract(@Param('contractId', new ParseUUIDPipe()) contractId: string): Promise<unknown> {
        return this.legalService.getContract(contractId);
    }

    @Patch('contracts/:contractId')
    @RequirePermissions('legal.contract.update')
    updateContract(
        @Param('contractId', new ParseUUIDPipe()) contractId: string,
        @Body() input: UpdateLegalContractDto,
    ): Promise<unknown> {
        return this.legalService.updateContract(contractId, input);
    }

    @Delete('contracts/:contractId')
    @RequirePermissions('legal.contract.delete')
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteContract(
        @Param('contractId', new ParseUUIDPipe()) contractId: string,
        @Query() query: LegalContractVersionQueryDto,
    ): Promise<void> {
        return this.legalService.deleteContract(contractId, query.version);
    }

    @Post('contracts/:contractId/activate')
    @RequirePermissions('legal.contract.update')
    activateContract(
        @Param('contractId', new ParseUUIDPipe()) contractId: string,
        @Body() input: LegalContractActionDto,
    ): Promise<unknown> {
        return this.legalService.activateContract(contractId, input);
    }

    @Post('contracts/:contractId/mark-pending-renewal')
    @RequirePermissions('legal.contract.update')
    markPendingRenewal(
        @Param('contractId', new ParseUUIDPipe()) contractId: string,
        @Body() input: LegalContractActionDto,
    ): Promise<unknown> {
        return this.legalService.markPendingRenewal(contractId, input);
    }

    @Post('contracts/:contractId/renew')
    @RequirePermissions('legal.contract.update')
    renewContract(
        @Param('contractId', new ParseUUIDPipe()) contractId: string,
        @Body() input: RenewLegalContractDto,
    ): Promise<unknown> {
        return this.legalService.renewContract(contractId, input);
    }

    @Post('contracts/:contractId/terminate')
    @RequirePermissions('legal.contract.update')
    terminateContract(
        @Param('contractId', new ParseUUIDPipe()) contractId: string,
        @Body() input: TerminateLegalContractDto,
    ): Promise<unknown> {
        return this.legalService.terminateContract(contractId, input);
    }

    @Post('contracts/:contractId/archive')
    @RequirePermissions('legal.contract.update')
    archiveContract(
        @Param('contractId', new ParseUUIDPipe()) contractId: string,
        @Body() input: LegalContractActionDto,
    ): Promise<unknown> {
        return this.legalService.archiveContract(contractId, input);
    }

    @Get('reports/contract-summary')
    @RequirePermissions('legal.contract.read')
    contractSummary(@Query() query: LegalContractSummaryQueryDto): Promise<unknown> {
        return this.legalService.contractSummary(query);
    }
}
