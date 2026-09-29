import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Card, Empty, Input, Modal, Progress, Select, Spin, Switch, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    createProject, createTask, deleteProject, hasStoredSession, listDepartments, listProjects,
    listProjectMembers, listTasks, listTenantMembers, transitionProject, transitionTask, updateProject,
    type CreateTaskInput, type MeResult, type PageAssistantContext, type ProjectStatus, type ProjectSummary,
    type ProjectTransitionAction, type TaskPriority, type TaskStatus, type TaskSummary,
} from '../../core/api';
import { useI18n } from '../../core/i18n';
import ProjectDetailPanel, { ProjectDetailPlaceholder } from './ProjectDetailPanel';
import ProjectFormModal, { type ProjectFormValues } from './ProjectFormModal';
import TaskDetailDrawer from './TaskDetailDrawer';
import TransitionPromptModal from './TransitionPromptModal';
import { isReadOnlyProject, projectStatusLabels, projectTransitions, taskPriorityLabels } from './project-constants';
import '../../styles/shared.css';
import './project.css';
import PageAssistant from '../assistant/PageAssistant';

interface TaskFormValues {
    title: string;
    description: string;
    parentId: string | null;
    priority: TaskPriority;
    dueDate: string;
    ownerMembershipId: string;
    collaboratorMembershipIds: string[];
}

const emptyTaskForm: TaskFormValues = {
    title: '', description: '', parentId: null, priority: 'MEDIUM', dueDate: '', ownerMembershipId: '', collaboratorMembershipIds: [],
};

interface ProjectManagementProps {
    authContext: MeResult;
    onSessionExpired: () => void;
}

/**
 * 项目管理页面：左侧项目列表 + 右侧项目详情。
 *
 * 项目编码与时间字段都由服务端管理，页面只负责展示；新建流程只提交项目资料、
 * 归属部门、负责人和初始成员。
 */
export default function ProjectManagement({ authContext, onSessionExpired }: ProjectManagementProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const permissions = useMemo(() => new Set(authContext.permissions), [authContext.permissions]);

    const [keyword, setKeyword] = useState('');
    const [statusFilter, setStatusFilter] = useState<ProjectStatus | ''>('');
    const [departmentFilter, setDepartmentFilter] = useState<string | undefined>(undefined);
    const [includeArchived, setIncludeArchived] = useState(false);
    const [selectedId, setSelectedId] = useState<string>();
    const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus | ''>('');
    const [rootOnly, setRootOnly] = useState(true);

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
    const [projectSubmitting, setProjectSubmitting] = useState(false);
    const [taskCreateOpen, setTaskCreateOpen] = useState(false);
    const [taskForm, setTaskForm] = useState<TaskFormValues>(emptyTaskForm);
    const [taskDetail, setTaskDetail] = useState<TaskSummary | null>(null);
    const [transitionPrompt, setTransitionPrompt] = useState<{ kind: 'project' | 'task'; action: string; label: string; requires: 'reason' | 'summary' } | null>(null);
    const [transitionText, setTransitionText] = useState('');

    const activeMembers = (membersQuery.data?.items ?? []).filter((member) => member.status === 'ACTIVE');
    const allTasks = allTasksQuery.data?.items ?? [];
    const refreshProjects = () => void queryClient.invalidateQueries({ queryKey: ['projects'] });
    const refreshMembers = () => void queryClient.invalidateQueries({ queryKey: ['project-members'] });
    const refreshTasks = () => void queryClient.invalidateQueries({ queryKey: ['project-tasks', 'project-tasks-all'] });

    const openCreateProject = (): void => setProjectModal({ open: true });

    const openEditProject = (): void => {
        if (selected) setProjectModal({ open: true, editing: selected });
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
            setSelectedId(created.id);
            refreshProjects();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        } finally {
            setProjectSubmitting(false);
        }
    };

    const handleDeleteProject = async (): Promise<void> => {
        if (!selected) return;
        try {
            await deleteProject(selected.id, selected.version);
            message.success(t('项目已删除'));
            setSelectedId(undefined);
            refreshProjects();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const runProjectTransition = async (action: ProjectTransitionAction, reason: string): Promise<void> => {
        if (!selected) return;
        if ((action === 'reopen' || action === 'cancel') && !reason.trim()) {
            message.warning(t('请填写原因'));
            return;
        }
        try {
            await transitionProject(selected.id, action, {
                version: selected.version,
                ...(action === 'complete' ? { completionSummary: reason } : {}),
                ...(action === 'reopen' || action === 'cancel' ? { reason } : {}),
            });
            message.success(t('状态已更新'));
            setTransitionPrompt(null);
            setTransitionText('');
            refreshProjects();
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
        void runProjectTransition(action, '');
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
            setTaskForm(emptyTaskForm);
            refreshTasks();
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
            refreshTasks();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const readOnly = selected ? isReadOnlyProject(selected.status) : false;
    const pageAssistantContext: PageAssistantContext = {
        source: 'project-management',
        role: '项目管理助手',
        selected: selected ? { id: selected.id, name: selected.name, code: selected.code, status: selected.status } : undefined,
        summary: selected ? { memberCount: selected.memberCount ?? 0, taskCount: selected.taskCount ?? 0, visibleTaskCount: tasksQuery.data?.items.length ?? 0 } : { projectCount: projects.length },
    };
    const activeProjectCount = projects.filter((project) => project.status === 'ACTIVE').length;
    const overdueTaskCount = allTasks.filter((task) => task.dueDate && new Date(task.dueDate).getTime() < Date.now() && !['DONE', 'CANCELLED'].includes(task.status)).length;
    const completionRate = allTasks.length ? Math.round((allTasks.filter((task) => task.status === 'DONE').length / allTasks.length) * 100) : 0;

    return <div className="workspace-page project-management-page">
        <header className="workspace-page-header">
            <div><h1>{t('项目管理')}</h1><p>{t('项目全生命周期：规划、执行、暂停、完成与归档')}</p></div>
            {permissions.has('project.create') && <div className="header-actions"><Button type="primary" icon={<PlusOutlined />} onClick={openCreateProject}>{t('新建项目')}</Button></div>}
        </header>
        <section className="project-signal-grid">
            <Card variant="borderless"><span>当前项目</span><strong>{projects.length}</strong><small>{activeProjectCount} 个进行中</small></Card>
            <Card variant="borderless"><span>当前任务</span><strong>{selected ? allTasks.length : '-'}</strong><small>{overdueTaskCount ? `${overdueTaskCount} 个逾期` : '暂无逾期'}</small></Card>
            <Card variant="borderless"><span>完成进度</span><Progress type="circle" percent={completionRate} size={54} strokeColor="var(--primary)" /><small>{selected ? selected.name : '选择项目查看'}</small></Card>
            <Card variant="borderless"><span>协作状态</span><Tag color={selected ? 'processing' : 'default'}>{selected ? '已连接项目上下文' : '等待选择项目'}</Tag><small>可直接询问 AI</small></Card>
        </section>
        <div className="project-layout">
            <aside className="surface-panel project-list-panel">
                <div className="task-toolbar">
                    <Input allowClear prefix={<SearchOutlined />} placeholder={t('搜索项目')} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                    <Select<ProjectStatus | ''> allowClear placeholder={t('状态')} value={statusFilter || undefined} onChange={(value) => setStatusFilter(value ?? '')} style={{ width: 120 }} options={Object.entries(projectStatusLabels).map(([value, label]) => ({ value: value as ProjectStatus, label: t(label) }))} />
                </div>
                <div className="task-toolbar">
                    <Select allowClear showSearch optionFilterProp="label" placeholder={t('归属部门')} value={departmentFilter} onChange={setDepartmentFilter} style={{ width: 200 }} loading={departmentsQuery.isLoading} options={departments.map((department) => ({ value: department.id, label: department.name }))} />
                    <label className="inline-switch" style={{ fontSize: 12, color: 'var(--cees-muted)' }}>
                        <Switch size="small" checked={includeArchived} onChange={setIncludeArchived} />{t('包含已归档')}
                    </label>
                </div>
                {projectsQuery.isLoading ? <div className="data-loading"><Spin /></div> : projects.length ? <div className="project-list">
                    {projects.map((project) => <button className={`project-row ${selected?.id === project.id ? 'is-selected' : ''}`} type="button" key={project.id} onClick={() => setSelectedId(project.id)}>
                        <strong>{project.name}</strong>
                        <small>{project.code} · {t(projectStatusLabels[project.status])} · {t('成员')} {project.memberCount ?? 0} · {t('任务')} {project.taskCount ?? 0}</small>
                    </button>)}
                </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无可见项目')} />}
            </aside>
            <section className="surface-panel project-detail-panel">
                {selected ? <ProjectDetailPanel
                    project={selected}
                    permissions={permissions}
                    readOnly={readOnly}
                    myMembershipId={authContext.membership.id}
                    activeMembers={activeMembers}
                    departments={departments}
                    projectMembers={projectMembersQuery.data?.items ?? []}
                    tasks={tasksQuery.data?.items ?? []}
                    tasksLoading={tasksQuery.isLoading}
                    taskStatusFilter={taskStatusFilter}
                    onTaskStatusFilter={setTaskStatusFilter}
                    rootOnly={rootOnly}
                    onToggleRootOnly={setRootOnly}
                    canCreateTask={permissions.has('task.create')}
                    onCreateTask={() => { setTaskForm(emptyTaskForm); setTaskCreateOpen(true); }}
                    onTaskClick={setTaskDetail}
                    onEdit={openEditProject}
                    onTransition={handleProjectTransition}
                    onDelete={() => void handleDeleteProject()}
                    onRefreshMembers={refreshMembers}
                    onRefreshTasks={refreshTasks}
                /> : <ProjectDetailPlaceholder />}
            </section>
        </div>

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
            onOk={() => void (transitionPrompt?.kind === 'project'
                ? runProjectTransition(transitionPrompt.action as ProjectTransitionAction, transitionText)
                : runTaskTransition())}
            onCancel={() => setTransitionPrompt(null)}
        />

        {selected && taskDetail && <TaskDetailDrawer
            projectId={selected.id}
            task={taskDetail}
            permissions={permissions}
            activeMembers={activeMembers}
            allTasks={allTasks}
            onClose={() => setTaskDetail(null)}
            onRefreshTasks={refreshTasks}
        />}
        <PageAssistant
            context={pageAssistantContext}
            suggestions={['查看当前项目进度', '找出延期风险任务', '把任务分配给某位成员', '把部门成员加入当前项目']}
            onExpand={(context, conversationId) => navigate('/', { state: { ...(conversationId ? { conversationId } : { createNewConversation: true }), forceChat: true, assistantContext: context } })}
        />
    </div>;
}
