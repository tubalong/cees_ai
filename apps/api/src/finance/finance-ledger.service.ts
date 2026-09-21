import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceLedgerImportStatus, FinanceLedgerSource, Prisma } from '@prisma/client';
import { dateKeyToUtcMidnight } from '../common/tenant-time';
import { PrismaService } from '../database/prisma.service';
import { DashboardSnapshotService } from '../dashboard/snapshot.service';
import { TenantContext } from '../tenant/tenant-context';
import { CreateFinanceLedgerImportDto, FinanceLedgerRowDto, ListFinanceLedgerEntriesQueryDto } from './dto';

@Injectable()
export class FinanceLedgerService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantContext: TenantContext,
        private readonly snapshots: DashboardSnapshotService,
    ) { }

    async importRows(input: CreateFinanceLedgerImportDto): Promise<unknown> {
        const context = this.tenantContext.require();
        const periodStart = dateKeyToUtcMidnight(input.periodStart);
        const periodEnd = dateKeyToUtcMidnight(input.periodEnd);
        if (periodStart > periodEnd) throw new BadRequestException({ code: 'FINANCE_LEDGER_PERIOD_INVALID', message: '台账期间无效' });
        const errors = await this.validateRows(context.tenantId, input.rows, periodStart, periodEnd);
        const invalidRows = new Set(errors.map((error) => error.rowNumber));
        const validRows = input.rows.filter((row) => !invalidRows.has(row.rowNumber));
        const result = await this.prisma.$transaction(async (transaction) => {
            const batch = await transaction.financeLedgerImport.create({
                data: {
                    tenantId: context.tenantId, fileName: input.fileName.trim(), format: input.format,
                    periodStart, periodEnd, status: FinanceLedgerImportStatus.PARSING,
                    rowCount: input.rows.length, errorCount: errors.length, errors,
                    uploadedByMembershipId: context.membershipId, startedAt: new Date(), createdBy: context.userId,
                }
            });
            const inserted = await transaction.financeLedgerEntry.createMany({
                data: validRows.map((row) => ({
                    tenantId: context.tenantId, importId: batch.id, occurredOn: dateKeyToUtcMidnight(row.occurredOn),
                    direction: row.direction, amount: row.amount, currency: row.currency.toUpperCase(),
                    categoryCode: clean(row.categoryCode), categoryName: clean(row.categoryName),
                    departmentId: row.departmentId, projectId: row.projectId, counterparty: clean(row.counterparty),
                    summary: clean(row.summary), voucherNo: row.voucherNo.trim(), source: FinanceLedgerSource.IMPORT,
                    createdBy: context.userId, updatedBy: context.userId,
                })),
                skipDuplicates: true,
            });
            const skippedCount = validRows.length - inserted.count;
            const status = errors.length === input.rows.length
                ? FinanceLedgerImportStatus.FAILED
                : errors.length > 0 || skippedCount > 0 ? FinanceLedgerImportStatus.PARTIAL : FinanceLedgerImportStatus.SUCCEEDED;
            return transaction.financeLedgerImport.update({
                where: { id: batch.id }, data: {
                    status, importedCount: inserted.count, skippedCount, finishedAt: new Date(),
                }
            });
        });
        for (const dateKey of [...new Set(validRows.map((row) => row.occurredOn))]) {
            await this.snapshots.rebuildTenantDay(context.tenantId, dateKey);
        }
        return serializeImport(result);
    }

    async listEntries(query: ListFinanceLedgerEntriesQueryDto): Promise<unknown> {
        const { tenantId } = this.tenantContext.require();
        const items = await this.prisma.financeLedgerEntry.findMany({
            where: {
                tenantId, deletedAt: null, direction: query.direction, departmentId: query.departmentId,
                projectId: query.projectId, occurredOn: query.dateFrom || query.dateTo ? {
                    gte: query.dateFrom ? dateKeyToUtcMidnight(query.dateFrom) : undefined,
                    lte: query.dateTo ? dateKeyToUtcMidnight(query.dateTo) : undefined,
                } : undefined,
                OR: query.category ? [
                    { categoryCode: { contains: query.category, mode: 'insensitive' } },
                    { categoryName: { contains: query.category, mode: 'insensitive' } },
                ] : undefined,
            },
            orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }], take: query.limit + 1,
            cursor: query.cursor ? { id: query.cursor } : undefined, skip: query.cursor ? 1 : 0,
        });
        const hasNext = items.length > query.limit;
        const page = hasNext ? items.slice(0, query.limit) : items;
        return { items: page.map(serializeEntry), nextCursor: hasNext ? page.at(-1)?.id ?? null : null };
    }

    async getImport(importId: string): Promise<unknown> {
        const { tenantId } = this.tenantContext.require();
        const batch = await this.prisma.financeLedgerImport.findFirst({ where: { id: importId, tenantId, deletedAt: null } });
        if (!batch) throw new NotFoundException({ code: 'FINANCE_LEDGER_IMPORT_NOT_FOUND', message: '台账导入批次不存在' });
        return serializeImport(batch);
    }

    async rollbackImport(importId: string): Promise<void> {
        const context = this.tenantContext.require();
        const batch = await this.prisma.financeLedgerImport.findFirst({ where: { id: importId, tenantId: context.tenantId, deletedAt: null } });
        if (!batch) throw new NotFoundException({ code: 'FINANCE_LEDGER_IMPORT_NOT_FOUND', message: '台账导入批次不存在' });
        const entries = await this.prisma.financeLedgerEntry.findMany({ where: { tenantId: context.tenantId, importId, deletedAt: null }, select: { occurredOn: true } });
        await this.prisma.$transaction([
            this.prisma.financeLedgerEntry.updateMany({ where: { tenantId: context.tenantId, importId, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: context.userId, version: { increment: 1 } } }),
            this.prisma.financeLedgerImport.update({ where: { id: importId }, data: { deletedAt: new Date(), version: { increment: 1 } } }),
        ]);
        for (const date of [...new Set(entries.map((entry) => entry.occurredOn.toISOString().slice(0, 10)))]) {
            await this.snapshots.rebuildTenantDay(context.tenantId, date);
        }
    }

    private async validateRows(tenantId: string, rows: FinanceLedgerRowDto[], from: Date, to: Date): Promise<Array<{ rowNumber: number; message: string }>> {
        const departmentIds = [...new Set(rows.flatMap((row) => row.departmentId ? [row.departmentId] : []))];
        const projectIds = [...new Set(rows.flatMap((row) => row.projectId ? [row.projectId] : []))];
        const [departments, projects] = await Promise.all([
            this.prisma.department.findMany({ where: { tenantId, id: { in: departmentIds }, deletedAt: null }, select: { id: true } }),
            this.prisma.project.findMany({ where: { tenantId, id: { in: projectIds }, deletedAt: null }, select: { id: true } }),
        ]);
        const validDepartments = new Set(departments.map((item) => item.id));
        const validProjects = new Set(projects.map((item) => item.id));
        return rows.flatMap((row) => {
            const date = dateKeyToUtcMidnight(row.occurredOn);
            const messages = [
                date < from || date > to ? '发生日期不在声明期间内' : null,
                !/^[A-Z]{3}$/.test(row.currency.toUpperCase()) ? '币种必须为 3 位大写字母' : null,
                row.departmentId && !validDepartments.has(row.departmentId) ? '部门不属于当前租户' : null,
                row.projectId && !validProjects.has(row.projectId) ? '项目不属于当前租户' : null,
            ].filter((message): message is string => Boolean(message));
            return messages.map((message) => ({ rowNumber: row.rowNumber, message }));
        });
    }
}

function clean(value?: string | null): string | null { return value?.trim() || null; }
function serializeEntry(entry: any): unknown { return { ...entry, amount: entry.amount.toString() }; }
function serializeImport(batch: any): unknown { return { ...batch, errors: batch.errors ?? [] }; }