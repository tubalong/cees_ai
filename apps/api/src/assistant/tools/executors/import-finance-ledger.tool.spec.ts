import type { DocumentSourceMaterial } from '@cees/ai-service-client';
import { FinanceLedgerService } from '../../../finance/finance-ledger.service';
import type { CreateFinanceLedgerImportDto } from '../../../finance/dto';
import { AssistantMessageContentService } from '../../runtime/message-content.service';
import { TenantContext } from '../../../tenant/tenant-context';
import { ToolRegistryService } from '../tool-registry';
import type { ToolConfirmationContext, ToolExecutionContext } from '../tool.types';
import { ImportFinanceLedgerTool } from './import-finance-ledger.tool';

const TENANT_ID = '1e1c1f0e-0000-4000-8000-000000000001';
const DEPARTMENT_ID = '3e1c1f0e-0000-4000-8000-000000000003';
const PROJECT_ID = '4e1c1f0e-0000-4000-8000-000000000004';

const context: ToolExecutionContext = {
    tenantId: TENANT_ID,
    userId: 'u-1',
    membershipId: 'm-1',
    requestId: 'r-1',
    conversationId: 'c-1',
    turnId: 'turn-1',
    toolCallId: 'tc-1',
    executionOwner: 'owner-1',
    executionToken: 'token-1',
    permissions: ['finance.ledger.manage'],
    knowledgeBaseEnabled: false,
    webSearchEnabled: false,
};

const confirmationContext: ToolConfirmationContext = {
    tenantId: TENANT_ID,
    userId: 'u-1',
    membershipId: 'm-1',
    requestId: 'r-1',
    turnId: 'turn-1',
    permissions: ['finance.ledger.manage'],
};

/** 与财务台账模板一致的表头；顺序刻意打乱科目/关联列的相对位置，验证按表头名取值而非按列序。 */
const LEDGER_CSV = [
    '发生日期,方向,金额,科目编码,科目名称,部门ID,项目ID,交易对方,摘要,凭证号,币种',
    '2026-01-05,支出,"15,000.00",6602.01,管理费用-租赁费,D001,,某某物业,一月房租,V2026010501,CNY',
    `2026-01-12,收入,5186.42,6051,其他业务收入,${DEPARTMENT_ID},${PROJECT_ID},某某客户,零星收入,V2026011201,CNY`,
    '2026-01-13,支出,¥5041.57,6602.02,管理费用-差旅费,D003,PRJ-TEST-001,某某商旅,出差报销,V2026011301,CNY',
].join('\n');

function spreadsheets(): DocumentSourceMaterial[] {
    return [{ id: 'file-1', title: 'CEES-财务收支台账-测试数据-约100万.xlsx', content: LEDGER_CSV }];
}

describe('import_finance_ledger assistant tool', () => {
    let registry: ToolRegistryService;
    let messageContent: jest.Mocked<Pick<AssistantMessageContentService, 'resolveTurnDocumentSourceMaterials'>>;
    let financeLedger: jest.Mocked<Pick<FinanceLedgerService, 'importRows'>>;
    let tool: ImportFinanceLedgerTool;

    beforeEach(() => {
        registry = new ToolRegistryService();
        messageContent = { resolveTurnDocumentSourceMaterials: jest.fn().mockResolvedValue(spreadsheets()) };
        financeLedger = {
            // 让 mock 按实际入参计数，否则摘要断言校验的是 mock 常量而不是解析结果。
            importRows: jest.fn().mockImplementation((input: CreateFinanceLedgerImportDto) => ({
                importedCount: input.rows.length,
                skippedCount: 0,
                errorCount: 0,
            })),
        };
        tool = new ImportFinanceLedgerTool(
            registry,
            messageContent as unknown as AssistantMessageContentService,
            financeLedger as unknown as FinanceLedgerService,
            new TenantContext(),
        );
        tool.onModuleInit();
    });

    it('self-registers as a WRITE tool gated by finance.ledger.manage', () => {
        const definition = registry.get('import_finance_ledger');
        expect(definition).toBeDefined();
        expect(definition?.requiredPermissions).toEqual(['finance.ledger.manage']);
        expect(definition?.riskLevel).toEqual('WRITE');
        expect(definition?.buildConfirmation).toBeDefined();
    });

    it('rejects any model-supplied argument so rows can never come from the model', () => {
        const definition = registry.get('import_finance_ledger');
        expect(() => definition?.validate({})).not.toThrow();
        expect(() => definition?.validate({ rows: [{ amount: 1 }] })).toThrow('工具参数必须为空对象');
        expect(() => definition?.validate('rows')).toThrow('工具参数必须为空对象');
    });

    it('previews file, period, row count and totals without touching the ledger', async () => {
        const definition = registry.get('import_finance_ledger');
        const confirmation = await definition?.buildConfirmation?.(confirmationContext, {});
        expect(financeLedger.importRows).not.toHaveBeenCalled();
        expect(confirmation?.title).toBe('导入财务收支台账');
        expect(confirmation?.fields).toEqual(expect.arrayContaining([
            { label: '文件', value: 'CEES-财务收支台账-测试数据-约100万.xlsx' },
            { label: '期间', value: '2026-01-05 至 2026-01-13' },
            { label: '记录数', value: '3 行' },
            { label: '收入合计', value: 'CNY 5186.42' },
            { label: '支出合计', value: 'CNY 20041.57' },
        ]));
    });

    it('warns that non-system department and project ids will be dropped', async () => {
        const definition = registry.get('import_finance_ledger');
        const confirmation = await definition?.buildConfirmation?.(confirmationContext, {});
        const warnings = confirmation?.fields.find((field) => field.label === '关联提示')?.value ?? '';
        expect(warnings).toContain('D001'); // 部门金额行里的非 UUID 部门引用
        expect(warnings).toContain('D003');
        expect(warnings).toContain('PRJ-TEST-001');
        expect(warnings).not.toContain(DEPARTMENT_ID);
        expect(confirmation?.summary).toContain('3 行');
    });

    it('imports deterministic rows rebuilt from the attachment and drops non-system references', async () => {
        const definition = registry.get('import_finance_ledger');
        const result = await definition?.execute(context, {});
        expect(result?.summary).toBe('财务台账已导入：成功 3 行，跳过 0 行，错误 0 行。');
        expect(financeLedger.importRows).toHaveBeenCalledTimes(1);
        const payload = financeLedger.importRows.mock.calls[0][0] as CreateFinanceLedgerImportDto;
        expect(payload).toMatchObject({
            fileName: 'CEES-财务收支台账-测试数据-约100万.xlsx',
            format: 'XLSX',
            periodStart: '2026-01-05',
            periodEnd: '2026-01-13',
            sourceFileObjectId: 'file-1',
        });
        expect(payload.rows).toHaveLength(3);
        // 千分位与货币符号必须归一化成数值，而不是被误判为 0 或 NaN。
        expect(payload.rows[0]).toMatchObject({
            rowNumber: 2, occurredOn: '2026-01-05', direction: 'EXPENSE',
            amount: 15000, categoryName: '管理费用-租赁费', voucherNo: 'V2026010501',
        });
        // UUID 引用保留，非 UUID 引用一律降级为 null，避免 DTO 校验拒绝整批导入。
        expect(payload.rows[1]).toMatchObject({
            rowNumber: 3, direction: 'INCOME', amount: 5186.42,
            departmentId: DEPARTMENT_ID, projectId: PROJECT_ID,
        });
        expect(payload.rows[2]).toMatchObject({
            rowNumber: 4, amount: 5041.57, departmentId: null, projectId: null,
        });
    });

    it('fails with a row-scoped message when an amount is not a positive number', async () => {
        messageContent.resolveTurnDocumentSourceMaterials.mockResolvedValueOnce([
            {
                id: 'file-1',
                title: '台账.xlsx',
                content: ['发生日期,方向,金额,凭证号', '2026-01-05,支出,0,V1'].join('\n'),
            },
        ]);
        const definition = registry.get('import_finance_ledger');
        await expect(definition?.execute(context, {})).rejects.toThrow('第 2 行金额格式无法识别或不大于 0');
        expect(financeLedger.importRows).not.toHaveBeenCalled();
    });

    it('stops at the next sheet marker so appendix sheets are never read as ledger rows', async () => {
        // 复现真实事故：同一份 xlsx 手动上传能成功、AI 上传总是失败。
        // 提取器会遍历**所有**工作表拼成一段文本，而桌面端只读第一个工作表。
        // 台账行解析完后若不在此处停下，就会把「测试汇总」附表的标题行当成台账数据，
        // 以「第 N 行方向只能是收入或支出」整批失败。
        messageContent.resolveTurnDocumentSourceMaterials.mockResolvedValueOnce([
            {
                id: 'file-1',
                title: '台账.xlsx',
                content: [
                    '[Sheet: 收支台账]',
                    '发生日期\t方向\t金额\t凭证号',
                    '2026-01-05\t支出\t15000\tV2026010501',
                    '2026-01-12\t收入\t5186.42\tV2026011201',
                    '',
                    '[Sheet: 测试汇总]',
                    'CEES 财务收支台账 · 测试数据汇总（2026-01 ~ 2026-09）',
                    '月份\t收入\t支出\t净额',
                    '2026-01\t118161.49\t68730\t49431.49',
                ].join('\n'),
            },
        ]);
        const definition = registry.get('import_finance_ledger');

        const result = await definition?.execute(context, {});

        expect(result?.summary).toBe('财务台账已导入：成功 2 行，跳过 0 行，错误 0 行。');
        const payload = financeLedger.importRows.mock.calls[0][0] as CreateFinanceLedgerImportDto;
        expect(payload.rows).toHaveLength(2);
        expect(payload.periodStart).toBe('2026-01-05');
        expect(payload.periodEnd).toBe('2026-01-12');
    });

    it('parses a ledger sheet that is not the first sheet in the workbook', async () => {
        // 台账表不在第一张时，标记在表头之前，循环里不应误判为「已到下一张表」。
        messageContent.resolveTurnDocumentSourceMaterials.mockResolvedValueOnce([
            {
                id: 'file-1',
                title: '台账.xlsx',
                content: [
                    '[Sheet: 填写说明]',
                    '列名\t是否必填\t填写说明',
                    '发生日期\t必填\t日期格式',
                    '',
                    '[Sheet: 收支台账]',
                    '发生日期\t方向\t金额\t凭证号',
                    '2026-02-01\t支出\t100\tV2026020101',
                ].join('\n'),
            },
        ]);
        const definition = registry.get('import_finance_ledger');

        await definition?.execute(context, {});

        const payload = financeLedger.importRows.mock.calls[0][0] as CreateFinanceLedgerImportDto;
        expect(payload.rows).toHaveLength(1);
        expect(payload.rows[0]).toMatchObject({ occurredOn: '2026-02-01', amount: 100 });
    });

    it('requires exactly one spreadsheet attachment per turn', async () => {
        messageContent.resolveTurnDocumentSourceMaterials.mockResolvedValueOnce([]);
        const definition = registry.get('import_finance_ledger');
        await expect(definition?.execute(context, {})).rejects.toThrow('本轮必须且只能上传一个 XLSX 或 CSV 台账附件');
        expect(financeLedger.importRows).not.toHaveBeenCalled();
    });
});
