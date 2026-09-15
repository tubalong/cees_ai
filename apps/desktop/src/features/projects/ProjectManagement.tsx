import {
    CalendarOutlined, DeleteOutlined, DownOutlined, EditOutlined, FileDoneOutlined,
    PaperClipOutlined, PlusOutlined, SearchOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import {
    App as AntdApp, Button, Dropdown, Empty, Input, Modal, Popconfirm, Select, Spin, Switch, Tag, Upload,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
    addProjectMember, addTaskAttachment, createProject, createTask, deleteProject,
    createTaskComment, deleteTask, deleteTaskComment, getTask, hasStoredSession, listProjectMembers,
    listProjects, listTaskActivities, listTaskAttachments, listTaskComments, listTasks,
    listTenantMembers, removeProjectMember, removeTaskAttachment, replaceTaskAssignees,
    transferProjectOwner, transitionProject, transitionTask, updateProject, updateProjectMember,
    updateTask, updateTaskComment, uploadAttachmentFile,
    type CreateProjectInput, type CreateTaskInput, type MeResult, type ProjectMemberRole,
    type ProjectStatus, type ProjectSummary, type ProjectTransitionAction, type TaskAttachment,
    type TaskActivity, type TaskComment, type TaskPriority, type TaskStatus, type TaskSummary,
    type TenantMember,
} from '../../core/api';
import '../../styles/shared.css';
import { useDateFormatter, useI18n } from '../../core/i18n';

const projectStatusLabels: Record<ProjectStatus, string> = {
    PLANNING: '规划中', ACTIVE: '进行中', PAUSED: '已暂停', COMPLETED: '已完成', CANCELLED: '已取消', ARCHIVED: '已归档',
};

const projectStatusColors: Record<ProjectStatus, string> = {
    PLANNING: 'default', ACTIVE: 'processing', PAUSED: 'warning', COMPLETED: 'success', CANCELLED: 'error', ARCHIVED: 'default',
};

const taskStatusLabels: Record<TaskStatus, string> = {
    TODO: '待处理', IN_PROGRESS: '进行中', BLOCKED: '已阻塞', DONE: '已完成', CANCELLED: '已取消',
};

const taskStatusColors: Record<TaskStatus, string> = {
    TODO: 'default', IN_PROGRESS: 'processing', BLOCKED: 'warning', DONE: 'success', CANCELLED: 'error',
};

const taskPriorityLabels: Record<TaskPriority, string> = { LOW: '低', MEDIUM: '中', HIGH: '高', URGENT: '紧急' };

interface ProjectTransitionOption {
    action: ProjectTransitionAction;
    label: string;
    reason?: 'optional' | 'required';
    summary?: boolean;
}

const projectTransitions: Record<ProjectStatus, ProjectTransitionOption[]> = {
    PLANNING: [{ action: 'start', label: '启动项目' }],
    ACTIVE: [
        { action: 'pause', label: '暂停' },
        { action: 'complete', label: '完成项目', summary: true },
        { action: 'cancel', label: '取消', reason: 'required' },
    ],
    PAUSED: [
        { action: 'resume', label: '恢复' },
        { action: 'cancel', label: '取消', reason: 'required' },
    ],
    COMPLETED: [
        { action: 'reopen', label: '重新开启', reason: 'required' },
        { action: 'archive', label: '归档' },
    ],
    CANCELLED: [],
    ARCHIVED: [{ action: 'restore', label: '恢复归档' }],
};

const taskTransitions: Record<TaskStatus, Array<{ to: TaskStatus; reason?: boolean }>> = {
    TODO: [{ to: 'IN_PROGRESS' }, { to: 'CANCELLED', reason: true }],
    IN_PROGRESS: [{ to: 'BLOCKED', reason: true }, { to: 'DONE' }, { to: 'CANCELLED', reason: true }],
    BLOCKED: [{ to: 'IN_PROGRESS' }, { to: 'DONE' }, { to: 'CANCELLED', reason: true }],
    DONE: [],
    CANCELLED: [],
};

function isReadOnlyProject(status: ProjectStatus): boolean {
    return status === 'COMPLETED' || status === 'CANCELLED' || status === 'ARCHIVED';
}

interface ProjectFormValues {
    code: string;
    name: string;
    description: string;
    startsAt: string;
    endsAt: string;
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

interface ProjectManagementProps {
    authContext: MeResult;
    onSessionExpired: () => void;
}

export default function ProjectManagement({ authContext, onSessionExpired }: ProjectManagementProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const permissions = useMemo(() => new Set(authContext.permissions), [authContext.permissions]);

    const [keyword, setKeyword] = useState('');
    const [statusFilter, setStatusFilter] = useState<ProjectStatus | ''>('');
    const [includeArchived, setIncludeArchived] = useState(false);
    const [selectedId, setSelectedId] = useState<string>();
    const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus | ''>('');
    const [rootOnly, setRootOnly] = useState(true);

    const projectsQuery = useQuery({
        queryKey: ['projects', keyword, statusFilter, includeArchived],
        queryFn: () => listProjects({
            keyword,
            ...(statusFilter ? { status: statusFilter } : {}),
            includeArchived,
        }),
    });
    const membersQuery = useQuery({ queryKey: ['tenant-members'], queryFn: () => listTenantMembers() });
    const projects = projectsQuery.data?.items ?? [];
    const selected = projects.find((project) => project.id === selectedId) ?? projects[0];

    const projectMembersQuery = useQuery({
        queryKey: ['project-members', selected?.id],
        queryFn: () => listProjectMembers(selected!.id),
        enabled: Boolean(selected?.id),
    });
    const tasksQuery = useQuery({
        queryKey: ['project-tasks', selected?.id, taskStatusFilter, rootOnly],
        queryFn: () => listTasks(selected!.id, { ...(taskStatusFilter ? { status: taskStatusFilter } : {}), rootOnly }),
        enabled: Boolean(selected?.id),
    });
    const allTasksQuery = useQuery({
        queryKey: ['project-tasks-all', selected?.id],
        queryFn: () => listTasks(selected!.id),
        enabled: Boolean(selected?.id),
    });

    useEffect(() => {
        if (projectsQuery.error && !hasStoredSession()) onSessionExpired();
    }, [projectsQuery.error, onSessionExpired]);

    const [projectModal, setProjectModal] = useState<{ open: boolean; editing?: ProjectSummary }>({ open: false });
    const [projectForm, setProjectForm] = useState<ProjectFormValues>({ code: '', name: '', description: '', startsAt: '', endsAt: '' });
    const [taskCreateOpen, setTaskCreateOpen] = useState(false);
    const [taskForm, setTaskForm] = useState<TaskFormValues>({ title: '', description: '', parentId: null, priority: 'MEDIUM', dueDate: '', ownerMembershipId: '', collaboratorMembershipIds: [] });
    const [taskDetail, setTaskDetail] = useState<TaskSummary | null>(null);
    const [transitionPrompt, setTransitionPrompt] = useState<{ kind: 'project' | 'task'; action: string; label: string; requires: 'reason' | 'summary' } | null>(null);
    const [transitionText, setTransitionText] = useState('');

    const activeMembers = (membersQuery.data?.items ?? []).filter((member) => member.status === 'ACTIVE');
    const allTasks = allTasksQuery.data?.items ?? [];
    const membershipName = (membershipId: string): string =>
        activeMembers.find((member) => member.id === membershipId)?.user.displayName ?? membershipId.slice(0, 8);

    const openCreateProject = (): void => {
        setProjectForm({ code: '', name: '', description: '', startsAt: '', endsAt: '' });
        setProjectModal({ open: true });
    };

    const openEditProject = (): void => {
        if (!selected) return;
        setProjectForm({
            code: selected.code,
            name: selected.name,
            description: selected.description ?? '',
            startsAt: selected.startsAt?.slice(0, 10) ?? '',
            endsAt: selected.endsAt?.slice(0, 10) ?? '',
        });
        setProjectModal({ open: true, editing: selected });
    };

    const submitProject = async (): Promise<void> => {
        if (!projectForm.code.trim() || !projectForm.name.trim()) {
            message.warning(t('请填写项目编码和名称'));
            return;
        }
        const input: CreateProjectInput = {
            code: projectForm.code,
            name: projectForm.name,
            ...(projectForm.description.trim() ? { description: projectForm.description } : {}),
            ...(projectForm.startsAt ? { startsAt: new Date(`${projectForm.startsAt}T00:00:00Z`).toISOString() } : {}),
            ...(projectForm.endsAt ? { endsAt: new Date(`${projectForm.endsAt}T00:00:00Z`).toISOString() } : {}),
        };
        try {
            if (projectModal.editing) {
                await updateProject(projectModal.editing.id, { ...input, version: projectModal.editing.version });
            } else {
                await createProject(input);
            }
            message.success(projectModal.editing ? t('项目已更新') : t('项目已创建'));
            setProjectModal({ open: false });
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleDeleteProject = async (): Promise<void> => {
        if (!selected) return;
        try {
            await deleteProject(selected.id, selected.version);
            message.success(t('项目已删除'));
            setSelectedId(undefined);
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const runProjectTransition = async (): Promise<void> => {
        if (!selected || !transitionPrompt) return;
        if (transitionPrompt.requires === 'reason' && !transitionText.trim()) {
            message.warning(t('请填写原因'));
            return;
        }
        try {
            await transitionProject(selected.id, transitionPrompt.action as ProjectTransitionAction, {
                version: selected.version,
                ...(transitionPrompt.requires === 'reason' ? { reason: transitionText } : {}),
                ...(transitionPrompt.requires === 'summary' && transitionText.trim() ? { completionSummary: transitionText } : {}),
            });
            message.success(t('状态已更新'));
            setTransitionPrompt(null);
            setTransitionText('');
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleProjectTransition = (action: ProjectTransitionAction): void => {
        if (!selected) return;
        const option = projectTransitions[selected.status].find((item) => item.action === action);
        if (!option) return;
        if (option.reason || option.summary) {
            setTransitionPrompt({ kind: 'project', action: option.action, label: option.label, requires: option.reason ? 'reason' : 'summary' });
            setTransitionText('');
            return;
        }
        void (async () => {
            try {
                await transitionProject(selected.id, action, { version: selected.version });
                message.success(t('状态已更新'));
                await queryClient.invalidateQueries({ queryKey: ['projects'] });
            } catch (error) {
                message.error(error instanceof Error ? error.message : t('操作失败'));
            }
        })();
    };

    const submitTask = async (): Promise<void> => {
        if (!selected) return;
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
            await createTask(selected.id, input);
            message.success(t('任务已创建'));
            setTaskCreateOpen(false);
            setTaskForm({ title: '', description: '', parentId: null, priority: 'MEDIUM', dueDate: '', ownerMembershipId: '', collaboratorMembershipIds: [] });
            await queryClient.invalidateQueries({ queryKey: ['project-tasks'] });
            await queryClient.invalidateQueries({ queryKey: ['project-tasks-all'] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const runTaskTransition = async (): Promise<void> => {
        if (!taskDetail || !selected || !transitionPrompt) return;
        if (transitionPrompt.requires === 'reason' && !transitionText.trim()) {
            message.warning(t('请填写原因'));
            return;
        }
        try {
            await transitionTask(selected.id, taskDetail.id, transitionPrompt.action as TaskStatus, taskDetail.version, transitionPrompt.requires === 'reason' ? transitionText : undefined);
            message.success(t('任务状态已更新'));
            setTransitionPrompt(null);
            setTransitionText('');
            setTaskDetail(null);
            await queryClient.invalidateQueries({ queryKey: ['project-tasks'] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const readOnly = selected ? isReadOnlyProject(selected.status) : false;

    return <div className="workspace-page project-management-page">
        <header className="workspace-page-header">
            <div><h1>{t('项目管理')}</h1><p>{t('项目全生命周期：规划、执行、暂停、完成与归档')}</p></div>
            {permissions.has('project.create') && <div className="header-actions"><Button type="primary" icon={<PlusOutlined />} onClick={openCreateProject}>{t('新建项目')}</Button></div>}
        </header>
        <div className="project-layout">
            <aside className="surface-panel project-list-panel">
                <div className="task-toolbar">
                    <Input allowClear prefix={<SearchOutlined />} placeholder={t('搜索项目')} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                    <Select<ProjectStatus | ''> allowClear placeholder={t('状态')} value={statusFilter || undefined} onChange={(value) => setStatusFilter(value ?? '')} style={{ width: 120 }} options={Object.entries(projectStatusLabels).map(([value, label]) => ({ value: value as ProjectStatus, label: t(label) }))} />
                </div>
                <label className="task-toolbar" style={{ fontSize: 12, color: 'var(--cees-muted)' }}>
                    <Switch size="small" checked={includeArchived} onChange={setIncludeArchived} />{t('包含已归档')}
                </label>
                {projectsQuery.isLoading ? <div className="data-loading"><Spin /></div> : projects.length ? <div className="project-list">
                    {projects.map((project) => <button className={`project-row ${selected?.id === project.id ? 'is-selected' : ''}`} type="button" key={project.id} onClick={() => setSelectedId(project.id)}>
                        <strong>{project.name}</strong>
                        <small>{project.code} · {t(projectStatusLabels[project.status])} · {t('成员')} {project.memberCount ?? 0} · {t('任务')} {project.taskCount ?? 0}</small>
                    </button>)}
                </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无可见项目')} />}
            </aside>
            <section className="surface-panel project-detail-panel">
                {selected ? <>
                    <div className="project-detail-header">
                        <div>
                            <h2>{selected.name} <Tag color={projectStatusColors[selected.status]}>{t(projectStatusLabels[selected.status])}</Tag></h2>
                            <small style={{ color: 'var(--cees-muted)' }}>{selected.code}{selected.description ? ` · ${selected.description}` : ''}</small>
                        </div>
                        <div className="header-actions">
                            {!readOnly && permissions.has('project.update') && <Button icon={<EditOutlined />} onClick={openEditProject}>{t('编辑')}</Button>}
                            {!readOnly && permissions.has('project.update') && projectTransitions[selected.status].length > 0 && <Dropdown
                                menu={{
                                    items: projectTransitions[selected.status].map((option) => ({ key: option.action, label: t(option.label) })),
                                    onClick: ({ key }) => handleProjectTransition(key as ProjectTransitionAction),
                                }}
                            ><Button type={projectTransitions[selected.status].some((option) => option.action === 'complete') ? 'primary' : 'default'}>{t('状态操作')} <DownOutlined /></Button></Dropdown>}
                            {!readOnly && permissions.has('project.delete') && selected.myRole === 'OWNER' && <Popconfirm title={t('确认删除该项目？')} onConfirm={handleDeleteProject}><Button danger icon={<DeleteOutlined />} /></Popconfirm>}
                        </div>
                    </div>
                    <dl className="project-meta-grid">
                        <div><dt>{t('负责人')}</dt><dd>{selected.owner?.displayName ?? (selected.ownerMembershipId ? membershipName(selected.ownerMembershipId) : '-')}</dd></div>
                        <div><dt>{t('我的角色')}</dt><dd>{selected.myRole ? t({ OWNER: '负责人', MANAGER: '项目经理', MEMBER: '项目成员' }[selected.myRole]) : '-'}</dd></div>
                        <div><dt>{t('开始时间')}</dt><dd>{selected.startsAt ? formatDate(selected.startsAt) : '-'}</dd></div>
                        <div><dt>{t('结束时间')}</dt><dd>{selected.endsAt ? formatDate(selected.endsAt) : '-'}</dd></div>
                        <div><dt>{t('当前版本')}</dt><dd>v{selected.version}</dd></div>
                    </dl>
                    <ProjectTabs
                        projectId={selected.id}
                        permissions={permissions}
                        readOnly={readOnly}
                        myMembershipId={authContext.membership.id}
                        activeMembers={activeMembers}
                        projectMembers={projectMembersQuery.data?.items ?? []}
                        projectVersion={selected.version}
                        tasks={tasksQuery.data?.items ?? []}
                        tasksLoading={tasksQuery.isLoading}
                        taskStatusFilter={taskStatusFilter}
                        onTaskStatusFilter={setTaskStatusFilter}
                        rootOnly={rootOnly}
                        onToggleRootOnly={setRootOnly}
                        canCreateTask={permissions.has('task.create')}
                        onCreateTask={() => setTaskCreateOpen(true)}
                        onTaskClick={setTaskDetail}
                        onRefreshMembers={() => void queryClient.invalidateQueries({ queryKey: ['project-members'] })}
                        onRefreshTasks={() => void queryClient.invalidateQueries({ queryKey: ['project-tasks', 'project-tasks-all'] })}
                    />
                </> : <Empty description={t('请选择项目')} />}
            </section>
        </div>

        <Modal
            open={projectModal.open}
            title={projectModal.editing ? t('编辑项目') : t('新建项目')}
            okText={t('保存')}
            cancelText={t('取消')}
            onOk={() => void submitProject()}
            onCancel={() => setProjectModal({ open: false })}
        >
            <div className="form-grid">
                <label><span>{t('项目编码')}</span><Input value={projectForm.code} placeholder="PRJ-2026-001" disabled={Boolean(projectModal.editing)} onChange={(event) => setProjectForm({ ...projectForm, code: event.target.value })} /></label>
                <label><span>{t('项目名称')}</span><Input value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} /></label>
                <label><span>{t('项目说明')}</span><Input.TextArea rows={3} value={projectForm.description} onChange={(event) => setProjectForm({ ...projectForm, description: event.target.value })} /></label>
                <div className="form-row">
                    <label><span>{t('开始日期')}</span><input type="date" value={projectForm.startsAt} onChange={(event) => setProjectForm({ ...projectForm, startsAt: event.target.value })} /></label>
                    <label><span>{t('结束日期')}</span><input type="date" value={projectForm.endsAt} onChange={(event) => setProjectForm({ ...projectForm, endsAt: event.target.value })} /></label>
                </div>
            </div>
        </Modal>

        <Modal
            open={taskCreateOpen}
            title={t('新建任务')}
            okText={t('创建')}
            cancelText={t('取消')}
            onOk={() => void submitTask()}
            onCancel={() => setTaskCreateOpen(false)}
        >
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

        <TransitionPromptModal
            open={transitionPrompt !== null}
            title={transitionPrompt ? t(transitionPrompt.label) : ''}
            reasonKind={transitionPrompt?.requires === 'reason' ? t('原因') : t('总结')}
            value={transitionText}
            onChange={setTransitionText}
            onOk={() => void (transitionPrompt?.kind === 'project' ? runProjectTransition() : runTaskTransition())}
            onCancel={() => setTransitionPrompt(null)}
        />

        {selected && taskDetail && <TaskDetailModal
            projectId={selected.id}
            task={taskDetail}
            permissions={permissions}
            activeMembers={activeMembers}
            allTasks={allTasks}
            onClose={() => setTaskDetail(null)}
            onRefreshTasks={() => void queryClient.invalidateQueries({ queryKey: ['project-tasks', 'project-tasks-all'] })}
        />}
    </div>;
}

function TransitionPromptModal({ open, title, reasonKind, value, onChange, onOk, onCancel }: { open: boolean; title: string; reasonKind: string; value: string; onChange: (value: string) => void; onOk: () => void; onCancel: () => void }): JSX.Element {
    const { t } = useI18n();
    return <Modal open={open} title={title} okText={t('确认')} cancelText={t('取消')} onOk={onOk} onCancel={onCancel}>
        <label className="form-grid"><span>{reasonKind}</span><Input.TextArea rows={3} value={value} onChange={(event) => onChange(event.target.value)} placeholder={`${reasonKind}（必填）`} /></label>
    </Modal>;
}

interface ProjectTabsProps {
    projectId: string;
    permissions: Set<string>;
    readOnly: boolean;
    myMembershipId: string;
    activeMembers: TenantMember[];
    projectMembers: ProjectMemberSummaryLite[];
    projectVersion: number;
    tasks: TaskSummary[];
    tasksLoading: boolean;
    taskStatusFilter: TaskStatus | '';
    onTaskStatusFilter: (value: TaskStatus | '') => void;
    rootOnly: boolean;
    onToggleRootOnly: (value: boolean) => void;
    canCreateTask: boolean;
    onCreateTask: () => void;
    onTaskClick: (task: TaskSummary) => void;
    onRefreshMembers: () => void;
    onRefreshTasks: () => void;
}

type ProjectMemberSummaryLite = { id: string; membershipId: string; account: string; displayName: string; role: ProjectMemberRole; version: number };

function ProjectTabs(props: ProjectTabsProps): JSX.Element {
    const { t } = useI18n();
    const [tab, setTab] = useState<'tasks' | 'members'>('tasks');
    return <>
        <div className="category-tabs">
            <button className={tab === 'tasks' ? 'is-active' : ''} type="button" onClick={() => setTab('tasks')}>{t('任务')}</button>
            <button className={tab === 'members' ? 'is-active' : ''} type="button" onClick={() => setTab('members')}>{t('项目成员')}</button>
        </div>
        {tab === 'tasks' ? <ProjectTasksTab {...props} /> : <ProjectMembersTab {...props} />}
    </>;
}

function ProjectTasksTab({ readOnly, tasks, tasksLoading, taskStatusFilter, onTaskStatusFilter, rootOnly, onToggleRootOnly, canCreateTask, onCreateTask, onTaskClick }: ProjectTabsProps): JSX.Element {
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    return <>
        <div className="task-toolbar">
            <Select<TaskStatus | ''> allowClear placeholder={t('任务状态')} value={taskStatusFilter || undefined} onChange={(value) => onTaskStatusFilter(value ?? '')} style={{ width: 140 }} options={Object.entries(taskStatusLabels).map(([value, label]) => ({ value: value as TaskStatus, label: t(label) }))} />
            <label className="inline-switch"><Switch size="small" checked={rootOnly} onChange={onToggleRootOnly} />{t('仅看根任务')}</label>
            <span style={{ flex: 1 }} />
            {!readOnly && canCreateTask && <Button type="primary" icon={<PlusOutlined />} onClick={onCreateTask}>{t('新建任务')}</Button>}
        </div>
        {tasksLoading ? <div className="data-loading"><Spin /></div> : tasks.length ? <div className="task-list">
            {tasks.map((task) => <button className={`task-row-item${task.parentId ? ' is-subtask' : ''}`} type="button" key={task.id} onClick={() => onTaskClick(task)}>
                <Tag color={taskStatusColors[task.status]}>{t(taskStatusLabels[task.status])}</Tag>
                <strong>{task.title}</strong>
                {task.subtaskCount ? <Tag>{t('子任务')} {task.subtaskCount}</Tag> : null}
                <small>{task.parentId ? `${t('子任务')} · ` : ''}{t(taskPriorityLabels[task.priority])}{task.dueDate ? ` · ${t('截止')} ${formatDate(task.dueDate)}` : ''} · {task.owner?.displayName ?? '-'}</small>
                <small>{t('评论')} {task.commentCount ?? 0} · {t('附件')} {task.attachmentCount ?? 0}</small>
            </button>)}
        </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无任务')} />}
    </>;
}

function ProjectMembersTab({ projectId, permissions, readOnly, myMembershipId, activeMembers, projectMembers, projectVersion, onRefreshMembers }: ProjectTabsProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const [addOpen, setAddOpen] = useState(false);
    const [addMembershipId, setAddMembershipId] = useState<string>();
    const [addRole, setAddRole] = useState<'MANAGER' | 'MEMBER'>('MEMBER');
    const [transferTarget, setTransferTarget] = useState<string>();
    const memberIds = new Set(projectMembers.map((member) => member.membershipId));
    const candidates = activeMembers.filter((member) => !memberIds.has(member.id));
    const canManage = permissions.has('project.member.manage') && !readOnly;

    const handleAdd = async (): Promise<void> => {
        if (!addMembershipId) return;
        try {
            await addProjectMember(projectId, addMembershipId, addRole);
            message.success(t('成员已加入项目'));
            setAddOpen(false);
            setAddMembershipId(undefined);
            onRefreshMembers();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleRemove = async (member: ProjectMemberSummaryLite): Promise<void> => {
        try {
            await removeProjectMember(projectId, member.membershipId, member.version);
            message.success(t('成员已移出项目'));
            onRefreshMembers();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleTransfer = async (): Promise<void> => {
        if (!transferTarget) return;
        try {
            await transferProjectOwner(projectId, transferTarget, projectVersion);
            message.success(t('负责人已转移'));
            setTransferTarget(undefined);
            onRefreshMembers();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    return <>
        <div className="task-toolbar">
            {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>{t('添加成员')}</Button>}
            {canManage && <Select showSearch allowClear optionFilterProp="label" placeholder={t('转移负责人给…')} value={transferTarget} onChange={(value) => setTransferTarget(value)} style={{ minWidth: 200 }} options={projectMembers.filter((member) => member.role !== 'OWNER').map((member) => ({ value: member.membershipId, label: member.displayName }))} />}
            {transferTarget && <Button type="primary" ghost onClick={() => void handleTransfer()}>{t('确认转移')}</Button>}
            <span style={{ flex: 1 }} />
            <small style={{ color: 'var(--cees-muted)' }}><TeamOutlined /> {projectMembers.length}</small>
        </div>
        <div className="task-list">
            {projectMembers.map((member) => <div className="task-row-item" key={member.id} style={{ cursor: 'default' }}>
                <UserOutlined />
                <strong>{member.displayName}</strong>
                <small>{member.account}</small>
                <Tag color={member.role === 'OWNER' ? 'gold' : member.role === 'MANAGER' ? 'blue' : 'default'}>{t({ OWNER: '负责人', MANAGER: '项目经理', MEMBER: '项目成员' }[member.role])}</Tag>
                {canManage && member.role !== 'OWNER' && <Select size="small" value={member.role} style={{ width: 110 }} options={[{ value: 'MANAGER', label: t('项目经理') }, { value: 'MEMBER', label: t('项目成员') }]} onChange={(role) => void (async () => {
                    try {
                        await updateProjectMember(projectId, member.membershipId, role as 'MANAGER' | 'MEMBER', member.version);
                        message.success(t('角色已更新'));
                        onRefreshMembers();
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : t('操作失败'));
                    }
                })()} />}
                {canManage && member.role !== 'OWNER' && member.membershipId !== myMembershipId && <Popconfirm title={t('确认移出该成员？')} onConfirm={() => void handleRemove(member)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>}
            </div>)}
        </div>
        <Modal open={addOpen} title={t('添加项目成员')} okText={t('添加')} cancelText={t('取消')} onOk={() => void handleAdd()} onCancel={() => setAddOpen(false)}>
            <div className="form-grid">
                <label><span>{t('成员')}</span><Select showSearch optionFilterProp="label" placeholder={t('选择租户成员')} value={addMembershipId} onChange={setAddMembershipId} options={candidates.map((member) => ({ value: member.id, label: `${member.user.displayName} (${member.account})` }))} /></label>
                <label><span>{t('项目角色')}</span><Select value={addRole} onChange={(value) => setAddRole(value as 'MANAGER' | 'MEMBER')} options={[{ value: 'MANAGER', label: t('项目经理') }, { value: 'MEMBER', label: t('项目成员') }]} /></label>
            </div>
        </Modal>
    </>;
}

function TaskDetailModal({ projectId, task, permissions, activeMembers, allTasks, onClose, onRefreshTasks }: { projectId: string; task: TaskSummary; permissions: Set<string>; activeMembers: TenantMember[]; allTasks: TaskSummary[]; onClose: () => void; onRefreshTasks: () => void }): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const [current, setCurrent] = useState<TaskSummary>(task);
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
    const [activities, setActivities] = useState<TaskActivity[]>([]);
    const [commentInput, setCommentInput] = useState('');
    const [editOpen, setEditOpen] = useState(false);
    const [editForm, setEditForm] = useState({ title: task.title, description: task.description ?? '', parentId: task.parentId, priority: task.priority });
    const [assigneeOpen, setAssigneeOpen] = useState(false);
    const [assigneeForm, setAssigneeForm] = useState({
        ownerMembershipId: task.owner?.membershipId ?? '',
        collaboratorMembershipIds: (task.collaborators ?? []).map((collaborator) => collaborator.membershipId),
    });
    const [transitionPrompt, setTransitionPrompt] = useState<{ to: TaskStatus; reason?: boolean } | null>(null);
    const [transitionText, setTransitionText] = useState('');
    const terminal = current.status === 'DONE' || current.status === 'CANCELLED';

    const reload = async (): Promise<void> => {
        const [detail, commentPage, attachmentList, activityPage] = await Promise.all([
            getTask(projectId, task.id),
            listTaskComments(projectId, task.id),
            listTaskAttachments(projectId, task.id),
            listTaskActivities(projectId, task.id),
        ]);
        setCurrent(detail);
        setComments(commentPage.items);
        setAttachments(attachmentList.items);
        setActivities(activityPage.items);
        onRefreshTasks();
    };

    useEffect(() => {
        void reload().catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, task.id]);

    const submitComment = async (): Promise<void> => {
        if (!commentInput.trim()) return;
        try {
            await createTaskComment(projectId, task.id, commentInput);
            setCommentInput('');
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const submitEdit = async (): Promise<void> => {
        try {
            await updateTask(projectId, task.id, {
                title: editForm.title,
                description: editForm.description,
                parentId: editForm.parentId,
                priority: editForm.priority,
                version: current.version,
            });
            message.success(t('任务已更新'));
            setEditOpen(false);
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const submitAssignees = async (): Promise<void> => {
        try {
            await replaceTaskAssignees(
                projectId, task.id,
                assigneeForm.ownerMembershipId,
                assigneeForm.collaboratorMembershipIds.filter((id) => id !== assigneeForm.ownerMembershipId),
                current.version,
            );
            message.success(t('执行人已更新'));
            setAssigneeOpen(false);
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const runTransition = async (): Promise<void> => {
        if (!transitionPrompt) return;
        if (transitionPrompt.reason && !transitionText.trim()) {
            message.warning(t('请填写原因'));
            return;
        }
        try {
            await transitionTask(projectId, task.id, transitionPrompt.to, current.version, transitionPrompt.reason ? transitionText : undefined);
            message.success(t('任务状态已更新'));
            setTransitionPrompt(null);
            setTransitionText('');
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const handleUpload = async (file: File): Promise<void> => {
        try {
            message.loading({ content: t('正在上传附件…'), key: 'task-upload', duration: 0 });
            const fileObjectId = await uploadAttachmentFile(file);
            await addTaskAttachment(projectId, task.id, fileObjectId);
            message.success({ content: t('附件已上传'), key: 'task-upload' });
            await reload();
        } catch (error) {
            message.error({ content: error instanceof Error ? error.message : t('上传失败'), key: 'task-upload' });
        }
    };

    return <Modal open width={760} title={<span>{current.title} <Tag color={taskStatusColors[current.status]}>{t(taskStatusLabels[current.status])}</Tag> <Tag>{t(taskPriorityLabels[current.priority])}</Tag></span>} footer={null} onCancel={onClose}>
        <div className="task-detail-sections">
            <div className="task-toolbar">
                {!terminal && permissions.has('task.update') && <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>{t('编辑')}</Button>}
                {!terminal && permissions.has('task.status.update') && taskTransitions[current.status].map((option) => <Button key={option.to} onClick={() => {
                    if (option.reason) {
                        setTransitionPrompt(option);
                        setTransitionText('');
                    } else {
                        setTransitionPrompt(option);
                    }
                }}>{t(`流转为${taskStatusLabels[option.to]}`)}</Button>)}
                {!terminal && permissions.has('task.assignee.manage') && <Button icon={<TeamOutlined />} onClick={() => setAssigneeOpen(true)}>{t('调整执行人')}</Button>}
                {!terminal && permissions.has('task.delete') && current.subtaskCount === 0 && <Popconfirm title={t('确认删除该任务？')} onConfirm={() => void (async () => {
                    try {
                        await deleteTask(projectId, task.id, current.version);
                        message.success(t('任务已删除'));
                        onClose();
                        onRefreshTasks();
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : t('操作失败'));
                    }
                })()}><Button danger icon={<DeleteOutlined />} /></Popconfirm>}
            </div>
            {current.description ? <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{current.description}</p> : <small style={{ color: 'var(--cees-muted)' }}>{t('暂无任务说明')}</small>}
            <dl className="project-meta-grid">
                <div><dt>{t('负责人')}</dt><dd>{current.owner?.displayName ?? '-'}</dd></div>
                <div><dt>{t('协作人')}</dt><dd>{current.collaborators?.length ? current.collaborators.map((collaborator) => collaborator.displayName ?? collaborator.account).join('、') : '-'}</dd></div>
                <div><dt>{t('截止时间')}</dt><dd>{current.dueDate ? formatDate(current.dueDate) : '-'}</dd></div>
                <div><dt>{t('子任务')}</dt><dd>{current.subtaskCount ?? 0}</dd></div>
                <div><dt>{t('当前版本')}</dt><dd>v{current.version}</dd></div>
            </dl>

            <section>
                <div className="panel-heading"><h3><PaperClipOutlined /> {t('附件')}</h3>
                    {permissions.has('task.attachment.manage') && <Upload showUploadList={false} customRequest={({ file }) => void handleUpload(file as File)}><Button size="small" icon={<PlusOutlined />}>{t('上传附件')}</Button></Upload>}
                </div>
                <div className="attachment-list">
                    {attachments.length ? attachments.map((attachment) => <div className="attachment-row" key={attachment.id}>
                        <FileDoneOutlined />
                        <strong>{attachment.fileName}</strong>
                        <small>{attachment.sizeBytes ? `${Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB` : ''} · {formatDate(attachment.createdAt ?? '')}</small>
                        {permissions.has('task.attachment.manage') && <Popconfirm title={t('确认移除该附件？')} onConfirm={() => void (async () => {
                            try {
                                await removeTaskAttachment(projectId, task.id, attachment.id, attachment.version);
                                message.success(t('附件已移除'));
                                await reload();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : t('操作失败'));
                            }
                        })()}><Button size="small" type="text" danger icon={<DeleteOutlined />} /></Popconfirm>}
                    </div>) : <small style={{ color: 'var(--cees-muted)' }}>{t('暂无附件')}</small>}
                </div>
            </section>

            <section>
                <div className="panel-heading"><h3><CalendarOutlined /> {t('评论')}</h3></div>
                <div className="task-comment-list">
                    {comments.length ? comments.map((comment) => <div className="task-comment-item" key={comment.id}>
                        <header><span>{comment.author?.displayName ?? comment.author?.account ?? '-'}</span><span>{formatDate(comment.createdAt ?? '')}</span></header>
                        <p>{comment.content}</p>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            {permissions.has('task.comment.update') && <Button size="small" type="text" onClick={() => {
                                const next = window.prompt(t('修改评论'), comment.content);
                                if (next && next.trim() && next !== comment.content) {
                                    void updateTaskComment(projectId, task.id, comment.id, next, comment.version)
                                        .then(() => { message.success(t('评论已更新')); return reload(); })
                                        .catch((error: unknown) => message.error(error instanceof Error ? error.message : t('操作失败')));
                                }
                            }}>{t('编辑')}</Button>}
                            {permissions.has('task.comment.delete') && <Button size="small" type="text" danger onClick={() => {
                                void deleteTaskComment(projectId, task.id, comment.id, comment.version)
                                    .then(() => { message.success(t('评论已删除')); return reload(); })
                                    .catch((error: unknown) => message.error(error instanceof Error ? error.message : t('操作失败')));
                            }}>{t('删除')}</Button>}
                        </div>
                    </div>) : <small style={{ color: 'var(--cees-muted)' }}>{t('暂无评论')}</small>}
                </div>
                {permissions.has('task.comment.create') && <div className="task-toolbar" style={{ marginTop: 8 }}>
                    <Input value={commentInput} onChange={(event) => setCommentInput(event.target.value)} onPressEnter={() => void submitComment()} placeholder={t('发表评论…')} />
                    <Button type="primary" onClick={() => void submitComment()}>{t('发送')}</Button>
                </div>}
            </section>

            <section>
                <div className="panel-heading"><h3>{t('动态')}</h3></div>
                <div className="task-activity-list">
                    {activities.length ? activities.map((activity) => <div className="task-activity-item" key={activity.id}>
                        <header><span>{activity.actor?.displayName ?? activity.actor?.account ?? t('系统')}</span><span>{formatDate(activity.createdAt ?? '')}</span></header>
                        <p>{activity.action}</p>
                    </div>) : <small style={{ color: 'var(--cees-muted)' }}>{t('暂无动态')}</small>}
                </div>
            </section>
        </div>

        <Modal open={editOpen} title={t('编辑任务')} okText={t('保存')} cancelText={t('取消')} onOk={() => void submitEdit()} onCancel={() => setEditOpen(false)}>
            <div className="form-grid">
                <label><span>{t('任务标题')}</span><Input value={editForm.title} onChange={(event) => setEditForm({ ...editForm, title: event.target.value })} /></label>
                <label><span>{t('任务说明')}</span><Input.TextArea rows={3} value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} /></label>
                <label><span>{t('父任务')}</span><Select allowClear placeholder={t('无（根任务）')} value={editForm.parentId ?? undefined} onChange={(value) => setEditForm({ ...editForm, parentId: value ?? null })} options={allTasks.filter((item) => item.id !== task.id).map((item) => ({ value: item.id, label: item.title }))} /></label>
                <label><span>{t('优先级')}</span><Select<TaskPriority> style={{ width: '100%' }} value={editForm.priority} onChange={(value) => setEditForm({ ...editForm, priority: value })} options={Object.entries(taskPriorityLabels).map(([value, label]) => ({ value: value as TaskPriority, label: t(label) }))} /></label>
            </div>
        </Modal>

        <Modal open={assigneeOpen} title={t('调整执行人')} okText={t('保存')} cancelText={t('取消')} onOk={() => void submitAssignees()} onCancel={() => setAssigneeOpen(false)}>
            <div className="form-grid">
                <label><span>{t('负责人')}</span><Select showSearch optionFilterProp="label" value={assigneeForm.ownerMembershipId || undefined} onChange={(value) => setAssigneeForm({ ...assigneeForm, ownerMembershipId: value })} options={activeMembers.map((member) => ({ value: member.id, label: `${member.user.displayName} (${member.account})` }))} /></label>
                <label><span>{t('协作人')}</span><Select mode="multiple" allowClear showSearch optionFilterProp="label" value={assigneeForm.collaboratorMembershipIds} onChange={(value) => setAssigneeForm({ ...assigneeForm, collaboratorMembershipIds: value })} options={activeMembers.map((member) => ({ value: member.id, label: `${member.user.displayName} (${member.account})` }))} /></label>
            </div>
        </Modal>

        <TransitionPromptModal
            open={transitionPrompt !== null}
            title={transitionPrompt ? t(`流转为${taskStatusLabels[transitionPrompt.to]}`) : ''}
            reasonKind={transitionPrompt?.reason ? t('原因') : t('备注')}
            value={transitionText}
            onChange={setTransitionText}
            onOk={() => void runTransition()}
            onCancel={() => setTransitionPrompt(null)}
        />
    </Modal>;
}
