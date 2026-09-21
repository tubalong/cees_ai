import { AppstoreOutlined, PlusOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { App as AntdApp, Avatar, Button, Empty, Input, Select, Spin, Switch, Tooltip } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    createProject, hasStoredSession, listDepartments, listProjects, listTenantMembers, updateProject,
    type MeResult, type ProjectStatus, type ProjectSummary,
} from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';
import ProjectFormModal, { type ProjectFormValues } from './ProjectFormModal';
import { projectStatusLabels } from './project-constants';
import '../../styles/shared.css';
import './project.css';

interface ProjectManagementProps {
    authContext: MeResult;
    onSessionExpired: () => void;
}

type ProjectViewMode = 'grid' | 'list';

const projectStageProgress: Record<ProjectStatus, number> = {
    PLANNING: 0,
    ACTIVE: 50,
    PAUSED: 50,
    COMPLETED: 100,
    CANCELLED: 0,
    ARCHIVED: 100,
};

function projectOwnerInitial(project: ProjectSummary): string {
    const displayName = project.owner?.displayName?.trim() || project.owner?.account?.trim() || '?';
    return displayName.slice(0, 1).toUpperCase();
}

/** 项目卡片总览；点击卡片进入独立项目详情页。 */
export default function ProjectManagement({ authContext, onSessionExpired }: ProjectManagementProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const permissions = useMemo(() => new Set(authContext.permissions), [authContext.permissions]);

    const [keyword, setKeyword] = useState('');
    const [statusFilter, setStatusFilter] = useState<ProjectStatus | ''>('');
    const [departmentFilter, setDepartmentFilter] = useState<string | undefined>(undefined);
    const [includeArchived, setIncludeArchived] = useState(false);
    const [viewMode, setViewMode] = useState<ProjectViewMode>('grid');
    const [projectModal, setProjectModal] = useState<{ open: boolean; editing?: ProjectSummary }>({ open: false });
    const [projectSubmitting, setProjectSubmitting] = useState(false);

    const projectsQuery = useQuery({
        queryKey: ['projects', keyword, statusFilter, departmentFilter, includeArchived],
        queryFn: () => listProjects({
            keyword,
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(departmentFilter ? { departmentId: departmentFilter } : {}),
            includeArchived,
        }),
    });
    const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: () => listDepartments() });
    const membersQuery = useQuery({ queryKey: ['tenant-members'], queryFn: () => listTenantMembers() });
    const projects = projectsQuery.data?.items ?? [];
    const departments = departmentsQuery.data?.items ?? [];
    const activeMembers = (membersQuery.data?.items ?? []).filter((member) => member.status === 'ACTIVE');

    useEffect(() => {
        if (projectsQuery.error && !hasStoredSession()) onSessionExpired();
    }, [projectsQuery.error, onSessionExpired]);

    const refreshProjects = (): void => {
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
    };

    const submitProject = async (values: ProjectFormValues): Promise<void> => {
        setProjectSubmitting(true);
        try {
            if (projectModal.editing) {
                await updateProject(projectModal.editing.id, {
                    name: values.name,
                    description: values.description?.trim() ? values.description : null,
                    departmentId: values.departmentId ?? null,
                    version: projectModal.editing.version,
                });
                message.success(t('项目已更新'));
                setProjectModal({ open: false });
                refreshProjects();
                return;
            }
            const created = await createProject({
                name: values.name,
                ...(values.description?.trim() ? { description: values.description } : {}),
                ...(values.departmentId ? { departmentId: values.departmentId } : {}),
                ...(values.ownerMembershipId ? { ownerMembershipId: values.ownerMembershipId } : {}),
                ...(values.memberMembershipIds?.length ? { memberMembershipIds: values.memberMembershipIds } : {}),
            });
            message.success(t('项目已创建，编号 {code}', { code: created.code }));
            setProjectModal({ open: false });
            refreshProjects();
            navigate(`/projects/${encodeURIComponent(created.id)}`);
        } catch (error) {
            if (!hasStoredSession()) onSessionExpired();
            message.error(error instanceof Error ? error.message : t('操作失败'));
        } finally {
            setProjectSubmitting(false);
        }
    };

    return <div className="workspace-page project-management-page">
        <header className="workspace-page-header project-page-header">
            <div><h1>{t('项目管理')}</h1><p>{t('全生命周期：规划、执行、监控、交付、归档与对标')}</p></div>
            <div className="project-header-actions">
                <div className="project-view-switcher" role="group" aria-label={t('项目视图')}>
                    <Tooltip title={t('网格视图')}>
                        <button className={viewMode === 'grid' ? 'is-active' : ''} type="button" aria-label={t('网格视图')} onClick={() => setViewMode('grid')}><AppstoreOutlined /></button>
                    </Tooltip>
                    <Tooltip title={t('列表视图')}>
                        <button className={viewMode === 'list' ? 'is-active' : ''} type="button" aria-label={t('列表视图')} onClick={() => setViewMode('list')}><UnorderedListOutlined /></button>
                    </Tooltip>
                </div>
                {permissions.has('project.create') && <Button className="project-create-button" type="primary" icon={<PlusOutlined />} onClick={() => setProjectModal({ open: true })}>{t('新建项目')}</Button>}
            </div>
        </header>

        <section className="surface-panel project-filter-panel">
            <div className="project-filter-controls">
                <Input className="project-search-input" allowClear prefix={<SearchOutlined />} placeholder={t('搜索项目名称、编号...')} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <Select<ProjectStatus | ''>
                    allowClear
                    className="project-filter-select"
                    placeholder={t('项目状态: 全部')}
                    value={statusFilter || undefined}
                    onChange={(value) => setStatusFilter(value ?? '')}
                    options={Object.entries(projectStatusLabels).map(([value, label]) => ({ value: value as ProjectStatus, label: t(label) }))}
                />
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    className="project-filter-select"
                    placeholder={t('所属部门: 全部')}
                    value={departmentFilter}
                    onChange={setDepartmentFilter}
                    loading={departmentsQuery.isLoading}
                    options={departments.map((department) => ({ value: department.id, label: department.name }))}
                />
            </div>
            <label className="project-archive-switch">
                <Switch size="small" checked={includeArchived} onChange={setIncludeArchived} />
                <span>{t('包含已归档项目')}</span>
            </label>
        </section>

        {projectsQuery.isLoading
            ? <div className="project-loading"><Spin /></div>
            : projects.length
                ? <section className={`project-cards project-cards-${viewMode}`} aria-label={t('项目列表')}>
                    {projects.map((project) => {
                        const progress = projectStageProgress[project.status];
                        const ownerName = project.owner?.displayName || project.owner?.account || t('未分配');
                        const additionalMembers = Math.max((project.memberCount ?? 0) - 1, 0);
                        return <button className={`project-card project-status-${project.status.toLowerCase()}`} type="button" key={project.id} onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}>
                            <span className="project-card-header">
                                <span className="project-card-title-block">
                                    <strong>{project.name}</strong>
                                    <small>{project.code}</small>
                                </span>
                                <span className="project-status-badge">{t(projectStatusLabels[project.status])}</span>
                            </span>
                            <span className="project-card-description">{project.description?.trim() || t('暂无项目说明')}</span>
                            <span className="project-card-divider" />
                            <span className="project-card-progress">
                                <span className="project-card-progress-label"><small>{t('阶段进度')}</small><strong>{progress}%</strong></span>
                                <span className="project-progress-track"><span style={{ width: `${progress}%` }} /></span>
                            </span>
                            <span className="project-card-divider" />
                            <span className="project-card-footer">
                                <span className="project-card-members" title={ownerName}>
                                    <Avatar size={24}>{projectOwnerInitial(project)}</Avatar>
                                    {additionalMembers > 0 && <span className="project-member-count">+{additionalMembers}</span>}
                                    <small>{t('任务')} {project.taskCount ?? 0}</small>
                                </span>
                                <span className="project-card-updated">{project.updatedAt ? t('更新: {date}', { date: formatDate(project.updatedAt, { withTime: true }) }) : '-'}</span>
                            </span>
                        </button>;
                    })}
                </section>
                : <div className="surface-panel project-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无可见项目')} /></div>}

        <ProjectFormModal
            open={projectModal.open}
            editing={projectModal.editing}
            permissions={permissions}
            currentMembershipId={authContext.membership.id}
            activeMembers={activeMembers}
            departments={departments}
            submitting={projectSubmitting}
            onSubmit={(values) => void submitProject(values)}
            onCancel={() => setProjectModal({ open: false })}
        />
    </div>;
}
