import { CheckCircleOutlined, GithubOutlined, PlusOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons';
import { App as AntdApp, Button, Empty, Input, Modal, Select, Spin, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
    cancelProjectMilestone, completeProjectMilestone, createConversation, createFinanceExpenseReport,
    createKnowledgeBase, createProjectDailyReport, createProjectDecision, createProjectMilestone,
    createProjectRepository, createTask, createTurn, deleteKnowledgeDocument, deleteProjectDecision,
    deleteProjectRepository, getConversation, getFinanceProjectSpend, listConversations,
    listFinanceExpenseCategories, listFinanceExpenseReports, listKnowledgeBases, listKnowledgeDocuments,
    listProjectDailyReports, listProjectDecisions, listProjectMilestones, listProjectRepositories,
    publishProjectDecision, reopenProjectMilestone, returnProjectMilestoneToProgress, retryKnowledgeDocument, startProjectMilestone,
    startProjectMilestoneAcceptance, submitFinanceExpenseReport, submitProjectDailyReport,
    updateProjectDailyReport, updateProjectDecision, updateProjectMilestone, updateProjectRepository,
    uploadAttachmentFile, uploadKnowledgeDocument, withdrawFinanceExpenseReport, withdrawProjectDailyReport,
    type Conversation, type ConversationMessage, type MeResult, type ProjectDailyReport,
    type ProjectDailyReportContent, type ProjectDecision, type ProjectMilestone, type ProjectRepository,
    type TaskStatus, type TaskSummary,
} from '../../core/api';

export interface ProjectPanelProps {
    projectId: string;
    authContext: MeResult;
    activeMembers: Array<{ id: string; account: string; user: { displayName: string }; status: string }>;
    projectMembers: Array<{ membershipId: string; role: string; account: string; displayName: string }>;
    tasks: TaskSummary[];
    permissions: Set<string>;
    canManage: boolean;
    readOnly: boolean;
    onRefresh: () => void;
    onTaskClick: (task: TaskSummary) => void;
}

export function ProjectWorkbenchPanel({ projectId, authContext, permissions, readOnly, onRefresh }: ProjectPanelProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeId, setActiveId] = useState<string>();
    const [messages, setMessages] = useState<ConversationMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [draftingDecision, setDraftingDecision] = useState(false);

    const loadConversation = async (conversationId: string): Promise<void> => {
        const detail = await getConversation(conversationId);
        setActiveId(conversationId);
        setMessages(detail.messages);
    };

    useEffect(() => {
        let cancelled = false;
        void listConversations(100, { contextType: 'PROJECT', projectId }).then(async (result) => {
            if (cancelled) return;
            setConversations(result.items);
            if (result.items[0]) await loadConversation(result.items[0].id);
        }).catch((error) => message.error(error instanceof Error ? error.message : '加载项目对话失败')).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [projectId]);

    const createNew = async (): Promise<void> => {
        const conversation = await createConversation(undefined, 'standard', { contextType: 'PROJECT', projectId });
        setConversations((items) => [conversation, ...items]);
        setActiveId(conversation.id);
        setMessages([]);
    };

    const send = async (preset?: string): Promise<void> => {
        const content = (preset ?? input).trim();
        if (!content || sending) return;
        setSending(true);
        setInput('');
        try {
            let conversationId = activeId;
            if (!conversationId) {
                const conversation = await createConversation(undefined, 'standard', { contextType: 'PROJECT', projectId });
                conversationId = conversation.id;
                setConversations((items) => [conversation, ...items]);
                setActiveId(conversation.id);
                setMessages([]);
            }
            const localUserId = `local-user-${Date.now()}`;
            const localAssistantId = `local-assistant-${Date.now()}`;
            setMessages((items) => [...items, { id: localUserId, role: 'USER', content, createdAt: new Date().toISOString() }, { id: localAssistantId, role: 'ASSISTANT', content: '', createdAt: new Date().toISOString() }]);
            await createTurn(conversationId, { content, mode: 'standard', knowledgeBaseEnabled: permissions.has('knowledge_base.query') }, `project-${Date.now()}-${Math.random().toString(36).slice(2)}`, (event) => {
                if (event.type === 'content_delta') {
                    setMessages((items) => items.map((item) => item.id === localAssistantId ? { ...item, content: item.content + event.text } : item));
                }
                if (event.type === 'error') throw new Error(event.error.message);
            });
            const detail = await getConversation(conversationId);
            setMessages(detail.messages);
        } catch (error) {
            message.error(error instanceof Error ? error.message : '项目工作台请求失败');
        } finally {
            setSending(false);
        }
    };

    const createDecisionDraft = async (): Promise<void> => {
        if (!activeId || draftingDecision || readOnly || !permissions.has('project.read')) return;
        const assistantIndex = [...messages].map((item, index) => ({ item, index })).reverse().find(({ item }) => item.role === 'ASSISTANT' && item.content.trim())?.index;
        if (assistantIndex === undefined) { message.warning('请先完成一轮项目对话'); return; }
        const assistant = messages[assistantIndex];
        const user = messages.slice(0, assistantIndex).reverse().find((item) => item.role === 'USER' && item.content.trim());
        if (!user) { message.warning('未找到需要形成决策的问题'); return; }
        setDraftingDecision(true);
        try {
            await createProjectDecision(projectId, {
                title: user.content.trim().slice(0, 80),
                problem: user.content.trim(),
                background: '来源于当前成员的项目工作台私有会话。',
                recommendation: assistant.content.trim(),
                conclusion: null,
                risks: [],
                nextActions: [],
                participantMembershipIds: [authContext.membership.id],
                sourceConversationId: activeId,
            });
            onRefresh();
            message.success('已生成决策草稿，请到“决策”页面编辑并确认发布');
        } catch (error) {
            message.error(error instanceof Error ? error.message : '生成决策草稿失败');
        } finally {
            setDraftingDecision(false);
        }
    };

    const quickActions = [
        { title: '汇总项目进展', detail: '整理当前进度、风险和需要关注的节点。', prompt: '请汇总当前项目进展和主要风险。' },
        { title: '识别延期风险', detail: '检查阻塞、逾期和临近截止的事项。', prompt: '请识别项目延期和阻塞风险。' },
        { title: '整理决策内容', detail: '把当前讨论收敛为可确认的决策草稿。', prompt: '请把当前问题整理为一份决策草稿。' },
    ];

    return <div className="workbench-page">
        <div className="workbench-head">
            <div><h2>项目工作台</h2><p>固定当前项目上下文；对话仅自己可见，正式产出需在决策与任务中确认。</p></div>
            <button className="quiet-button" type="button" onClick={() => void createNew()}><PlusOutlined /> 新建对话</button>
        </div>
        <section className="ai-workbench">
            {quickActions.map((action) => <button className="ai-quick-card" type="button" key={action.title} disabled={sending} onClick={() => void send(action.prompt)}><i><RobotOutlined /></i><span><strong>{action.title}</strong><small>{action.detail}</small></span><em className="ai-quick-action">开始 →</em></button>)}
            <button className="ai-quick-card" type="button" disabled={draftingDecision || readOnly || !activeId || !messages.some((item) => item.role === 'ASSISTANT' && item.content.trim())} onClick={() => void createDecisionDraft()}><i><CheckCircleOutlined /></i><span><strong>生成决策草稿</strong><small>基于最近一轮对话形成草稿，确认后进入决策页。</small></span><em className="ai-quick-action">{draftingDecision ? '生成中…' : '生成 →'}</em></button>
        </section>
        <div className="workbench-layout">
            <section className="workbench-chat">
                <div className="workbench-message-stream">
                    {loading ? <div className="data-loading"><Spin /></div> : messages.length === 0 ? <Empty description="从项目现状、风险或需要形成的决策开始" /> : messages.map((item) => <article key={item.id} className={`project-chat-message ${item.role === 'USER' ? 'is-user' : 'is-assistant'}`}><div className="project-chat-role">{item.role === 'USER' ? authContext.user.displayName : '项目 AI'}</div><div className="project-chat-content">{item.content || (sending && item.role === 'ASSISTANT' ? '正在整理…' : '')}</div></article>)}
                </div>
                <div className="workbench-composer">
                    <Input.TextArea value={input} autoSize={{ minRows: 2, maxRows: 6 }} placeholder="继续询问项目情况，或描述需要形成的决策和任务……" onChange={(event) => setInput(event.target.value)} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void send(); } }} />
                    <div className="project-workbench-composer-actions"><span>{permissions.has('knowledge_base.query') ? '已启用项目知识库检索，范围受当前权限限制' : '当前角色未启用项目知识库检索'}</span><Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => void send()}>发送</Button></div>
                </div>
            </section>
            <aside className="project-workbench-history">
                <div className="project-panel-heading"><div><h3>项目对话</h3><p>仅当前成员可见</p></div></div>
                <div className="project-conversation-list">{conversations.map((conversation) => <button type="button" key={conversation.id} className={`history-row ${conversation.id === activeId ? 'is-active' : ''}`} onClick={() => void loadConversation(conversation.id)}><strong>{conversation.title || '新对话'}</strong><small>{conversation.lastTurnAt ? new Date(conversation.lastTurnAt).toLocaleString() : '尚未开始'}</small></button>)}</div>
            </aside>
        </div>
    </div>;
}

export function ProjectDecisionPanel({ projectId, authContext, activeMembers, canManage, readOnly, permissions, onRefresh }: ProjectPanelProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const queryClient = useQueryClient();
    const [editor, setEditor] = useState<ProjectDecision | 'new' | null>(null);
    const [form, setForm] = useState({ title: '', problem: '', background: '', recommendation: '', conclusion: '', rationale: '', risks: '', nextActions: '', participantMembershipIds: [] as string[] });
    const [taskDecision, setTaskDecision] = useState<ProjectDecision | null>(null);
    const [taskOwnerId, setTaskOwnerId] = useState('');
    const query = useQuery({ queryKey: ['project-decisions', projectId], queryFn: () => listProjectDecisions(projectId) });
    const decisions = query.data ?? [];

    const openEditor = (decision?: ProjectDecision): void => {
        setEditor(decision ?? 'new');
        setForm(decision ? {
            title: decision.title, problem: decision.problem, background: decision.background ?? '', recommendation: decision.recommendation ?? '',
            conclusion: decision.conclusion ?? '', rationale: decision.rationale ?? '', risks: decision.risks.join('\n'), nextActions: decision.nextActions.join('\n'), participantMembershipIds: decision.participantMembershipIds,
        } : { title: '', problem: '', background: '', recommendation: '', conclusion: '', rationale: '', risks: '', nextActions: '', participantMembershipIds: [authContext.membership.id] });
    };

    const save = async (): Promise<void> => {
        try {
            const input = { ...form, risks: lines(form.risks), nextActions: lines(form.nextActions) };
            if (editor === 'new') await createProjectDecision(projectId, input);
            else if (editor) await updateProjectDecision(projectId, editor.id, { ...input, version: editor.version });
            setEditor(null);
            await queryClient.invalidateQueries({ queryKey: ['project-decisions', projectId] });
            onRefresh();
            message.success('决策草稿已保存');
        } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
    };

    const publish = async (decision: ProjectDecision): Promise<void> => {
        if (!decision.conclusion?.trim()) { message.warning('请先编辑并填写最终结论'); return; }
        await publishProjectDecision(projectId, decision.id, decision.conclusion, decision.version);
        await queryClient.invalidateQueries({ queryKey: ['project-decisions', projectId] });
        onRefresh();
    };

    const createFromDecision = async (): Promise<void> => {
        if (!taskDecision || !taskOwnerId) return;
        await createTask(projectId, { title: taskDecision.title, description: taskDecision.conclusion ?? taskDecision.problem, ownerMembershipId: taskOwnerId, decisionId: taskDecision.id });
        setTaskDecision(null); onRefresh(); message.success('任务已创建并进入看板');
    };

    return <section className="project-workflow-panel">
        <div className="project-panel-heading"><div><h2>决策闭环</h2><p>将讨论结论沉淀为正式决策，并可继续生成任务。</p></div><Button type="primary" disabled={readOnly} onClick={() => openEditor()}>发起决策</Button></div>
        {query.isLoading ? <Spin /> : decisions.length === 0 ? <Empty description="暂无项目决策" /> : <div className="project-decision-list">{decisions.map((decision) => <article className="project-decision-card" key={decision.id}>
            <div className="project-panel-heading"><div><Tag color={decision.status === 'PUBLISHED' ? 'success' : decision.status === 'SUPERSEDED' ? 'default' : 'processing'}>{decision.status === 'PUBLISHED' ? '已发布' : decision.status === 'SUPERSEDED' ? '已替代' : '草稿'}</Tag><h3>{decision.title}</h3></div><small>{new Date(decision.updatedAt).toLocaleDateString()}</small></div>
            <p><strong>问题：</strong>{decision.problem}</p><p><strong>结论：</strong>{decision.conclusion || '尚未确认'}</p>
            <div className="project-inline-actions">
                {decision.status === 'DRAFT' && (canManage || decision.createdBy.membershipId === authContext.membership.id) && <Button size="small" disabled={readOnly} onClick={() => openEditor(decision)}>编辑</Button>}
                {decision.status === 'DRAFT' && canManage && <Button size="small" type="primary" disabled={readOnly} onClick={() => void publish(decision)}>确认发布</Button>}
                {decision.status === 'PUBLISHED' && permissions.has('task.create') && <Button size="small" onClick={() => { setTaskDecision(decision); setTaskOwnerId(activeMembers[0]?.id ?? ''); }}>生成任务</Button>}
                {decision.status === 'DRAFT' && (canManage || decision.createdBy.membershipId === authContext.membership.id) && <Button size="small" danger disabled={readOnly} onClick={() => void deleteProjectDecision(projectId, decision.id, decision.version).then(() => queryClient.invalidateQueries({ queryKey: ['project-decisions', projectId] }))}>删除</Button>}
            </div>
        </article>)}</div>}
        {editor !== null && <div className="milestone-drawer" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
            <aside className="drawer-panel">
                <div className="drawer-head"><div><span className="workspace-phase">{editor === 'new' ? '发起决策' : '编辑决策草稿'}</span><p>AI 建议只是草稿，最终结论和发布必须由人确认。</p></div><button className="drawer-close" type="button" onClick={() => setEditor(null)}>×</button></div>
                <div className="drawer-body draft-fields">
                    <label>决策标题<Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
                    <label>参与人<Select mode="multiple" value={form.participantMembershipIds} onChange={(value) => setForm({ ...form, participantMembershipIds: value })} options={activeMembers.map((member) => ({ value: member.id, label: member.user.displayName }))} /></label>
                    <label>决策问题<Input.TextArea rows={3} value={form.problem} onChange={(event) => setForm({ ...form, problem: event.target.value })} /></label>
                    <label>背景<Input.TextArea rows={3} value={form.background} onChange={(event) => setForm({ ...form, background: event.target.value })} /></label>
                    <label>AI 建议 / 推荐方案<Input.TextArea rows={4} value={form.recommendation} onChange={(event) => setForm({ ...form, recommendation: event.target.value })} /></label>
                    <label>最终结论<Input.TextArea rows={4} value={form.conclusion} onChange={(event) => setForm({ ...form, conclusion: event.target.value })} /></label>
                    <label>决策依据<Input.TextArea rows={3} value={form.rationale} onChange={(event) => setForm({ ...form, rationale: event.target.value })} /></label>
                    <label>主要风险（每行一条）<Input.TextArea rows={3} value={form.risks} onChange={(event) => setForm({ ...form, risks: event.target.value })} /></label>
                    <label>后续动作（每行一条）<Input.TextArea rows={3} value={form.nextActions} onChange={(event) => setForm({ ...form, nextActions: event.target.value })} /></label>
                </div>
                <div className="drawer-actions"><button className="quiet-button" type="button" onClick={() => setEditor(null)}>取消</button><button className="primary-button" type="button" onClick={() => void save()}>保存草稿</button></div>
            </aside>
        </div>}
        {taskDecision !== null && <div className="milestone-drawer" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setTaskDecision(null); }}><div className="confirm-card"><span className="workspace-phase">由决策生成任务</span><h3>{taskDecision.title}</h3><p>任务正式写入后进入看板，状态变化会继续反馈到项目动态和日报。</p><label className="task-draft-grid">任务负责人<Select value={taskOwnerId || undefined} onChange={setTaskOwnerId} options={activeMembers.map((member) => ({ value: member.id, label: member.user.displayName }))} /></label><div className="drawer-actions"><button className="quiet-button" type="button" onClick={() => setTaskDecision(null)}>取消</button><button className="primary-button" type="button" disabled={!taskOwnerId} onClick={() => void createFromDecision()}>创建任务</button></div></div></div>}
    </section>;
}

export function ProjectKanbanPanel({ tasks, onTaskClick }: ProjectPanelProps): JSX.Element {
    const columns: Array<{ status: TaskStatus; title: string; tone: string }> = [{ status: 'TODO', title: '待处理', tone: '#94a3b8' }, { status: 'IN_PROGRESS', title: '进行中', tone: '#4f46e5' }, { status: 'BLOCKED', title: '已阻塞', tone: '#ef4444' }, { status: 'DONE', title: '已完成', tone: '#10b981' }];
    return <section className="project-workflow-panel">
        <div className="project-panel-heading"><div><h2>任务看板</h2><p>任务状态变化会写入项目动态，并触发负责人日报草稿联动。</p></div><span className="project-kanban-total">{tasks.length} 项任务</span></div>
        <div className="project-kanban">{columns.map((column) => <div className="project-kanban-column" key={column.status}>
            <header><span><i style={{ background: column.tone }} />{column.title}</span><b>{tasks.filter((task) => task.status === column.status).length}</b></header>
            <div className="project-kanban-cards">{tasks.filter((task) => task.status === column.status).map((task) => <button type="button" className="project-kanban-card" key={task.id} onClick={() => onTaskClick(task)}>
                <div className="project-kanban-card-tags"><Tag color={task.priority === 'HIGH' || task.priority === 'URGENT' ? 'error' : task.priority === 'MEDIUM' ? 'warning' : 'success'}>{task.priority}</Tag>{task.decisionId && <Tag color="blue">来源决策</Tag>}</div>
                <strong>{task.title}</strong>
                {task.description && <p>{task.description}</p>}
                <footer><span className="project-kanban-owner">{task.owner?.displayName || task.owner?.account || '未分配'}</span><time>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '无截止日期'}</time></footer>
            </button>)}</div>
        </div>)}</div>
    </section>;
}

function lines(value: string): string[] { return value.split('\n').map((line) => line.trim()).filter(Boolean); }

export function ProjectMilestonePanel({ projectId, activeMembers, canManage, readOnly, tasks, onRefresh }: ProjectPanelProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const queryClient = useQueryClient();
    const [editor, setEditor] = useState<ProjectMilestone | 'new' | null>(null);
    const [form, setForm] = useState({ title: '', objective: '', targetDate: '', ownerMembershipId: '', acceptanceCriteria: '', taskIds: [] as string[], decisionIds: [] as string[] });
    const query = useQuery({ queryKey: ['project-milestones', projectId], queryFn: () => listProjectMilestones(projectId) });
    const decisionsQuery = useQuery({ queryKey: ['project-decisions', projectId], queryFn: () => listProjectDecisions(projectId) });
    const milestones = query.data ?? [];
    const decisions = decisionsQuery.data ?? [];
    const refresh = async (): Promise<void> => { await queryClient.invalidateQueries({ queryKey: ['project-milestones', projectId] }); onRefresh(); };
    const openEditor = (milestone?: ProjectMilestone): void => {
        setEditor(milestone ?? 'new');
        setForm(milestone ? { title: milestone.title, objective: milestone.objective, targetDate: milestone.targetDate.slice(0, 10), ownerMembershipId: milestone.owner.membershipId, acceptanceCriteria: milestone.acceptanceCriteria.join('\n'), taskIds: milestone.tasks.map((task) => task.id), decisionIds: milestone.decisions.map((decision) => decision.id) } : { title: '', objective: '', targetDate: new Date().toISOString().slice(0, 10), ownerMembershipId: activeMembers[0]?.id ?? '', acceptanceCriteria: '', taskIds: [], decisionIds: [] });
    };
    const save = async (): Promise<void> => {
        try {
            const input = { ...form, acceptanceCriteria: lines(form.acceptanceCriteria) };
            if (editor === 'new') await createProjectMilestone(projectId, input);
            else if (editor) await updateProjectMilestone(projectId, editor.id, { ...input, version: editor.version });
            setEditor(null); await refresh(); message.success('里程碑已保存');
        } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
    };
    const run = async (action: () => Promise<unknown>, success: string): Promise<void> => { try { await action(); await refresh(); message.success(success); } catch (error) { message.error(error instanceof Error ? error.message : '操作失败'); } };
    return <section className="project-workflow-panel"><div className="project-panel-heading"><div><h2>项目里程碑</h2><p>里程碑记录阶段成果和验收关口，不替代任务执行。</p></div><Button type="primary" disabled={!canManage || readOnly} onClick={() => openEditor()}>新建里程碑</Button></div>{query.isLoading ? <Spin /> : milestones.length === 0 ? <Empty description="暂无里程碑" /> : <div className="project-milestone-list">{milestones.map((milestone) => <article className={`project-milestone-item ${milestone.overdue ? 'is-overdue' : milestone.health === 'AT_RISK' ? 'is-risk' : ''}`} key={milestone.id}><div className="project-panel-heading"><div><Tag color={milestone.status === 'COMPLETED' ? 'success' : milestone.overdue ? 'error' : milestone.health === 'AT_RISK' ? 'warning' : 'processing'}>{milestone.status}</Tag><h3>{milestone.title}</h3><p>{milestone.objective}</p></div><strong>{milestone.progressPercent}%</strong></div><div className="project-milestone-meta"><span>负责人 {milestone.owner.displayName}</span><span>目标 {milestone.targetDate.slice(0, 10)}</span><span>任务 {milestone.completedTaskCount}/{milestone.taskCount}</span>{milestone.overdue && <span>已逾期</span>}</div><div className="project-inline-actions">{canManage && !readOnly && <Button size="small" onClick={() => openEditor(milestone)}>编辑</Button>}{milestone.status === 'PLANNED' && canManage && <Button size="small" onClick={() => void run(() => startProjectMilestone(projectId, milestone.id, milestone.version), '里程碑已启动')}>启动</Button>}{milestone.status === 'IN_PROGRESS' && canManage && <Button size="small" onClick={() => void run(() => startProjectMilestoneAcceptance(projectId, milestone.id, milestone.version), '已进入验收')}>进入验收</Button>}{milestone.status === 'ACCEPTANCE' && canManage && <Button size="small" type="primary" onClick={() => void run(() => completeProjectMilestone(projectId, milestone.id, milestone.version), '里程碑已完成')}>确认完成</Button>}{milestone.status === 'ACCEPTANCE' && canManage && <Button size="small" onClick={() => void run(() => returnProjectMilestoneToProgress(projectId, milestone.id, milestone.version, '验收未通过'), '里程碑已退回进行中')}>退回进行中</Button>}{['PLANNED', 'IN_PROGRESS', 'ACCEPTANCE'].includes(milestone.status) && canManage && <Button size="small" danger onClick={() => { let reason = ''; Modal.confirm({ title: `取消里程碑“${milestone.title}”`, content: <Input.TextArea placeholder="请输入取消原因" onChange={(event) => { reason = event.target.value; }} />, okText: '确认取消', okButtonProps: { danger: true }, cancelText: '返回', onOk: async () => { if (!reason.trim()) { message.error('请输入取消原因'); return Promise.reject(); } await run(() => cancelProjectMilestone(projectId, milestone.id, milestone.version, reason.trim()), '里程碑已取消'); } }); }}>取消</Button>}{['COMPLETED', 'CANCELLED'].includes(milestone.status) && canManage && <Button size="small" onClick={() => void run(() => reopenProjectMilestone(projectId, milestone.id, milestone.version), '里程碑已重新打开')}>重新打开</Button>}</div></article>)}</div>}{editor !== null && <div className="milestone-drawer" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
            <aside className="drawer-panel">
                <div className="drawer-head"><div><span className="workspace-phase">{editor === 'new' ? '新建里程碑' : '编辑里程碑'}</span><p>目标、负责人和验收标准由项目负责人或经理人工维护。</p></div><button className="drawer-close" type="button" onClick={() => setEditor(null)}>×</button></div>
                <div className="drawer-body">
                    <label>名称<Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
                    <label>阶段目标<Input.TextArea rows={3} value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} /></label>
                    <div className="task-draft-grid"><label>目标日期<input type="date" value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} /></label><label>负责人<Select value={form.ownerMembershipId || undefined} onChange={(value) => setForm({ ...form, ownerMembershipId: value })} options={activeMembers.map((member) => ({ value: member.id, label: member.user.displayName }))} /></label></div>
                    <label>验收标准（每行一条）<Input.TextArea rows={4} value={form.acceptanceCriteria} onChange={(event) => setForm({ ...form, acceptanceCriteria: event.target.value })} /></label>
                    <label>关联任务<Select mode="multiple" value={form.taskIds} onChange={(value) => setForm({ ...form, taskIds: value })} options={tasks.map((task) => ({ value: task.id, label: task.title }))} /></label>
                    <label>关联决策<Select mode="multiple" value={form.decisionIds} onChange={(value) => setForm({ ...form, decisionIds: value })} options={decisions.map((decision) => ({ value: decision.id, label: `${decision.status === 'PUBLISHED' ? '已发布' : '草稿'} · ${decision.title}` }))} /></label>
                </div>
                <div className="drawer-actions"><button className="quiet-button" type="button" onClick={() => setEditor(null)}>取消</button><button className="primary-button" type="button" onClick={() => void save()}>保存</button></div>
            </aside>
        </div>}</section>;
}

export function ProjectDailyReportPanel({ projectId, authContext, activeMembers, permissions, readOnly, onRefresh }: ProjectPanelProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const queryClient = useQueryClient();
    const today = new Date().toISOString().slice(0, 10);
    const [editor, setEditor] = useState<ProjectDailyReport | 'new' | null>(null);
    const [reviewerId, setReviewerId] = useState('');
    const [completed, setCompleted] = useState('');
    const [planned, setPlanned] = useState('');
    const [blockers, setBlockers] = useState('');
    const [remarks, setRemarks] = useState('');
    const canRead = permissions.has('work_report.read');
    const canCreate = permissions.has('work_report.create');
    const canUpdate = permissions.has('work_report.update');
    const canSubmit = permissions.has('work_report.submit');
    const query = useQuery({ queryKey: ['project-daily-reports', projectId], queryFn: () => listProjectDailyReports(projectId), enabled: canRead });
    const reports = query.data?.items ?? [];
    const refresh = async (): Promise<void> => { await queryClient.invalidateQueries({ queryKey: ['project-daily-reports', projectId] }); onRefresh(); };
    const open = (report?: ProjectDailyReport): void => {
        setEditor(report ?? 'new');
        setReviewerId(report?.reviewer?.membershipId ?? activeMembers.find((member) => member.id !== authContext.membership.id)?.id ?? '');
        setCompleted(report?.content.completedItems.join('\n') ?? '');
        setPlanned(report?.content.plannedItems.join('\n') ?? '');
        setBlockers(report?.content.blockers.join('\n') ?? '');
        setRemarks(report?.content.remarks ?? '');
    };
    const save = async (): Promise<void> => {
        if (!reviewerId) { message.warning('请选择审核人'); return; }
        const content: ProjectDailyReportContent = { completedItems: lines(completed), plannedItems: lines(planned), blockers: lines(blockers), remarks: remarks.trim() || null };
        try {
            if (editor === 'new') await createProjectDailyReport(projectId, today, reviewerId, content);
            else if (editor) await updateProjectDailyReport(editor.id, reviewerId, content, editor.version, editor.projectIds, editor.taskIds);
            setEditor(null); await refresh(); message.success('日报草稿已保存');
        } catch (error) { message.error(error instanceof Error ? error.message : '保存日报失败'); }
    };
    return <section className="project-workflow-panel"><div className="project-panel-heading"><div><h2>项目日报</h2><p>任务完成后自动带入负责人日报草稿；提交前可自由修改。</p></div><Button type="primary" disabled={readOnly || !canCreate} onClick={() => open()}>写今日日报</Button></div>{!canRead ? <Empty description="当前角色没有日报查看权限" /> : query.isLoading ? <Spin /> : reports.length === 0 ? <Empty description="暂无项目日报" /> : <div className="project-report-list">{reports.map((report) => <article className="project-report-card" key={report.id}><div className="project-panel-heading"><div><Tag color={report.status === 'APPROVED' ? 'success' : report.status === 'REJECTED' ? 'error' : report.status === 'SUBMITTED' ? 'processing' : 'default'}>{report.status}</Tag><h3>{report.periodStart.slice(0, 10)} · {report.author?.displayName ?? '成员'}</h3></div>{report.author?.membershipId === authContext.membership.id && (report.status === 'DRAFT' || report.status === 'REJECTED') && canUpdate && <Button size="small" onClick={() => open(report)}>编辑</Button>}</div><strong>今日完成</strong><ul>{report.content.completedItems.map((item) => <li key={item}>{item}</li>)}</ul>{report.content.blockers.length > 0 && <p className="is-warning">阻塞：{report.content.blockers.join('；')}</p>}<div className="project-inline-actions">{report.author?.membershipId === authContext.membership.id && (report.status === 'DRAFT' || report.status === 'REJECTED') && canSubmit && <Button size="small" type="primary" disabled={readOnly} onClick={() => void submitProjectDailyReport(report.id, report.version).then(refresh)}>提交日报</Button>}{report.author?.membershipId === authContext.membership.id && report.status === 'SUBMITTED' && canSubmit && <Button size="small" onClick={() => void withdrawProjectDailyReport(report.id, report.version).then(refresh)}>撤回</Button>}</div></article>)}</div>}{editor !== null && <div className="milestone-drawer" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
            <aside className="drawer-panel">
                <div className="drawer-head"><div><span className="workspace-phase">{editor === 'new' ? '写今日日报' : '编辑日报草稿'}</span><p>任务完成项会自动带入“今日完成”，提交前仍可自由修改。</p></div><button className="drawer-close" type="button" onClick={() => setEditor(null)}>×</button></div>
                <div className="drawer-body draft-fields">
                    <label>审核人<Select value={reviewerId || undefined} onChange={setReviewerId} options={activeMembers.filter((member) => member.id !== authContext.membership.id).map((member) => ({ value: member.id, label: member.user.displayName }))} /></label>
                    <label>今日完成（每行一条）<Input.TextArea rows={5} value={completed} onChange={(event) => setCompleted(event.target.value)} /></label>
                    <label>明日计划<Input.TextArea rows={4} value={planned} onChange={(event) => setPlanned(event.target.value)} /></label>
                    <label>阻塞问题<Input.TextArea rows={3} value={blockers} onChange={(event) => setBlockers(event.target.value)} /></label>
                    <label>补充说明<Input.TextArea rows={3} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></label>
                </div>
                <div className="drawer-actions"><button className="quiet-button" type="button" onClick={() => setEditor(null)}>取消</button><button className="primary-button" type="button" onClick={() => void save()}>保存草稿</button></div>
            </aside>
        </div>}</section>;
}

export function ProjectRepositoryPanel({ projectId, onRefresh }: ProjectPanelProps): JSX.Element {
    const query = useQuery({ queryKey: ['project-repositories', projectId], queryFn: () => listProjectRepositories(projectId) });
    const repositories = query.data ?? [];
    const enabledCount = repositories.filter((repository) => repository.enabled).length;
    const providers = new Set(repositories.map((repository) => repository.provider)).size;
    return <section className="project-workflow-panel">
        <div className="project-panel-heading"><div><h2>项目仓库</h2><p>当前阶段只登记仓库和默认分支，不伪造提交、PR 或贡献数据。</p></div><button className="quiet-button" type="button" onClick={onRefresh}>刷新</button></div>
        {query.isLoading ? <Spin /> : repositories.length === 0 ? <Empty description="尚未绑定项目仓库" /> : <>
            <div className="repo-stat-grid">
                <div><b>{repositories.length}</b><span>已登记仓库</span></div>
                <div><b>{enabledCount}</b><span>已启用</span></div>
                <div><b>{providers}</b><span>代码平台</span></div>
                <div><b>仅登记</b><span>未接入代码同步</span></div>
            </div>
            <div className="project-repository-list">{repositories.map((repository) => <article className="project-repository-card" key={repository.id}><i className="project-repository-icon"><GithubOutlined /></i><div><strong>{repository.name}</strong><p><a href={repository.url} target="_blank" rel="noreferrer">{repository.url}</a></p><small>默认分支：{repository.defaultBranch}</small></div><Tag color={repository.enabled ? 'success' : 'default'}>{repository.enabled ? '已启用' : '已停用'}</Tag></article>)}</div>
        </>}
    </section>;
}

export function ProjectFilesPanel({ projectId, permissions, onRefresh }: ProjectPanelProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const queryClient = useQueryClient();
    const [selectedId, setSelectedId] = useState<string>();
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [uploading, setUploading] = useState(false);
    const canRead = permissions.has('knowledge_base.read');
    const basesQuery = useQuery({ queryKey: ['project-knowledge-bases', projectId], queryFn: () => listKnowledgeBases({ projectId, limit: 100 }), enabled: canRead });
    const bases = basesQuery.data?.items ?? [];
    const selected = bases.find((item) => item.id === selectedId) ?? bases[0];
    const docsQuery = useQuery({ queryKey: ['project-knowledge-docs', selected?.id], queryFn: () => listKnowledgeDocuments(selected?.id ?? ''), enabled: Boolean(selected?.id) });
    const docs = docsQuery.data?.items ?? [];
    const refresh = async (): Promise<void> => { await queryClient.invalidateQueries({ queryKey: ['project-knowledge-bases', projectId] }); await queryClient.invalidateQueries({ queryKey: ['project-knowledge-docs'] }); onRefresh(); };
    const createBase = async (): Promise<void> => { if (!name.trim()) return; await createKnowledgeBase({ name, projectId, visibilityScope: 'PROJECT' }); setCreating(false); setName(''); await refresh(); };
    const upload = async (file: File): Promise<void> => {
        if (!selected) { message.warning('请先创建项目知识库'); return; }
        setUploading(true);
        try { const fileObjectId = await uploadAttachmentFile(file); await uploadKnowledgeDocument(selected.id, { fileObjectId, name: file.name, visibilityScope: 'PROJECT', projectId }); await refresh(); message.success('文件已上传并进入索引队列'); }
        catch (error) { message.error(error instanceof Error ? error.message : '上传失败'); }
        finally { setUploading(false); }
    };
    return <section className="project-workflow-panel"><div className="project-panel-heading"><div><h2>项目文件</h2><p>文件与项目知识库同步，项目工作台会在权限范围内引用。</p></div><div className="project-inline-actions">{permissions.has('knowledge_base.create') && <Button onClick={() => setCreating(true)}>新建项目知识库</Button>}{selected && <label className="project-upload-button"><input type="file" hidden disabled={uploading || !(permissions.has('knowledge_base.manage_all') || selected?.myPermission === 'EDITOR' || selected?.myPermission === 'MANAGER')} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ''; }} />{uploading ? '上传中…' : '上传文件'}</label>}</div></div>{!canRead ? <Empty description="当前角色没有项目知识库读取权限" /> : basesQuery.isLoading ? <Spin /> : bases.length === 0 ? <Empty description="尚未创建项目知识库" /> : <><div className="project-inline-actions">{bases.map((base) => <Button key={base.id} type={base.id === selected?.id ? 'primary' : 'default'} onClick={() => setSelectedId(base.id)}>{base.name}</Button>)}</div><div className="project-file-list">{docsQuery.isLoading ? <Spin /> : docs.map((document) => <article key={document.id} className="project-file-row"><div><strong>{document.name}</strong><small>{new Date(document.updatedAt).toLocaleString()}</small></div><Tag color={document.status === 'READY' ? 'success' : document.status === 'FAILED' ? 'error' : 'processing'}>{document.status}</Tag><div className="project-inline-actions">{document.status === 'FAILED' && <Button size="small" onClick={() => void retryKnowledgeDocument(selected!.id, document.id).then(refresh)}>重试</Button>}{(permissions.has('knowledge_base.manage_all') || selected?.myPermission === 'EDITOR' || selected?.myPermission === 'MANAGER') && <Button size="small" danger onClick={() => void deleteKnowledgeDocument(selected!.id, document.id).then(refresh)}>删除</Button>}</div></article>)}</div></>}<Modal open={creating} title="新建项目知识库" okText="创建" cancelText="取消" onOk={() => void createBase()} onCancel={() => setCreating(false)}><Input value={name} placeholder="项目知识库名称" onChange={(e) => setName(e.target.value)} /></Modal></section>;
}

export function ProjectExpensePanel({ projectId, authContext, permissions, readOnly, onRefresh }: ProjectPanelProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [items, setItems] = useState<Array<{ categoryId: string; description: string; amount: string; occurredAt: string; invoiceNumber: string; merchantName: string }>>([{ categoryId: '', description: '', amount: '', occurredAt: new Date().toISOString().slice(0, 10), invoiceNumber: '', merchantName: '' }]);
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const canRead = permissions.has('finance.expense.read');
    const canRequest = permissions.has('finance.expense.request');
    const categoriesQuery = useQuery({ queryKey: ['finance-expense-categories'], queryFn: listFinanceExpenseCategories, enabled: canRead });
    const reportsQuery = useQuery({ queryKey: ['project-expenses', projectId], queryFn: () => listFinanceExpenseReports({ projectId }), enabled: canRead });
    const spendQuery = useQuery({ queryKey: ['project-expense-spend', projectId], queryFn: () => getFinanceProjectSpend(projectId), enabled: canRead });
    const categories = categoriesQuery.data?.items ?? [];
    const reports = reportsQuery.data?.items ?? [];
    const refresh = async (): Promise<void> => { await queryClient.invalidateQueries({ queryKey: ['project-expenses', projectId] }); await queryClient.invalidateQueries({ queryKey: ['project-expense-spend', projectId] }); onRefresh(); };
    const submit = async (submitToFinance: boolean): Promise<void> => {
        setBusy(true);
        try {
            const attachmentIds = files.length ? await Promise.all(files.map((file) => uploadAttachmentFile(file))) : [];
            const report = await createFinanceExpenseReport({ title, description: description || null, items: items.map((item) => ({ categoryId: item.categoryId, description: item.description, amount: Number(item.amount), occurredAt: item.occurredAt, projectId, invoiceNumber: item.invoiceNumber || null, merchantName: item.merchantName || null })), attachmentIds });
            if (submitToFinance) await submitFinanceExpenseReport(report.id, report.version);
            setOpen(false); setTitle(''); setDescription(''); setItems([{ categoryId: '', description: '', amount: '', occurredAt: new Date().toISOString().slice(0, 10), invoiceNumber: '', merchantName: '' }]); setFiles([]); await refresh(); message.success(submitToFinance ? '报销已提交财务' : '报销草稿已保存');
        } catch (error) { message.error(error instanceof Error ? error.message : '提交报销失败'); }
        finally { setBusy(false); }
    };
    return <section className="project-workflow-panel"><div className="project-panel-heading"><div><h2>项目费用与报销</h2><p>报销统一由财务域处理；项目页面只负责创建、附件和进度查看。</p></div><Button type="primary" disabled={readOnly || !canRead || !canRequest} onClick={() => setOpen(true)}>新增报销</Button></div>{!canRead ? <Empty description="当前角色没有项目费用读取权限" /> : <><div className="project-expense-stats"><div><span>已申请</span><strong>¥{(spendQuery.data?.submittedAmount ?? 0).toLocaleString()}</strong></div><div><span>已批准</span><strong>¥{(spendQuery.data?.approvedAmount ?? 0).toLocaleString()}</strong></div><div><span>已付款支出</span><strong>¥{(spendQuery.data?.paidAmount ?? 0).toLocaleString()}</strong></div></div>{reportsQuery.isLoading ? <Spin /> : reports.length === 0 ? <Empty description="暂无项目报销" /> : <div className="project-expense-list">{reports.map((report) => <article key={report.id} className="project-expense-row"><div><strong>{report.title}</strong><small>{report.reportNo} · {new Date(report.createdAt).toLocaleDateString()} · {report.attachments.length} 个附件</small></div><Tag color={report.status === 'PAID' ? 'success' : report.status === 'REJECTED' ? 'error' : report.status === 'SUBMITTED' ? 'processing' : 'default'}>{report.status}</Tag><strong>¥{report.totalAmount.toLocaleString()}</strong>{report.requesterMembershipId === authContext.membership.id && (report.status === 'DRAFT' || report.status === 'REJECTED') && <Button size="small" type="primary" disabled={readOnly} onClick={() => void submitFinanceExpenseReport(report.id, report.version).then(refresh)}>提交财务</Button>}{report.requesterMembershipId === authContext.membership.id && report.status === 'SUBMITTED' && <Button size="small" onClick={() => void withdrawFinanceExpenseReport(report.id, report.version).then(refresh)}>撤回</Button>}</article>)}</div>}</>}{open && <div className="milestone-drawer" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
            <div className="expense-dialog">
                <div className="drawer-head"><div><span className="workspace-phase">新增项目报销</span><p>项目页只负责登记支出和附件，提交后推送至财务审批中心。</p></div><button className="drawer-close" type="button" disabled={busy} onClick={() => setOpen(false)}>×</button></div>
                <div className="drawer-body">
                    <div className="draft-fields"><label>报销标题<Input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>报销说明<Input value={description} onChange={(event) => setDescription(event.target.value)} /></label></div>
                    <div className="project-panel-heading"><div><strong>费用明细</strong><p>填写用途、金额、发生日期和发票号码。</p></div><button className="quiet-button" type="button" onClick={() => setItems([...items, { categoryId: '', description: '', amount: '', occurredAt: new Date().toISOString().slice(0, 10), invoiceNumber: '', merchantName: '' }])}>添加明细</button></div>
                    <div className="project-expense-items">{items.map((item, index) => <div className="project-expense-item" key={index}><Select placeholder="费用类别" value={item.categoryId || undefined} onChange={(value) => setItems(items.map((row, rowIndex) => rowIndex === index ? { ...row, categoryId: value } : row))} options={categories.filter((category) => category.enabled).map((category) => ({ value: category.id, label: category.name }))} /><Input placeholder="费用说明" value={item.description} onChange={(event) => setItems(items.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} /><Input placeholder="金额" value={item.amount} onChange={(event) => setItems(items.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} /><input type="date" value={item.occurredAt} onChange={(event) => setItems(items.map((row, rowIndex) => rowIndex === index ? { ...row, occurredAt: event.target.value } : row))} /><Input placeholder="发票号码" value={item.invoiceNumber} onChange={(event) => setItems(items.map((row, rowIndex) => rowIndex === index ? { ...row, invoiceNumber: event.target.value } : row))} /></div>)}</div>
                    <label className="expense-upload">发票与凭证附件<input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><span>{files.length > 0 ? `已选择 ${files.length} 个附件` : '支持多张发票或凭证，提交财务时一并上传'}</span></label>
                    <div className="expense-total"><span>报销总金额</span><strong>¥{items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0).toFixed(2)}</strong></div>
                </div>
                <div className="drawer-actions"><button className="quiet-button" type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button><button className="quiet-button" type="button" disabled={busy} onClick={() => void submit(false)}>保存草稿</button><button className="primary-button" type="button" disabled={busy} onClick={() => void submit(true)}>{busy ? '处理中…' : '提交财务'}</button></div>
            </div>
        </div>}</section>;
}

export function ProjectRepositorySettingsPanel({ projectId, canManage, readOnly, onRefresh }: ProjectPanelProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<ProjectRepository | null>(null);
    const [url, setUrl] = useState('');
    const [name, setName] = useState('');
    const [branch, setBranch] = useState('main');
    const query = useQuery({ queryKey: ['project-repositories', projectId], queryFn: () => listProjectRepositories(projectId) });
    const repositories = query.data ?? [];
    const writable = canManage && !readOnly;
    const refresh = async (): Promise<void> => { await queryClient.invalidateQueries({ queryKey: ['project-repositories', projectId] }); onRefresh(); };
    const resetForm = (): void => { setEditing(null); setUrl(''); setName(''); setBranch('main'); };
    const openEditor = (repository?: ProjectRepository): void => { setEditing(repository ?? null); setUrl(repository?.url ?? ''); setName(repository?.name ?? ''); setBranch(repository?.defaultBranch ?? 'main'); };
    const save = async (): Promise<void> => {
        if (!url.trim()) { message.warning('请填写仓库 URL'); return; }
        try {
            if (editing) await updateProjectRepository(projectId, editing.id, { url: url.trim(), name: name.trim(), defaultBranch: branch.trim(), version: editing.version });
            else await createProjectRepository(projectId, { url: url.trim(), name: name.trim(), defaultBranch: branch.trim() });
            resetForm(); await refresh(); message.success('仓库配置已保存');
        } catch (error) { message.error(error instanceof Error ? error.message : '保存仓库失败'); }
    };
    const unbind = async (repository: ProjectRepository): Promise<void> => {
        try { await deleteProjectRepository(projectId, repository.id, repository.version); if (editing?.id === repository.id) resetForm(); await refresh(); message.success('仓库已解除绑定'); }
        catch (error) { message.error(error instanceof Error ? error.message : '解除绑定失败'); }
    };

    return <section className="project-workflow-panel project-repo-settings">
        <div className="project-panel-heading"><div><h2>设置 · 项目仓库</h2><p>填写并保存仓库 URL 后，顶部才会出现“项目仓库”Tab。请勿填写用户名、密码或访问令牌。</p></div><Tag color={repositories.length ? 'success' : 'default'}>{repositories.length ? `已绑定 ${repositories.length} 个仓库` : '尚未绑定仓库'}</Tag></div>
        <div className="repo-settings-grid">
            <label>仓库 URL<input value={url} disabled={!writable} placeholder="https://github.com/organization/repository" onChange={(event) => setUrl(event.target.value)} /></label>
            <label>显示名称<input value={name} disabled={!writable} placeholder="例如：核心业务仓库" onChange={(event) => setName(event.target.value)} /></label>
            <label>默认分支<input value={branch} disabled={!writable} placeholder="main" onChange={(event) => setBranch(event.target.value)} /></label>
        </div>
        <div className="project-inline-actions">
            <button className="primary-button" type="button" disabled={!writable} onClick={() => void save()}>{editing ? '保存修改' : '保存并绑定'}</button>
            {editing && <button className="quiet-button" type="button" onClick={resetForm}>取消编辑</button>}
        </div>
        <div className="repository-settings-divider" />
        {query.isLoading ? <Spin /> : repositories.length === 0 ? <Empty description="尚未绑定项目仓库" /> : <div className="repository-settings-list">{repositories.map((repository) => <div className="history-row repository-settings-row" key={repository.id}><span className="repository-settings-main"><strong>{repository.name}</strong><small>{repository.url}</small></span><Tag>{repository.provider}</Tag><span className="repository-settings-branch">{repository.defaultBranch}</span><button className="link-button" type="button" disabled={!writable} onClick={() => openEditor(repository)}>编辑</button><button className="link-button is-danger" type="button" disabled={!writable} onClick={() => void unbind(repository)}>解除绑定</button></div>)}</div>}
    </section>;
}
