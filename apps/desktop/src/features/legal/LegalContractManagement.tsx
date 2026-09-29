import { FileProtectOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    App as AntdApp, Button, Card, Col, Descriptions, Drawer, Form, Input, InputNumber, Modal,
    Popconfirm, Row, Select, Space, Statistic, Table, Tag, Timeline, Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import {
    activateLegalContract, archiveLegalContract, createLegalContract, deleteLegalContract,
    getLegalContractSummary, hasStoredSession, listDepartments, listLegalContracts, listProjects,
    listTenantMembers, markLegalContractPendingRenewal, renewLegalContract, terminateLegalContract,
    updateLegalContract, uploadAttachmentFile,
    type DepartmentNode, type LegalContract, type LegalContractFilters, type LegalContractInput,
    type LegalContractStatus, type LegalContractType, type MeResult, type PageAssistantContext,
} from '../../core/api';
import './legal.css';
import PageAssistant from '../assistant/PageAssistant';
import { useNavigate } from 'react-router-dom';

type ContractFormValues = Omit<LegalContractInput, 'attachmentIds'>;

const statusLabels: Record<LegalContractStatus, string> = {
    DRAFT: '草稿', ACTIVE: '生效', PENDING_RENEWAL: '待续签', EXPIRED: '已到期', TERMINATED: '已终止', ARCHIVED: '已归档',
};
const statusColors: Record<LegalContractStatus, string> = {
    DRAFT: 'default', ACTIVE: 'green', PENDING_RENEWAL: 'orange', EXPIRED: 'red', TERMINATED: 'volcano', ARCHIVED: 'blue',
};
const typeLabels: Record<LegalContractType, string> = {
    PURCHASE: '采购', SALES: '销售', SERVICE: '服务', EMPLOYMENT: '劳动', NDA: '保密', LEASE: '租赁', OTHER: '其他',
};

export default function LegalContractManagement({ authContext, onSessionExpired }: { authContext: MeResult; onSessionExpired: () => void }): JSX.Element {
    const permissions = new Set(authContext.permissions);
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message, modal } = AntdApp.useApp();
    const [form] = Form.useForm<ContractFormValues>();
    const [filters, setFilters] = useState<LegalContractFilters>({});
    const [editing, setEditing] = useState<LegalContract>();
    const [detail, setDetail] = useState<LegalContract>();
    const [formOpen, setFormOpen] = useState(false);
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [attachmentNames, setAttachmentNames] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);

    const canRead = permissions.has('legal.contract.read');
    const canCreate = permissions.has('legal.contract.create');
    const canUpdate = permissions.has('legal.contract.update');
    const canDelete = permissions.has('legal.contract.delete');
    const handleError = (error: unknown): void => {
        if (!hasStoredSession()) onSessionExpired();
        message.error(error instanceof Error ? error.message : '操作失败');
    };
    const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['legal'] }); };
    const mutation = useMutation({
        mutationFn: async (work: () => Promise<unknown>) => work(),
        onSuccess: () => { message.success('操作成功'); setFormOpen(false); setDetail(undefined); refresh(); },
        onError: handleError,
    });

    const contractsQuery = useInfiniteQuery({
        queryKey: ['legal', 'contracts', filters],
        queryFn: ({ pageParam }) => listLegalContracts({ ...filters, cursor: pageParam ?? undefined }),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: canRead,
    });
    const contracts = useMemo(
        () => (contractsQuery.data?.pages ?? []).flatMap((page) => page.items),
        [contractsQuery.data],
    );
    const summaryQuery = useQuery({ queryKey: ['legal', 'summary'], queryFn: () => getLegalContractSummary(30), enabled: canRead });
    const membersQuery = useQuery({ queryKey: ['legal', 'members'], queryFn: () => listTenantMembers(), enabled: canRead });
    const departmentsQuery = useQuery({ queryKey: ['legal', 'departments'], queryFn: () => listDepartments(), enabled: canRead });
    const projectsQuery = useQuery({ queryKey: ['legal', 'projects'], queryFn: () => listProjects({ includeArchived: false }), enabled: canRead });
    const members = membersQuery.data?.items ?? [];
    const departments = useMemo(() => flattenDepartments(departmentsQuery.data?.items ?? []), [departmentsQuery.data]);
    const projects = projectsQuery.data?.items ?? [];
    const memberMap = new Map(members.map((member) => [member.id, member.user.displayName]));
    const departmentMap = new Map(departments.map((department) => [department.id, department.name]));
    const projectMap = new Map(projects.map((project) => [project.id, project.name]));
    const pageAssistantContext: PageAssistantContext = {
        source: 'legal-contracts',
        role: '法务合同助手',
        selected: detail ? { id: detail.id, name: detail.name, contractNo: detail.contractNo, status: detail.status } : undefined,
        summary: { contractCount: contracts.length, activeCount: summaryQuery.data?.activeCount ?? 0, expiringCount: summaryQuery.data?.expiringCount ?? 0, pendingRenewalCount: summaryQuery.data?.pendingRenewalCount ?? 0 },
    };

    const openForm = (contract?: LegalContract): void => {
        setEditing(contract);
        setAttachmentIds(contract?.attachments.map((attachment) => attachment.fileObjectId) ?? []);
        setAttachmentNames(contract?.attachments.map((attachment) => attachment.originalName) ?? []);
        form.setFieldsValue(contract ? {
            contractNo: contract.contractNo, name: contract.name, counterparty: contract.counterparty, type: contract.type,
            amount: contract.amount, currency: contract.currency, startDate: contract.startDate, endDate: contract.endDate,
            signedAt: contract.signedAt, description: contract.description, ownerMembershipId: contract.ownerMembershipId,
            departmentId: contract.departmentId, projectId: contract.projectId, renewalReminderDays: contract.renewalReminderDays,
        } : { currency: 'CNY', renewalReminderDays: 30, type: 'SERVICE' });
        setFormOpen(true);
    };
    const submit = async (): Promise<void> => {
        const values = await form.validateFields();
        const input = { ...values, attachmentIds } as LegalContractInput;
        mutation.mutate(() => editing
            ? updateLegalContract(editing.id, { ...input, version: editing.version })
            : createLegalContract(input));
    };
    const upload = async (file: File): Promise<void> => {
        setUploading(true);
        try {
            const id = await uploadAttachmentFile(file);
            setAttachmentIds((current) => [...current, id]);
            setAttachmentNames((current) => [...current, file.name]);
            message.success('附件上传完成');
        } catch (error) { handleError(error); } finally { setUploading(false); }
    };
    const action = (work: () => Promise<unknown>): void => mutation.mutate(work);
    const renew = (contract: LegalContract): void => {
        let newEndDate = contract.endDate ?? '';
        modal.confirm({
            title: '续签合同', content: <Input type="date" defaultValue={newEndDate} onChange={(event) => { newEndDate = event.target.value; }} />,
            onOk: async () => { if (!newEndDate) throw new Error('请选择新到期日期'); await renewLegalContract(contract.id, { newEndDate, version: contract.version }); refresh(); },
        });
    };
    const terminate = (contract: LegalContract): void => {
        let effectiveDate = new Date().toISOString().slice(0, 10); let reason = '';
        modal.confirm({
            title: '提前终止合同', content: <Space direction="vertical" className="legal-full-width"><Input type="date" defaultValue={effectiveDate} onChange={(event) => { effectiveDate = event.target.value; }} /><Input.TextArea placeholder="终止原因" onChange={(event) => { reason = event.target.value; }} /></Space>,
            onOk: async () => { if (!reason.trim()) throw new Error('请填写终止原因'); await terminateLegalContract(contract.id, { effectiveDate, reason, version: contract.version }); refresh(); },
        });
    };

    if (!canRead) return <Card><Typography.Text type="secondary">缺少合同台账读取权限。</Typography.Text></Card>;
    const summary = summaryQuery.data;
    return <div className="legal-page">
        <div className="legal-heading"><div><i><FileProtectOutlined /></i><span><h2>合同台账</h2><p>统一管理合同归属、附件、生命周期与到期提醒</p></span></div><Space><Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>{canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>新增合同</Button>}</Space></div>
        <Row gutter={12} className="legal-summary">
            <Col span={4}><Card><Statistic title="合同总数" value={summary?.totalCount ?? 0} /></Card></Col>
            <Col span={4}><Card><Statistic title="生效合同" value={summary?.activeCount ?? 0} /></Card></Col>
            <Col span={4}><Card><Statistic title="30 天内到期" value={summary?.expiringCount ?? 0} /></Card></Col>
            <Col span={4}><Card><Statistic title="待续签" value={summary?.pendingRenewalCount ?? 0} /></Card></Col>
            <Col span={4}><Card><Statistic title="已到期" value={summary?.expiredCount ?? 0} /></Card></Col>
            <Col span={4}><Card><Statistic title="草稿" value={summary?.draftCount ?? 0} /></Card></Col>
        </Row>
        <Card className="legal-filters"><Space wrap>
            <Input allowClear placeholder="编号、名称、交易对方" className="legal-keyword" value={filters.keyword ?? ''} onChange={(event) => setFilters((value) => ({ ...value, keyword: event.target.value || undefined }))} />
            <Select allowClear placeholder="状态" className="legal-select" value={filters.status} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} onChange={(status) => setFilters((value) => ({ ...value, status }))} />
            <Select allowClear placeholder="合同类型" className="legal-select" value={filters.type} options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))} onChange={(type) => setFilters((value) => ({ ...value, type }))} />
            <Select allowClear showSearch placeholder="负责人" className="legal-select" value={filters.ownerMembershipId} options={members.map((member) => ({ value: member.id, label: member.user.displayName }))} onChange={(ownerMembershipId) => setFilters((value) => ({ ...value, ownerMembershipId }))} />
            <Select allowClear showSearch placeholder="归属部门" className="legal-select" value={filters.departmentId} options={departments.map((department) => ({ value: department.id, label: department.name }))} onChange={(departmentId) => setFilters((value) => ({ ...value, departmentId }))} />
            <Select allowClear showSearch placeholder="关联项目" className="legal-select" value={filters.projectId} options={projects.map((project) => ({ value: project.id, label: project.name }))} onChange={(projectId) => setFilters((value) => ({ ...value, projectId }))} />
            <Input type="date" className="legal-date" value={filters.endDateFrom ?? ''} onChange={(event) => setFilters((value) => ({ ...value, endDateFrom: event.target.value || undefined }))} />
            <Typography.Text type="secondary">至</Typography.Text>
            <Input type="date" className="legal-date" value={filters.endDateTo ?? ''} onChange={(event) => setFilters((value) => ({ ...value, endDateTo: event.target.value || undefined }))} />
            <Button onClick={() => setFilters({ expiringWithinDays: 30 })}>只看 30 天内到期</Button>
            <Button onClick={() => setFilters({})}>清空筛选</Button>
        </Space></Card>
        <Card><Table rowKey="id" loading={contractsQuery.isLoading} dataSource={contracts} columns={[
            { title: '合同编号', dataIndex: 'contractNo', width: 155 },
            { title: '合同名称', dataIndex: 'name', ellipsis: true },
            { title: '交易对方', dataIndex: 'counterparty', ellipsis: true },
            { title: '类型', dataIndex: 'type', width: 90, render: (value: LegalContractType) => typeLabels[value] },
            { title: '金额', width: 120, render: (_: unknown, contract: LegalContract) => contract.amount == null ? '-' : `${contract.currency} ${contract.amount.toLocaleString()}` },
            { title: '负责人', dataIndex: 'ownerMembershipId', width: 120, render: (value: string) => memberMap.get(value) ?? value },
            { title: '到期日期', dataIndex: 'endDate', width: 115, render: (value?: string | null) => value ?? '无固定期限' },
            { title: '状态', dataIndex: 'status', width: 95, render: (value: LegalContractStatus) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag> },
            {
                title: '操作', width: 330, fixed: 'right', render: (_: unknown, contract: LegalContract) => <Space wrap>
                    <Button size="small" onClick={() => setDetail(contract)}>详情</Button>
                    {canUpdate && ['DRAFT', 'ACTIVE', 'PENDING_RENEWAL'].includes(contract.status) && <Button size="small" onClick={() => openForm(contract)}>编辑</Button>}
                    {canUpdate && contract.status === 'DRAFT' && <Button size="small" type="primary" onClick={() => action(() => activateLegalContract(contract.id, contract.version))}>激活</Button>}
                    {canUpdate && contract.status === 'ACTIVE' && contract.endDate && <Button size="small" onClick={() => action(() => markLegalContractPendingRenewal(contract.id, contract.version))}>待续签</Button>}
                    {canUpdate && ['PENDING_RENEWAL', 'EXPIRED'].includes(contract.status) && <Button size="small" onClick={() => renew(contract)}>续签</Button>}
                    {canUpdate && ['ACTIVE', 'PENDING_RENEWAL'].includes(contract.status) && <Button size="small" danger onClick={() => terminate(contract)}>终止</Button>}
                    {canUpdate && ['EXPIRED', 'TERMINATED'].includes(contract.status) && <Button size="small" onClick={() => action(() => archiveLegalContract(contract.id, contract.version))}>归档</Button>}
                    {canDelete && contract.status === 'DRAFT' && <Popconfirm title="确认删除该草稿合同？" onConfirm={() => action(() => deleteLegalContract(contract.id, contract.version))}><Button size="small" danger>删除</Button></Popconfirm>}
                </Space>
            },
        ]} scroll={{ x: 1450 }} />
            {(contractsQuery.hasNextPage || contracts.length > 0) && <Space className="legal-load-more">
                <Typography.Text type="secondary">已加载 {contracts.length} 条</Typography.Text>
                {contractsQuery.hasNextPage && <Button loading={contractsQuery.isFetchingNextPage} onClick={() => void contractsQuery.fetchNextPage()}>加载更多</Button>}
            </Space>}
        </Card>

        <Modal title={editing ? '编辑合同' : '新增合同'} open={formOpen} width={820} onCancel={() => setFormOpen(false)} onOk={() => void submit()} confirmLoading={mutation.isPending}>
            <Form form={form} layout="vertical"><Row gutter={16}>
                <Col span={12}><Form.Item name="contractNo" label="合同编号"><Input placeholder="留空由服务端自动生成" disabled={Boolean(editing && editing.status !== 'DRAFT')} /></Form.Item></Col>
                <Col span={12}><Form.Item name="name" label="合同名称" rules={[{ required: true }]}><Input disabled={Boolean(editing && editing.status !== 'DRAFT')} /></Form.Item></Col>
                <Col span={12}><Form.Item name="counterparty" label="交易对方" rules={[{ required: true }]}><Input disabled={Boolean(editing && editing.status !== 'DRAFT')} /></Form.Item></Col>
                <Col span={12}><Form.Item name="type" label="合同类型" rules={[{ required: true }]}><Select disabled={Boolean(editing && editing.status !== 'DRAFT')} options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))} /></Form.Item></Col>
                <Col span={8}><Form.Item name="amount" label="合同金额"><InputNumber min={0} precision={2} className="legal-full-width" disabled={Boolean(editing && editing.status !== 'DRAFT')} /></Form.Item></Col>
                <Col span={8}><Form.Item name="currency" label="币种"><Input maxLength={3} disabled={Boolean(editing && editing.status !== 'DRAFT')} /></Form.Item></Col>
                <Col span={8}><Form.Item name="renewalReminderDays" label="提前提醒天数"><InputNumber min={0} max={365} className="legal-full-width" /></Form.Item></Col>
                <Col span={8}><Form.Item name="startDate" label="生效日期" rules={[{ required: true }]}><Input type="date" disabled={Boolean(editing && editing.status !== 'DRAFT')} /></Form.Item></Col>
                <Col span={8}><Form.Item name="endDate" label="到期日期"><Input type="date" disabled={Boolean(editing && editing.status !== 'DRAFT')} /></Form.Item></Col>
                <Col span={8}><Form.Item name="signedAt" label="签署日期"><Input type="date" disabled={Boolean(editing && editing.status !== 'DRAFT')} /></Form.Item></Col>
                <Col span={8}><Form.Item name="ownerMembershipId" label="负责人" rules={[{ required: true }]}><Select showSearch options={members.filter((member) => member.status === 'ACTIVE').map((member) => ({ value: member.id, label: member.user.displayName }))} /></Form.Item></Col>
                <Col span={8}><Form.Item name="departmentId" label="归属部门"><Select allowClear showSearch options={departments.map((department) => ({ value: department.id, label: department.name }))} /></Form.Item></Col>
                <Col span={8}><Form.Item name="projectId" label="关联项目"><Select allowClear showSearch options={projects.map((project) => ({ value: project.id, label: project.name }))} /></Form.Item></Col>
                <Col span={24}><Form.Item name="description" label="合同说明"><Input.TextArea rows={3} /></Form.Item></Col>
            </Row></Form>
            <div className="legal-attachments"><label className="ant-btn"><UploadOutlined /> {uploading ? '上传中...' : '上传附件'}<input hidden type="file" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label><Typography.Text type="secondary">{attachmentNames.join('、') || '暂无附件'}</Typography.Text></div>
        </Modal>

        <Drawer title="合同详情" width={620} open={Boolean(detail)} onClose={() => setDetail(undefined)}>{detail && <>
            <Descriptions column={2} bordered size="small" items={[
                { key: 'no', label: '合同编号', children: detail.contractNo }, { key: 'status', label: '状态', children: <Tag color={statusColors[detail.status]}>{statusLabels[detail.status]}</Tag> },
                { key: 'name', label: '合同名称', children: detail.name, span: 2 }, { key: 'counterparty', label: '交易对方', children: detail.counterparty, span: 2 },
                { key: 'owner', label: '负责人', children: memberMap.get(detail.ownerMembershipId) ?? detail.ownerMembershipId }, { key: 'department', label: '部门', children: detail.departmentId ? departmentMap.get(detail.departmentId) : '-' },
                { key: 'project', label: '项目', children: detail.projectId ? projectMap.get(detail.projectId) : '-' }, { key: 'amount', label: '金额', children: detail.amount == null ? '-' : `${detail.currency} ${detail.amount.toLocaleString()}` },
                { key: 'dates', label: '有效期', children: `${detail.startDate} 至 ${detail.endDate ?? '无固定期限'}`, span: 2 },
                { key: 'description', label: '说明', children: detail.description || '-', span: 2 },
            ]} />
            <Typography.Title level={5}>附件</Typography.Title>{detail.attachments.length ? detail.attachments.map((attachment) => <Tag key={attachment.id}>{attachment.originalName}</Tag>) : <Typography.Text type="secondary">暂无附件</Typography.Text>}
            <Typography.Title level={5}>状态历史</Typography.Title><Timeline items={detail.statusHistory.map((history) => ({ children: `${statusLabels[history.toStatus]} · ${new Date(history.createdAt).toLocaleString()}${history.comment ? ` · ${history.comment}` : ''}` }))} />
        </>}</Drawer>
        <PageAssistant context={pageAssistantContext} suggestions={['查看即将到期合同', '找出高风险合同', '分析合同归属和负责人', '生成合同风险简报']} onExpand={(context, conversationId) => navigate('/', { state: { ...(conversationId ? { conversationId } : { createNewConversation: true }), forceChat: true, assistantContext: context } })} />
    </div>;
}

function flattenDepartments(items: DepartmentNode[], prefix = ''): Array<{ id: string; name: string }> {
    return items.flatMap((item) => [{ id: item.id, name: `${prefix}${item.name}` }, ...flattenDepartments(item.children, `${prefix}— `)]);
}
