import { Injectable, OnModuleInit } from '@nestjs/common';
import { FinanceLedgerService } from '../../../finance/finance-ledger.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { AssistantMessageContentService } from '../../runtime/message-content.service';
import { ToolRegistryService } from '../tool-registry';
import {
    runAsTenant,
    ToolExecutionError,
    type ToolConfirmationContext,
    type ToolConfirmationRequest,
    type ToolDefinition,
    type ToolExecutionContext,
    type ToolExecutionResult,
} from '../tool.types';
import { parseFinanceLedgerAttachment, type ParsedFinanceLedgerAttachment } from './finance-ledger-attachment';

interface FinanceLedgerImportSummary {
    importedCount: number;
    skippedCount: number;
    errorCount: number;
}

@Injectable()
export class ImportFinanceLedgerTool implements OnModuleInit {
    constructor(
        private readonly registry: ToolRegistryService,
        private readonly messageContent: AssistantMessageContentService,
        private readonly financeLedger: FinanceLedgerService,
        private readonly tenantContext: TenantContext,
    ) { }

    onModuleInit(): void {
        this.registry.register(this.definition);
    }

    private readonly definition: ToolDefinition = {
        name: 'import_finance_ledger',
        version: '1.0.0',
        displayName: '导入财务收支台账',
        description: '把本轮唯一的 XLSX 或 CSV 附件导入财务收支台账。'
            + '仅当用户明确要求导入、上传到台账或记入财务系统时调用；仅分析、汇总或修改表格时不要调用。'
            + '本工具不接收模型生成的行数据，而是由服务端重新读取附件；调用参数必须为空对象。'
            + '系统会先展示文件、期间、行数和收支合计，用户确认后才正式写入。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        requiredPermissions: ['finance.ledger.manage'],
        riskLevel: 'WRITE',
        validate: validateArguments,
        buildConfirmation: (context) => this.buildConfirmation(context),
        execute: (context) => this.executeImport(context),
    };

    private async buildConfirmation(context: ToolConfirmationContext): Promise<ToolConfirmationRequest> {
        const parsed = await this.resolveAttachment(context);
        const totals = summarizeTotals(parsed);
        const warnings = ignoredReferenceSummary(parsed);
        return {
            title: '导入财务收支台账',
            fields: [
                { label: '文件', value: parsed.fileName },
                { label: '期间', value: `${parsed.periodStart} 至 ${parsed.periodEnd}` },
                { label: '记录数', value: `${parsed.rows.length} 行` },
                { label: '收入合计', value: totals.income },
                { label: '支出合计', value: totals.expense },
                { label: '关联提示', value: warnings },
                { label: '原文件', value: '随导入批次留档' },
            ],
            summary: `已解析《${parsed.fileName}》共 ${parsed.rows.length} 行，等待确认后导入财务台账。${warnings === '无' ? '' : ` ${warnings}`}`,
        };
    }

    private async executeImport(context: ToolExecutionContext): Promise<ToolExecutionResult> {
        const parsed = await this.resolveAttachment(context);
        const result = await runAsTenant(this.tenantContext, context, () => this.financeLedger.importRows({
            fileName: parsed.fileName,
            format: parsed.format,
            periodStart: parsed.periodStart,
            periodEnd: parsed.periodEnd,
            sourceFileObjectId: parsed.fileId,
            rows: parsed.rows,
        })) as FinanceLedgerImportSummary;
        return {
            resourceType: null,
            resourceId: null,
            summary: `财务台账已导入：成功 ${result.importedCount} 行，跳过 ${result.skippedCount} 行，错误 ${result.errorCount} 行。`,
        };
    }

    private async resolveAttachment(context: ToolConfirmationContext): Promise<ParsedFinanceLedgerAttachment> {
        // 本工具依赖「本轮上传的附件」；任务步骤执行窗口没有轮次输入，
        // 工具面已排除 WRITE 工具，这里兜底防御绕过（模型编造调用时拒绝）。
        if (context.turnId === null) {
            throw new ToolExecutionError(
                'TURN_INPUT_REQUIRED',
                'import_finance_ledger requires an active turn with a spreadsheet attachment',
                '导入台账需要基于当前消息中的 XLSX 或 CSV 附件。请告知用户：在对话中上传文件后重试。',
            );
        }
        const materials = await this.messageContent.resolveTurnDocumentSourceMaterials(context.turnId, {
            tenantId: context.tenantId,
            userId: context.userId,
            membershipId: context.membershipId,
            requestId: context.requestId,
        });
        return parseFinanceLedgerAttachment(materials);
    }
}

function validateArguments(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工具参数必须为空对象');
    if (Object.keys(input as Record<string, unknown>).length > 0) throw new Error('工具参数必须为空对象');
    return {};
}

function summarizeTotals(parsed: ParsedFinanceLedgerAttachment): { income: string; expense: string } {
    const income = new Map<string, number>();
    const expense = new Map<string, number>();
    for (const row of parsed.rows) {
        const target = row.direction === 'INCOME' ? income : expense;
        target.set(row.currency, (target.get(row.currency) ?? 0) + row.amount);
    }
    return { income: formatTotals(income), expense: formatTotals(expense) };
}

function formatTotals(totals: Map<string, number>): string {
    if (totals.size === 0) return '0';
    return [...totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
        .join('；');
}

function ignoredReferenceSummary(parsed: ParsedFinanceLedgerAttachment): string {
    const parts: string[] = [];
    if (parsed.ignoredDepartmentRefs.length > 0) {
        parts.push(`非系统部门 ID 将不关联：${parsed.ignoredDepartmentRefs.join('、')}`);
    }
    if (parsed.ignoredProjectRefs.length > 0) {
        parts.push(`非系统项目 ID 将不关联：${parsed.ignoredProjectRefs.join('、')}`);
    }
    return parts.join('；') || '无';
}