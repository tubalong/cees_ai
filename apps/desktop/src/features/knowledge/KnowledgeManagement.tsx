import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Descriptions, Empty, Input, Modal, Popconfirm, Select, Spin, Table, Tag, TreeSelect } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
    addKnowledgeBaseMember, createKnowledgeBase, deleteKnowledgeBase, deleteKnowledgeDocument, hasStoredSession,
    listDepartments, listKnowledgeBaseMembers, listKnowledgeBases, listKnowledgeDocuments, listProjects,
    listTenantMembers, removeKnowledgeBaseMember, retryKnowledgeDocument, updateKnowledgeBase,
    updateKnowledgeBaseMember, uploadAttachmentFile, uploadKnowledgeDocument,
    type DepartmentNode, type KnowledgeBaseMemberPermission, type KnowledgeBaseMemberSummary,
    type KnowledgeBaseSummary, type KnowledgeBaseVisibilityScope, type KnowledgeDocumentResult, type MeResult,
} from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';
import KnowledgeDocumentUploader, { type KnowledgeDocumentUploadInput } from './KnowledgeDocumentUploader';
import '../../styles/shared.css';
import './knowledge.css';

const scopeLabels: Record<KnowledgeBaseVisibilityScope, string> = {
    PRIVATE: '私有（仅成员）',
    DEPARTMENT: '部门可见',
    PROJECT: '项目可见',
    TENANT: '全员可见',
};

const scopeColors: Record<KnowledgeBaseVisibilityScope, string> = {
    PRIVATE: 'default',
    DEPARTMENT: 'blue',
    PROJECT: 'green',
    TENANT: 'gold',
};

const permissionLabels: Record<KnowledgeBaseMemberPermission, string> = {
    READER: '只读',
    EDITOR: '可编辑',
    MANAGER: '管理员',
};

const permissionColors: Record<KnowledgeBaseMemberPermission, string> = {
    READER: 'default',
    EDITOR: 'blue',
    MANAGER: 'gold',
};

const documentStatusLabels: Record<KnowledgeDocumentResult['status'], string> = {
    PENDING: '等待处理',
    PARSING: '解析中',
    PARSED: '已解析',
    INDEXING: '索引中',
    READY: '已就绪',
    FAILED: '处理失败',
};

const documentStatusColors: Record<KnowledgeDocumentResult['status'], string> = {
    PENDING: 'default',
    PARSING: 'processing',
    PARSED: 'processing',
    INDEXING: 'processing',
    READY: 'success',
    FAILED: 'error',
};

/** 处理中的文档状态：存在则每 5 秒轮询列表，全部落定后停止。 */
const PROCESSING_DOCUMENT_STATUSES: Array<KnowledgeDocumentResult['status']> = ['PENDING', 'PARSING', 'PARSED', 'INDEXING'];

interface KnowledgeBaseFormValues {
    name: string;
    description: string;
    visibilityScope: KnowledgeBaseVisibilityScope;
    departmentId: string | null;
    projectId: string | null;
}

const emptyFormValues: KnowledgeBaseFormValues = {
    name: '',
    description: '',
    visibilityScope: 'PRIVATE',
    departmentId: null,
    projectId: null,
};

function buildDepartmentTree(departments: DepartmentNode[]): Array<{ title: string; value: string; children?: ReturnType<typeof buildDepartmentTree> }> {
    return departments
        .filter((department) => department.status === 'ACTIVE')
        .map((department) => ({ title: department.name, value: department.id, children: buildDepartmentTree(department.children) }));
}

function findDepartmentName(departments: DepartmentNode[], departmentId: string): string | null {
    for (const department of departments) {
        if (department.id === departmentId) return department.name;
        const found = findDepartmentName(department.children, departmentId);
        if (found) return found;
    }
    return null;
}

interface KnowledgeManagementProps {
    authContext: MeResult;
    onSessionExpired: () => void;
}

/**
 * 知识管理页面：左侧知识库列表 + 右侧库详情与成员管理。
 *
 * 页面入口由 knowledge_base.read 导航权限控制；新建依赖 knowledge_base.create；
 * 编辑、删除与成员管理仅对库内 MANAGER（或 knowledge_base.manage_all 超级管理员）开放。
 * 锚点人群（部门/项目/全员）与 read_all 用户恒为 READER，只读浏览。
 */
export default function KnowledgeManagement({ authContext, onSessionExpired }: KnowledgeManagementProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const permissions = useMemo(() => new Set(authContext.permissions), [authContext.permissions]);
    const canCreate = permissions.has('knowledge_base.create');
    const isManager = (kb: KnowledgeBaseSummary): boolean => kb.myPermission === 'MANAGER' || permissions.has('knowledge_base.manage_all');

    const [keyword, setKeyword] = useState('');
    const [selectedId, setSelectedId] = useState<string>();
    const [formOpen, setFormOpen] = useState<{ open: boolean; editing?: KnowledgeBaseSummary }>({ open: false });
    const [formValues, setFormValues] = useState<KnowledgeBaseFormValues>(emptyFormValues);
    const [submitting, setSubmitting] = useState(false);
    const [addMemberOpen, setAddMemberOpen] = useState(false);
    const [addMemberMembershipId, setAddMemberMembershipId] = useState<string>();
    const [addMemberPermission, setAddMemberPermission] = useState<KnowledgeBaseMemberPermission>('READER');
    const [addMemberSubmitting, setAddMemberSubmitting] = useState(false);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [uploading, setUploading] = useState(false);

    const basesQuery = useQuery({ queryKey: ['knowledge-bases', keyword], queryFn: () => listKnowledgeBases({ keyword }) });
    const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: () => listDepartments() });
    const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => listProjects({}) });
    const tenantMembersQuery = useQuery({ queryKey: ['tenant-members'], queryFn: () => listTenantMembers() });

    const bases = basesQuery.data?.items ?? [];
    const departments = departmentsQuery.data?.items ?? [];
    const projects = projectsQuery.data?.items ?? [];
    const selected = bases.find((kb) => kb.id === selectedId) ?? bases[0];
    const selectedManaged = selected ? isManager(selected) : false;
    // 文档写入门槛为库内 EDITOR 及以上（后端对上传/重试校验 EDITOR 等级）。
    const selectedEditable = selected ? selected.myPermission === 'EDITOR' || isManager(selected) : false;

    // 成员列表仅对 MANAGER 开放（后端对 listMembers 校验 MANAGER 等级）。
    const membersQuery = useQuery({
        queryKey: ['knowledge-base-members', selected?.id],
        queryFn: () => listKnowledgeBaseMembers(selected!.id),
        enabled: Boolean(selected?.id) && selectedManaged,
    });

    // 文档列表对所有可见成员开放；存在处理中的文档时每 5 秒轮询，全部落定后停止。
    const documentsQuery = useQuery({
        queryKey: ['knowledge-base-documents', selected?.id],
        queryFn: () => listKnowledgeDocuments(selected!.id),
        enabled: Boolean(selected?.id),
        refetchInterval: (query) => {
            const items = query.state.data?.items ?? [];
            return items.some((document) => PROCESSING_DOCUMENT_STATUSES.includes(document.status)) ? 5000 : false;
        },
    });

    useEffect(() => {
        if (basesQuery.error && !hasStoredSession()) onSessionExpired();
    }, [basesQuery.error, onSessionExpired]);

    const departmentTree = useMemo(() => buildDepartmentTree(departments), [departments]);
    const refreshBases = () => void queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
    const refreshMembers = () => void queryClient.invalidateQueries({ queryKey: ['knowledge-base-members'] });
    const refreshDocuments = () => void queryClient.invalidateQueries({ queryKey: ['knowledge-base-documents'] });

    const openCreate = (): void => {
        setFormValues(emptyFormValues);
        setFormOpen({ open: true });
    };

    const openEdit = (): void => {
        if (!selected) return;
        setFormValues({
            name: selected.name,
            description: selected.description ?? '',
            visibilityScope: selected.visibilityScope,
            departmentId: selected.departmentId ?? null,
            projectId: selected.projectId ?? null,
        });
        setFormOpen({ open: true, editing: selected });
    };

    const submitForm = async (): Promise<void> => {
        if (!formValues.name.trim()) {
            message.warning(t('请填写知识库名称'));
            return;
        }
        if (formValues.visibilityScope === 'DEPARTMENT' && !formValues.departmentId) {
            message.warning(t('请选择归属部门'));
            return;
        }
        if (formValues.visibilityScope === 'PROJECT' && !formValues.projectId) {
            message.warning(t('请选择归属项目'));
            return;
        }
        setSubmitting(true);
        try {
            const scope = {
                visibilityScope: formValues.visibilityScope,
                departmentId: formValues.visibilityScope === 'DEPARTMENT' ? formValues.departmentId : null,
                projectId: formValues.visibilityScope === 'PROJECT' ? formValues.projectId : null,
            };
            if (formOpen.editing) {
                const editing = formOpen.editing;
                const scopeChanged = editing.visibilityScope !== scope.visibilityScope
                    || (editing.departmentId ?? null) !== scope.departmentId
                    || (editing.projectId ?? null) !== scope.projectId;
                await updateKnowledgeBase(editing.id, {
                    name: formValues.name.trim(),
                    description: formValues.description,
                    version: editing.version,
                    ...(scopeChanged ? scope : {}),
                });
                message.success(t('知识库已更新'));
            } else {
                const created = await createKnowledgeBase({
                    name: formValues.name.trim(),
                    ...(formValues.description.trim() ? { description: formValues.description } : {}),
                    visibilityScope: scope.visibilityScope,
                    ...(scope.departmentId ? { departmentId: scope.departmentId } : {}),
                    ...(scope.projectId ? { projectId: scope.projectId } : {}),
                });
                message.success(t('知识库已创建'));
                setSelectedId(created.id);
            }
            setFormOpen({ open: false });
            refreshBases();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (): Promise<void> => {
        if (!selected) return;
        try {
            await deleteKnowledgeBase(selected.id, selected.version);
            message.success(t('知识库已删除'));
            setSelectedId(undefined);
            refreshBases();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const changeMemberPermission = async (member: KnowledgeBaseMemberSummary, permission: KnowledgeBaseMemberPermission): Promise<void> => {
        if (!selected || permission === member.permission) return;
        try {
            await updateKnowledgeBaseMember(selected.id, member.membershipId, permission);
            message.success(t('成员权限已更新'));
            refreshMembers();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleRemoveMember = async (member: KnowledgeBaseMemberSummary): Promise<void> => {
        if (!selected) return;
        try {
            await removeKnowledgeBaseMember(selected.id, member.membershipId);
            message.success(t('成员已移除'));
            refreshMembers();
            refreshBases();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const submitAddMember = async (): Promise<void> => {
        if (!selected) return;
        if (!addMemberMembershipId) {
            message.warning(t('请选择成员'));
            return;
        }
        setAddMemberSubmitting(true);
        try {
            await addKnowledgeBaseMember(selected.id, addMemberMembershipId, addMemberPermission);
            message.success(t('成员已添加'));
            setAddMemberOpen(false);
            refreshMembers();
            refreshBases();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        } finally {
            setAddMemberSubmitting(false);
        }
    };

    const submitUpload = async ({ file, name }: KnowledgeDocumentUploadInput): Promise<void> => {
        if (!selected) return;
        setUploading(true);
        try {
            // 文件先直传 COS 登记为文件对象，再关联创建文档进入解析索引队列；
            // 库内上传统一按 PRIVATE（仅知识库成员可见）提交，不做文档级范围选择。
            const fileObjectId = await uploadAttachmentFile(file);
            await uploadKnowledgeDocument(selected.id, { fileObjectId, name, visibilityScope: 'PRIVATE' });
            message.success(t('文档已提交解析，处理完成后即可检索'));
            setUploadOpen(false);
            refreshDocuments();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('上传失败'));
        } finally {
            setUploading(false);
        }
    };

    const handleRetryDocument = async (document: KnowledgeDocumentResult): Promise<void> => {
        if (!selected) return;
        try {
            await retryKnowledgeDocument(selected.id, document.id);
            message.success(t('文档已重新进入处理队列'));
            refreshDocuments();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleDeleteDocument = async (document: KnowledgeDocumentResult): Promise<void> => {
        if (!selected) return;
        try {
            await deleteKnowledgeDocument(selected.id, document.id);
            message.success(t('文档已删除'));
            refreshDocuments();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('删除失败'));
        }
    };

    const existingMemberIds = new Set((membersQuery.data?.items ?? []).map((member) => member.membershipId));
    const memberCandidates = (tenantMembersQuery.data?.items ?? [])
        .filter((member) => member.status === 'ACTIVE')
        .filter((member) => !existingMemberIds.has(member.id));

    const isCreator = (member: KnowledgeBaseMemberSummary): boolean => Boolean(selected?.createdBy && member.userId === selected.createdBy);

    const departmentName = selected?.visibilityScope === 'DEPARTMENT' && selected.departmentId
        ? findDepartmentName(departments, selected.departmentId)
        : null;
    const projectName = selected?.visibilityScope === 'PROJECT' && selected.projectId
        ? projects.find((project) => project.id === selected.projectId)?.name ?? null
        : null;

    const memberColumns = [
        {
            title: t('成员'),
            key: 'member',
            render: (member: KnowledgeBaseMemberSummary) => <span className="kb-member-cell">
                <strong>{member.displayName}</strong>
                <small>{member.account}</small>
            </span>,
        },
        {
            title: t('权限'),
            key: 'permission',
            width: 150,
            render: (member: KnowledgeBaseMemberSummary) => isCreator(member)
                ? <Tag color="gold">{t('管理员 · 创建者')}</Tag>
                : selectedManaged
                    ? <Select<KnowledgeBaseMemberPermission>
                        size="small"
                        value={member.permission}
                        style={{ width: 110 }}
                        options={Object.entries(permissionLabels).map(([value, label]) => ({ value: value as KnowledgeBaseMemberPermission, label: t(label) }))}
                        onChange={(value) => void changeMemberPermission(member, value)}
                    />
                    : <Tag color={permissionColors[member.permission]}>{t(permissionLabels[member.permission])}</Tag>,
        },
        {
            title: t('操作'),
            key: 'actions',
            width: 90,
            render: (member: KnowledgeBaseMemberSummary) => selectedManaged && !isCreator(member)
                ? <Popconfirm title={t('移除成员')} description={t('确认将该成员移出知识库吗？')} onConfirm={() => void handleRemoveMember(member)}>
                    <Button size="small" type="text" danger>{t('移除')}</Button>
                </Popconfirm>
                : <span className="kb-muted">—</span>,
        },
    ];

    const documentColumns = [
        {
            title: t('文档名称'),
            key: 'name',
            render: (document: KnowledgeDocumentResult) => <span className="kb-member-cell">
                <strong>{document.name}</strong>
                {document.status === 'FAILED' && document.lastError
                    ? <small className="kb-doc-error">{document.lastError}</small>
                    : null}
            </span>,
        },
        {
            title: t('状态'),
            key: 'status',
            width: 110,
            render: (document: KnowledgeDocumentResult) => <Tag color={documentStatusColors[document.status]}>{t(documentStatusLabels[document.status])}</Tag>,
        },
        {
            title: t('版本'),
            key: 'versionNumber',
            width: 70,
            render: (document: KnowledgeDocumentResult) => `v${document.versionNumber}`,
        },
        {
            title: t('可见范围'),
            key: 'visibilityScope',
            width: 100,
            render: (document: KnowledgeDocumentResult) => <Tag>{document.visibilityScope === 'PRIVATE' ? t('仅成员') : t('全员')}</Tag>,
        },
        {
            title: t('创建时间'),
            key: 'createdAt',
            width: 150,
            render: (document: KnowledgeDocumentResult) => formatDate(document.createdAt),
        },
        {
            title: t('操作'),
            key: 'actions',
            width: 140,
            render: (document: KnowledgeDocumentResult) => selectedEditable
                ? <span className="kb-row-actions">
                    {document.status === 'FAILED' && <Button size="small" onClick={() => void handleRetryDocument(document)}>{t('重试')}</Button>}
                    <Popconfirm title={t('删除文档')} description={t('删除后文档将无法被检索引用，确认删除吗？')} onConfirm={() => void handleDeleteDocument(document)}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />}>{t('删除')}</Button>
                    </Popconfirm>
                </span>
                : <span className="kb-muted">—</span>,
        },
    ];

    return <div className="workspace-page knowledge-management-page">
        <header className="workspace-page-header">
            <div><h1>{t('知识管理')}</h1><p>{t('沉淀、组织并安全共享企业知识')}</p></div>
            {canCreate && <div className="header-actions"><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('新建知识库')}</Button></div>}
        </header>
        <div className="kb-layout">
            <aside className="surface-panel kb-list-panel">
                <div className="kb-toolbar">
                    <Input allowClear prefix={<SearchOutlined />} placeholder={t('搜索知识库')} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                </div>
                {basesQuery.isLoading ? <div className="data-loading"><Spin /></div> : bases.length ? <div className="kb-list">
                    {bases.map((kb) => <button className={`kb-list-item ${selected?.id === kb.id ? 'is-selected' : ''}`} type="button" key={kb.id} onClick={() => setSelectedId(kb.id)}>
                        <span className="kb-list-item-head"><strong>{kb.name}</strong><Tag color={permissionColors[kb.myPermission]}>{t(permissionLabels[kb.myPermission])}</Tag></span>
                        <small>{t(scopeLabels[kb.visibilityScope])} · {t('成员')} {kb.memberCount}</small>
                    </button>)}
                </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无可见知识库')} />}
            </aside>
            <section className="kb-main">
                {selected ? <>
                    <section className="surface-panel kb-detail-panel">
                        <div className="panel-heading">
                            <h3>{selected.name}</h3>
                            <span className="kb-detail-actions">
                                {selectedManaged && <Button size="small" icon={<EditOutlined />} onClick={openEdit}>{t('编辑')}</Button>}
                                {selectedManaged && <Popconfirm title={t('删除知识库')} description={t('删除后库内文档将无法检索，确认删除吗？')} onConfirm={() => void handleDelete()}>
                                    <Button size="small" danger icon={<DeleteOutlined />}>{t('删除')}</Button>
                                </Popconfirm>}
                            </span>
                        </div>
                        <p className="kb-description">{selected.description || t('暂无描述')}</p>
                        <Descriptions column={2} size="small">
                            <Descriptions.Item label={t('归属范围')}>
                                <Tag color={scopeColors[selected.visibilityScope]}>{t(scopeLabels[selected.visibilityScope])}</Tag>
                                {departmentName && <small className="kb-anchor-text">{t('部门：{name}', { name: departmentName })}</small>}
                                {projectName && <small className="kb-anchor-text">{t('项目：{name}', { name: projectName })}</small>}
                            </Descriptions.Item>
                            <Descriptions.Item label={t('我的权限')}><Tag color={permissionColors[selected.myPermission]}>{t(permissionLabels[selected.myPermission])}</Tag></Descriptions.Item>
                            <Descriptions.Item label={t('成员数')}>{selected.memberCount}</Descriptions.Item>
                            <Descriptions.Item label={t('版本')}>v{selected.version}</Descriptions.Item>
                            <Descriptions.Item label={t('创建时间')}>{formatDate(selected.createdAt)}</Descriptions.Item>
                            <Descriptions.Item label={t('更新时间')}>{formatDate(selected.updatedAt)}</Descriptions.Item>
                        </Descriptions>
                    </section>
                    <section className="surface-panel kb-documents-panel">
                        <div className="panel-heading">
                            <h3>{t('文档管理')}</h3>
                            {selectedEditable && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>{t('上传文档')}</Button>}
                        </div>
                        <Table<KnowledgeDocumentResult>
                            rowKey="id"
                            columns={documentColumns}
                            dataSource={documentsQuery.data?.items ?? []}
                            loading={documentsQuery.isLoading}
                            pagination={false}
                            size="small"
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无文档，点击「上传文档」添加 PDF、Word、Excel 等内容')} /> }}
                        />
                    </section>
                    <section className="surface-panel kb-members-panel">
                        <div className="panel-heading">
                            <h3>{t('成员管理')}</h3>
                            {selectedManaged && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { setAddMemberMembershipId(undefined); setAddMemberPermission('READER'); setAddMemberOpen(true); }}>{t('添加成员')}</Button>}
                        </div>
                        {selectedManaged
                            ? <Table<KnowledgeBaseMemberSummary>
                                rowKey="membershipId"
                                columns={memberColumns}
                                dataSource={membersQuery.data?.items ?? []}
                                loading={membersQuery.isLoading}
                                pagination={false}
                                size="small"
                                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无成员')} /> }}
                            />
                            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('仅管理员可管理成员')} />}
                    </section>
                </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('请选择知识库')} />}
            </section>
        </div>

        <Modal
            open={formOpen.open}
            title={formOpen.editing ? t('编辑知识库') : t('新建知识库')}
            okText={t('保存')}
            cancelText={t('取消')}
            confirmLoading={submitting}
            onOk={() => void submitForm()}
            onCancel={() => setFormOpen({ open: false })}
        >
            <div className="form-grid">
                <label><span>{t('知识库名称')}</span><Input value={formValues.name} maxLength={200} onChange={(event) => setFormValues({ ...formValues, name: event.target.value })} placeholder={t('请输入知识库名称')} /></label>
                <label><span>{t('描述')}</span><Input.TextArea rows={3} value={formValues.description} maxLength={2000} onChange={(event) => setFormValues({ ...formValues, description: event.target.value })} placeholder={t('简要说明知识库用途')} /></label>
                <label><span>{t('归属范围')}</span><Select<KnowledgeBaseVisibilityScope>
                    value={formValues.visibilityScope}
                    options={Object.entries(scopeLabels).map(([value, label]) => ({ value: value as KnowledgeBaseVisibilityScope, label: t(label) }))}
                    onChange={(value) => setFormValues({ ...formValues, visibilityScope: value, departmentId: null, projectId: null })}
                /></label>
                {formValues.visibilityScope === 'DEPARTMENT' && <label><span>{t('归属部门')}</span><TreeSelect
                    showSearch
                    treeNodeFilterProp="title"
                    placeholder={t('选择部门，部门树内成员可见')}
                    treeDefaultExpandAll
                    loading={departmentsQuery.isLoading}
                    treeData={departmentTree}
                    value={formValues.departmentId ?? undefined}
                    onChange={(value) => setFormValues({ ...formValues, departmentId: value ?? null })}
                /></label>}
                {formValues.visibilityScope === 'PROJECT' && <label><span>{t('归属项目')}</span><Select
                    showSearch
                    optionFilterProp="label"
                    placeholder={t('选择项目，项目成员可见')}
                    loading={projectsQuery.isLoading}
                    value={formValues.projectId ?? undefined}
                    onChange={(value) => setFormValues({ ...formValues, projectId: value ?? null })}
                    options={projects.map((project) => ({ value: project.id, label: `${project.name}${project.code ? `（${project.code}）` : ''}` }))}
                /></label>}
            </div>
        </Modal>

        <Modal
            open={addMemberOpen}
            title={t('添加成员')}
            okText={t('添加')}
            cancelText={t('取消')}
            confirmLoading={addMemberSubmitting}
            onOk={() => void submitAddMember()}
            onCancel={() => setAddMemberOpen(false)}
        >
            <div className="form-grid">
                <label><span>{t('选择成员')}</span><Select
                    showSearch
                    optionFilterProp="label"
                    placeholder={t('从租户成员中选择')}
                    value={addMemberMembershipId}
                    onChange={setAddMemberMembershipId}
                    options={memberCandidates.map((member) => ({ value: member.id, label: `${member.user.displayName}（${member.account}）` }))}
                /></label>
                <label><span>{t('成员权限')}</span><Select<KnowledgeBaseMemberPermission>
                    value={addMemberPermission}
                    onChange={setAddMemberPermission}
                    options={Object.entries(permissionLabels).map(([value, label]) => ({ value: value as KnowledgeBaseMemberPermission, label: t(label) }))}
                /></label>
            </div>
        </Modal>

        <KnowledgeDocumentUploader
            open={uploadOpen}
            submitting={uploading}
            onCancel={() => setUploadOpen(false)}
            onSubmit={(input) => void submitUpload(input)}
        />
    </div>;
}
