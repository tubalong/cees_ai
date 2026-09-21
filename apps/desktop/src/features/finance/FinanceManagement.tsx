import { DollarOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    App as AntdApp, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm,
    Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Timeline, Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import {
    cancelFinanceExpenseReport, createFinanceExpenseCategory, createFinanceExpenseReport,
    deleteFinanceExpenseCategory, deleteFinanceExpenseReport, getFinanceExpenseSummary, getFinanceProjectSpend, hasStoredSession,
    listDepartments, listFinanceExpenseCategories, listFinanceExpenseReports, listProjects, listTenantMembers,
    markFinanceExpenseReportPaid, reviewFinanceExpenseReport, submitFinanceExpenseReport,
    updateFinanceExpenseCategory, updateFinanceExpenseReport, uploadAttachmentFile, withdrawFinanceExpenseReport,
    type DepartmentNode, type FinanceExpenseCategory, type FinanceExpenseItemInput, type FinanceExpenseReport,
    type FinanceExpenseReportFilters, type FinanceExpenseStatus, type FinancePaymentMethod, type MeResult,
} from '../../core/api';
import './finance.css';
import FinanceLedgerPanel from './FinanceLedgerPanel';

type ReportFormValues = {
    title: string; description?: string; currency: string;
    items: Array<FinanceExpenseItemInput>;
};

type CategoryFormValues = { code: string; name: string; description?: string; enabled: boolean };

export default function FinanceManagement({ authContext, onSessionExpired }: { authContext: MeResult; onSessionExpired: () => void }): JSX.Element {
    const permissions = new Set(authContext.permissions);
    const queryClient = useQueryClient();
    const { message } = AntdApp.useApp();
    const [reportForm] = Form.useForm<ReportFormValues>();
    const [categoryForm] = Form.useForm<CategoryFormValues>();
    const [paymentForm] = Form.useForm();
    const [reportDialog, setReportDialog] = useState(false);
    const [categoryDialog, setCategoryDialog] = useState(false);
    const [paymentReport, setPaymentReport] = useState<FinanceExpenseReport>();
    const [editingReport, setEditingReport] = useState<FinanceExpenseReport>();
    const [editingCategory, setEditingCategory] = useState<FinanceExpenseCategory>();
    const [detailReport, setDetailReport] = useState<FinanceExpenseReport>();
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [attachmentNames, setAttachmentNames] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);
    const [filters, setFilters] = useState<FinanceExpenseReportFilters>({});
    const [categoryFilter, setCategoryFilter] = useState<string>();
    const [projectSpendProjectId, setProjectSpendProjectId] = useState<string>();

    const handleError = (error: unknown): void => {
        if (!hasStoredSession()) onSessionExpired();
        message.error(error instanceof Error ? error.message : '操作失败');
    };
    const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['finance'] }); };
    const mutation = useMutation({
        mutationFn: async (work: () => Promise<unknown>) => work(),
        onSuccess: () => { message.success('操作成功'); setReportDialog(false); setCategoryDialog(false); setPaymentReport(undefined); refresh(); },
        onError: handleError,
    });

    const categoriesQuery = useQuery({ queryKey: ['finance', 'categories'], queryFn: listFinanceExpenseCategories, enabled: permissions.has('finance.expense.read') });
    const reportsQuery = useQuery({
        queryKey: ['finance', 'reports', filters, categoryFilter],
        queryFn: () => listFinanceExpenseReports({ ...filters, categoryId: categoryFilter }),
        enabled: permissions.has('finance.expense.read'),
    });
    const membersQuery = useQuery({ queryKey: ['finance', 'members'], queryFn: () => listTenantMembers(), enabled: permissions.has('finance.expense.read') });
    const departmentsQuery = useQuery({ queryKey: ['finance', 'departments'], queryFn: () => listDepartments(), enabled: permissions.has('finance.expense.read') });
    const projectsQuery = useQuery({ queryKey: ['finance', 'projects'], queryFn: () => listProjects({ includeArchived: false }), enabled: permissions.has('finance.expense.read') });
    const period = currentMonthRange();
    const summaryQuery = useQuery({
        queryKey: ['finance', 'summary', period.dateFrom, period.dateTo],
        queryFn: () => getFinanceExpenseSummary(period.dateFrom, period.dateTo),
        enabled: permissions.has('finance.expense.read'),
    });
    const projectSpendQuery = useQuery({
        queryKey: ['finance', 'project-spend', projectSpendProjectId, period.dateFrom, period.dateTo],
        queryFn: () => getFinanceProjectSpend(projectSpendProjectId!, period.dateFrom, period.dateTo),
        enabled: permissions.has('finance.expense.read') && Boolean(projectSpendProjectId),
    });

    const categories = categoriesQuery.data?.items ?? [];
    const reports = reportsQuery.data?.items ?? [];
    const members = membersQuery.data?.items ?? [];
    const departments = useMemo(() => flattenDepartments(departmentsQuery.data?.items ?? []), [departmentsQuery.data]);
    const memberMap = useMemo(() => new Map<string, string>(members.map((item) => [item.id, item.user.displayName])), [members]);
    const departmentMap = useMemo(() => new Map<string, string>(departments.map((item) => [item.id, item.name])), [departments]);
    const categoryMap = useMemo(() => new Map<string, string>(categories.map((item) => [item.id, item.name])), [categories]);
    const projectMap = useMemo(() => new Map<string, string>((projectsQuery.data?.items ?? []).map((item) => [item.id, item.name])), [projectsQuery.data]);

    const openCreateReport = (): void => {
        setEditingReport(undefined); setAttachmentIds([]); setAttachmentNames([]);
        reportForm.setFieldsValue({ currency: 'CNY', items: [{ categoryId: '', description: '', amount: 0, taxAmount: 0, occurredAt: today() }] });
        setReportDialog(true);
    };
    const openEditReport = (report: FinanceExpenseReport): void => {
        setEditingReport(report); setAttachmentIds(report.attachments.map((item) => item.fileObjectId));
        setAttachmentNames(report.attachments.map((item) => item.originalName));
        reportForm.setFieldsValue({
            title: report.title, description: report.description ?? undefined, currency: report.currency,
            items: report.items.map(({ id: _id, reportId: _reportId, sortOrder: _sortOrder, version: _version, createdAt: _createdAt, ...item }) => item),
        });
        setReportDialog(true);
    };
    const saveReport = async (): Promise<void> => {
        const values = await reportForm.validateFields();
        const input = { ...values, attachmentIds };
        mutation.mutate(() => editingReport
            ? updateFinanceExpenseReport(editingReport.id, { ...input, version: editingReport.version })
            : createFinanceExpenseReport(input));
    };
    const openCategory = (category?: FinanceExpenseCategory): void => {
        setEditingCategory(category);
        categoryForm.setFieldsValue(category ? {
            code: category.code, name: category.name, description: category.description ?? undefined, enabled: category.enabled,
        } : { code: '', name: '', enabled: true });
        setCategoryDialog(true);
    };
    const saveCategory = async (): Promise<void> => {
        const values = await categoryForm.validateFields();
        mutation.mutate(() => editingCategory
            ? updateFinanceExpenseCategory(editingCategory.id, { ...values, version: editingCategory.version })
            : createFinanceExpenseCategory(values));
    };
    const uploadFile = async (file?: File): Promise<void> => {
        if (!file) return;
        setUploading(true);
        try {
            const id = await uploadAttachmentFile(file);
            setAttachmentIds((items) => [...items, id]); setAttachmentNames((items) => [...items, file.name]);
            message.success('附件上传成功');
        } catch (error) { handleError(error); } finally { setUploading(false); }
    };

    const ownReports = reports.filter((item) => item.requesterMembershipId === authContext.membership.id);
    const submittedReports = reports.filter((item) => item.status === 'SUBMITTED');
    const approvalReports = reports.filter((item) => ['SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'].includes(item.status));
    const paymentReports = reports.filter((item) => item.status === 'APPROVED' || item.status === 'PAID');

    return <div className="finance-page">
        <div className="finance-heading">
            <div><i><DollarOutlined /></i><div><h2>财务管理</h2><p>报销、审批、付款和项目支出统一管理</p></div></div>
            <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
        </div>
        <SummaryCards summary={summaryQuery.data} />
        <FinanceFilters filters={filters} categoryId={categoryFilter} categories={categories} members={members}
            departments={departments} projects={projectsQuery.data?.items ?? []}
            onChange={setFilters} onCategoryChange={setCategoryFilter} onReset={() => { setFilters({}); setCategoryFilter(undefined); }} />
        <Tabs items={[
            {
                key: 'mine', label: '我的报销',
                children: <ReportTable reports={ownReports} loading={reportsQuery.isLoading} memberMap={memberMap} onDetail={setDetailReport}
                    renderActions={(report) => <MyReportActions report={report} canRequest={permissions.has('finance.expense.request')}
                        busy={mutation.isPending} onEdit={openEditReport} onWork={(work) => mutation.mutate(work)} />} />,
            },
            {
                key: 'approval', label: `审批中心 (${submittedReports.length})`,
                children: <ApprovalPanel reports={approvalReports} loading={reportsQuery.isLoading} memberMap={memberMap}
                    canApprove={permissions.has('finance.expense.approve')} canManage={permissions.has('finance.expense.manage_all')}
                    onDetail={setDetailReport} onWork={(work) => mutation.mutate(work)} />,
            },
            {
                key: 'payment', label: `付款管理 (${paymentReports.filter((item) => item.status === 'APPROVED').length})`,
                children: <PaymentPanel reports={paymentReports} loading={reportsQuery.isLoading} memberMap={memberMap}
                    canPay={permissions.has('finance.expense.manage_all')} onDetail={setDetailReport} onPay={(report) => {
                        setPaymentReport(report);
                        paymentForm.setFieldsValue({ paidAt: new Date().toISOString().slice(0, 16), paymentMethod: 'BANK_TRANSFER' });
                    }} />,
            },
            {
                key: 'categories', label: '报销类别',
                children: <CategoryPanel categories={categories} loading={categoriesQuery.isLoading}
                    canManage={permissions.has('finance.expense.manage_all')} onEdit={openCategory} onWork={(work) => mutation.mutate(work)} />,
            },
            ...(permissions.has('finance.expense.manage_all') ? [{
                key: 'all', label: '全部报销',
                children: <ReportTable reports={reports} loading={reportsQuery.isLoading} memberMap={memberMap} onDetail={setDetailReport} />,
            }] : []),
            {
                key: 'reports', label: '财务报表',
                children: <ReportSummary summary={summaryQuery.data} loading={summaryQuery.isLoading}
                    projects={projectsQuery.data?.items ?? []} projectId={projectSpendProjectId}
                    projectSpend={projectSpendQuery.data} projectSpendLoading={projectSpendQuery.isLoading}
                    onProjectChange={setProjectSpendProjectId} />,
            },
            ...(permissions.has('finance.ledger.read') || permissions.has('finance.ledger.manage') ? [{
                key: 'ledger', label: '收支台账',
                children: <FinanceLedgerPanel canManage={permissions.has('finance.ledger.manage')} onImported={refresh} />,
            }] : []),
        ]} tabBarExtraContent={permissions.has('finance.expense.request')
            ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreateReport}>新建报销</Button> : undefined} />

        <ReportEditor open={reportDialog} form={reportForm} editing={editingReport} categories={categories} departments={departments} projects={projectsQuery.data?.items ?? []} attachmentNames={attachmentNames} uploading={uploading} busy={mutation.isPending} onCancel={() => setReportDialog(false)} onSave={() => void saveReport()} onUpload={(file) => void uploadFile(file)} onRemoveAttachment={(index) => { setAttachmentIds((items) => items.filter((_, itemIndex) => itemIndex !== index)); setAttachmentNames((items) => items.filter((_, itemIndex) => itemIndex !== index)); }} />
        <CategoryEditor open={categoryDialog} form={categoryForm} editing={editingCategory} busy={mutation.isPending} onCancel={() => setCategoryDialog(false)} onSave={() => void saveCategory()} />
        <PaymentEditor report={paymentReport} form={paymentForm} busy={mutation.isPending} onCancel={() => setPaymentReport(undefined)} onSave={async () => { const values = await paymentForm.validateFields(); mutation.mutate(() => markFinanceExpenseReportPaid(paymentReport!.id, { ...values, paidAt: new Date(values.paidAt).toISOString(), version: paymentReport!.version })); }} />
        <ReportDetail report={detailReport} memberMap={memberMap} departmentMap={departmentMap} categoryMap={categoryMap} projectMap={projectMap} onClose={() => setDetailReport(undefined)} />
    </div>;
}

function SummaryCards({ summary }: { summary?: Awaited<ReturnType<typeof getFinanceExpenseSummary>> }): JSX.Element {
    return <Row gutter={12} className="finance-summary">
        <Col span={6}><Card><Statistic title="待审批" value={summary?.pendingApprovalCount ?? 0} suffix="单" /></Card></Col>
        <Col span={6}><Card><Statistic title="待审批金额" value={summary?.pendingApprovalAmount ?? 0} precision={2} prefix="¥" /></Card></Col>
        <Col span={6}><Card><Statistic title="待付款金额" value={summary?.pendingPaymentAmount ?? 0} precision={2} prefix="¥" /></Card></Col>
        <Col span={6}><Card><Statistic title="本月已付款" value={summary?.paidAmount ?? 0} precision={2} prefix="¥" /></Card></Col>
    </Row>;
}

function FinanceFilters({ filters, categoryId, categories, members, departments, projects, onChange, onCategoryChange, onReset }: {
    filters: FinanceExpenseReportFilters; categoryId?: string; categories: FinanceExpenseCategory[];
    members: Array<{ id: string; user: { displayName: string } }>; departments: Array<{ id: string; name: string }>;
    projects: Array<{ id: string; name: string }>; onChange: (filters: FinanceExpenseReportFilters) => void;
    onCategoryChange: (categoryId?: string) => void; onReset: () => void;
}): JSX.Element {
    return <Card size="small" className="finance-filters">
        <Space wrap>
            <Input allowClear placeholder="单号、标题或说明" value={filters.keyword} className="finance-filter-keyword"
                onChange={(event) => onChange({ ...filters, keyword: event.target.value || undefined })} />
            <Select allowClear placeholder="状态" value={filters.status} className="finance-filter-select"
                options={statusOptions} onChange={(status) => onChange({ ...filters, status })} />
            <Select allowClear showSearch optionFilterProp="label" placeholder="报销人" value={filters.requesterMembershipId}
                className="finance-filter-select" options={members.map((item) => ({ value: item.id, label: item.user.displayName }))}
                onChange={(requesterMembershipId) => onChange({ ...filters, requesterMembershipId })} />
            <Select allowClear showSearch optionFilterProp="label" placeholder="部门" value={filters.departmentId}
                className="finance-filter-select" options={departments.map((item) => ({ value: item.id, label: item.name }))}
                onChange={(departmentId) => onChange({ ...filters, departmentId })} />
            <Select allowClear showSearch optionFilterProp="label" placeholder="项目" value={filters.projectId}
                className="finance-filter-select" options={projects.map((item) => ({ value: item.id, label: item.name }))}
                onChange={(projectId) => onChange({ ...filters, projectId })} />
            <Select allowClear showSearch optionFilterProp="label" placeholder="费用类别" value={categoryId}
                className="finance-filter-select" options={categories.map((item) => ({ value: item.id, label: item.name }))}
                onChange={onCategoryChange} />
            <Input type="date" value={filters.dateFrom} className="finance-filter-date"
                onChange={(event) => onChange({ ...filters, dateFrom: event.target.value || undefined })} />
            <Input type="date" value={filters.dateTo} className="finance-filter-date"
                onChange={(event) => onChange({ ...filters, dateTo: event.target.value || undefined })} />
            <Button onClick={onReset}>重置</Button>
        </Space>
    </Card>;
}

function ReportTable({ reports, loading, memberMap, onDetail, renderActions }: {
    reports: FinanceExpenseReport[]; loading: boolean; memberMap: Map<string, string>;
    onDetail: (report: FinanceExpenseReport) => void; renderActions?: (report: FinanceExpenseReport) => JSX.Element;
}): JSX.Element {
    return <Table rowKey="id" loading={loading} dataSource={reports} pagination={{ pageSize: 10 }} columns={[
        { title: '单号', dataIndex: 'reportNo', width: 150, render: (value: string, report) => <Button type="link" onClick={() => onDetail(report)}>{value}</Button> },
        { title: '标题', dataIndex: 'title' },
        { title: '报销人', dataIndex: 'requesterMembershipId', width: 120, render: (value: string) => memberMap.get(value) ?? value.slice(0, 8) },
        { title: '金额', dataIndex: 'totalAmount', width: 120, render: (value: number, report) => `${report.currency} ${value.toFixed(2)}` },
        { title: '状态', dataIndex: 'status', width: 100, render: (value: FinanceExpenseStatus) => <StatusTag status={value} /> },
        { title: '创建时间', dataIndex: 'createdAt', width: 170, render: formatTime },
        ...(renderActions ? [{ title: '操作', key: 'actions', width: 240, render: (_: unknown, report: FinanceExpenseReport) => renderActions(report) }] : []),
    ]} />;
}

function MyReportActions({ report, canRequest, busy, onEdit, onWork }: {
    report: FinanceExpenseReport; canRequest: boolean; busy: boolean; onEdit: (report: FinanceExpenseReport) => void;
    onWork: (work: () => Promise<unknown>) => void;
}): JSX.Element {
    const editable = ['DRAFT', 'REJECTED', 'WITHDRAWN'].includes(report.status);
    if (!canRequest) return <></>;
    return <Space wrap>
        {editable && <Button size="small" onClick={() => onEdit(report)}>编辑</Button>}
        {report.status === 'DRAFT' && <Button size="small" type="primary" loading={busy} onClick={() => onWork(() => submitFinanceExpenseReport(report.id, report.version))}>提交</Button>}
        {report.status === 'SUBMITTED' && <Popconfirm title="确认撤回该报销单？" onConfirm={() => onWork(() => withdrawFinanceExpenseReport(report.id, report.version, '申请人撤回'))}><Button size="small">撤回</Button></Popconfirm>}
        {editable && <Popconfirm title="确认删除该报销草稿？" onConfirm={() => onWork(() => deleteFinanceExpenseReport(report.id, report.version))}><Button size="small" danger>删除</Button></Popconfirm>}
    </Space>;
}

function ApprovalPanel({ reports, loading, memberMap, canApprove, canManage, onDetail, onWork }: {
    reports: FinanceExpenseReport[]; loading: boolean; memberMap: Map<string, string>; canApprove: boolean; canManage: boolean;
    onDetail: (report: FinanceExpenseReport) => void; onWork: (work: () => Promise<unknown>) => void;
}): JSX.Element {
    const review = (report: FinanceExpenseReport, decision: 'APPROVE' | 'REJECT'): void => {
        let comment = '';
        Modal.confirm({
            title: decision === 'APPROVE' ? '审批通过' : '拒绝报销',
            content: <Input.TextArea placeholder={decision === 'REJECT' ? '拒绝原因（必填）' : '审批意见（可选）'} onChange={(event) => { comment = event.target.value; }} />,
            okText: decision === 'APPROVE' ? '通过' : '拒绝', okButtonProps: { danger: decision === 'REJECT' },
            onOk: () => {
                if (decision === 'REJECT' && !comment.trim()) return Promise.reject(new Error('请输入拒绝原因'));
                onWork(() => reviewFinanceExpenseReport(report.id, { decision, comment: comment.trim() || null, version: report.version }));
            },
        });
    };
    return <ReportTable reports={reports} loading={loading} memberMap={memberMap} onDetail={onDetail} renderActions={(report) => report.status === 'SUBMITTED' && (canApprove || canManage) ? <Space>
        {canApprove && <Button size="small" type="primary" onClick={() => review(report, 'APPROVE')}>通过</Button>}
        {canApprove && <Button size="small" danger onClick={() => review(report, 'REJECT')}>拒绝</Button>}
        {canManage && <Popconfirm title="确认管理员取消该报销单？" onConfirm={() => onWork(() => cancelFinanceExpenseReport(report.id, report.version, '管理员取消'))}><Button size="small">取消</Button></Popconfirm>}
    </Space> : <Typography.Text type="secondary">已处理</Typography.Text>} />;
}

function PaymentPanel({ reports, loading, memberMap, canPay, onDetail, onPay }: {
    reports: FinanceExpenseReport[]; loading: boolean; memberMap: Map<string, string>; canPay: boolean;
    onDetail: (report: FinanceExpenseReport) => void; onPay: (report: FinanceExpenseReport) => void;
}): JSX.Element {
    const pending = reports.filter((report) => report.status === 'APPROVED');
    const paid = reports.filter((report) => report.status === 'PAID');
    return <Tabs size="small" items={[
        {
            key: 'pending', label: `待付款 (${pending.length})`, children: <ReportTable reports={pending} loading={loading} memberMap={memberMap} onDetail={onDetail} renderActions={(report) => canPay
                ? <Button size="small" type="primary" onClick={() => onPay(report)}>确认付款</Button> : <></>} />
        },
        { key: 'paid', label: `已付款 (${paid.length})`, children: <ReportTable reports={paid} loading={loading} memberMap={memberMap} onDetail={onDetail} /> },
    ]} />;
}

function CategoryPanel({ categories, loading, canManage, onEdit, onWork }: {
    categories: FinanceExpenseCategory[]; loading: boolean; canManage: boolean;
    onEdit: (category?: FinanceExpenseCategory) => void; onWork: (work: () => Promise<unknown>) => void;
}): JSX.Element {
    return <>
        {canManage && <div className="finance-table-toolbar"><Button type="primary" icon={<PlusOutlined />} onClick={() => onEdit()}>新增类别</Button></div>}
        <Table rowKey="id" loading={loading} dataSource={categories} columns={[
            { title: '编码', dataIndex: 'code', width: 150 }, { title: '名称', dataIndex: 'name', width: 180 },
            { title: '说明', dataIndex: 'description' },
            { title: '状态', dataIndex: 'enabled', width: 100, render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '启用' : '停用'}</Tag> },
            ...(canManage ? [{
                title: '操作', key: 'actions', width: 180, render: (_: unknown, category: FinanceExpenseCategory) => <Space>
                    <Button size="small" onClick={() => onEdit(category)}>编辑</Button>
                    <Popconfirm title="只有未使用类别可以删除，确认继续？" onConfirm={() => onWork(() => deleteFinanceExpenseCategory(category.id, category.version))}><Button size="small" danger>删除</Button></Popconfirm>
                </Space>
            }] : []),
        ]} />
    </>;
}

function ReportSummary({ summary, loading, projects, projectId, projectSpend, projectSpendLoading, onProjectChange }: {
    summary?: Awaited<ReturnType<typeof getFinanceExpenseSummary>>; loading: boolean;
    projects: Array<{ id: string; name: string }>; projectId?: string;
    projectSpend?: Awaited<ReturnType<typeof getFinanceProjectSpend>>; projectSpendLoading: boolean;
    onProjectChange: (projectId?: string) => void;
}): JSX.Element {
    return <Card loading={loading} title="本月费用概况">
        <Row gutter={16}>
            <Col span={8}><Statistic title="已提交金额" value={summary?.submittedAmount ?? 0} precision={2} prefix="¥" /></Col>
            <Col span={8}><Statistic title="已批准金额" value={summary?.approvedAmount ?? 0} precision={2} prefix="¥" /></Col>
            <Col span={8}><Statistic title="已付款金额" value={summary?.paidAmount ?? 0} precision={2} prefix="¥" /></Col>
        </Row>
        <Table className="finance-category-summary" rowKey="categoryId" pagination={false} dataSource={summary?.byCategory ?? []} columns={[
            { title: '费用类别', dataIndex: 'categoryName' },
            { title: '金额', dataIndex: 'amount', render: (value: number) => `${summary?.currency ?? 'CNY'} ${value.toFixed(2)}` },
        ]} />
        <div className="finance-project-summary-heading">
            <strong>项目支出</strong>
            <Select allowClear showSearch optionFilterProp="label" placeholder="选择项目" value={projectId}
                className="finance-project-select" options={projects.map((item) => ({ value: item.id, label: item.name }))}
                onChange={onProjectChange} />
        </div>
        <Card size="small" loading={projectSpendLoading}>
            {projectId ? <Row gutter={16}>
                <Col span={8}><Statistic title="已提交支出" value={projectSpend?.submittedAmount ?? 0} precision={2} prefix="¥" /></Col>
                <Col span={8}><Statistic title="已批准支出" value={projectSpend?.approvedAmount ?? 0} precision={2} prefix="¥" /></Col>
                <Col span={8}><Statistic title="已付款支出" value={projectSpend?.paidAmount ?? 0} precision={2} prefix="¥" /></Col>
            </Row> : <Typography.Text type="secondary">选择项目后查看预算页面可消费的支出事实</Typography.Text>}
        </Card>
    </Card>;
}

function ReportEditor({ open, form, editing, categories, departments, projects, attachmentNames, uploading, busy, onCancel, onSave, onUpload, onRemoveAttachment }: {
    open: boolean; form: ReturnType<typeof Form.useForm<ReportFormValues>>[0]; editing?: FinanceExpenseReport;
    categories: FinanceExpenseCategory[]; departments: Array<{ id: string; name: string }>;
    projects: Array<{ id: string; name: string }>; attachmentNames: string[]; uploading: boolean; busy: boolean;
    onCancel: () => void; onSave: () => void; onUpload: (file?: File) => void; onRemoveAttachment: (index: number) => void;
}): JSX.Element {
    const items = Form.useWatch('items', form) ?? [];
    const total = items.reduce((sum, item) => sum + Number(item?.amount || 0), 0);
    return <Modal width={980} open={open} title={editing ? `编辑报销 ${editing.reportNo}` : '新建报销草稿'} onCancel={onCancel} onOk={onSave} confirmLoading={busy} destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
            <Row gutter={12}>
                <Col span={16}><Form.Item name="title" label="报销标题" rules={[{ required: true, message: '请输入报销标题' }]}><Input maxLength={120} /></Form.Item></Col>
                <Col span={8}><Form.Item name="currency" label="币种" rules={[{ required: true }]}><Select options={[{ value: 'CNY', label: 'CNY 人民币' }, { value: 'USD', label: 'USD 美元' }, { value: 'EUR', label: 'EUR 欧元' }]} /></Form.Item></Col>
            </Row>
            <Form.Item name="description" label="报销说明"><Input.TextArea maxLength={2000} rows={2} /></Form.Item>
            <div className="finance-items-title"><strong>费用明细</strong><span>服务端合计：{total.toFixed(2)}</span></div>
            <Form.List name="items">
                {(fields, { add, remove }) => <Space direction="vertical" className="finance-items" size={10}>
                    {fields.map((field, index) => <Card size="small" key={field.key} title={`明细 ${index + 1}`} extra={fields.length > 1 ? <Button type="link" danger onClick={() => remove(field.name)}>删除</Button> : undefined}>
                        <Row gutter={10}>
                            <Col span={6}><Form.Item name={[field.name, 'categoryId']} label="费用类别" rules={[{ required: true }]}><Select options={categories.filter((item) => item.enabled).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} /></Form.Item></Col>
                            <Col span={8}><Form.Item name={[field.name, 'description']} label="费用说明" rules={[{ required: true }]}><Input maxLength={500} /></Form.Item></Col>
                            <Col span={5}><Form.Item name={[field.name, 'amount']} label="金额" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} className="finance-full-width" /></Form.Item></Col>
                            <Col span={5}><Form.Item name={[field.name, 'occurredAt']} label="发生日期" rules={[{ required: true }]}><Input type="date" /></Form.Item></Col>
                        </Row>
                        <Row gutter={10}>
                            <Col span={5}><Form.Item name={[field.name, 'merchantName']} label="商户/收款方"><Input /></Form.Item></Col>
                            <Col span={5}><Form.Item name={[field.name, 'invoiceNumber']} label="发票号码"><Input /></Form.Item></Col>
                            <Col span={5}><Form.Item name={[field.name, 'projectId']} label="归属项目"><Select allowClear options={projects.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
                            <Col span={5}><Form.Item name={[field.name, 'departmentId']} label="归属部门"><Select allowClear options={departments.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item></Col>
                            <Col span={4}><Form.Item name={[field.name, 'taxAmount']} label="税额"><InputNumber min={0} precision={2} className="finance-full-width" /></Form.Item></Col>
                        </Row>
                    </Card>)}
                    <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ amount: 0, taxAmount: 0, occurredAt: today() })}>增加明细</Button>
                </Space>}
            </Form.List>
            <div className="finance-attachments">
                <label className="ant-btn"><UploadOutlined /> {uploading ? '上传中…' : '上传票据'}<input hidden type="file" disabled={uploading} accept="image/*,.pdf" onChange={(event) => { onUpload(event.target.files?.[0]); event.target.value = ''; }} /></label>
                <Space wrap>{attachmentNames.map((name, index) => <Tag closable onClose={() => onRemoveAttachment(index)} key={`${name}-${index}`}>{name}</Tag>)}</Space>
            </div>
        </Form>
    </Modal>;
}

function CategoryEditor({ open, form, editing, busy, onCancel, onSave }: {
    open: boolean; form: ReturnType<typeof Form.useForm<CategoryFormValues>>[0]; editing?: FinanceExpenseCategory;
    busy: boolean; onCancel: () => void; onSave: () => void;
}): JSX.Element {
    return <Modal open={open} title={editing ? '编辑报销类别' : '新增报销类别'} onCancel={onCancel} onOk={onSave} confirmLoading={busy} destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
            <Form.Item name="code" label="类别编码" rules={[{ required: true }]}><Input maxLength={64} /></Form.Item>
            <Form.Item name="name" label="类别名称" rules={[{ required: true }]}><Input maxLength={120} /></Form.Item>
            <Form.Item name="description" label="说明"><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
        </Form>
    </Modal>;
}

function PaymentEditor({ report, form, busy, onCancel, onSave }: {
    report?: FinanceExpenseReport; form: ReturnType<typeof Form.useForm>[0]; busy: boolean; onCancel: () => void; onSave: () => void;
}): JSX.Element {
    return <Modal open={Boolean(report)} title={`确认付款${report ? ` · ${report.reportNo}` : ''}`} onCancel={onCancel} onOk={onSave} confirmLoading={busy} destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
            <Form.Item label="付款金额"><Typography.Text strong>{report?.currency} {report?.totalAmount.toFixed(2)}</Typography.Text></Form.Item>
            <Form.Item name="paidAt" label="付款时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
            <Form.Item name="paymentMethod" label="付款方式" rules={[{ required: true }]}><Select options={paymentMethodOptions} /></Form.Item>
            <Form.Item name="paymentReference" label="付款流水号" rules={[{ required: true }]}><Input maxLength={120} /></Form.Item>
            <Form.Item name="comment" label="付款备注"><Input.TextArea rows={3} maxLength={1000} /></Form.Item>
        </Form>
    </Modal>;
}

function ReportDetail({ report, memberMap, departmentMap, categoryMap, projectMap, onClose }: {
    report?: FinanceExpenseReport; memberMap: Map<string, string>; departmentMap: Map<string, string>;
    categoryMap: Map<string, string>; projectMap: Map<string, string>; onClose: () => void;
}): JSX.Element {
    return <Modal width={900} open={Boolean(report)} title={report ? `报销详情 · ${report.reportNo}` : '报销详情'} footer={null} onCancel={onClose}>
        {report && <>
            <Descriptions bordered size="small" column={3} items={[
                { key: 'requester', label: '报销人', children: memberMap.get(report.requesterMembershipId) ?? report.requesterMembershipId },
                { key: 'status', label: '状态', children: <StatusTag status={report.status} /> },
                { key: 'amount', label: '总金额', children: `${report.currency} ${report.totalAmount.toFixed(2)}` },
                { key: 'department', label: '申请部门', children: report.requesterDepartmentId ? departmentMap.get(report.requesterDepartmentId) ?? '-' : '-' },
                { key: 'created', label: '创建时间', children: formatTime(report.createdAt) },
                { key: 'review', label: '审批意见', children: report.reviewComment ?? '-' },
                { key: 'description', label: '说明', children: report.description ?? '-', span: 3 },
                { key: 'paidAt', label: '付款时间', children: formatTime(report.paidAt ?? undefined) },
                { key: 'paymentMethod', label: '付款方式', children: report.paymentMethod ? paymentMethodLabel(report.paymentMethod) : '-' },
                { key: 'paymentReference', label: '付款流水号', children: report.paymentReference ?? '-' },
            ]} />
            <Table className="finance-detail-table" rowKey="id" pagination={false} dataSource={report.items} columns={[
                { title: '类别', dataIndex: 'categoryId', render: (value: string) => categoryMap.get(value) ?? value },
                { title: '说明', dataIndex: 'description' },
                { title: '金额', dataIndex: 'amount', render: (value: number) => value.toFixed(2) },
                { title: '日期', dataIndex: 'occurredAt' },
                { title: '项目', dataIndex: 'projectId', render: (value?: string) => value ? projectMap.get(value) ?? value : '-' },
            ]} />
            <p><strong>附件：</strong>{report.attachments.length ? report.attachments.map((item) => item.originalName).join('、') : '无'}</p>
            <Timeline items={report.statusHistory.map((item) => ({ children: `${statusLabel(item.toStatus)} · ${formatTime(item.createdAt)}${item.comment ? ` · ${item.comment}` : ''}` }))} />
        </>}
    </Modal>;
}

const paymentMethodOptions: Array<{ value: FinancePaymentMethod; label: string }> = [
    { value: 'BANK_TRANSFER', label: '银行转账' }, { value: 'CASH', label: '现金' },
    { value: 'CORPORATE_CARD', label: '企业卡' }, { value: 'OTHER', label: '其他' },
];

const statusOptions: Array<{ value: FinanceExpenseStatus; label: string }> = [
    { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '待审批' },
    { value: 'APPROVED', label: '已批准' }, { value: 'REJECTED', label: '已拒绝' },
    { value: 'WITHDRAWN', label: '已撤回' }, { value: 'CANCELLED', label: '已取消' },
    { value: 'PAID', label: '已付款' },
];

function StatusTag({ status }: { status: FinanceExpenseStatus }): JSX.Element {
    const colors: Record<FinanceExpenseStatus, string> = { DRAFT: 'default', SUBMITTED: 'blue', APPROVED: 'green', REJECTED: 'red', WITHDRAWN: 'orange', CANCELLED: 'default', PAID: 'purple' };
    return <Tag color={colors[status]}>{statusLabel(status)}</Tag>;
}
function statusLabel(status: FinanceExpenseStatus): string {
    return ({ DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已批准', REJECTED: '已拒绝', WITHDRAWN: '已撤回', CANCELLED: '已取消', PAID: '已付款' } as Record<FinanceExpenseStatus, string>)[status];
}
function paymentMethodLabel(method: FinancePaymentMethod): string {
    return paymentMethodOptions.find((item) => item.value === method)?.label ?? method;
}
function flattenDepartments(nodes: DepartmentNode[], prefix = ''): Array<{ id: string; name: string }> {
    return nodes.flatMap((node) => [{ id: node.id, name: `${prefix}${node.name}` }, ...flattenDepartments(node.children ?? [], `${prefix}　`)]);
}
function formatTime(value?: string): string { return value ? new Date(value).toLocaleString('zh-CN') : '-'; }
function today(): string { return new Date().toISOString().slice(0, 10); }
function currentMonthRange(): { dateFrom: string; dateTo: string } {
    const now = new Date();
    const dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { dateFrom, dateTo: `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}` };
}
