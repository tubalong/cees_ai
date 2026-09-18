import {
    ApartmentOutlined,
    DeleteOutlined,
    EditOutlined,
    FileSearchOutlined,
    PartitionOutlined,
    PlusOutlined,
    ProjectOutlined,
    ReloadOutlined,
    TeamOutlined,
} from '@ant-design/icons';
import {
    Alert,
    App as AntdApp,
    Button,
    Empty,
    Form,
    Input,
    Modal,
    Select,
    Spin,
    Switch,
    Tag,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
    createAssignmentPolicy,
    deleteAssignmentPolicy,
    getAssignmentPolicy,
    hasStoredSession,
    listAssignmentPolicies,
    listDepartments,
    listProjects,
    listTenantMembers,
    resolveAssignmentPolicy,
    updateAssignmentPolicy,
    type AssignmentPolicy,
    type AssignmentPolicyDomain,
    type AssignmentPolicyFallbackMode,
    type AssignmentPolicyLevel,
    type AssignmentPolicyResolveResult,
    type MeResult,
} from '../../core/api';
import { useI18n } from '../../core/i18n';

import './assignment.css';
const domainOptions: Array<{ label: string; value: AssignmentPolicyDomain }> = [
    { label: '任务', value: 'TASK' },
    { label: '会议', value: 'MEETING' },
    { label: '工作报告', value: 'WORK_REPORT' },
    { label: '项目', value: 'PROJECT' },
    { label: '文档', value: 'DOCUMENT' },
];

const levelOptions: Array<{ label: string; value: AssignmentPolicyLevel }> = [
    { label: '租户默认', value: 'TENANT' },
    { label: '项目覆盖', value: 'PROJECT' },
];

const fallbackOptions: Array<{ label: string; value: AssignmentPolicyFallbackMode }> = [
    { label: '不兜底', value: 'NONE' },
    { label: '项目成员', value: 'PROJECT_MEMBERS' },
    { label: '租户成员', value: 'TENANT_MEMBERS' },
];

interface PolicyFormValues {
    domain: AssignmentPolicyDomain;
    level: AssignmentPolicyLevel;
    projectId?: string;
    name: string;
    description?: string | null;
    candidateMembershipIds: string[];
    candidateDepartmentIds: string[];
    candidateProjectIds: string[];
    skipOnLeave: boolean;
    fallbackMode: AssignmentPolicyFallbackMode;
    enabled: boolean;
}

export default function AssignmentPolicyManagement({ authContext, onSessionExpired }: { authContext: MeResult; onSessionExpired: () => void }): JSX.Element {
    const [domainFilter, setDomainFilter] = useState<AssignmentPolicyDomain | undefined>();
    const [selectedPolicyId, setSelectedPolicyId] = useState<string>();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [resolveOpen, setResolveOpen] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState<AssignmentPolicy>();
    const [resolveResult, setResolveResult] = useState<AssignmentPolicyResolveResult>();
    const [form] = Form.useForm<PolicyFormValues>();
    const [resolveForm] = Form.useForm<{
        domain: AssignmentPolicyDomain;
        projectId?: string;
        availabilityStartAt?: string;
        availabilityEndAt?: string;
    }>();
    const { message, modal } = AntdApp.useApp();
    const { t } = useI18n();
    const queryClient = useQueryClient();
    const permissions = new Set(authContext.permissions);

    const policiesQuery = useQuery({
        queryKey: ['assignment-policies', domainFilter],
        queryFn: () => listAssignmentPolicies(domainFilter),
        enabled: permissions.has('assignment.policy.read'),
    });
    const membersQuery = useQuery({
        queryKey: ['tenant-members'],
        queryFn: () => listTenantMembers(),
        enabled: permissions.has('assignment.policy.read'),
    });
    const departmentsQuery = useQuery({
        queryKey: ['departments'],
        queryFn: () => listDepartments(),
        enabled: permissions.has('assignment.policy.read'),
    });
    const projectsQuery = useQuery({
        queryKey: ['projects-options'],
        queryFn: () => listProjects({ includeArchived: false }),
        enabled: permissions.has('assignment.policy.read'),
    });
    const selectedPolicyIdFallback = selectedPolicyId ?? policiesQuery.data?.items[0]?.id;
    const selectedPolicyQuery = useQuery({
        queryKey: ['assignment-policy', selectedPolicyIdFallback],
        queryFn: () => getAssignmentPolicy(selectedPolicyIdFallback!),
        enabled: Boolean(selectedPolicyIdFallback) && permissions.has('assignment.policy.read'),
    });

    const policies = policiesQuery.data?.items ?? [];
    const selectedPolicy = selectedPolicyQuery.data ?? policies.find((policy) => policy.id === selectedPolicyIdFallback);
    const memberOptions = useMemo(() => (membersQuery.data?.items ?? []).map((member) => ({ label: `${member.user.displayName}（${member.account}）`, value: member.id })), [membersQuery.data]);
    const departmentOptions = useMemo(() => flattenDepartments(departmentsQuery.data?.items ?? []).map((department) => ({ label: department.name, value: department.id })), [departmentsQuery.data]);
    const projectOptions = useMemo(() => (projectsQuery.data?.items ?? []).map((project) => ({ label: `${project.name}（${project.code}）`, value: project.id })), [projectsQuery.data]);
    const memberMap = useMemo(() => new Map((membersQuery.data?.items ?? []).map((member) => [member.id, `${member.user.displayName}（${member.account}）`])), [membersQuery.data]);

    useEffect(() => {
        const failed = policiesQuery.error || selectedPolicyQuery.error || membersQuery.error || departmentsQuery.error || projectsQuery.error;
        if (failed && !hasStoredSession()) onSessionExpired();
    }, [onSessionExpired, departmentsQuery.error, membersQuery.error, policiesQuery.error, projectsQuery.error, selectedPolicyQuery.error]);

    const openCreate = (): void => {
        setEditingPolicy(undefined);
        form.resetFields();
        form.setFieldsValue({
            domain: 'TASK',
            level: 'TENANT',
            candidateMembershipIds: [],
            candidateDepartmentIds: [],
            candidateProjectIds: [],
            skipOnLeave: false,
            fallbackMode: 'NONE',
            enabled: true,
        });
        setDialogOpen(true);
    };

    const openEdit = (policy: AssignmentPolicy): void => {
        setEditingPolicy(policy);
        form.resetFields();
        form.setFieldsValue({
            domain: policy.domain,
            level: policy.level,
            projectId: policy.projectId ?? undefined,
            name: policy.name,
            description: policy.description ?? '',
            candidateMembershipIds: policy.candidatePool.membershipIds,
            candidateDepartmentIds: policy.candidatePool.departmentIds,
            candidateProjectIds: policy.candidatePool.projectIds,
            skipOnLeave: policy.skipOnLeave,
            fallbackMode: policy.fallbackMode,
            enabled: policy.enabled,
        });
        setDialogOpen(true);
    };

    const saveMutation = useMutation({
        mutationFn: async (values: PolicyFormValues) => {
            const input = {
                domain: values.domain,
                level: values.level,
                projectId: values.level === 'PROJECT' ? values.projectId : undefined,
                name: values.name,
                description: values.description || null,
                candidatePool: {
                    membershipIds: values.candidateMembershipIds ?? [],
                    departmentIds: values.candidateDepartmentIds ?? [],
                    projectIds: values.candidateProjectIds ?? [],
                },
                skipOnLeave: values.skipOnLeave,
                fallbackMode: values.fallbackMode,
                enabled: values.enabled,
            };
            if (editingPolicy) {
                return updateAssignmentPolicy(editingPolicy.id, { ...input, version: editingPolicy.version });
            }
            return createAssignmentPolicy(input);
        },
        onSuccess: (policy) => {
            setDialogOpen(false);
            setSelectedPolicyId(policy.id);
            void queryClient.invalidateQueries({ queryKey: ['assignment-policies'] });
            void queryClient.invalidateQueries({ queryKey: ['assignment-policy', policy.id] });
            message.success(t(editingPolicy ? '分配策略已更新' : '分配策略已创建'));
        },
        onError: (error) => message.error(errorMessage(error)),
    });

    const deleteMutation = useMutation({
        mutationFn: (policy: AssignmentPolicy) => deleteAssignmentPolicy(policy.id, policy.version),
        onSuccess: () => {
            setSelectedPolicyId(undefined);
            void queryClient.invalidateQueries({ queryKey: ['assignment-policies'] });
            message.success(t('分配策略已删除'));
        },
        onError: (error) => message.error(errorMessage(error)),
    });

    const resolveMutation = useMutation({
        mutationFn: resolveAssignmentPolicy,
        onSuccess: (result) => setResolveResult(result),
        onError: (error) => message.error(errorMessage(error)),
    });

    const canManage = permissions.has('assignment.policy.manage');
    const canRead = permissions.has('assignment.policy.read');

    if (!canRead) return <Empty description={t('缺少分配策略查看权限')} />;

    return <div className="assignment-page">
        <div className="assignment-list-panel">
            <div className="assignment-toolbar">
                <Select allowClear placeholder={t('全部领域')} value={domainFilter} onChange={setDomainFilter} options={domainOptions.map((option) => ({ ...option, label: t(option.label) }))} className="assignment-domain-filter" />
                <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={openCreate}>{t('新建策略')}</Button>
                <Button icon={<ReloadOutlined />} onClick={() => void queryClient.invalidateQueries({ queryKey: ['assignment-policies'] })} />
            </div>
            <div className="assignment-list">
                {policiesQuery.isLoading ? <Spin /> : policies.length === 0 ? <Empty description={t('暂无分配策略')} /> : policies.map((policy) => <button key={policy.id} className={`assignment-list-item ${selectedPolicy?.id === policy.id ? 'is-active' : ''}`} onClick={() => setSelectedPolicyId(policy.id)}>
                    <span><PartitionOutlined /><strong>{policy.name}</strong></span>
                    <span>{t(domainLabel(policy.domain))}<Tag>{t(levelLabel(policy.level))}</Tag></span>
                </button>)}
            </div>
        </div>
        <section className="assignment-detail-panel">
            {selectedPolicyQuery.isLoading ? <Spin /> : selectedPolicy ? <>
                <div className="assignment-detail-heading">
                    <div>
                        <i><PartitionOutlined /></i>
                        <span><h2>{selectedPolicy.name}</h2><p>{selectedPolicy.description || t('暂无策略说明')}</p></span>
                    </div>
                    <div>
                        <Button icon={<FileSearchOutlined />} disabled={!canRead} onClick={() => { setResolveResult(undefined); resolveForm.resetFields(); resolveForm.setFieldsValue({ domain: selectedPolicy.domain, projectId: selectedPolicy.projectId ?? undefined }); setResolveOpen(true); }}>{t('解析预览')}</Button>
                        <Button icon={<EditOutlined />} disabled={!canManage} onClick={() => openEdit(selectedPolicy)}>{t('编辑')}</Button>
                        <Button danger icon={<DeleteOutlined />} disabled={!canManage} onClick={() => modal.confirm({ title: `${t('删除策略')}“${selectedPolicy.name}”？`, content: t('删除后任务模块将不再命中该策略。'), okText: t('删除'), okButtonProps: { danger: true }, cancelText: t('取消'), onOk: () => deleteMutation.mutateAsync(selectedPolicy) })}>{t('删除')}</Button>
                    </div>
                </div>
                <div className="assignment-summary-grid">
                    <div><PartitionOutlined /><span>{t('领域')}<strong>{t(domainLabel(selectedPolicy.domain))}</strong></span></div>
                    <div><ProjectOutlined /><span>{t('层级')}<strong>{t(levelLabel(selectedPolicy.level))}</strong></span></div>
                    <div><TeamOutlined /><span>{t('候选成员')}<strong>{selectedPolicy.candidatePool.membershipIds.length}</strong></span></div>
                    <div><ApartmentOutlined /><span>{t('候选部门')}<strong>{selectedPolicy.candidatePool.departmentIds.length}</strong></span></div>
                    <div><ProjectOutlined /><span>{t('候选项目')}<strong>{selectedPolicy.candidatePool.projectIds.length}</strong></span></div>
                    <div><FileSearchOutlined /><span>{t('跳过请假')}<strong>{selectedPolicy.skipOnLeave ? t('开启') : t('关闭')}</strong></span></div>
                    <div><ReloadOutlined /><span>{t('兜底')}<strong>{t(fallbackLabel(selectedPolicy.fallbackMode))}</strong></span></div>
                    <div><PartitionOutlined /><span>{t('状态')}<Tag color={selectedPolicy.enabled ? 'green' : 'default'}>{selectedPolicy.enabled ? t('启用') : t('停用')}</Tag></span></div>
                </div>
                <h3 className="assignment-section-title">{t('候选池')}</h3>
                <CandidatePoolView policy={selectedPolicy} memberMap={memberMap} departmentOptions={departmentOptions} projectOptions={projectOptions} />
            </> : <Empty description={t('请选择分配策略')} />}
        </section>

        <Modal title={editingPolicy ? t('编辑分配策略') : t('新建分配策略')} open={dialogOpen} onCancel={() => setDialogOpen(false)} onOk={() => form.submit()} confirmLoading={saveMutation.isPending} okText={t('保存策略')} cancelText={t('取消')} width={820} forceRender destroyOnHidden>
            <Form<PolicyFormValues> form={form} layout="vertical" requiredMark={false} onFinish={(values) => saveMutation.mutate(values)}>
                <div className="assignment-form-grid">
                    <Form.Item name="domain" label={t('业务领域')} rules={[{ required: true, message: t('请选择领域') }]}><Select options={domainOptions.map((option) => ({ ...option, label: t(option.label) }))} /></Form.Item>
                    <Form.Item name="level" label={t('策略层级')} rules={[{ required: true, message: t('请选择层级') }]}><Select options={levelOptions.map((option) => ({ ...option, label: t(option.label) }))} /></Form.Item>
                </div>
                <Form.Item noStyle shouldUpdate={(prev, current) => prev.level !== current.level}>{({ getFieldValue }) => getFieldValue('level') === 'PROJECT' ? <Form.Item name="projectId" label={t('覆盖项目')} rules={[{ required: true, message: t('请选择项目') }]}><Select showSearch optionFilterProp="label" options={projectOptions} placeholder={t('选择项目')} /></Form.Item> : null}</Form.Item>
                <Form.Item name="name" label={t('策略名称')} rules={[{ required: true, message: t('请输入策略名称') }, { max: 120 }]}><Input placeholder={t('例如：默认任务分配策略')} /></Form.Item>
                <Form.Item name="description" label={t('策略说明')}><Input.TextArea rows={2} maxLength={2000} showCount /></Form.Item>
                <h3 className="assignment-form-section">{t('候选池')}</h3>
                <Form.Item name="candidateMembershipIds" label={t('指定成员')} initialValue={[]}><Select mode="multiple" allowClear showSearch optionFilterProp="label" options={memberOptions} placeholder={t('选择成员')} /></Form.Item>
                <Form.Item name="candidateDepartmentIds" label={t('按部门')} initialValue={[]}><Select mode="multiple" allowClear showSearch optionFilterProp="label" options={departmentOptions} placeholder={t('选择部门')} /></Form.Item>
                <Form.Item name="candidateProjectIds" label={t('按项目')} initialValue={[]}><Select mode="multiple" allowClear showSearch optionFilterProp="label" options={projectOptions} placeholder={t('选择项目')} /></Form.Item>
                <div className="assignment-form-grid">
                    <Form.Item name="fallbackMode" label={t('候选为空时兜底')} rules={[{ required: true, message: t('请选择兜底模式') }]}><Select options={fallbackOptions.map((option) => ({ ...option, label: t(option.label) }))} /></Form.Item>
                    <Form.Item name="skipOnLeave" label={t('跳过请假人员')} valuePropName="checked" initialValue={false}><Switch checkedChildren={t('开启')} unCheckedChildren={t('关闭')} /></Form.Item>
                    <Form.Item name="enabled" label={t('策略启用')} valuePropName="checked" initialValue={true}><Switch checkedChildren={t('启用')} unCheckedChildren={t('停用')} /></Form.Item>
                </div>
            </Form>
        </Modal>

        <Modal title={t('分配策略解析预览')} open={resolveOpen} onCancel={() => setResolveOpen(false)} footer={null} width={720}>
            <Form form={resolveForm} layout="vertical" onFinish={(values) => resolveMutation.mutate({
                domain: values.domain,
                projectId: values.projectId,
                availabilityWindow: values.availabilityStartAt && values.availabilityEndAt
                    ? { startAt: values.availabilityStartAt, endAt: values.availabilityEndAt }
                    : undefined,
            })}>
                <div className="assignment-form-grid">
                    <Form.Item name="domain" label={t('业务领域')} rules={[{ required: true, message: t('请选择领域') }]}><Select options={domainOptions.map((option) => ({ ...option, label: t(option.label) }))} /></Form.Item>
                    <Form.Item name="projectId" label={t('项目')}><Select allowClear showSearch optionFilterProp="label" options={projectOptions} placeholder={t('无项目时使用租户默认')} /></Form.Item>
                    <Form.Item
                        name="availabilityStartAt"
                        label={t('可用窗口开始时间')}
                        dependencies={['availabilityEndAt']}
                        rules={[({ getFieldValue }) => ({
                            validator: (_, value) => value || !getFieldValue('availabilityEndAt')
                                ? Promise.resolve()
                                : Promise.reject(new Error(t('请同时填写可用窗口开始和结束时间'))),
                        })]}
                    >
                        <Input placeholder="2026-09-21T09:00:00+08:00" />
                    </Form.Item>
                    <Form.Item
                        name="availabilityEndAt"
                        label={t('可用窗口结束时间')}
                        dependencies={['availabilityStartAt']}
                        rules={[({ getFieldValue }) => ({
                            validator: (_, value) => value || !getFieldValue('availabilityStartAt')
                                ? Promise.resolve()
                                : Promise.reject(new Error(t('请同时填写可用窗口开始和结束时间'))),
                        })]}
                    >
                        <Input placeholder="2026-09-21T18:00:00+08:00" />
                    </Form.Item>
                </div>
                <Alert type="info" showIcon message={t('开启跳过请假时，只有填写时间窗口才会过滤与窗口重叠的已批准请假')} />
                <Button type="primary" htmlType="submit" loading={resolveMutation.isPending} icon={<FileSearchOutlined />}>{t('开始解析')}</Button>
            </Form>
            {resolveResult && <div className="assignment-resolve-result">
                <Alert type={resolveResult.matchedPolicyId ? 'success' : 'info'} showIcon message={resolveResult.matchedPolicyId ? t('已命中策略') : t('未命中策略')} />
                <div className="assignment-summary-grid">
                    <div><PartitionOutlined /><span>{t('命中层级')}<strong>{t(levelLabel(resolveResult.level))}</strong></span></div>
                    <div><TeamOutlined /><span>{t('候选人数')}<strong>{resolveResult.candidates.length}</strong></span></div>
                    <div><FileSearchOutlined /><span>{t('跳过请假')}<strong>{resolveResult.skippedOnLeave.length}</strong></span></div>
                    <div><FileSearchOutlined /><span>{t('请假过滤')}<strong>{resolveResult.leaveFilterApplied ? t('已执行') : t('未执行')}</strong></span></div>
                    <div><ReloadOutlined /><span>{t('兜底模式')}<strong>{t(fallbackLabel(resolveResult.fallbackMode))}</strong></span></div>
                </div>
                <h4>{t('候选成员')}</h4>
                {resolveResult.candidates.length > 0 ? <div className="assignment-candidate-tags">{resolveResult.candidates.map((membershipId) => <Tag key={membershipId}>{memberMap.get(membershipId) ?? membershipId}</Tag>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无候选成员')} />}
                {resolveResult.skippedOnLeave.length > 0 && <>
                    <h4>{t('因请假跳过')}</h4>
                    <div className="assignment-candidate-tags">{resolveResult.skippedOnLeave.map((membershipId) => <Tag color="orange" key={membershipId}>{memberMap.get(membershipId) ?? membershipId}</Tag>)}</div>
                </>}
            </div>}
        </Modal>
    </div>;
}

function CandidatePoolView({ policy, memberMap, departmentOptions, projectOptions }: { policy: AssignmentPolicy; memberMap: Map<string, string>; departmentOptions: Array<{ label: string; value: string }>; projectOptions: Array<{ label: string; value: string }> }): JSX.Element {
    const { t } = useI18n();
    const departmentMap = new Map(departmentOptions.map((item) => [item.value, item.label]));
    const projectMap = new Map(projectOptions.map((item) => [item.value, item.label]));
    const showNames = (ids: string[], map: Map<string, string>): string[] => ids.map((id) => map.get(id) ?? id);
    return <div className="assignment-candidate-sections">
        <section><h4>{t('指定成员')}</h4>{policy.candidatePool.membershipIds.length > 0 ? showNames(policy.candidatePool.membershipIds, memberMap).map((name) => <Tag key={name}>{name}</Tag>) : <span className="assignment-empty-inline">-</span>}</section>
        <section><h4>{t('按部门')}</h4>{policy.candidatePool.departmentIds.length > 0 ? showNames(policy.candidatePool.departmentIds, departmentMap).map((name) => <Tag key={name}>{name}</Tag>) : <span className="assignment-empty-inline">-</span>}</section>
        <section><h4>{t('按项目')}</h4>{policy.candidatePool.projectIds.length > 0 ? showNames(policy.candidatePool.projectIds, projectMap).map((name) => <Tag key={name}>{name}</Tag>) : <span className="assignment-empty-inline">-</span>}</section>
    </div>;
}

function flattenDepartments(nodes: Array<{ id: string; name: string; children: Array<{ id: string; name: string; children: any[] }> }>): Array<{ id: string; name: string }> {
    return nodes.flatMap((node) => [{ id: node.id, name: node.name }, ...flattenDepartments(node.children ?? [])]);
}

function domainLabel(domain: AssignmentPolicyDomain): string {
    return domainOptions.find((option) => option.value === domain)?.label ?? domain;
}

function levelLabel(level: AssignmentPolicyLevel): string {
    return levelOptions.find((option) => option.value === level)?.label ?? level;
}

function fallbackLabel(fallbackMode: AssignmentPolicyFallbackMode): string {
    return fallbackOptions.find((option) => option.value === fallbackMode)?.label ?? fallbackMode;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '请求参数或状态不合法';
}
