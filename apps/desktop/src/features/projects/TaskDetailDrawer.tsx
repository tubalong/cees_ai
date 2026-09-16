import {
    CalendarOutlined, DeleteOutlined, EditOutlined, FileDoneOutlined, PaperClipOutlined, PlusOutlined, TeamOutlined,
} from '@ant-design/icons';
import { App as AntdApp, Button, Drawer, Input, Modal, Popconfirm, Select, Tag, Upload } from 'antd';
import { useEffect, useState } from 'react';
import {
    addTaskAttachment, createTaskComment, deleteTask, deleteTaskComment, getTask, listTaskActivities,
    listTaskAttachments, listTaskComments, removeTaskAttachment, replaceTaskAssignees, transitionTask,
    updateTask, updateTaskComment, uploadAttachmentFile,
    type TaskActivity, type TaskAttachment, type TaskComment, type TaskPriority, type TaskStatus, type TaskSummary, type TenantMember,
} from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';
import { taskPriorityLabels, taskStatusColors, taskStatusLabels, taskTransitions } from './project-constants';
import TransitionPromptModal from './TransitionPromptModal';

export default function TaskDetailDrawer({ projectId, task, permissions, activeMembers, allTasks, onClose, onRefreshTasks }: { projectId: string; task: TaskSummary; permissions: Set<string>; activeMembers: TenantMember[]; allTasks: TaskSummary[]; onClose: () => void; onRefreshTasks: () => void }): JSX.Element {
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

    return <Drawer open width={760} title={<span>{current.title} <Tag color={taskStatusColors[current.status]}>{t(taskStatusLabels[current.status])}</Tag> <Tag>{t(taskPriorityLabels[current.priority])}</Tag></span>} onClose={onClose}>
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
    </Drawer>;
}
