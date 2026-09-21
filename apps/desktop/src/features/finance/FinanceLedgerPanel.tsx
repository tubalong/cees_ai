import { DownloadOutlined, FileExcelOutlined, UploadOutlined } from '@ant-design/icons';
import { App as AntdApp, Alert, Button, Card, Space, Statistic, Table, Upload } from 'antd';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { createFinanceLedgerImport, type FinanceLedgerImport, type FinanceLedgerRow } from '../../core/api';

const HEADERS = ['发生日期', '方向', '金额', '币种', '科目编码', '科目名称', '部门ID', '项目ID', '交易对方', '摘要', '凭证号'];

export default function FinanceLedgerPanel({ canManage, onImported }: { canManage: boolean; onImported: () => void }): JSX.Element {
    const { message } = AntdApp.useApp();
    const [fileName, setFileName] = useState('');
    const [rows, setRows] = useState<FinanceLedgerRow[]>([]);
    const [result, setResult] = useState<FinanceLedgerImport>();
    const [busy, setBusy] = useState(false);

    const parseFile = async (file: File): Promise<void> => {
        setBusy(true); setResult(undefined);
        try {
            const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
            const headerIndex = matrix.findIndex((line) => HEADERS.every((header) => line.map(String).includes(header)));
            if (headerIndex < 0) throw new Error('未找到标准台账表头，请先下载模板');
            const headers = matrix[headerIndex].map((value) => String(value).trim());
            const parsed = matrix.slice(headerIndex + 1).map((line, index) => ({ line, rowNumber: headerIndex + index + 2 })).filter(({ line }) => line.some((value) => String(value).trim())).map(({ line, rowNumber }) => {
                const read = (header: string): string => String(line[headers.indexOf(header)] ?? '').trim();
                const directionText = read('方向').toUpperCase();
                const direction = ['收入', 'INCOME'].includes(directionText) ? 'INCOME' : ['支出', 'EXPENSE'].includes(directionText) ? 'EXPENSE' : undefined;
                if (!direction) throw new Error(`第 ${rowNumber} 行方向只能是收入或支出`);
                const amount = Number(read('金额'));
                if (!Number.isFinite(amount) || amount <= 0) throw new Error(`第 ${rowNumber} 行金额必须大于 0`);
                const occurredOn = excelDate(read('发生日期'));
                if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) throw new Error(`第 ${rowNumber} 行发生日期格式不正确`);
                const voucherNo = read('凭证号');
                if (!voucherNo) throw new Error(`第 ${rowNumber} 行凭证号不能为空`);
                return {
                    rowNumber, occurredOn, direction, amount, currency: (read('币种') || 'CNY').toUpperCase(),
                    categoryCode: read('科目编码') || null, categoryName: read('科目名称') || null,
                    departmentId: read('部门ID') || null, projectId: read('项目ID') || null,
                    counterparty: read('交易对方') || null, summary: read('摘要') || null, voucherNo,
                } satisfies FinanceLedgerRow;
            });
            if (!parsed.length) throw new Error('台账中没有可导入记录');
            setFileName(file.name); setRows(parsed); message.success(`已解析 ${parsed.length} 行`);
        } catch (error) { setRows([]); message.error(error instanceof Error ? error.message : '解析失败'); } finally { setBusy(false); }
    };

    const submit = async (): Promise<void> => {
        if (!rows.length) return;
        setBusy(true);
        try {
            const dates = rows.map((row) => row.occurredOn).sort();
            const imported = await createFinanceLedgerImport({ fileName, format: fileName.toLowerCase().endsWith('.csv') ? 'CSV' : 'XLSX', periodStart: dates[0], periodEnd: dates.at(-1)!, rows });
            setResult(imported); onImported(); message.success(`成功导入 ${imported.importedCount} 行`);
        } catch (error) { message.error(error instanceof Error ? error.message : '导入失败'); } finally { setBusy(false); }
    };

    return <div className="finance-ledger-panel">
        <Card title="收支台账上传" extra={<Space><Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载模板</Button>{canManage && <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={(file) => { void parseFile(file); return false; }}><Button icon={<UploadOutlined />} loading={busy}>选择台账</Button></Upload>}<Button type="primary" disabled={!canManage || !rows.length} loading={busy} onClick={() => void submit()}>确认导入</Button></Space>}>
            <Alert type="info" showIcon message="财务首页按昨日和上月展示收支；导入后系统会自动重算日/月快照。相同日期、方向和凭证号重复上传时自动跳过。" />
            {!rows.length ? <Upload.Dragger disabled={!canManage} accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={(file) => { void parseFile(file); return false; }}><p className="ant-upload-drag-icon"><FileExcelOutlined /></p><p>拖入财务收支台账，或点击选择文件</p></Upload.Dragger> : <Table size="small" rowKey="rowNumber" dataSource={rows.slice(0, 100)} pagination={{ pageSize: 10 }} columns={[{ title: '行', dataIndex: 'rowNumber', width: 70 }, { title: '日期', dataIndex: 'occurredOn' }, { title: '方向', dataIndex: 'direction', render: (value) => value === 'INCOME' ? '收入' : '支出' }, { title: '金额', dataIndex: 'amount' }, { title: '科目', dataIndex: 'categoryName' }, { title: '凭证号', dataIndex: 'voucherNo' }]} />}
        </Card>
        {result && <Card title="导入结果"><Space size="large"><Statistic title="总行数" value={result.rowCount} /><Statistic title="已导入" value={result.importedCount} /><Statistic title="已跳过" value={result.skippedCount} /><Statistic title="错误" value={result.errorCount} /></Space>{result.errors.length > 0 && <Alert type="warning" showIcon message={result.errors.slice(0, 8).map((error) => `第 ${error.rowNumber} 行：${error.message}`).join('；')} />}</Card>}
    </div>;
}

function downloadTemplate(): void {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ['2026-09-20', '收入', 10000, 'CNY', '6001', '主营业务收入', '', '', '示例客户', '项目回款', 'V20260920001']]);
    XLSX.utils.book_append_sheet(workbook, sheet, '收支台账');
    XLSX.writeFile(workbook, 'CEES-财务收支台账模板.xlsx');
}

function excelDate(value: string): string { const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value); return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : value; }