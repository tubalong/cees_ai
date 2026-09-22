import { AppstoreOutlined, CheckCircleOutlined, EditOutlined, EllipsisOutlined, FileTextOutlined, FlagOutlined, FolderOpenOutlined, GithubOutlined, LeftOutlined, ProjectOutlined, RobotOutlined, SettingOutlined, TeamOutlined, UnorderedListOutlined, WalletOutlined, WarningOutlined } from '@ant-design/icons';
import { App as AntdApp, Avatar, Button, Dropdown, Empty, Input, Modal, Select, Spin, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    createTask, deleteProject, getProject, hasStoredSession, listDepartments, listProjectActivities, listProjectMembers, listProjectRepositories, listTasks,
    listTenantMembers, transitionProject, updateProject,
    type CreateTaskInput, type MeResult, type ProjectStatus, type ProjectSummary, type ProjectTransitionAction,
    type ProjectActivity, type TaskPriority, type TaskStatus, type TaskSummary,
} from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';
import ProjectFormModal, { type ProjectFormValues } from './ProjectFormModal';
import ProjectMembersPanel from './ProjectMembersPanel';
import ProjectTasksPanel from './ProjectTasksPanel';
import TaskDetailDrawer from './TaskDetailDrawer';
import TransitionPromptModal from './TransitionPromptModal';
import { ProjectDailyReportPanel, ProjectDecisionPanel, ProjectExpensePanel, ProjectFilesPanel, ProjectKanbanPanel, ProjectMilestonePanel, ProjectRepositoryPanel, ProjectRepositorySettingsPanel, ProjectWorkbenchPanel } from './ProjectWorkflowPanels';
import { isReadOnlyProject, projectStatusLabels, projectTransitions, taskPriorityLabels } from './project-constants';
import '../../styles/shared.css';
import './project.css';
import './project-detail.css';

interface ProjectDetailPageProps {
    projectId: string;
    authContext: MeResult;
    onSessionExpired: () => void;
}

interface TaskFormValues {
    title: string;
    description: string;
    parentId: string | null;
    priority: TaskPriority;
    dueDate: string;
    ownerMembershipId: string;
    collaboratorMembershipIds: string[];
}

type ProjectDetailTab = 'overview' | 'workbench' | 'decisions' | 'kanban' | 'daily' | 'milestones' | 'members' | 'files' | 'expenses' | 'repository' | 'settings';

const emptyTaskForm: TaskFormValues = {
    title: '', description: '', parentId: null, priority: 'MEDIUM', dueDate: '', ownerMembershipId: '', collaboratorMembershipIds: [],
};

const projectWorkspaceCopy: Record<ProjectDetailTab, { phase: string; detail: string }> = {
    overview: { phase: '项目全景', detail: '集中查看进度、风险、任务与最新动态' },
    workbench: { phase: 'AI 共创', detail: '基于项目文件与知识库讨论，正式产出需人工确认' },
    decisions: { phase: '决策沉淀', detail: '把讨论收敛为正式决策，并继续拆解为任务' },
    kanban: { phase: '任务推进', detail: '按状态跟踪任务，完成后自动反馈到日报' },
    daily: { phase: '工作日报', detail: '任务完成自动带入，成员可继续补完并提交' },
    milestones: { phase: '阶段验收', detail: '人工维护目标、关联任务与验收标准' },
    members: { phase: '团队协作', detail: '查看项目角色、成员与职责边界' },
    files: { phase: '项目文件', detail: '项目知识库、文件上传与索引状态' },
    expenses: { phase: '项目支出', detail: '报销、发票与财务审批进度统一查看' },
    repository: { phase: '代码仓库', detail: '查看已登记仓库与默认分支信息' },
    settings: { phase: '项目设置', detail: '维护项目资料与代码仓库绑定' },
};

const projectStageProgress: Record<ProjectStatus, number> = {
    PLANNING: 0,
    ACTIVE: 50,
    PAUSED: 50,
    COMPLETED: 100,
    CANCELLED: 0,
    ARCHIVED: 100,
};


function formatShortDate(value: string | undefined, formatDate: (date: string) => string): string {
    return value ? formatDate(value) : '-';
}

export default function ProjectDetailPage({ projectId, authContext, onSessionExpired }: ProjectDetailPageProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const permissions = useMemo(() => new Set(authContext.permissions), [authContext.permissions]);
    const [tab, setTab] = useState<ProjectDetailTab>('overview');
    const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus | ''>('');
    const [rootOnly, setRootOnly] = useState(true);
    const [taskDetail, setTaskDetail] = useState<TaskSummary | null>(null);
    const [taskCreateOpen, setTaskCreateOpen] = useState(false);
    const [taskForm, setTaskForm] = useState<TaskFormValues>(emptyTaskForm);
    const [projectModal, setProjectModal] = useState<{ open: boolean; editing?: ProjectSummary }>({ open: false });
    const [projectSubmitting, setProjectSubmitting] = useState(false);
    const [transitionPrompt, setTransitionPrompt] = useState<{ action: string; label: string; requires: 'reason' | 'summary' } | null>(null);
    const [transitionText, setTransitionText] = useState('');

    const projectQuery = useQuery({
        queryKey: ['project-detail', projectId],
        queryFn: () => getProject(projectId),
    });
    const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: () => listDepartments() });
    const membersQuery = useQuery({ queryKey: ['tenant-members'], queryFn: () => listTenantMembers() });
    const projectMembersQuery = useQuery({
        queryKey: ['project-members', projectId],
        queryFn: () => listProjectMembers(projectId),
    });
    const tasksQuery = useQuery({
        queryKey: ['project-tasks', projectId, taskStatusFilter, rootOnly],
        queryFn: () => listTasks(projectId, { ...(taskStatusFilter ? { status: taskStatusFilter } : {}), rootOnly }),
    });
    const allTasksQuery = useQuery({
        queryKey: ['project-tasks-all', projectId],
        queryFn: () => listTasks(projectId),
    });
    const repositoriesQuery = useQuery({
        queryKey: ['project-repositories', projectId],
        queryFn: () => listProjectRepositories(projectId),
    });
    const activitiesQuery = useQuery({
        queryKey: ['project-activities', projectId],
        queryFn: () => listProjectActivities(projectId, 20),
    });

    const project = projectQuery.data;
    const departments = departmentsQuery.data?.items ?? [];
    const activeMembers = (membersQuery.data?.items ?? []).filter((member) => member.status === 'ACTIVE');
    const projectMembers = projectMembersQuery.data?.items ?? [];
    const tasks = tasksQuery.data?.items ?? [];
    const allTasks = allTasksQuery.data?.items ?? [];
    const repositories = repositoriesQuery.data ?? [];
    const activities = activitiesQuery.data ?? [];
    const hasRepository = repositories.length > 0;
    const readOnly = project ? isReadOnlyProject(project.status) : false;
    const canManage = permissions.has('project.update') && (permissions.has('project.manage_all') || project?.currentMemberRole === 'OWNER' || project?.currentMemberRole === 'MANAGER');
    const completedTaskCount = allTasks.filter((task) => task.status === 'DONE').length;
    const inProgressTaskCount = allTasks.filter((task) => task.status === 'IN_PROGRESS').length;
    const progress = allTasks.length > 0 ? Math.round((completedTaskCount / allTasks.length) * 100) : project ? projectStageProgress[project.status] : 0;
    const upcomingTask = useMemo(() => allTasks
        .filter((task) => task.dueDate && new Date(task.dueDate).getTime() >= Date.now() && task.status !== 'DONE' && task.status !== 'CANCELLED')
        .sort((left, right) => new Date(left.dueDate ?? '').getTime() - new Date(right.dueDate ?? '').getTime())[0], [allTasks]);
    const riskTask = useMemo(() => allTasks.find((task) => task.status === 'BLOCKED')
        ?? allTasks.find((task) => task.dueDate && new Date(task.dueDate).getTime() < Date.now() && task.status !== 'DONE' && task.status !== 'CANCELLED'), [allTasks]);

    const refreshProject = (): void => {
        void queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
    };
    const refreshMembers = (): void => {
        void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
        refreshProject();
    };
    const refreshTasks = (): void => {
        void queryClient.invalidateQueries({ queryKey: ['project-tasks', projectId] });
        void queryClient.invalidateQueries({ queryKey: ['project-tasks-all', projectId] });
        refreshProject();
    };

    const refreshProjectWorkflow = (): void => {
        refreshTasks();
        void queryClient.invalidateQueries({ queryKey: ['project-activities', projectId] });
        void queryClient.invalidateQueries({ queryKey: ['project-decisions', projectId] });
        void queryClient.invalidateQueries({ queryKey: ['project-milestones', projectId] });
        void queryClient.invalidateQueries({ queryKey: ['project-repositories', projectId] });
        void queryClient.invalidateQueries({ queryKey: ['project-daily-reports', projectId] });
    };

    const openEditProject = (): void => {
        if (project) setProjectModal({ open: true, editing: project });
    };

    const submitProject = async (values: ProjectFormValues): Promise<void> => {
        if (!project) return;
        setProjectSubmitting(true);
        try {
            await updateProject(project.id, {
                name: values.name,
                description: values.description?.trim() ? values.description : null,
                departmentId: values.departmentId ?? null,
                version: project.version,
            });
            message.success(t('项目已更新'));
            setProjectModal({ open: false });
            refreshProject();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        } finally {
            setProjectSubmitting(false);
        }
    };

    const handleDeleteProject = async (): Promise<void> => {
        if (!project) return;
        try {
            await deleteProject(project.id, project.version);
            message.success(t('项目已删除'));
            navigate('/projects');
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const runProjectTransition = async (action: ProjectTransitionAction, reason: string): Promise<void> => {
        if (!project) return;
        if ((action === 'reopen' || action === 'cancel') && !reason.trim()) {
            message.warning(t('请填写原因'));
            return;
        }
        try {
            await transitionProject(project.id, action, {
                version: project.version,
                ...(action === 'complete' ? { completionSummary: reason } : { reason: reason || undefined }),
            });
            message.success(t('状态已更新'));
            setTransitionPrompt(null);
            setTransitionText('');
            refreshProject();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleProjectTransition = (action: ProjectTransitionAction): void => {
        if (!project) return;
        const option = projectTransitions[project.status].find((item) => item.action === action);
        if (!option) return;
        if (option.reason || option.summary) {
            setTransitionPrompt({ action: option.action, label: option.label, requires: option.reason ? 'reason' : 'summary' });
            setTransitionText('');
            return;
        }
        void runProjectTransition(action, '');
    };

    const submitTask = async (): Promise<void> => {
        if (!project) return;
        if (!taskForm.title.trim() || !taskForm.ownerMembershipId) {
            message.warning(t('请填写任务标题并选择负责人'));
            return;
        }
        const input: CreateTaskInput = {
            title: taskForm.title,
            ...(taskForm.description.trim() ? { description: taskForm.description } : {}),
            ...(taskForm.parentId ? { parentId: taskForm.parentId } : {}),
            priority: taskForm.priority,
            ...(taskForm.dueDate ? { dueDate: new Date(`${taskForm.dueDate}T23:59:59Z`).toISOString() } : {}),
            ownerMembershipId: taskForm.ownerMembershipId,
            collaboratorMembershipIds: taskForm.collaboratorMembershipIds.filter((id) => id !== taskForm.ownerMembershipId),
        };
        try {
            await createTask(project.id, input);
            message.success(t('任务已创建'));
            setTaskCreateOpen(false);
            setTaskForm(emptyTaskForm);
            refreshTasks();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };


    useEffect(() => {
        if (projectQuery.error && !hasStoredSession()) onSessionExpired();
    }, [projectQuery.error, onSessionExpired]);
    useEffect(() => {
        if (!repositoriesQuery.isLoading && tab === 'repository' && repositories.length === 0) setTab('settings');
    }, [repositories.length, repositoriesQuery.isLoading, tab]);

    if (projectQuery.isLoading) return <div className="workspace-page project-detail-page"><div className="project-detail-loading"><Spin /></div></div>;
    if (projectQuery.error || !project) {
        return <div className="workspace-page project-detail-page"><div className="surface-panel project-detail-error"><Empty description={t('项目不存在或无权访问')} /><Button type="primary" onClick={() => navigate('/projects')}>{t('返回项目列表')}</Button></div></div>;
    }

    const memberCount = project.memberCount ?? projectMembers.length;
    const timeline = [
        { label: t('项目创建'), date: project.createdAt, state: 'done' },
        { label: t('首次启动'), date: project.startedAt ?? undefined, state: project.startedAt ? 'done' : 'pending' },
        { label: t('项目完成'), date: project.completedAt ?? undefined, state: project.completedAt ? 'done' : 'pending' },
        { label: t('项目关闭'), date: project.closedAt ?? undefined, state: project.closedAt ? 'done' : 'pending' },
    ];
    const recentTasks = [...allTasks].sort((left, right) => new Date(right.updatedAt ?? right.createdAt ?? 0).getTime() - new Date(left.updatedAt ?? left.createdAt ?? 0).getTime()).slice(0, 5);
    const projectActions = projectTransitions[project.status].map((option) => ({ key: option.action, label: t(option.label) }));
    if (permissions.has('project.delete') && !readOnly && project.currentMemberRole === 'OWNER') projectActions.push({ key: 'delete' as ProjectTransitionAction, label: t('删除') });
    const ownerName = project.owner?.displayName ?? project.owner?.account ?? '-';
    const ownerInitial = (ownerName || '?').slice(0, 1).toUpperCase();
    const stageNumber = project.status === 'PLANNING' || project.status === 'CANCELLED' ? 1 : project.status === 'COMPLETED' || project.status === 'ARCHIVED' ? 4 : 2;
    const progressRingStyle = { '--project-progress-angle': `${Math.max(0, Math.min(progress, 100)) * 3.6}deg` } as CSSProperties;
    const detailTabs: Array<{ key: ProjectDetailTab; label: string; icon: JSX.Element }> = [
        { key: 'overview', label: '概览', icon: <AppstoreOutlined /> },
        { key: 'workbench', label: '项目工作台', icon: <RobotOutlined /> },
        { key: 'decisions', label: '决策', icon: <CheckCircleOutlined /> },
        { key: 'kanban', label: '看板', icon: <ProjectOutlined /> },
        { key: 'daily', label: '日报', icon: <FileTextOutlined /> },
        { key: 'milestones', label: '里程碑', icon: <FlagOutlined /> },
        { key: 'members', label: '成员', icon: <TeamOutlined /> },
        { key: 'files', label: '文件', icon: <FolderOpenOutlined /> },
        { key: 'expenses', label: '费用', icon: <WalletOutlined /> },
        ...(hasRepository ? [{ key: 'repository' as ProjectDetailTab, label: '项目仓库', icon: <GithubOutlined /> }] : []),
        { key: 'settings', label: '设置', icon: <SettingOutlined /> },
    ];
    const currentWorkspace = projectWorkspaceCopy[tab];

    return <div className="workspace-page project-detail-page">
        <div className="project-detail-shell">
            <header className="project-detail-header">
                <button className="project-detail-breadcrumb" type="button" onClick={() => navigate('/projects')}>
                    <LeftOutlined />
                    <span>{t('项目管理')}</span>
                    <i>/</i>
                    <strong>{t('项目详情')}</strong>
                </button>

                <div className="project-detail-identity-row">
                    <div className="project-detail-mark">{project.name.slice(0, 1).toUpperCase()}</div>
                    <div className="project-detail-identity-copy">
                        <div className="project-detail-title-line">
                            <h1>{project.name}</h1>
                            <Tag className={`project-detail-status project-detail-status-${project.status.toLowerCase()}`}>{t(projectStatusLabels[project.status])}</Tag>
                        </div>
                        <div className="project-detail-meta">
                            <span className="project-detail-owner"><Avatar size={28}>{ownerInitial}</Avatar><span>{t('负责人')} <strong>{ownerName}</strong></span></span>
                            <i />
                            <span className="project-detail-code">{project.code}</span>
                            <i />
                            <span>{t('创建于 {date}', { date: project.createdAt ? formatDate(project.createdAt) : '-' })}</span>
                        </div>
                    </div>
                    <div className="project-detail-actions">
                        <Dropdown menu={{ items: projectActions, onClick: ({ key }) => key === 'delete' ? Modal.confirm({ title: t('确认删除该项目？'), onOk: () => void handleDeleteProject() }) : handleProjectTransition(key as ProjectTransitionAction) }} disabled={projectActions.length === 0}>
                            <Button aria-label={t('状态操作')} icon={<EllipsisOutlined />} />
                        </Dropdown>
                        {permissions.has('project.update') && !readOnly && <Button className="project-edit-button" icon={<EditOutlined />} onClick={openEditProject}>{t('编辑项目')}</Button>}
                    </div>
                </div>

                <section className="project-stat-grid">
                    <div className="project-stat-card">
                        <div className="project-stat-visual project-stat-ring" style={progressRingStyle}><span>{progress}%</span></div>
                        <div className="project-stat-content"><span>{t('整体进度')}</span><strong>{progress === 100 ? t('已完成') : progress === 0 ? t('尚未启动') : t('进行中')}</strong><small>{t('阶段 {current} / 4', { current: stageNumber })}</small></div>
                    </div>
                    <div className="project-stat-card">
                        <div className="project-stat-visual"><i className="project-stat-symbol is-indigo"><UnorderedListOutlined /></i></div>
                        <div className="project-stat-content"><span>{t('任务总数')}</span><strong>{project.taskCount ?? allTasks.length} {t('项任务')}</strong><small>{t('进行中')} {inProgressTaskCount} · {t('已完成')} {completedTaskCount}</small></div>
                    </div>
                    <div className="project-stat-card">
                        <div className="project-stat-visual"><i className="project-stat-symbol is-cyan"><FlagOutlined /></i></div>
                        <div className="project-stat-content"><span>{t('最近节点')}</span><strong>{upcomingTask?.title ?? t('暂无待办节点')}</strong><small>{upcomingTask?.dueDate ? formatDate(upcomingTask.dueDate) : t('当前没有临近节点')}</small></div>
                    </div>
                    <div className="project-stat-card">
                        <div className="project-stat-content"><span>{t('团队成员')}</span><strong>{memberCount} {t('名成员')}</strong>{memberCount === 0 && <small>{t('尚未添加成员')}</small>}</div>
                        <div className="project-stat-visual project-stat-member-stack project-member-avatars">
                            {projectMembers.slice(0, 4).map((member) => <Avatar key={member.id} size={28}>{member.displayName.slice(0, 1)}</Avatar>)}
                            {memberCount > 4 && <i className="project-member-overflow">+{memberCount - 4}</i>}
                        </div>
                    </div>
                </section>

                <nav className="project-detail-tabs" aria-label={t('项目详情导航')}>
                    {detailTabs.map((item) => <button key={item.key} className={tab === item.key ? 'is-active' : ''} type="button" onClick={() => setTab(item.key)}>{item.icon}<span>{t(item.label)}</span></button>)}
                </nav>
            </header>

            <main className="project-detail-content">
                <div className="workspace-intro">
                    <div><span className="workspace-phase">{t(currentWorkspace.phase)}</span><span className="workspace-detail">{t(currentWorkspace.detail)}</span></div>
                </div>

                {tab === 'overview' && <>
                    <section className="project-overview-quick-grid">
                        <button className="ai-quick-card" type="button" onClick={() => setTab('workbench')}><i><RobotOutlined /></i><span><strong>{t('和项目 AI 共创')}</strong><small>{t('结合项目文件、知识库和当前进展，梳理想法、风险与决策建议。')}</small></span><em className="ai-quick-action">{t('进入工作台')} →</em></button>
                        <button className="ai-quick-card" type="button" onClick={() => setTab('daily')}><i><FileTextOutlined /></i><span><strong>{t('补完今日日报')}</strong><small>{t('任务完成后自动带入已完成事项，你可以继续修改并提交。')}</small></span><em className="ai-quick-action">{t('查看日报')} →</em></button>
                    </section>
                    <div className="project-overview-grid overview-layout">
                        <div className="project-overview-left">
                            <section className="project-detail-card project-description-card"><h2>{t('项目描述')}</h2><p>{project.description?.trim() || t('暂无项目说明')}</p></section>
                            <section className="project-detail-card project-recent-tasks-card"><div className="project-card-section-heading"><h2>{t('近期任务')}</h2><button type="button" onClick={() => setTab('kanban')}>{t('查看全部任务')} <span>→</span></button></div>{recentTasks.length ? <div className="project-recent-task-list">{recentTasks.map((task) => <button type="button" key={task.id} onClick={() => setTaskDetail(task)}><Tag color={task.priority === 'HIGH' || task.priority === 'URGENT' ? 'error' : task.priority === 'MEDIUM' ? 'warning' : 'success'}>{t(taskPriorityLabels[task.priority])}</Tag><strong>{task.title}</strong><span>{task.owner?.displayName ?? '-'}</span><time>{formatShortDate(task.dueDate ?? undefined, formatDate)}</time></button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无任务')} />}</section>
                        </div>
                        <div className="project-overview-right">
                            <section className={`project-risk-panel ${riskTask ? 'has-risk' : 'is-clear'}`}><WarningOutlined /><div><h2>{riskTask ? t('项目进度预警') : t('项目进度正常')}</h2><p>{riskTask ? t('任务“{task}”需要关注，请及时检查执行进度。', { task: riskTask.title }) : t('当前没有已识别的进度风险。')}</p></div></section>
                            <section className="project-detail-card project-activity-card"><div className="project-card-section-heading"><h2>{t('项目动态')}</h2></div>{activities.length > 0 ? <div className="project-activity-list">{activities.slice(0, 8).map((activity: ProjectActivity) => <div className="project-activity-item" key={activity.id}><span className="project-activity-dot" /><div><strong>{activity.actor?.displayName ?? t('系统')}</strong><p>{activity.summary}</p><time>{formatDate(activity.createdAt)}</time></div></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无项目动态')} />}</section>
                            <section className="project-detail-card project-milestone-card"><h2>{t('里程碑时间线')}</h2><ProjectTimeline events={timeline} formatDate={formatDate} t={t} /></section>
                        </div>
                    </div>
                </>}

                {tab === 'workbench' && <ProjectWorkbenchPanel projectId={project.id} authContext={authContext} activeMembers={activeMembers} projectMembers={projectMembers} tasks={allTasks} permissions={permissions} canManage={canManage} readOnly={readOnly} onRefresh={() => void refreshProjectWorkflow()} onTaskClick={setTaskDetail} />}
                {tab === 'decisions' && <ProjectDecisionPanel projectId={project.id} authContext={authContext} activeMembers={activeMembers} projectMembers={projectMembers} tasks={allTasks} permissions={permissions} canManage={canManage} readOnly={readOnly} onRefresh={() => void refreshProjectWorkflow()} onTaskClick={setTaskDetail} />}
                {tab === 'kanban' && <ProjectKanbanPanel projectId={project.id} authContext={authContext} activeMembers={activeMembers} projectMembers={projectMembers} tasks={allTasks} permissions={permissions} canManage={canManage} readOnly={readOnly} onRefresh={() => void refreshProjectWorkflow()} onTaskClick={setTaskDetail} />}
                {tab === 'daily' && <ProjectDailyReportPanel projectId={project.id} authContext={authContext} activeMembers={activeMembers} projectMembers={projectMembers} tasks={allTasks} permissions={permissions} canManage={canManage} readOnly={readOnly} onRefresh={() => void refreshProjectWorkflow()} onTaskClick={setTaskDetail} />}
                {tab === 'milestones' && <ProjectMilestonePanel projectId={project.id} authContext={authContext} activeMembers={activeMembers} projectMembers={projectMembers} tasks={allTasks} permissions={permissions} canManage={canManage} readOnly={readOnly} onRefresh={() => void refreshProjectWorkflow()} onTaskClick={setTaskDetail} />}
                {tab === 'members' && <section className="project-detail-card project-tab-card"><ProjectMembersPanel projectId={project.id} permissions={permissions} readOnly={readOnly} myMembershipId={authContext.membership.id} activeMembers={activeMembers} projectMembers={projectMembers} projectVersion={project.version} onRefreshMembers={refreshMembers} /></section>}
                {tab === 'files' && <ProjectFilesPanel projectId={project.id} authContext={authContext} activeMembers={activeMembers} projectMembers={projectMembers} tasks={allTasks} permissions={permissions} canManage={canManage} readOnly={readOnly} onRefresh={() => void refreshProjectWorkflow()} onTaskClick={setTaskDetail} />}
                {tab === 'expenses' && <ProjectExpensePanel projectId={project.id} authContext={authContext} activeMembers={activeMembers} projectMembers={projectMembers} tasks={allTasks} permissions={permissions} canManage={canManage} readOnly={readOnly} onRefresh={() => void refreshProjectWorkflow()} onTaskClick={setTaskDetail} />}
                {tab === 'repository' && hasRepository && <ProjectRepositoryPanel projectId={project.id} authContext={authContext} activeMembers={activeMembers} projectMembers={projectMembers} tasks={allTasks} permissions={permissions} canManage={canManage} readOnly={readOnly} onRefresh={() => void repositoriesQuery.refetch()} onTaskClick={setTaskDetail} />}
                {tab === 'settings' && <ProjectRepositorySettingsPanel projectId={project.id} authContext={authContext} activeMembers={activeMembers} projectMembers={projectMembers} tasks={allTasks} permissions={permissions} canManage={canManage} readOnly={readOnly} onRefresh={() => void repositoriesQuery.refetch()} onTaskClick={setTaskDetail} />}
            </main>
        </div>

        <ProjectFormModal open={projectModal.open} editing={projectModal.editing} permissions={permissions} currentMembershipId={authContext.membership.id} activeMembers={activeMembers} departments={departments} submitting={projectSubmitting} onSubmit={(values) => void submitProject(values)} onCancel={() => setProjectModal({ open: false })} />
        <Modal open={taskCreateOpen} title={t('新建任务')} okText={t('创建')} cancelText={t('取消')} onOk={() => void submitTask()} onCancel={() => setTaskCreateOpen(false)}>
            <div className="form-grid">
                <label><span>{t('任务标题')}</span><Input value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} /></label>
                <label><span>{t('任务说明')}</span><Input.TextArea rows={3} value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} /></label>
                <label><span>{t('父任务')}</span><Select allowClear placeholder={t('无（根任务）')} value={taskForm.parentId ?? undefined} onChange={(value) => setTaskForm({ ...taskForm, parentId: value ?? null })} options={allTasks.map((item) => ({ value: item.id, label: item.title }))} /></label>
                <div className="form-row">
                    <label><span>{t('优先级')}</span><Select<TaskPriority> style={{ width: '100%' }} value={taskForm.priority} onChange={(value) => setTaskForm({ ...taskForm, priority: value })} options={Object.entries(taskPriorityLabels).map(([value, label]) => ({ value: value as TaskPriority, label: t(label) }))} /></label>
                    <label><span>{t('截止日期')}</span><input type="date" value={taskForm.dueDate} onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value })} /></label>
                </div>
                <label><span>{t('负责人')}</span><Select showSearch optionFilterProp="label" placeholder={t('选择负责人')} value={taskForm.ownerMembershipId || undefined} onChange={(value) => setTaskForm({ ...taskForm, ownerMembershipId: value })} options={activeMembers.map((member) => ({ value: member.id, label: `${member.user.displayName} (${member.account})` }))} /></label>
                <label><span>{t('协作人')}</span><Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder={t('选择协作人')} value={taskForm.collaboratorMembershipIds} onChange={(value) => setTaskForm({ ...taskForm, collaboratorMembershipIds: value })} options={activeMembers.map((member) => ({ value: member.id, label: `${member.user.displayName} (${member.account})` }))} /></label>
            </div>
        </Modal>
        <TransitionPromptModal open={transitionPrompt !== null} title={transitionPrompt ? t(transitionPrompt.label) : ''} reasonKind={transitionPrompt?.requires === 'reason' ? t('原因') : t('总结')} value={transitionText} onChange={setTransitionText} onOk={() => void (transitionPrompt && runProjectTransition(transitionPrompt.action as ProjectTransitionAction, transitionText))} onCancel={() => setTransitionPrompt(null)} />
        {taskDetail && <TaskDetailDrawer projectId={project.id} task={taskDetail} permissions={permissions} activeMembers={activeMembers} allTasks={allTasks} onClose={() => setTaskDetail(null)} onRefreshTasks={refreshTasks} />}
    </div>;
}

function ProjectTimeline({ events, formatDate, t }: { events: Array<{ label: string; date?: string; state: string }>; formatDate: (value: string) => string; t: (key: string) => string }): JSX.Element {
    return <div className="project-timeline">{events.map((event, index) => <div className={`project-timeline-item ${event.state}`} key={`${event.label}-${index}`}><span className="project-timeline-marker">{event.state === 'done' ? <CheckCircleOutlined /> : <i />}</span><div><strong>{event.label}</strong><small>{event.date ? formatDate(event.date) : t('待完成')}</small></div></div>)}</div>;
}
