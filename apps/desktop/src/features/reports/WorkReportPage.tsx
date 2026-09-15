import { DeleteOutlined, EditOutlined, FileTextOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Empty, Input, Modal, Popconfirm, Select, Spin, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
    createWorkReport, deleteWorkReport, hasStoredSession, listWorkReports,
    reviewWorkReport, submitWorkReport, updateWorkReport, withdrawWorkReport,
    type MeResult, type WorkReport, type WorkReportStatus, type WorkReportType,
} from '../../core/api';
import '../../styles/shared.css';
import { useDateFormatter, useI18n } from '../../core/i18n';

const reportTypeLabels: Record<WorkReportType, string> = { DAILY: '日报', WEEKLY: '周报' };
const reportStatusLabels: Record<WorkReportStatus, string> = { DRAFT: '草稿', SUBMITTED: '已提交', APPROVED: '已通过', REJECTED: '已驳回' };
const reportStatusColors: Record<WorkReportStatus, string> = { DRAFT: 'default', SUBMITTED: 'processing', APPROVED: 'success', REJECTED: 'error' };

interface WorkReportPageProps {
    authContext: MeResult;
    onSessionExpired: () => void;
}

export default function WorkReportPage({ authContext, onSessionExpired }: WorkReportPageProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const permissions = useMemo(() => new Set(authContext.permissions), [authContext.permissions]);

    const [typeFilter, setTypeFilter] = useState<WorkReportType | ''>('');
    const [statusFilter, setStatusFilter] = useState<WorkReportStatus | ''>('');
    const [createOpen, setCreateOpen] = useState(false);
    const [createForm, setCreateForm] = useState<{ type: WorkReportType; periodStart: string; content: string }>({ type: 'DAILY', periodStart: new Date().toISOString().slice(0, 10), content: '' });
    const [editing, setEditing] = useState<WorkReport | null>(null);
    const [editContent, setEditContent] = useState('');
    const [reviewPrompt, setReviewPrompt] = useState<{ report: WorkReport; approve: boolean } | null>(null);
    const [reviewComment, setReviewComment] = useState('');

    const reportsQuery = useQuery({
        queryKey: ['work-reports', typeFilter, statusFilter],
        queryFn: () => listWorkReports({ ...(typeFilter ? { type: typeFilter } : {}), ...(statusFilter ? { status: statusFilter } : {}) }),
    });

    useEffect(() => {
        if (reportsQuery.error && !hasStoredSession()) onSessionExpired();
    }, [reportsQuery.error, onSessionExpired]);

    const reports = reportsQuery.data?.items ?? [];
    const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['work-reports'] });

    const submitCreate = async (): Promise<void> => {
        if (!createForm.content.trim()) {
            message.warning(t('请填写报告内容'));
            return;
        }
        if (createForm.type === 'WEEKLY') {
            const day = new Date(`${createForm.periodStart}T00:00:00Z`).getUTCDay();
            if (day !== 1) {
                message.warning(t('周报的开始日期必须是周一'));
                return;
            }
        }
        try {
            await createWorkReport(createForm);
            message.success(t('报告已创建'));
            setCreateOpen(false);
            setCreateForm({ type: 'DAILY', periodStart: new Date().toISOString().slice(0, 10), content: '' });
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const openEdit = (report: WorkReport): void => {
        setEditing(report);
        setEditContent(report.content ?? '');
    };

    const submitEdit = async (): Promise<void> => {
        if (!editing) return;
        try {
            await updateWorkReport(editing.id, editContent, editing.version);
            message.success(t('报告已保存'));
            setEditing(null);
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const runReview = async (): Promise<void> => {
        if (!reviewPrompt) return;
        try {
            await reviewWorkReport(reviewPrompt.report.id, reviewPrompt.approve, reviewComment, reviewPrompt.report.version);
            message.success(reviewPrompt.approve ? t('报告已通过') : t('报告已驳回'));
            setReviewPrompt(null);
            setReviewComment('');
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    return <div className="workspace-page project-management-page">
        <header className="workspace-page-header">
            <div><h1>{t('工作报告')}</h1><p>{t('日报与周报的编写、提交、撤回与审核')}</p></div>
            <div className="header-actions"><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>{t('写报告')}</Button></div>
        </header>
        <div className="task-toolbar surface-panel" style={{ padding: 14 }}>
            <Select<WorkReportType | ''> placeholder={t('报告类型')} allowClear value={typeFilter || undefined} onChange={(value) => setTypeFilter(value ?? '')} style={{ width: 120 }} options={Object.entries(reportTypeLabels).map(([value, label]) => ({ value: value as WorkReportType, label: t(label) }))} />
            <Select<WorkReportStatus | ''> placeholder={t('状态')} allowClear value={statusFilter || undefined} onChange={(value) => setStatusFilter(value ?? '')} style={{ width: 120 }} options={Object.entries(reportStatusLabels).map(([value, label]) => ({ value: value as WorkReportStatus, label: t(label) }))} />
            <Input allowClear prefix={<SearchOutlined />} disabled placeholder={t('按内容搜索')} style={{ maxWidth: 220 }} />
        </div>
        <section className="surface-panel">
            {reportsQuery.isLoading ? <div className="data-loading"><Spin /></div> : reports.length ? <div className="task-list">
                {reports.map((report) => <div className="task-row-item" key={report.id} style={{ cursor: 'default' }}>
                    <FileTextOutlined />
                    <Tag>{t(reportTypeLabels[report.type])}</Tag>
                    <strong>{formatDate(report.periodStart)}{report.periodEnd ? ` ~ ${formatDate(report.periodEnd)}` : ''}</strong>
                    <Tag color={reportStatusColors[report.status]}>{t(reportStatusLabels[report.status])}</Tag>
                    <small>{report.author?.displayName ?? '-'}</small>
                    <span style={{ flex: 1 }} />
                    {(report.status === 'DRAFT' || report.status === 'REJECTED') && <>
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(report)}>{t('编辑')}</Button>
                        <Button size="small" type="primary" onClick={() => void (async () => {
                            try {
                                await submitWorkReport(report.id, report.version);
                                message.success(t('报告已提交'));
                                await refresh();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : t('操作失败'));
                            }
                        })()}>{t('提交')}</Button>
                        <Popconfirm title={t('确认删除该报告？')} onConfirm={() => void (async () => {
                            try {
                                await deleteWorkReport(report.id, report.version);
                                message.success(t('报告已删除'));
                                await refresh();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : t('操作失败'));
                            }
                        })()}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
                    </>}
                    {report.status === 'SUBMITTED' && <>
                        <Button size="small" onClick={() => void (async () => {
                            try {
                                await withdrawWorkReport(report.id, report.version);
                                message.success(t('报告已撤回'));
                                await refresh();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : t('操作失败'));
                            }
                        })()}>{t('撤回')}</Button>
                        <Button size="small" type="primary" onClick={() => { setReviewPrompt({ report, approve: true }); setReviewComment(''); }}>{t('通过')}</Button>
                        <Button size="small" danger onClick={() => { setReviewPrompt({ report, approve: false }); setReviewComment(''); }}>{t('驳回')}</Button>
                    </>}
                    {report.status === 'APPROVED' && <small>{report.reviewer ? `${t('审核人')} ${report.reviewer.displayName ?? ''}` : ''}</small>}
                </div>)}
            </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无报告')} />}
        </section>

        <Modal open={createOpen} title={t('写工作报告')} okText={t('创建草稿')} cancelText={t('取消')} onOk={() => void submitCreate()} onCancel={() => setCreateOpen(false)}>
            <div className="form-grid">
                <div className="form-row">
                    <label><span>{t('报告类型')}</span><Select<WorkReportType> style={{ width: '100%' }} value={createForm.type} onChange={(value) => setCreateForm({ ...createForm, type: value })} options={Object.entries(reportTypeLabels).map(([value, label]) => ({ value: value as WorkReportType, label: t(label) }))} /></label>
                    <label><span>{t('周期开始日期')}</span><input type="date" value={createForm.periodStart} onChange={(event) => setCreateForm({ ...createForm, periodStart: event.target.value })} /></label>
                </div>
                {createForm.type === 'WEEKLY' && <small style={{ color: 'var(--cees-muted)' }}>{t('周报开始日期必须是周一，结束日期由服务端按该周周日计算')}</small>}
                <label><span>{t('报告内容')}</span><Input.TextArea rows={8} value={createForm.content} onChange={(event) => setCreateForm({ ...createForm, content: event.target.value })} /></label>
            </div>
        </Modal>

        <Modal open={editing !== null} title={editing ? `${t('编辑')}${t(reportTypeLabels[editing.type])} · ${formatDate(editing.periodStart)}` : ''} okText={t('保存')} cancelText={t('取消')} onOk={() => void submitEdit()} onCancel={() => setEditing(null)}>
            <label className="form-grid"><span>{t('报告内容')}</span><Input.TextArea rows={8} value={editContent} onChange={(event) => setEditContent(event.target.value)} /></label>
        </Modal>

        <Modal open={reviewPrompt !== null} title={reviewPrompt?.approve ? t('审核通过') : t('驳回报告')} okText={t('确认')} cancelText={t('取消')} onOk={() => void runReview()} onCancel={() => setReviewPrompt(null)}>
            <label className="form-grid"><span>{t('审核意见')}</span><Input.TextArea rows={3} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder={t('驳回时建议填写意见')} /></label>
        </Modal>
    </div>;
}
