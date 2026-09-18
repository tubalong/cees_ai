import { CheckCircleOutlined, ClockCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Empty, Input, Modal, Popconfirm, Select, Spin, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
    addMeetingParticipant, createMeeting, deleteMeeting, getMeetingMinutes, hasStoredSession,
    listMeetingParticipants, listMeetings, listTenantMembers, publishMeetingMinutes,
    removeMeetingParticipant, reopenMeetingMinutes, respondMeetingInvitation, transitionMeeting,
    updateMeeting, updateMeetingParticipant, upsertMeetingMinutes,
    type CreateMeetingInput, type MeResult, type Meeting, type MeetingAttendanceStatus,
    type MeetingMinutes, type MeetingMinutesContent, type MeetingParticipant, type MeetingParticipantRole,
    type MeetingResponseStatus, type MeetingStatus, type TenantMember,
} from '../../core/api';
import '../../styles/shared.css';
import './meeting.css';
import { useDateFormatter, useI18n } from '../../core/i18n';

const meetingStatusLabels: Record<MeetingStatus, string> = {
    DRAFT: '草稿', SCHEDULED: '已安排', IN_PROGRESS: '进行中', COMPLETED: '已完成', CANCELLED: '已取消',
};

const meetingStatusColors: Record<MeetingStatus, string> = {
    DRAFT: 'default', SCHEDULED: 'processing', IN_PROGRESS: 'warning', COMPLETED: 'success', CANCELLED: 'error',
};

const participantRoleLabels: Record<MeetingParticipantRole, string> = { HOST: '主持人', RECORDER: '记录人', PARTICIPANT: '参会人' };
const responseStatusLabels: Record<MeetingResponseStatus, string> = { INVITED: '待回应', ACCEPTED: '已接受', DECLINED: '已拒绝', TENTATIVE: '待定' };
const attendanceStatusLabels: Record<MeetingAttendanceStatus, string> = { PENDING: '未登记', ATTENDED: '已出席', ABSENT: '缺席' };

interface MeetingTransitionOption {
    to: MeetingStatus;
    label: string;
    reason?: boolean;
}

const meetingTransitions: Record<MeetingStatus, MeetingTransitionOption[]> = {
    DRAFT: [
        { to: 'SCHEDULED', label: '安排会议' },
        { to: 'CANCELLED', label: '取消', reason: true },
    ],
    SCHEDULED: [
        { to: 'IN_PROGRESS', label: '开始会议' },
        { to: 'CANCELLED', label: '取消', reason: true },
    ],
    IN_PROGRESS: [{ to: 'COMPLETED', label: '结束会议' }],
    COMPLETED: [],
    CANCELLED: [],
};

interface MeetingFormValues {
    title: string;
    startsAt: string;
    startsAtTime: string;
    durationMinutes: number;
    description: string;
    location: string;
    meetingUrl: string;
}

interface MeetingManagementProps {
    authContext: MeResult;
    onSessionExpired: () => void;
}

export default function MeetingManagement({ authContext, onSessionExpired }: MeetingManagementProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const permissions = useMemo(() => new Set(authContext.permissions), [authContext.permissions]);

    const [keyword, setKeyword] = useState('');
    const [statusFilter, setStatusFilter] = useState<MeetingStatus | ''>('');
    const [createOpen, setCreateOpen] = useState(false);
    const [form, setForm] = useState<MeetingFormValues>({ title: '', startsAt: '', startsAtTime: '09:00', durationMinutes: 60, description: '', location: '', meetingUrl: '' });
    const [detail, setDetail] = useState<Meeting | null>(null);

    const meetingsQuery = useQuery({
        queryKey: ['meetings', keyword, statusFilter],
        queryFn: () => listMeetings({ keyword, ...(statusFilter ? { status: statusFilter } : {}) }),
    });
    const membersQuery = useQuery({ queryKey: ['tenant-members'], queryFn: () => listTenantMembers() });

    useEffect(() => {
        if (meetingsQuery.error && !hasStoredSession()) onSessionExpired();
    }, [meetingsQuery.error, onSessionExpired]);

    const meetings = meetingsQuery.data?.items ?? [];
    const activeMembers = (membersQuery.data?.items ?? []).filter((member) => member.status === 'ACTIVE');

    const submitCreate = async (): Promise<void> => {
        if (!form.title.trim() || !form.startsAt) {
            message.warning(t('请填写会议标题和开始日期'));
            return;
        }
        const input: CreateMeetingInput = {
            title: form.title,
            startsAt: new Date(`${form.startsAt}T${form.startsAtTime || '09:00'}:00Z`).toISOString(),
            durationMinutes: form.durationMinutes,
            ...(form.description.trim() ? { description: form.description } : {}),
            ...(form.location.trim() ? { location: form.location } : {}),
            ...(form.meetingUrl.trim() ? { meetingUrl: form.meetingUrl } : {}),
        };
        try {
            await createMeeting(input);
            message.success(t('会议已创建'));
            setCreateOpen(false);
            setForm({ title: '', startsAt: '', startsAtTime: '09:00', durationMinutes: 60, description: '', location: '', meetingUrl: '' });
            await queryClient.invalidateQueries({ queryKey: ['meetings'] });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    return <div className="workspace-page project-management-page">
        <header className="workspace-page-header">
            <div><h1>{t('会议管理')}</h1><p>{t('会议全流程：安排、进行、纪要与决议沉淀')}</p></div>
            {permissions.has('meeting.create') && <div className="header-actions"><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>{t('新建会议')}</Button></div>}
        </header>
        <div className="task-toolbar surface-panel" style={{ padding: 14 }}>
            <Input allowClear prefix={<SearchOutlined />} placeholder={t('搜索会议')} value={keyword} onChange={(event) => setKeyword(event.target.value)} style={{ maxWidth: 260 }} />
            <Select<MeetingStatus | ''> allowClear placeholder={t('状态')} value={statusFilter || undefined} onChange={(value) => setStatusFilter(value ?? '')} style={{ width: 130 }} options={Object.entries(meetingStatusLabels).map(([value, label]) => ({ value: value as MeetingStatus, label: t(label) }))} />
        </div>
        <section className="surface-panel">
            {meetingsQuery.isLoading ? <div className="data-loading"><Spin /></div> : meetings.length ? <div className="task-list">
                {meetings.map((meeting) => <button className="task-row-item" type="button" key={meeting.id} onClick={() => setDetail(meeting)}>
                    <Tag color={meetingStatusColors[meeting.status]}>{t(meetingStatusLabels[meeting.status])}</Tag>
                    <strong>{meeting.title}</strong>
                    <small><ClockCircleOutlined /> {formatDate(meeting.startsAt)} · {meeting.durationMinutes}{t('分钟')}</small>
                    <small><TeamOutlined /> {meeting.participantCount ?? 0}</small>
                    {meeting.myResponseStatus && <Tag>{t(responseStatusLabels[meeting.myResponseStatus])}</Tag>}
                </button>)}
            </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无可见会议')} />}
        </section>

        <Modal open={createOpen} title={t('新建会议')} okText={t('创建')} cancelText={t('取消')} onOk={() => void submitCreate()} onCancel={() => setCreateOpen(false)}>
            <div className="form-grid">
                <label><span>{t('会议标题')}</span><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
                <div className="form-row">
                    <label><span>{t('开始日期')}</span><input type="date" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
                    <label><span>{t('开始时间')}</span><input type="time" value={form.startsAtTime} onChange={(event) => setForm({ ...form, startsAtTime: event.target.value })} /></label>
                    <label><span>{t('时长（分钟）')}</span><input type="number" min={5} step={5} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) || 60 })} /></label>
                </div>
                <label><span>{t('会议说明')}</span><Input.TextArea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
                <div className="form-row">
                    <label><span>{t('线下地点')}</span><Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></label>
                    <label><span>{t('线上会议链接')}</span><Input value={form.meetingUrl} onChange={(event) => setForm({ ...form, meetingUrl: event.target.value })} /></label>
                </div>
            </div>
        </Modal>

        {detail && <MeetingDetailModal meeting={detail} myMembershipId={authContext.membership.id} permissions={permissions} activeMembers={activeMembers} onClose={() => setDetail(null)} onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['meetings'] })} />}
    </div>;
}

function MeetingDetailModal({ meeting, myMembershipId, permissions, activeMembers, onClose, onRefresh }: { meeting: Meeting; myMembershipId: string; permissions: Set<string>; activeMembers: TenantMember[]; onClose: () => void; onRefresh: () => void }): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const [tab, setTab] = useState<'info' | 'participants' | 'minutes'>('info');
    const [current, setCurrent] = useState<Meeting>(meeting);
    const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
    const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [editForm, setEditForm] = useState<MeetingFormValues>({
        title: meeting.title, startsAt: meeting.startsAt.slice(0, 10), startsAtTime: meeting.startsAt.slice(11, 16),
        durationMinutes: meeting.durationMinutes, description: meeting.description ?? '', location: meeting.location ?? '', meetingUrl: meeting.meetingUrl ?? '',
    });
    const [addTarget, setAddTarget] = useState<string>();
    const [transitionPrompt, setTransitionPrompt] = useState<MeetingTransitionOption | null>(null);
    const [transitionText, setTransitionText] = useState('');
    const [minutesDraft, setMinutesDraft] = useState<MeetingMinutesContent>({ summary: '', decisions: [], actionItems: [], notes: '' });

    const reload = async (): Promise<void> => {
        const [detailResult, participantList, minutesResult] = await Promise.all([
            listMeetings({ keyword: current.title }).catch(() => null),
            listMeetingParticipants(meeting.id),
            getMeetingMinutes(meeting.id).catch(() => null),
        ]);
        const matched = detailResult?.items.find((item) => item.id === meeting.id);
        if (matched) setCurrent(matched);
        setParticipants(participantList.items);
        setMinutes(minutesResult);
        onRefresh();
    };

    useEffect(() => {
        void (async () => {
            try {
                const [participantList, minutesResult] = await Promise.all([
                    listMeetingParticipants(meeting.id),
                    getMeetingMinutes(meeting.id).catch(() => null),
                ]);
                setParticipants(participantList.items);
                setMinutes(minutesResult);
            } catch {
                // 详情加载失败时保持列表数据
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meeting.id]);

    const editable = current.status === 'DRAFT' || current.status === 'SCHEDULED';
    const participantIds = new Set(participants.map((participant) => participant.member.membershipId));
    const myParticipant = participants.find((participant) => participant.member.membershipId === myMembershipId);

    const submitEdit = async (): Promise<void> => {
        try {
            await updateMeeting(meeting.id, {
                title: editForm.title,
                startsAt: new Date(`${editForm.startsAt}T${editForm.startsAtTime || '09:00'}:00Z`).toISOString(),
                durationMinutes: editForm.durationMinutes,
                description: editForm.description,
                location: editForm.location,
                meetingUrl: editForm.meetingUrl,
                version: current.version,
            });
            message.success(t('会议已更新'));
            setEditOpen(false);
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const runTransition = async (): Promise<void> => {
        if (!transitionPrompt) return;
        if (transitionPrompt.reason && !transitionText.trim()) {
            message.warning(t('请填写取消原因'));
            return;
        }
        try {
            const updated = await transitionMeeting(meeting.id, transitionPrompt.to, current.version, transitionPrompt.reason ? transitionText : undefined);
            setCurrent(updated);
            message.success(t('状态已更新'));
            setTransitionPrompt(null);
            setTransitionText('');
            onRefresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const saveMinutes = async (): Promise<void> => {
        try {
            await upsertMeetingMinutes(meeting.id, minutesDraft, minutes?.status === 'DRAFT' ? minutes.version : undefined);
            message.success(t('纪要已保存'));
            await reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('操作失败'));
        }
    };

    const openMinutesEditor = (): void => {
        setMinutesDraft(minutes?.content ?? { summary: '', decisions: [], actionItems: [], notes: '' });
        setTab('minutes');
    };

    return <Modal open width={760} title={<span>{current.title} <Tag color={meetingStatusColors[current.status]}>{t(meetingStatusLabels[current.status])}</Tag></span>} footer={null} onCancel={onClose}>
        <div className="task-detail-sections">
            <div className="task-toolbar">
                {editable && permissions.has('meeting.update') && <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>{t('编辑资料')}</Button>}
                {permissions.has('meeting.status.update') && meetingTransitions[current.status].map((option) => <Button key={option.to} type={option.to === 'SCHEDULED' || option.to === 'COMPLETED' ? 'primary' : 'default'} onClick={() => {
                    setTransitionPrompt(option);
                    setTransitionText('');
                }}>{t(option.label)}</Button>)}
                {current.status === 'DRAFT' && permissions.has('meeting.delete') && <Popconfirm title={t('确认删除该会议草稿？')} onConfirm={() => void (async () => {
                    try {
                        await deleteMeeting(meeting.id, current.version);
                        message.success(t('会议已删除'));
                        onClose();
                        onRefresh();
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : t('操作失败'));
                    }
                })()}><Button danger icon={<DeleteOutlined />} /></Popconfirm>}
            </div>

            {myParticipant && current.status === 'SCHEDULED' && <div className="task-toolbar">
                <span style={{ fontSize: 13 }}>{t('邀请应答：')}</span>
                {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as MeetingResponseStatus[]).map((status) => <Button key={status} size="small" type={myParticipant.responseStatus === status ? 'primary' : 'default'} onClick={() => void (async () => {
                    try {
                        await respondMeetingInvitation(meeting.id, status, myParticipant.version);
                        message.success(t('应答已提交'));
                        await reload();
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : t('操作失败'));
                    }
                })()}>{t(responseStatusLabels[status])}</Button>)}
            </div>}

            <dl className="project-meta-grid">
                <div><dt>{t('开始时间')}</dt><dd>{formatDate(current.startsAt)}</dd></div>
                <div><dt>{t('时长')}</dt><dd>{current.durationMinutes} {t('分钟')}</dd></div>
                <div><dt>{t('组织者')}</dt><dd>{current.organizer?.displayName ?? '-'}</dd></div>
                <div><dt>{t('我的角色')}</dt><dd>{current.myRole ? t(participantRoleLabels[current.myRole]) : '-'}</dd></div>
                <div><dt>{t('我的应答')}</dt><dd>{current.myResponseStatus ? t(responseStatusLabels[current.myResponseStatus]) : '-'}</dd></div>
                <div><dt>{t('当前版本')}</dt><dd>v{current.version}</dd></div>
            </dl>
            {current.location && <small><CheckCircleOutlined /> {t('地点')}：{current.location}</small>}
            {current.meetingUrl && <small><CheckCircleOutlined /> {t('会议链接')}：{current.meetingUrl}</small>}
            {current.description && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{current.description}</p>}
            {current.agenda?.length ? <section>
                <div className="panel-heading"><h3>{t('会议议程')}</h3></div>
                {current.agenda.map((item, index) => <div className="task-activity-item" key={`${item.title}-${index}`}><header><span>{index + 1}. {item.title}</span></header>{item.description && <p>{item.description}</p>}</div>)}
            </section> : null}

            <div className="category-tabs">
                <button className={tab === 'participants' ? 'is-active' : ''} type="button" onClick={() => setTab('participants')}>{t('参会人')}</button>
                <button className={tab === 'minutes' ? 'is-active' : ''} type="button" onClick={() => setTab('minutes')}>{t('会议纪要')}</button>
            </div>

            {tab === 'participants' && <>
                <div className="task-toolbar">
                    {permissions.has('meeting.participant.manage') && (current.status === 'DRAFT' || current.status === 'SCHEDULED') && <>
                        <Select showSearch allowClear optionFilterProp="label" placeholder={t('添加参会人')} value={addTarget} onChange={setAddTarget} style={{ minWidth: 220 }} options={activeMembers.filter((member) => !participantIds.has(member.id)).map((member) => ({ value: member.id, label: `${member.user.displayName} (${member.account})` }))} />
                        <Button type="primary" disabled={!addTarget} onClick={() => void (async () => {
                            if (!addTarget) return;
                            try {
                                await addMeetingParticipant(meeting.id, addTarget);
                                message.success(t('参会人已添加'));
                                setAddTarget(undefined);
                                await reload();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : t('操作失败'));
                            }
                        })()}>{t('添加')}</Button>
                    </>}
                    <span style={{ flex: 1 }} />
                    <small style={{ color: 'var(--muted)' }}><TeamOutlined /> {participants.length}</small>
                </div>
                <div className="task-list">
                    {participants.map((participant) => <div className="task-row-item" key={participant.id} style={{ cursor: 'default' }}>
                        <strong>{participant.member.displayName ?? participant.member.account}</strong>
                        <Tag color={participant.role === 'HOST' ? 'gold' : participant.role === 'RECORDER' ? 'blue' : 'default'}>{t(participantRoleLabels[participant.role])}</Tag>
                        <Tag>{t(responseStatusLabels[participant.responseStatus])}</Tag>
                        {current.status === 'IN_PROGRESS' && permissions.has('meeting.participant.manage') && <Select<MeetingAttendanceStatus> size="small" value={participant.attendanceStatus ?? 'PENDING'} style={{ width: 110 }} options={Object.entries(attendanceStatusLabels).map(([value, label]) => ({ value: value as MeetingAttendanceStatus, label: t(label) }))} onChange={(value) => void (async () => {
                            try {
                                await updateMeetingParticipant(meeting.id, participant.member.membershipId, { attendanceStatus: value, version: participant.version });
                                message.success(t('出席状态已登记'));
                                await reload();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : t('操作失败'));
                            }
                        })()} />}
                        {participant.role !== 'HOST' && permissions.has('meeting.participant.manage') && (current.status === 'DRAFT' || current.status === 'SCHEDULED') && <Popconfirm title={t('确认移除该参会人？')} onConfirm={() => void (async () => {
                            try {
                                await removeMeetingParticipant(meeting.id, participant.member.membershipId, participant.version);
                                message.success(t('参会人已移除'));
                                await reload();
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : t('操作失败'));
                            }
                        })()}><Button size="small" danger type="text" icon={<DeleteOutlined />} /></Popconfirm>}
                    </div>)}
                </div>
            </>}

            {tab === 'minutes' && <>
                <div className="task-toolbar">
                    {permissions.has('meeting.minutes.manage') && <Button icon={<EditOutlined />} onClick={openMinutesEditor}>{minutes ? t('编辑纪要草稿') : t('创建纪要')}</Button>}
                    {minutes?.status === 'DRAFT' && permissions.has('meeting.minutes.manage') && <Button type="primary" onClick={() => void (async () => {
                        try {
                            await publishMeetingMinutes(meeting.id, minutes.version);
                            message.success(t('纪要已发布'));
                            await reload();
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : t('操作失败'));
                        }
                    })()}>{t('发布纪要')}</Button>}
                    {minutes?.status === 'PUBLISHED' && permissions.has('meeting.minutes.manage') && <Button onClick={() => void (async () => {
                        try {
                            await reopenMeetingMinutes(meeting.id, minutes.version);
                            message.success(t('纪要已重新打开为草稿'));
                            await reload();
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : t('操作失败'));
                        }
                    })()}>{t('重新打开纪要')}</Button>}
                    {minutes && <Tag color={minutes.status === 'PUBLISHED' ? 'success' : 'default'}>{minutes.status === 'PUBLISHED' ? t('已发布') : t('草稿')}</Tag>}
                </div>
                <div className="form-grid">
                    <label><span>{t('总结')}</span><Input.TextArea rows={3} disabled={minutes?.status === 'PUBLISHED'} value={minutesDraft.summary ?? ''} onChange={(event) => setMinutesDraft({ ...minutesDraft, summary: event.target.value })} /></label>
                    <label><span>{t('决议（每行一条）')}</span><Input.TextArea rows={3} disabled={minutes?.status === 'PUBLISHED'} value={(minutesDraft.decisions ?? []).join('\n')} onChange={(event) => setMinutesDraft({ ...minutesDraft, decisions: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) })} /></label>
                    <label><span>{t('补充记录')}</span><Input.TextArea rows={2} disabled={minutes?.status === 'PUBLISHED'} value={minutesDraft.notes ?? ''} onChange={(event) => setMinutesDraft({ ...minutesDraft, notes: event.target.value })} /></label>
                    {minutes?.status !== 'PUBLISHED' && permissions.has('meeting.minutes.manage') && <Button type="primary" style={{ justifySelf: 'start' }} onClick={() => void saveMinutes()}>{t('保存纪要')}</Button>}
                </div>
            </>}
        </div>

        <Modal open={editOpen} title={t('编辑会议资料')} okText={t('保存')} cancelText={t('取消')} onOk={() => void submitEdit()} onCancel={() => setEditOpen(false)}>
            <div className="form-grid">
                <label><span>{t('会议标题')}</span><Input value={editForm.title} onChange={(event) => setEditForm({ ...editForm, title: event.target.value })} /></label>
                <div className="form-row">
                    <label><span>{t('开始日期')}</span><input type="date" value={editForm.startsAt} onChange={(event) => setEditForm({ ...editForm, startsAt: event.target.value })} /></label>
                    <label><span>{t('开始时间')}</span><input type="time" value={editForm.startsAtTime} onChange={(event) => setEditForm({ ...editForm, startsAtTime: event.target.value })} /></label>
                    <label><span>{t('时长（分钟）')}</span><input type="number" min={5} step={5} value={editForm.durationMinutes} onChange={(event) => setEditForm({ ...editForm, durationMinutes: Number(event.target.value) || 60 })} /></label>
                </div>
                <label><span>{t('会议说明')}</span><Input.TextArea rows={3} value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} /></label>
                <div className="form-row">
                    <label><span>{t('线下地点')}</span><Input value={editForm.location} onChange={(event) => setEditForm({ ...editForm, location: event.target.value })} /></label>
                    <label><span>{t('线上会议链接')}</span><Input value={editForm.meetingUrl} onChange={(event) => setEditForm({ ...editForm, meetingUrl: event.target.value })} /></label>
                </div>
            </div>
        </Modal>

        <Modal open={transitionPrompt !== null} title={transitionPrompt ? t(transitionPrompt.label) : ''} okText={t('确认')} cancelText={t('取消')} onOk={() => void runTransition()} onCancel={() => setTransitionPrompt(null)}>
            {transitionPrompt?.reason && <label className="form-grid"><span>{t('取消原因')}</span><Input.TextArea rows={3} value={transitionText} onChange={(event) => setTransitionText(event.target.value)} /></label>}
        </Modal>
    </Modal>;
}
