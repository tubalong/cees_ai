import { CheckCircleOutlined, EditOutlined, EllipsisOutlined, LeftOutlined, WarningOutlined } from '@ant-design/icons';
import { App as AntdApp, Avatar, Button, Dropdown, Empty, Input, Modal, Select, Spin, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
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

    if (projectQuery.isLoading) return <div className="workspace-page project-detail-page"><div className="project-detail-loading"><Spin /></div></div>;
    if (projectQuery.error || !project) {
        return <div className="workspace-page project-detail-page"><div className="surface-panel project-detail-error"><Empty description={t('项目不存在或无权访问')} /><Button type="primary" onClick={() => navigate('/projects')}>{t('返回项目列表')}</Button></div></div>;
    }

    const timeline = [
        { label: t('项目创建'), date: project.createdAt, state: 'done' },
        { label: t('首次启动'), date: project.startedAt ?? undefined, state: project.startedAt ? 'done' : 'pending' },
        { label: t('项目完成'), date: project.completedAt ?? undefined, state: project.completedAt ? 'done' : 'pending' },
        { label: t('项目关闭'), date: project.closedAt ?? undefined, state: project.closedAt ? 'done' : 'pending' },
    ];
    const recentTasks = [...allTasks].sort((left, right) => new Date(right.updatedAt ?? right.createdAt ?? 0).getTime() - new Date(left.updatedAt ?? left.createdAt ?? 0).getTime()).slice(0, 5);
    const projectActions = projectTransitions[project.status].map((option) => ({ key: option.action, label: t(option.label) }));
    if (permissions.has('project.delete') && !readOnly && project.currentMemberRole === 'OWNER') projectActions.push({ key: 'delete' as ProjectTransitionAction, label: t('删除') });
    useEffect(() => {
        if (!repositoriesQuery.isLoading && tab === 'repository' && repositories.length === 0) setTab('settings');
    }, [repositories.length, repositoriesQuery.isLoading, tab]);

    const ownerName = project.owner?.displayName ?? project.owner?.account ?? '-';

    return <div className="workspace-page project-detail-page">
        <header className="project-detail-header-area">
            <button className="project-back-link" type="button" onClick={() => navigate('/projects')}><LeftOutlined />{t('返回项目列表')}</button>
            <div className="project-detail-title-row">
                <div className="project-detail-title-left">
                    <h1>{project.name}</h1>
                    <Tag className={`project-detail-status project-detail-status-${project.status.toLowerCase()}`}>{t(projectStatusLabels[project.status])}</Tag>
                    <span className="project-detail-owner"><span>{t('负责人')}:</span><strong>{ownerName}</strong></span>
                </div>
                <div className="project-detail-actions">
                    <Dropdown menu={{ items: projectActions, onClick: ({ key }) => key === 'delete' ? Modal.confirm({ title: t('确认删除该项目？'), onOk: () => void handleDeleteProject() }) : handleProjectTransition(key as ProjectTransitionAction) }} disabled={projectActions.length === 0}>
                        <Button aria-label={t('状态操作')} icon={<EllipsisOutlined />} />
                    </Dropdown>
                    {permissions.has('project.update') && !readOnly && <Button className="project-edit-button" icon={<EditOutlined />} onClick={openEditProject}>{t('编辑项目')}</Button>}
                </div>
            </div>
        </header>

        <section className="project-summary-grid">
            <div className="project-summary-card project-progress-summary"><div className="project-progress-ring"><strong>{progress}%</strong></div><div><span>{t('整体进度')}</span><strong>{progress === 100 ? t('已完成') : progress === 0 ? t('尚未启动') : t('推进平稳')}</strong></div></div>
            <div className="project-summary-card"><span>{t('任务总数')}</span><div><strong>{project.taskCount ?? allTasks.length}</strong><small>{t('进行中')} {inProgressTaskCount} / {t('已完成')} {completedTaskCount}</small></div></div>
            <div className="project-summary-card"><span>{t('团队成员')}</span><div><strong>{project.memberCount ?? projectMembers.length} {t('人')}</strong><span className="project-summary-avatars">{projectMembers.slice(0, 3).map((member) => <Avatar key={member.id} size={24}>{member.displayName.slice(0, 1)}</Avatar>)}{(project.memberCount ?? projectMembers.length) > 3 && <i>+{(project.memberCount ?? projectMembers.length) - 3}</i>}</span></div></div>
            <div className="project-summary-card"><span>{t('最近节点')}</span><div><strong>{upcomingTask?.dueDate ? formatDate(upcomingTask.dueDate) : '-'}</strong><small>{upcomingTask?.title ?? t('暂无待办节点')}</small></div></div>
            <div className="project-summary-card"><span>{t('当前版本')}</span><strong className="project-version-value">v{project.version}</strong></div>
        </section>

        <nav className="project-detail-tabs" aria-label={t('项目详情导航')}>
            {([
                ['overview', '概览'], ['workbench', '项目工作台'], ['decisions', '决策'], ['kanban', '看板'], ['daily', '日报'], ['milestones', '里程碑'], ['members', '成员'], ['files', '文件'], ['expenses', '费用'], ...(hasRepository ? [['repository', '项目仓库'] as [ProjectDetailTab, string]] : []), ['settings', '设置'],
            ] as Array<[ProjectDetailTab, string]>).map(([key, label]) => <button key={key} className={tab === key ? 'is-active' : ''} type="button" onClick={() => setTab(key)}>{t(label)}</button>)}
        </nav>

        {tab === 'overview' && <div className="project-overview-grid">
            <div className="project-overview-left">
                <section className="project-detail-card project-description-card"><h2>{t('项目描述')}</h2><p>{project.description?.trim() || t('暂无项目说明')}</p></section>
                <section className="project-detail-card project-recent-tasks-card"><div className="project-card-section-heading"><h2>{t('近期任务')}</h2><button type="button" onClick={() => setTab('kanban')}>{t('查看全部任务')} <span>→</span></button></div>{recentTasks.length ? <div className="project-recent-task-list">{recentTasks.map((task) => <button type="button" key={task.id} onClick={() => setTaskDetail(task)}><Tag color={task.priority === 'HIGH' || task.priority === 'URGENT' ? 'error' : task.priority === 'MEDIUM' ? 'warning' : 'success'}>{t(taskPriorityLabels[task.priority])}</Tag><strong>{task.title}</strong><span>{task.owner?.displayName ?? '-'}</span><time>{formatShortDate(task.dueDate ?? undefined, formatDate)}</time></button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无任务')} />}</section>
            </div>
            <div className="project-overview-right">
                <section className={`project-risk-panel ${riskTask ? 'has-risk' : 'is-clear'}`}><WarningOutlined /><div><h2>{riskTask ? t('项目进度预警') : t('项目进度正常')}</h2><p>{riskTask ? t('任务“{task}”需要关注，请及时检查执行进度。', { task: riskTask.title }) : t('当前没有已识别的进度风险。')}</p></div></section>
                <section className="project-detail-card project-activity-card"><div className="project-card-section-heading"><h2>{t('项目动态')}</h2></div>{activities.length > 0 ? <div className="project-activity-list">{activities.slice(0, 8).map((activity: ProjectActivity) => <div className="project-activity-item" key={activity.id}><span className="project-activity-dot" /><div><strong>{activity.actor?.displayName ?? t('系统')}</strong><p>{activity.summary}</p><time>{formatDate(activity.createdAt)}</time></div></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无项目动态')} />}</section>
                <section className="project-detail-card project-milestone-card"><h2>{t('里程碑时间线')}</h2><ProjectTimeline events={timeline} formatDate={formatDate} t={t} /></section>
            </div>
        </div>}

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
