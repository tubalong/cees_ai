import { DownloadOutlined, FileExcelOutlined, UploadOutlined } from '@ant-design/icons';
import { App as AntdApp, Alert, Button, Card, Checkbox, Empty, Popconfirm, Select, Space, Spin, Statistic, Table, Tabs, Tag, Upload } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
    createFinanceLedgerImport, listFinanceLedgerEntries, listFinanceLedgerImports, rollbackFinanceLedgerImport,
    uploadAttachmentFile,
    type FinanceLedgerEntry, type FinanceLedgerImport, type FinanceLedgerRow,
} from '../../core/api';

const HEADERS = ['发生日期', '方向', '金额', '币种', '科目编码', '科目名称', '部门ID', '项目ID', '交易对方', '摘要', '凭证号'];
const PAGE_SIZE = 20;

const IMPORT_STATUS_LABELS: Record<string, { text: string; color?: string }> = {
    PENDING: { text: '待处理' },
    PARSING: { text: '解析中', color: 'processing' },
    SUCCEEDED: { text: '全部导入', color: 'green' },
    PARTIAL: { text: '部分导入', color: 'orange' },
    FAILED: { text: '导入失败', color: 'red' },
};

/**
 * 收支台账面板。
 *
 * 三个页签对应台账的三步工作流：上传 → 核对批次 → 核对明细。
 * 回滚以**导入批次**为粒度（一次上传 = 一个批次）：台账要求「可解释、可撤销」，
 * 逐行删除会让账面与原始凭证对不上，整批撤销才能保证账实一致。
 */
export default function FinanceLedgerPanel({ canManage, onImported }: { canManage: boolean; onImported: () => void }): JSX.Element {
    return <div className="finance-ledger-panel">
        <Tabs items={[
            { key: 'upload', label: '上传台账', children: <LedgerUploadTab canManage={canManage} onImported={onImported} /> },
            { key: 'history', label: '导入历史', children: <LedgerImportHistoryTab canManage={canManage} onRolledBack={onImported} /> },
            { key: 'entries', label: '收支明细', children: <LedgerEntriesTab /> },
        ]} />
    </div>;
}

/** 上传页签：解析本地 Excel/CSV → 预览 → 确认导入，并可选留档原文件。 */
function LedgerUploadTab({ canManage, onImported }: { canManage: boolean; onImported: () => void }): JSX.Element {
    const { message } = AntdApp.useApp();
    const [fileName, setFileName] = useState('');
    const [rows, setRows] = useState<FinanceLedgerRow[]>([]);
    const [sourceFile, setSourceFile] = useState<File>();
    const [keepSource, setKeepSource] = useState(false);
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
            setFileName(file.name); setRows(parsed); setSourceFile(file); message.success(`已解析 ${parsed.length} 行`);
        } catch (error) { setRows([]); setSourceFile(undefined); message.error(error instanceof Error ? error.message : '解析失败'); } finally { setBusy(false); }
    };

    const submit = async (): Promise<void> => {
        if (!rows.length) return;
        setBusy(true);
        try {
            // 留档是可选项：只有用户勾选时才上传原件，避免把台账原件无意识地长期存入对象存储。
            const sourceFileObjectId = keepSource && sourceFile ? await uploadAttachmentFile(sourceFile) : undefined;
            const dates = rows.map((row) => row.occurredOn).sort();
            const imported = await createFinanceLedgerImport({
                fileName, format: fileName.toLowerCase().endsWith('.csv') ? 'CSV' : 'XLSX',
                periodStart: dates[0], periodEnd: dates.at(-1)!, sourceFileObjectId, rows,
            });
            setResult(imported); onImported(); message.success(`成功导入 ${imported.importedCount} 行`);
        } catch (error) { message.error(error instanceof Error ? error.message : '导入失败'); } finally { setBusy(false); }
    };

    return <>
        <Card title="收支台账上传" extra={<Space><Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载模板</Button>{canManage && <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={(file) => { void parseFile(file); return false; }}><Button icon={<UploadOutlined />} loading={busy}>选择台账</Button></Upload>}<Button type="primary" disabled={!canManage || !rows.length} loading={busy} onClick={() => void submit()}>确认导入</Button></Space>}>
            <Alert type="info" showIcon message="财务首页按昨日和上月展示收支；导入后系统会自动重算日/月快照。相同日期、方向和凭证号重复上传时自动跳过。回滚在「导入历史」页签按批次整批撤销。" />
            {rows.length > 0 && <div className="finance-ledger-options">
                <Checkbox checked={keepSource} disabled={!canManage} onChange={(event) => setKeepSource(event.target.checked)}>
                    留档原始文件（便于事后核对与审计，会占用对象存储空间）
                </Checkbox>
            </div>}
            {!rows.length ? <Upload.Dragger disabled={!canManage} accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={(file) => { void parseFile(file); return false; }}><p className="ant-upload-drag-icon"><FileExcelOutlined /></p><p>拖入财务收支台账，或点击选择文件</p></Upload.Dragger> : <Table size="small" rowKey="rowNumber" dataSource={rows.slice(0, 100)} pagination={{ pageSize: 10 }} columns={[{ title: '行', dataIndex: 'rowNumber', width: 70 }, { title: '日期', dataIndex: 'occurredOn' }, { title: '方向', dataIndex: 'direction', render: (value) => value === 'INCOME' ? '收入' : '支出' }, { title: '金额', dataIndex: 'amount' }, { title: '科目', dataIndex: 'categoryName' }, { title: '凭证号', dataIndex: 'voucherNo' }]} />}
        </Card>
        {result && <Card title="导入结果"><Space size="large"><Statistic title="总行数" value={result.rowCount} /><Statistic title="已导入" value={result.importedCount} /><Statistic title="已跳过" value={result.skippedCount} /><Statistic title="错误" value={result.errorCount} /></Space>{result.errors.length > 0 && <Alert type="warning" showIcon message={result.errors.slice(0, 8).map((error) => `第 ${error.rowNumber} 行：${error.message}`).join('；')} />}</Card>}
    </>;
}

/** 导入历史页签：按批次展示并支持整批回滚。 */
function LedgerImportHistoryTab({ canManage, onRolledBack }: { canManage: boolean; onRolledBack: () => void }): JSX.Element {
    const { message } = AntdApp.useApp();
    const [items, setItems] = useState<FinanceLedgerImport[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [rollingBack, setRollingBack] = useState<string>();

    const load = useCallback(async (nextCursor?: string): Promise<void> => {
        setLoading(true);
        try {
            const page = await listFinanceLedgerImports(PAGE_SIZE, nextCursor);
            setItems((current) => nextCursor ? [...current, ...page.items] : page.items);
            setCursor(page.nextCursor);
        } catch (error) { message.error(error instanceof Error ? error.message : '加载导入历史失败'); } finally { setLoading(false); }
    }, [message]);

    useEffect(() => { void load(); }, [load]);

    const rollback = async (importId: string): Promise<void> => {
        setRollingBack(importId);
        try {
            await rollbackFinanceLedgerImport(importId);
            message.success('该批次已回滚，相关收支明细已作废');
            setItems((current) => current.filter((item) => item.id !== importId));
            onRolledBack();
        } catch (error) { message.error(error instanceof Error ? error.message : '回滚失败'); } finally { setRollingBack(undefined); }
    };

    return <Card title="导入历史" extra={<Button size="small" onClick={() => void load()}>刷新</Button>}>
        <Alert type="info" showIcon message="回滚按批次整批撤销：该次上传导入的全部明细会一并作废并重算快照，其他批次不受影响。" />
        <Table<FinanceLedgerImport> size="small" rowKey="id" loading={loading} dataSource={items} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有导入记录" /> }}
            pagination={false}
            columns={[
                { title: '文件名', dataIndex: 'fileName', ellipsis: true },
                { title: '期间', render: (_, item) => `${item.periodStart} ~ ${item.periodEnd}` },
                { title: '状态', dataIndex: 'status', width: 110, render: (value: string) => { const meta = IMPORT_STATUS_LABELS[value] ?? { text: value }; return <Tag color={meta.color}>{meta.text}</Tag>; } },
                { title: '行数', dataIndex: 'rowCount', width: 70 },
                { title: '已导入', dataIndex: 'importedCount', width: 80 },
                { title: '已跳过', dataIndex: 'skippedCount', width: 80 },
                { title: '错误', dataIndex: 'errorCount', width: 70, render: (value: number) => value > 0 ? <Tag color="red">{value}</Tag> : 0 },
                { title: '导入时间', dataIndex: 'createdAt', width: 170, render: (value?: string) => value ? new Date(value).toLocaleString() : '-' },
                { title: '原文件', dataIndex: 'sourceFileObjectId', width: 90, render: (value?: string | null) => value ? <Tag color="blue">已留档</Tag> : <span className="finance-ledger-muted">未留档</span> },
                {
                    title: '操作', width: 100,
                    render: (_, item) => canManage
                        ? <Popconfirm title="回滚该批次" description="该次导入的全部收支明细将被作废，且不可恢复。确认回滚？" okText="确认回滚" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void rollback(item.id)}>
                            <Button size="small" danger loading={rollingBack === item.id}>回滚</Button>
                        </Popconfirm>
                        : <span className="finance-ledger-muted">无权限</span>,
                },
            ]} />
        {cursor && <div className="finance-ledger-more"><Button size="small" loading={loading} onClick={() => void load(cursor)}>加载更多</Button></div>}
    </Card>;
}

/** 收支明细页签：按方向与日期区间核对台账明细。 */
function LedgerEntriesTab(): JSX.Element {
    const { message } = AntdApp.useApp();
    const [items, setItems] = useState<FinanceLedgerEntry[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [direction, setDirection] = useState<'INCOME' | 'EXPENSE'>();
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const load = useCallback(async (nextCursor?: string): Promise<void> => {
        setLoading(true);
        try {
            const page = await listFinanceLedgerEntries({
                limit: PAGE_SIZE, cursor: nextCursor, direction,
                dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
            });
            setItems((current) => nextCursor ? [...current, ...page.items] : page.items);
            setCursor(page.nextCursor);
        } catch (error) { message.error(error instanceof Error ? error.message : '加载收支明细失败'); } finally { setLoading(false); }
    }, [dateFrom, dateTo, direction, message]);

    useEffect(() => { void load(); }, [load]);

    return <Card title="收支明细" extra={<Space wrap>
        <Select allowClear placeholder="方向" value={direction} style={{ width: 110 }}
            options={[{ value: 'INCOME', label: '收入' }, { value: 'EXPENSE', label: '支出' }]}
            onChange={(value) => setDirection(value)} />
        <input type="date" className="finance-ledger-date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <span className="finance-ledger-muted">至</span>
        <input type="date" className="finance-ledger-date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <Button size="small" onClick={() => void load()}>刷新</Button>
    </Space>}>
        <Table<FinanceLedgerEntry> size="small" rowKey="id" loading={loading} dataSource={items} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有收支明细" /> }}
            pagination={false}
            columns={[
                { title: '发生日期', dataIndex: 'occurredOn', width: 120 },
                { title: '方向', dataIndex: 'direction', width: 80, render: (value: string) => value === 'INCOME' ? <Tag color="green">收入</Tag> : <Tag color="orange">支出</Tag> },
                { title: '金额', dataIndex: 'amount', width: 140, align: 'right', render: (value: number, item) => `${item.currency} ${value}` },
                { title: '科目', render: (_, item) => item.categoryName ?? item.categoryCode ?? '-' },
                { title: '交易对方', dataIndex: 'counterparty', render: (value?: string | null) => value || '-' },
                { title: '摘要', dataIndex: 'summary', ellipsis: true, render: (value?: string | null) => value || '-' },
                { title: '凭证号', dataIndex: 'voucherNo', width: 160 },
            ]} />
        {cursor && <div className="finance-ledger-more"><Button size="small" loading={loading} onClick={() => void load(cursor)}>加载更多</Button></div>}
        {loading && !items.length && <div className="data-loading"><Spin /></div>}
    </Card>;
}

function downloadTemplate(): void {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ['2026-09-20', '收入', 10000, 'CNY', '6001', '主营业务收入', '', '', '示例客户', '项目回款', 'V20260920001']]);
    XLSX.utils.book_append_sheet(workbook, sheet, '收支台账');
    XLSX.writeFile(workbook, 'CEES-财务收支台账模板.xlsx');
}

function excelDate(value: string): string { const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value); return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : value; }