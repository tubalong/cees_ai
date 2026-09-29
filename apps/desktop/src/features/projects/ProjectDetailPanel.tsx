import { DeleteOutlined, DownOutlined, EditOutlined } from '@ant-design/icons';
import { Button, Dropdown, Empty, Popconfirm, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import type { DepartmentNode, ProjectMemberSummary, ProjectSummary, ProjectTransitionAction, TaskStatus, TaskSummary, TenantMember } from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';
import ProjectMembersPanel from './ProjectMembersPanel';
import ProjectTasksPanel from './ProjectTasksPanel';
import { projectMemberRoleLabels, projectStatusColors, projectStatusLabels, projectTransitions } from './project-constants';

interface ProjectDetailPanelProps {
    project: ProjectSummary;
    permissions: Set<string>;
    readOnly: boolean;
    myMembershipId: string;
    activeMembers: TenantMember[];
    departments: DepartmentNode[];
    projectMembers: ProjectMemberSummary[];
    tasks: TaskSummary[];
    tasksLoading: boolean;
    taskStatusFilter: TaskStatus | '';
    onTaskStatusFilter: (value: TaskStatus | '') => void;
    rootOnly: boolean;
    onToggleRootOnly: (value: boolean) => void;
    canCreateTask: boolean;
    onCreateTask: () => void;
    onTaskClick: (task: TaskSummary) => void;
    onEdit: () => void;
    onTransition: (action: ProjectTransitionAction) => void;
    onDelete: () => void;
    onRefreshMembers: () => void;
    onRefreshTasks: () => void;
}

/** 项目详情区：项目资料、系统时间戳、状态操作和任务 / 成员分页。 */
export default function ProjectDetailPanel(props: ProjectDetailPanelProps): JSX.Element {
    const {
        project, permissions, readOnly, myMembershipId, activeMembers, departments, projectMembers,
        tasks, tasksLoading, taskStatusFilter, onTaskStatusFilter, rootOnly, onToggleRootOnly,
        canCreateTask, onCreateTask, onTaskClick, onEdit, onTransition, onDelete, onRefreshMembers, onRefreshTasks,
    } = props;
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const [tab, setTab] = useState<'tasks' | 'members'>('tasks');
    const transitions = projectTransitions[project.status];
    const hasTasks = (project.taskCount ?? 0) > 0;
    const departmentName = project.departmentId
        ? departments.find((department) => department.id === project.departmentId)?.name ?? '-'
        : '-';
    const isOwner = project.currentMemberRole === 'OWNER';

    return <>
        <div className="project-detail-header">
            <div>
                <h2>{project.name} <Tag color={projectStatusColors[project.status]}>{t(projectStatusLabels[project.status])}</Tag></h2>
                <small className="project-detail-subtitle">{project.code}{project.description ? ` · ${project.description}` : ''}</small>
            </div>
            <div className="header-actions">
                {!readOnly && permissions.has('project.update') && <Button icon={<EditOutlined />} onClick={onEdit}>{t('编辑')}</Button>}
                {!readOnly && permissions.has('project.update') && transitions.length > 0 && <Dropdown
                    menu={{
                        items: transitions.map((option) => ({ key: option.action, label: t(option.label) })),
                        onClick: ({ key }) => onTransition(key as ProjectTransitionAction),
                    }}
                >
                    <Button type={transitions.some((option) => option.action === 'complete') ? 'primary' : 'default'}>{t('状态操作')} <DownOutlined /></Button>
                </Dropdown>}
                {!readOnly && permissions.has('project.delete') && isOwner && <Tooltip title={hasTasks ? t('项目已有任务，不能删除，请完成或归档项目') : undefined}><span><Popconfirm disabled={hasTasks} title={t('确认删除该项目？')} onConfirm={onDelete}><Button danger disabled={hasTasks} icon={<DeleteOutlined />} /></Popconfirm></span></Tooltip>}
            </div>
        </div>
        <dl className="project-meta-grid">
            <div><dt>{t('项目编码')}</dt><dd>{project.code}</dd></div>
            <div><dt>{t('负责人')}</dt><dd>{project.owner?.displayName ?? '-'}</dd></div>
            <div><dt>{t('我的角色')}</dt><dd>{project.currentMemberRole ? t(projectMemberRoleLabels[project.currentMemberRole]) : '-'}</dd></div>
            <div><dt>{t('归属部门')}</dt><dd>{departmentName}</dd></div>
            <div><dt>{t('首次启动时间')}</dt><dd>{project.startedAt ? formatDate(project.startedAt) : '-'}</dd></div>
            <div><dt>{t('完成时间')}</dt><dd>{project.completedAt ? formatDate(project.completedAt) : '-'}</dd></div>
            <div><dt>{t('关闭时间')}</dt><dd>{project.closedAt ? formatDate(project.closedAt) : '-'}</dd></div>
            <div><dt>{t('创建时间')}</dt><dd>{project.createdAt ? formatDate(project.createdAt) : '-'}</dd></div>
            <div><dt>{t('当前版本')}</dt><dd>v{project.version}</dd></div>
        </dl>
        <div className="category-tabs">
            <button className={tab === 'tasks' ? 'is-active' : ''} type="button" onClick={() => setTab('tasks')}>{t('任务')}</button>
            <button className={tab === 'members' ? 'is-active' : ''} type="button" onClick={() => setTab('members')}>{t('项目成员')}</button>
        </div>
        {tab === 'tasks'
            ? <ProjectTasksPanel
                readOnly={readOnly}
                tasks={tasks}
                tasksLoading={tasksLoading}
                taskStatusFilter={taskStatusFilter}
                onTaskStatusFilter={onTaskStatusFilter}
                rootOnly={rootOnly}
                onToggleRootOnly={onToggleRootOnly}
                canCreateTask={canCreateTask}
                onCreateTask={onCreateTask}
                onTaskClick={onTaskClick}
            />
            : <ProjectMembersPanel
                projectId={project.id}
                permissions={permissions}
                readOnly={readOnly}
                myMembershipId={myMembershipId}
                activeMembers={activeMembers}
                projectMembers={projectMembers}
                projectVersion={project.version}
                onRefreshMembers={onRefreshMembers}
            />}
    </>;
}

/** 未选中项目时的占位内容。 */
export function ProjectDetailPlaceholder(): JSX.Element {
    const { t } = useI18n();
    return <Empty description={t('请选择项目')} />;
}
