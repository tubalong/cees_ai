import { PlusOutlined } from '@ant-design/icons';
import { Button, Empty, Select, Spin, Switch, Tag } from 'antd';
import { type TaskStatus, type TaskSummary } from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';
import { taskPriorityLabels, taskStatusColors, taskStatusLabels } from './project-constants';

interface ProjectTasksPanelProps {
    readOnly: boolean;
    tasks: TaskSummary[];
    tasksLoading: boolean;
    taskStatusFilter: TaskStatus | '';
    onTaskStatusFilter: (value: TaskStatus | '') => void;
    rootOnly: boolean;
    onToggleRootOnly: (value: boolean) => void;
    canCreateTask: boolean;
    onCreateTask: () => void;
    onTaskClick: (task: TaskSummary) => void;
}

export default function ProjectTasksPanel({
    readOnly, tasks, tasksLoading, taskStatusFilter, onTaskStatusFilter, rootOnly, onToggleRootOnly, canCreateTask, onCreateTask, onTaskClick,
}: ProjectTasksPanelProps): JSX.Element {
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
