import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { FinanceController } from './finance.controller';
import { FinanceLedgerService } from './finance-ledger.service';
import { FinanceService } from './finance.service';

@Module({
    imports: [DashboardModule],
    controllers: [FinanceController],
    providers: [FinanceService, FinanceLedgerService],
    exports: [FinanceService, FinanceLedgerService],
})
export class FinanceModule { }
