import {
    AppstoreOutlined, BankOutlined, BellOutlined, BookOutlined, CheckCircleOutlined,
    CloudSyncOutlined, CodeOutlined, CopyOutlined, DatabaseOutlined, FileTextOutlined, FolderOutlined,
    HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, MoreOutlined,
    PartitionOutlined, PlusOutlined, ProjectOutlined, SafetyCertificateOutlined, SearchOutlined, SettingOutlined,
    CalendarOutlined, NotificationOutlined, ProfileOutlined,
    StarOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { App as AntdApp, Avatar, Badge, Button, Empty, Image as AntImage, Input, Modal, Select, Spin, Tag, Tooltip, Dropdown } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BookOpen, Download, ExternalLink, Eye, FileImage, FileText as FileTextIcon, Globe2, ImagePlus, Pencil, RotateCw, Send, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLocation, useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import {
    cancelTurn, createConversation, createTurn, deleteConversation, getConversation, getDashboardOverview, getDashboardTodos, getDashboardUpcomingMeetings, getDocument, getImage, replayTurnEvents, updateConversation, uploadAttachmentFile,
    getUnreadNotificationCount, hasStoredSession, listConversations, listDocuments, listTenantMembers, logout,
    type Conversation, type ConversationMessage, type DashboardOverview, type DashboardTodoItem, type DashboardUpcomingMeeting, type ImageAccess,
    type TurnStreamEvent,
    type ManagedDocumentSummary, type MeResult, type TenantMember,
} from '../core/api';
import MeetingManagement from '../features/meetings/MeetingManagement';
import DingTalkOrganizationPage from '../features/dingtalk/DingTalkOrganizationPage';
import NotificationCenter from '../features/notifications/NotificationCenter';
import OrganizationManagement from '../features/organization/OrganizationManagement';
import ProjectManagement from '../features/projects/ProjectManagement';
import WorkReportPage from '../features/reports/WorkReportPage';
import ProfileSettings from '../features/profile/ProfileSettings';
import RoleManagement from '../features/roles/RoleManagement';
import AssignmentPolicyManagement from '../features/assignment/AssignmentPolicyManagement';
import HrManagement from '../features/hr/HrManagement';
import FinanceManagement from '../features/finance/FinanceManagement';
import { useDateFormatter, useI18n } from '../core/i18n';

interface WebviewElement extends HTMLWebViewElement {
    goBack: () => void;
    goForward: () => void;
    reload: () => void;
    getURL: () => string;
}

interface NavItem {
    path: string;
    label: string;
    icon: JSX.Element;
}

function CeesLogo({ className }: { className?: string }): JSX.Element {
    return <img className={className} src="./assests/logo.webp" alt="CEES AI" />;
}

const navItems: NavItem[] = [
    { path: '/', label: '首页', icon: <HomeOutlined /> },
    { path: '/assistant', label: 'AI 助手', icon: <MessageOutlined /> },
    { path: '/projects', label: '项目管理', icon: <ProjectOutlined /> },
    { path: '/meetings', label: '会议管理', icon: <CalendarOutlined /> },
    { path: '/reports', label: '工作报告', icon: <ProfileOutlined /> },
    { path: '/applications', label: '应用中心', icon: <AppstoreOutlined /> },
    { path: '/architecture', label: '架构管理', icon: <TeamOutlined /> },
    { path: '/roles', label: '角色权限', icon: <SafetyCertificateOutlined /> },
    { path: '/assignment', label: '分配策略', icon: <PartitionOutlined /> },
    { path: '/hr', label: '人力资源', icon: <UserOutlined /> },
    { path: '/finance', label: '财务管理', icon: <BankOutlined /> },
    { path: '/dingtalk', label: '钉钉管理', icon: <CloudSyncOutlined /> },
    { path: '/knowledge', label: '知识管理', icon: <BookOutlined /> },
    { path: '/notifications', label: '通知中心', icon: <NotificationOutlined /> },
];

const appItems = [
    { name: '智能文档助手', description: '总结、润色与多语言翻译', icon: <FileTextOutlined />, tone: 'indigo', category: '办公协作' },
    { name: '代码生成助手', description: '补全、优化与代码解释', icon: <CodeOutlined />, tone: 'violet', category: '研发提效' },
    { name: '数据分析助手', description: '智能洞察与报表生成', icon: <DatabaseOutlined />, tone: 'green', category: '数据分析' },
    { name: '智能客服助手', description: '全天候智能客户响应', icon: <MessageOutlined />, tone: 'orange', category: '智能客服' },
    { name: '合同审查助手', description: '识别风险条款与修改建议', icon: <CheckCircleOutlined />, tone: 'blue', category: '办公协作' },
    { name: '项目管理助手', description: '计划拆解与进度跟踪', icon: <SettingOutlined />, tone: 'mint', category: '办公协作' },
    { name: '招聘筛选助手', description: '智能匹配岗位与人才', icon: <UserOutlined />, tone: 'sky', category: '办公协作' },
    { name: '财务报表助手', description: '指标解读与异常分析', icon: <BankOutlined />, tone: 'amber', category: '数据分析' },
];

const navPermissionByPath: Record<string, string> = {
    '/assignment': 'assignment.policy.read',
    '/roles': 'role.read',
    '/projects': 'project.read',
    '/meetings': 'meeting.read',
    '/reports': 'work_report.read',
    '/notifications': 'notification.read',
};

const navAnyPermissionByPath: Record<string, string[]> = {
    '/dingtalk': ['dingtalk.integration.read', 'dingtalk.organization.read', 'dingtalk.organization.mapping.preview'],
    '/hr': ['hr.profile.read', 'hr.leave.read', 'hr.attendance.read', 'hr.overtime.read', 'hr.employee_change.read', 'hr.report.read'],
    '/finance': ['finance.expense.read', 'finance.expense.request', 'finance.expense.approve', 'finance.expense.manage_all'],
};

interface WorkspaceProps {
    authContext: MeResult;
    onSessionExpired: () => void;
    onProfileUpdated: (displayName: string) => void;
}

function SideNavigation({ collapsed, permissions, unreadCount, onToggle, onLogout }: { collapsed: boolean; permissions: string[]; unreadCount: number; onToggle: () => void; onLogout: () => void }): JSX.Element {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useI18n();
    const { message } = AntdApp.useApp();
    const [debugModalOpen, setDebugModalOpen] = useState(false);
    const [debugPassword, setDebugPassword] = useState('');
    const debugClickTimes = useRef<number[]>([]);

    const handleBrandClick = (): void => {
        const now = Date.now();
        debugClickTimes.current = [...debugClickTimes.current.filter((time) => now - time < 2000), now];
        if (debugClickTimes.current.length >= 5) {
            debugClickTimes.current = [];
            setDebugPassword('');
            setDebugModalOpen(true);
        }
    };

    const verifyDebugPassword = (): void => {
        if (debugPassword === 'aa123456') {
            window.cees?.openDevTools();
            setDebugModalOpen(false);
            setDebugPassword('');
            message.success(t('已打开开发者工具'));
        } else {
            message.error(t('密码错误'));
        }
    };

    return <aside className={`side-navigation ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="workspace-brand" title={t('CEES AI')} onClick={handleBrandClick}>
            <span className="workspace-brand-mark"><CeesLogo /></span>
            {!collapsed && <span><strong>CEES AI</strong><small>{t('企业智能工作台')}</small></span>}
        </div>
        <nav className="nav-list">
            {navItems.filter((item) => {
                const requiredPermission = navPermissionByPath[item.path];
                const anyPermissions = navAnyPermissionByPath[item.path];
                return (!requiredPermission || permissions.includes(requiredPermission)) && (!anyPermissions || anyPermissions.some((permission) => permissions.includes(permission)));
            }).map((item) => <Tooltip key={item.path} title={collapsed ? t(item.label) : ''} placement="right">
                <button className={`nav-item ${location.pathname === item.path ? 'is-active' : ''}`} type="button" onClick={() => navigate(item.path)}>
                    {item.path === '/notifications' ? <Badge count={unreadCount} size="small" offset={[2, -2]}>{item.icon}</Badge> : item.icon}{!collapsed && <span>{t(item.label)}</span>}
                </button>
            </Tooltip>)}
        </nav>
        <div className="nav-bottom">
            <Tooltip title={collapsed ? t('个人中心') : ''} placement="right"><button className={`nav-item ${location.pathname === '/profile' ? 'is-active' : ''}`} type="button" onClick={() => navigate('/profile')}><UserOutlined />{!collapsed && <span>{t('个人中心')}</span>}</button></Tooltip>
            <Tooltip title={collapsed ? t('退出登录') : ''} placement="right"><button className="nav-item" type="button" onClick={onLogout}><LogoutOutlined />{!collapsed && <span>{t('退出登录')}</span>}</button></Tooltip>
            <Tooltip title={collapsed ? t('收起导航') : ''} placement="right"><button className="nav-item nav-toggle" type="button" onClick={onToggle}>{collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}{!collapsed && <span>{t('收起导航')}</span>}</button></Tooltip>
        </div>
        <Modal open={debugModalOpen} title={t('开发者调试')} okText={t('确定')} cancelText={t('取消')} onOk={verifyDebugPassword} onCancel={() => setDebugModalOpen(false)}>
            <Input.Password value={debugPassword} onChange={(event) => setDebugPassword(event.target.value)} onPressEnter={verifyDebugPassword} autoFocus placeholder={t('请输入调试密码')} />
        </Modal>
    </aside>;
}

function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: JSX.Element }): JSX.Element {
    const { t } = useI18n();
    return <header className="workspace-page-header">
        <div><h1>{t(title)}</h1>{description && <p>{t(description)}</p>}</div>
        {actions}
    </header>;
}

function HomePage({ authContext, documents, memberCount, dashboard, todos, upcomingMeetings, dashboardLoading, onNavigate }: {
    authContext: MeResult;
    documents: ManagedDocumentSummary[];
    memberCount: number;
    dashboard: DashboardOverview | undefined;
    todos: DashboardTodoItem[];
    upcomingMeetings: DashboardUpcomingMeeting[];
    dashboardLoading: boolean;
    onNavigate: (path: string) => void;
}): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const numberValue = (value: unknown): string => value === undefined || value === null ? '-' : String(value);
    const todoRows = dashboardLoading
        ? []
        : [
            ...(todos ?? []).map((todo) => ({ title: todo.title ?? todo.id ?? '', due: todo.dueDate ? formatDate(todo.dueDate) : '', kind: '任务' })),
        ];
    const todoTasks = (todos ?? []);
    return <div className="workspace-page home-page">
        <PageHeader title={t('下午好，{name}', { name: authContext.user.displayName })} description={t('欢迎回到 {tenant}，今天也一起高效工作', { tenant: authContext.tenant.name })} actions={<div className="header-actions"><Input prefix={<SearchOutlined />} placeholder={t('搜索文档、应用、成员')} /><Button type="primary" icon={<PlusOutlined />}>{t('新建')}</Button></div>} />
        <div className="metric-grid">
            {[
                ['进行中项目', numberValue(dashboard?.projects?.active ?? dashboard?.projects?.total), `共 ${numberValue(dashboard?.projects?.total)} 个项目`, <ProjectOutlined />, 'indigo'],
                ['我的任务', numberValue(dashboard?.tasks?.total), dashboard?.tasks?.overdue ? `${numberValue(dashboard.tasks.overdue)} 项已逾期` : '暂无逾期任务', <CheckCircleOutlined />, 'violet'],
                ['待审报告', numberValue(dashboard?.reports?.submitted), `共 ${numberValue(dashboard?.reports?.total)} 份报告`, <ProfileOutlined />, 'green'],
                ['未读通知', numberValue(dashboard?.notifications?.unread), '来自通知中心', <BellOutlined />, 'orange'],
            ].map(([label, value, note, icon, tone]) => <div className="metric-panel" key={String(label)}>
                <div><span>{t(String(label))}</span><strong>{value}</strong><small>{t(String(note))}</small></div><i className={`tone-${tone}`}>{icon}</i>
            </div>)}
        </div>
        <section className="shortcut-grid">
            {appItems.slice(0, 4).map((item) => <button type="button" className="shortcut-item" key={item.name}><i className={`tone-${item.tone}`}>{item.icon}</i><span><strong>{t(item.name)}</strong><small>{t(item.description)}</small></span></button>)}
        </section>
        <h2 className="section-title">{t('快捷入口')}</h2>
        <div className="home-content-grid">
            <div className="home-main-column">
                <section className="surface-panel recent-documents">
                    <div className="panel-heading"><h3>{t('最近文档')}</h3><button type="button">{t('查看全部')}</button></div>
                    {documents.length ? documents.slice(0, 3).map((document) => <div className="document-row" key={document.id}><i><FileTextOutlined /></i><span><strong>{document.title}</strong><small>{document.visibility === 'TENANT' ? t('租户可见') : t('私有')} · {formatDate(document.updatedAt)}</small></span><Tag>{document.visibility === 'TENANT' ? t('租户') : t('私有')}</Tag></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前权限范围内暂无文档')} />}
                </section>
                <section className="surface-panel task-panel">
                    <div className="panel-heading"><h3>{t('待办事项')}</h3><button type="button" onClick={() => onNavigate('/projects')}>{t('全部待办')}</button></div>
                    {dashboardLoading ? <div className="data-loading"><Spin /></div> : todoTasks.length ? todoTasks.slice(0, 5).map((todo) => <div className="task-row" key={todo.id ?? todo.title}><span>{todo.title}</span>{todo.dueDate && <strong className="warning-text">{formatDate(todo.dueDate)}</strong>}</div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前没有待办')} />}
                </section>
            </div>
            <div className="home-side-column">
                <section className="assistant-widget">
                    <div className="assistant-widget-title"><i><CeesLogo /></i><strong>{t('AI 助手')}</strong></div>
                    <p>{t('有什么可以帮你的？')}</p>
                    <button type="button" onClick={() => message.info(t('请从左侧进入 AI 助手开始对话'))}>{t('输入你的问题…')}<Send size={16} /></button>
                </section>
                <section className="surface-panel activity-panel">
                    <div className="panel-heading"><h3>{t('近期会议')}</h3><button type="button" onClick={() => onNavigate('/meetings')}>{t('查看全部')}</button></div>
                    {dashboardLoading ? <div className="data-loading"><Spin /></div> : upcomingMeetings.length ? upcomingMeetings.map((meeting) => <div className="activity-row" key={meeting.id ?? meeting.title}><Avatar size={26} icon={<CalendarOutlined />} /><span>{meeting.title}<small>{meeting.startsAt ? formatDate(meeting.startsAt) : ''}</small></span></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('近期没有会议')} />}
                </section>
            </div>
        </div>
    </div>;
}

interface LocalChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    resources?: ChatResource[];
    sources?: ChatSource[];
}

interface ChatResource {
    id: string;
    type: 'IMAGE' | 'DOCUMENT';
    url?: string | null;
}

interface ChatSource {
    id: string;
    title: string;
    url: string;
    domain: string;
    snippet: string;
    publishedAt?: string | null;
}

function ChatResourceCard({ resource, onPreviewDocument }: { resource: ChatResource; onPreviewDocument: (document: { id: string; title: string; content: string }) => void }): JSX.Element {
    const { message } = AntdApp.useApp();
    const [image, setImage] = useState<ImageAccess>();
    const [documentTitle, setDocumentTitle] = useState('生成文档');
    const [documentContent, setDocumentContent] = useState<string>();
    useEffect(() => {
        if (resource.type === 'IMAGE' && !resource.url) void getImage(resource.id).then(setImage).catch(() => undefined);
        if (resource.type === 'DOCUMENT') void getDocument(resource.id).then((document) => { setDocumentTitle(document.title); setDocumentContent(document.content); }).catch(() => undefined);
    }, [resource.id, resource.type]);
    const download = async (): Promise<void> => {
        try {
            if (resource.type === 'IMAGE') {
                const access = image ?? (resource.url ? { url: resource.url, mimeType: 'image/png' as const } : await getImage(resource.id));
                const response = await fetch(access.url);
                const blobUrl = URL.createObjectURL(await response.blob());
                const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = `${resource.id}.${access.mimeType.split('/')[1]}`; anchor.click(); URL.revokeObjectURL(blobUrl);
            } else if (documentContent !== undefined) {
                const blobUrl = URL.createObjectURL(new Blob([documentContent], { type: 'text/markdown;charset=utf-8' }));
                const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = `${documentTitle}.md`; anchor.click(); URL.revokeObjectURL(blobUrl);
            }
        } catch (error) { message.error(error instanceof Error ? error.message : '资源下载失败'); }
    };
    return <div className={`chat-resource ${resource.type.toLowerCase()}`}>
        {resource.type === 'IMAGE' && <>{image || resource.url ? <AntImage className="chat-resource-image" src={image?.url ?? resource.url ?? undefined} alt="AI 生成图片" preview={{ mask: '点击放大' }} /> : <Spin size="small" />}<Button size="small" disabled={!image && !resource.url} icon={<Download size={15} />} onClick={() => void download()}>{'下载'}</Button></>}
        {resource.type === 'DOCUMENT' && <>
            <div className="chat-resource-header"><span><FileTextIcon size={17} />{documentTitle}</span><span className="chat-resource-actions"><Button size="small" disabled={documentContent === undefined} icon={<Eye size={15} />} onClick={() => documentContent !== undefined && onPreviewDocument({ id: resource.id, title: documentTitle, content: documentContent })}>{'查看内容'}</Button><Button size="small" disabled={documentContent === undefined} icon={<Download size={15} />} onClick={() => void download()}>{'下载'}</Button></span></div>
        </>}
    </div>;
}

function ChatSourceCard({ source }: { source: ChatSource }): JSX.Element {
    return <a className="chat-source" href={source.url} target="_blank" rel="noreferrer">
        <span className="chat-source-heading"><Globe2 size={15} /><strong>{source.title || source.domain}</strong></span>
        <span className="chat-source-domain">{source.domain}</span>
        {source.snippet && <span className="chat-source-snippet">{source.snippet}</span>}
    </a>;
}

function AssistantPage(): JSX.Element {
    const { t } = useI18n();
    const { message } = AntdApp.useApp();
    const [input, setInput] = useState('');
    const [selectedPrompt, setSelectedPrompt] = useState<string>();
    const [mode, setMode] = useState<'standard' | 'ultra'>('standard');
    const [networkSearch, setNetworkSearch] = useState(false);
    const [knowledgeBase, setKnowledgeBase] = useState(false);
    const [attachment, setAttachment] = useState<{ name: string; id: string; isImage: boolean }>();
    const [imageGenerating, setImageGenerating] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const [sending, setSending] = useState(false);
    const [messages, setMessages] = useState<LocalChatMessage[]>([]);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string>();
    const [activeTurn, setActiveTurn] = useState<{ conversationId: string; turnId: string; seq: number }>();
    const abortController = useRef<AbortController>();
    const requestVersion = useRef(0);
    const streamFlush = useRef<ReturnType<typeof setTimeout>>();
    const [previewDocument, setPreviewDocument] = useState<{ id: string; title: string; content: string }>();
    const [renameTarget, setRenameTarget] = useState<Conversation>();
    const [renameValue, setRenameValue] = useState('');
    useEffect(() => { void listConversations().then((result) => { setConversations(result.items); if (result.items[0]) void selectConversation(result.items[0]); }).catch((error) => message.error(error instanceof Error ? error.message : '加载会话失败')); }, []);
    useEffect(() => () => abortController.current?.abort(), []);

    const copyText = async (text: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            message.success(t('已复制'));
        } catch {
            message.error(t('复制失败'));
        }
    };

    const submitRename = (): void => {
        const target = renameTarget;
        const title = renameValue.trim();
        if (!target) { setRenameTarget(undefined); return; }
        if (!title || title === target.title) { setRenameTarget(undefined); return; }
        void updateConversation(target.id, title, target.version)
            .then((updated) => setConversations((items) => items.map((item) => item.id === updated.id ? updated : item)))
            .catch((error) => message.error(error instanceof Error ? error.message : t('重命名失败')))
            .finally(() => setRenameTarget(undefined));
    };

    const newConversation = (): void => {
        void createConversation().then((conversation) => { setConversations((items) => [conversation, ...items]); setActiveConversationId(conversation.id); setMessages([]); setPreviewDocument(undefined); }).catch((error) => message.error(error instanceof Error ? error.message : '创建会话失败'));
    };

    const selectConversation = async (conversation: Conversation): Promise<void> => {
        requestVersion.current += 1;
        abortController.current?.abort();
        setSending(false);
        setActiveTurn(undefined);
        setPreviewDocument(undefined);
        setImageGenerating(false);
        setActiveConversationId(conversation.id);
        const detail = await getConversation(conversation.id);
        if (activeConversationId && activeConversationId !== conversation.id) return;
        const cachedSources = JSON.parse(localStorage.getItem(`cees.chat.sources.${conversation.id}`) ?? '[]') as ChatSource[];
        const resourcesByTurn = new Map<string, ChatResource[]>();
        for (const item of detail.messages) {
            const resources = item.resources?.map((resource): ChatResource => ({ id: resource.id || resource.resourceId || '', type: resource.type, url: resource.url ?? resource.resourceUrl })) ?? [];
            const legacyImageUrl = item.role === 'TOOL' ? item.content.match(/https?:\/\/\S+/)?.[0] : undefined;
            if (legacyImageUrl && item.turnId && item.toolCallId) resources.push({ id: item.toolCallId, type: 'IMAGE', url: legacyImageUrl });
            if (resources.length && item.turnId) resourcesByTurn.set(item.turnId, [...(resourcesByTurn.get(item.turnId) ?? []), ...resources]);
        }
        const restored: LocalChatMessage[] = detail.messages.filter((item) => item.role !== 'TOOL').map((item) => ({ id: item.id, role: item.role === 'USER' ? 'user' : 'assistant', content: item.content, resources: item.role === 'ASSISTANT' ? resourcesByTurn.get(item.turnId ?? '') : undefined }));
        if (cachedSources.length) {
            const lastAssistantMessage = [...restored].reverse().find((item) => item.role === 'assistant');
            if (lastAssistantMessage) lastAssistantMessage.sources = cachedSources;
        }
        setMessages(restored);
    };

    const sendMessage = async (): Promise<void> => {
        const text = input.trim();
        const imageFileIds = attachment?.isImage ? [attachment.id] : [];
        const options = [networkSearch && '使用联网搜索', knowledgeBase && '使用知识库', attachment && !attachment.isImage && `参考附件：${attachment.name}（${attachment.id}）`].filter(Boolean);
        const content = [selectedPrompt, ...options, text].filter(Boolean).join('\n') || (imageFileIds.length ? t('请分析这张图片') : '');
        if ((!content && !imageFileIds.length) || sending) return;
        setInput('');
        setSelectedPrompt(undefined);
        setAttachment(undefined);
        setSending(true);
        const version = ++requestVersion.current;
        const controller = new AbortController();
        abortController.current = controller;
        const userMessage: LocalChatMessage = { id: `m-${Date.now()}`, role: 'user', content };
        setMessages((items) => [...items, userMessage]);
        try {
            const conversationId = activeConversationId ?? (await createConversation()).id;
            setActiveConversationId(conversationId);
            if (!conversations.some((item) => item.id === conversationId)) setConversations((items) => [{ id: conversationId, title: t('新对话'), mode, visibility: 'PRIVATE', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...items]);
            let turnId = ''; let seq = 0; let answer = ''; let terminal = false; const streamingMessageId = `streaming-${Date.now()}`; const resources: ChatResource[] = []; const sources: ChatSource[] = []; const toolTypes = new Map<string, ChatResource['type']>();
            const updateStreamingMessage = (): void => setMessages((items) => [...items.filter((item) => item.id !== streamingMessageId), { id: streamingMessageId, role: 'assistant', content: answer, resources: [...resources], sources: [...sources] }]);
            const handle = (event: TurnStreamEvent): void => {
                if (event.seq <= seq) return;
                seq = event.seq;
                if (event.type === 'started') { turnId = event.turnId; setActiveTurn({ conversationId, turnId, seq }); }
                if (event.type === 'content_delta') { answer += event.text; if (!streamFlush.current) streamFlush.current = setTimeout(() => { streamFlush.current = undefined; updateStreamingMessage(); }, 50); }
                if (event.type === 'tool_call') { if (event.name === 'generate_document') toolTypes.set(event.toolCallId, 'DOCUMENT'); else if (event.name === 'generate_image') { toolTypes.set(event.toolCallId, 'IMAGE'); setImageGenerating(true); } }
                if (event.type === 'tool_result' && event.status === 'completed') {
                    if (event.sources?.length) { sources.push(...event.sources); updateStreamingMessage(); }
                    const resourceId = event.resource?.id ?? event.resourceId;
                    const resourceType = event.resource?.type ?? toolTypes.get(event.toolCallId);
                    if (resourceId && resourceType) { resources.push({ id: resourceId, type: resourceType, url: event.resourceUrl }); if (resourceType === 'IMAGE') setImageGenerating(false); updateStreamingMessage(); }
                }
                if (event.type === 'error') { terminal = true; setImageGenerating(false); throw new Error(event.error.message); }
                if (event.type === 'completed') { terminal = true; setImageGenerating(false); if (sources.length) localStorage.setItem(`cees.chat.sources.${conversationId}`, JSON.stringify(sources)); if (event.finishReason === 'length') message.warning(t('回答达到长度上限，内容可能不完整')); }
            };
            const replay = async (): Promise<void> => {
                for (let attempt = 0; attempt < 3 && !terminal; attempt += 1) await replayTurnEvents(conversationId, turnId, seq, handle, controller.signal);
                if (!terminal) throw new Error(t('连接已断开，请稍后重试'));
            };
            try {
                await createTurn(conversationId, { content, mode, imageFileIds }, crypto.randomUUID(), handle, controller.signal);
            } catch (error) {
                if (!turnId || controller.signal.aborted || terminal) throw error;
                await replay();
            }
            if (!terminal && turnId && !controller.signal.aborted) await replay();
            if (version === requestVersion.current) setActiveTurn(undefined);
        } catch (error) {
            if (!controller.signal.aborted && version === requestVersion.current) message.error(error instanceof Error ? error.message : t('AI 请求失败，请稍后重试'));
        } finally {
            if (version === requestVersion.current) { setSending(false); abortController.current = undefined; }
        }
    };

    return <div className={`assistant-layout ${previewDocument ? 'has-preview' : ''}`}>
        <aside className="conversation-list">
            <div className="conversation-heading"><h2>{t('对话')}</h2><Button type="primary" icon={<PlusOutlined />} onClick={newConversation}>{t('新对话')}</Button></div>
            {conversations.map((conversation) => <Dropdown key={conversation.id} trigger={['contextMenu']} menu={{ items: [{ key: 'rename', icon: <Pencil size={15} />, label: t('重命名'), onClick: () => { setRenameTarget(conversation); setRenameValue(conversation.title); } }, { key: 'delete', danger: true, icon: <Trash2 size={15} />, label: t('删除对话'), onClick: () => Modal.confirm({ title: t('删除对话'), content: t('删除后无法恢复，确认删除吗？'), onOk: async () => { await deleteConversation(conversation.id, conversation.version); setConversations((items) => items.filter((item) => item.id !== conversation.id)); if (activeConversationId === conversation.id) { setActiveConversationId(undefined); setMessages([]); } } }) }] }}><button className={`conversation-item ${conversation.id === activeConversationId ? 'is-active' : ''}`} type="button" onClick={() => void selectConversation(conversation)}><strong>{conversation.title || t('新对话')}</strong><small>{conversation.lastTurnAt ? new Date(conversation.lastTurnAt).toLocaleString() : t('尚未开始')}</small></button></Dropdown>)}
        </aside>
        <section className="chat-panel">
            <header className="chat-header"><span><i><CeesLogo /></i><strong>{t('CEES AI 助手')}</strong></span><span>{activeTurn && <Button size="small" danger onClick={() => { abortController.current?.abort(); setImageGenerating(false); void cancelTurn(activeTurn.conversationId, activeTurn.turnId).finally(() => setActiveTurn(undefined)); }}>{t('停止生成')}</Button>}</span></header>
            <div className="message-stream">
                {messages.map((item, index) => <div className={`chat-message ${item.role}`} key={`${item.role}-${index}`}>
                    {item.role === 'assistant' && <i className="assistant-avatar"><CeesLogo /></i>}
                    <div className="chat-message-body">
                        <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown></div>
                        {item.resources?.map((resource) => <ChatResourceCard key={`${resource.type}-${resource.id}`} resource={resource} onPreviewDocument={setPreviewDocument} />)}
                        {item.sources?.length ? <div className="chat-sources">{item.sources.map((source) => <ChatSourceCard key={source.id} source={source} />)}</div> : null}
                        <button className="chat-copy" type="button" onClick={() => void copyText(item.content)}><CopyOutlined />{t('复制')}</button>
                    </div>
                </div>)}
                {sending && <div className="chat-message assistant"><i className="assistant-avatar"><CeesLogo /></i><div className={`chat-generation-status ${imageGenerating ? 'is-image-generation' : ''}`}><span className={imageGenerating ? 'image-generating-orbit' : 'thinking-dots'} />{imageGenerating ? <span>图片生成中</span> : <span>{t('正在思考…')}</span>}</div></div>}
            </div>
            <div className="composer-area">
                <div className="message-composer">
                    <div className="message-editor">
                        {selectedPrompt && <Tag closable onClose={() => setSelectedPrompt(undefined)}>{t(selectedPrompt)}</Tag>}
                        {attachment && <Tag closable icon={attachment.isImage ? <FileImage size={14} /> : <FileTextIcon size={14} />} onClose={() => setAttachment(undefined)}>{attachment.name}</Tag>}
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} value={input} onChange={(event) => setInput(event.target.value)} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={t('输入消息，Enter 发送')} />
                        <div className="composer-footer">
                            <Dropdown trigger={['click']} menu={{ items: [{ key: 'upload', icon: <Upload size={16} />, label: '上传文件或图片', onClick: () => fileInput.current?.click() }, { key: 'image', icon: <ImagePlus size={16} />, label: '生成图片', onClick: () => setSelectedPrompt('生成图片') }, { key: 'document', icon: <FileTextIcon size={16} />, label: '生成文档', onClick: () => setSelectedPrompt('生成文档') }] }}><Button type="text" className="composer-add" icon={<PlusOutlined />} /></Dropdown>
                            <input ref={fileInput} type="file" hidden accept="image/*,.pdf,.doc,.docx,.txt,.md" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void uploadAttachmentFile(file).then((id) => setAttachment({ name: file.name, id, isImage: file.type.startsWith('image/') })).catch((error) => message.error(error instanceof Error ? error.message : '附件上传失败')); event.target.value = ''; }} />
                            <Button type="text" className={`composer-option ${networkSearch ? 'is-selected' : ''}`} icon={<Globe2 size={15} />} onClick={() => setNetworkSearch((value) => !value)}>联网搜索</Button>
                            <Button type="text" className={`composer-option ${knowledgeBase ? 'is-selected' : ''}`} icon={<BookOpen size={15} />} onClick={() => setKnowledgeBase((value) => !value)}>知识库</Button>
                            <Select className="composer-mode" size="small" value={mode} onChange={setMode} options={[{ label: '快速模式', value: 'standard' }, { label: '深度模式', value: 'ultra' }]} />
                            <Button type="primary" className="composer-send" icon={<Send size={16} />} loading={sending} onClick={() => void sendMessage()}>发送</Button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
        {previewDocument && <aside className="document-preview-panel"><div className="document-preview-heading"><span><FileTextIcon size={18} /><strong>{previewDocument.title}</strong></span><Button type="text" onClick={() => setPreviewDocument(undefined)}>×</Button></div><div className="document-preview-content chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{previewDocument.content}</ReactMarkdown></div></aside>}
        <Modal open={!!renameTarget} title={t('重命名对话')} okText={t('确定')} cancelText={t('取消')} onOk={submitRename} onCancel={() => setRenameTarget(undefined)}>
            <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onPressEnter={submitRename} maxLength={128} autoFocus placeholder={t('请输入新的对话名称')} />
        </Modal>
    </div>;
}

function BrowserPage(): JSX.Element {
    const location = useLocation();
    const navigate = useNavigate();
    const { t } = useI18n();
    const targetUrl = new URLSearchParams(location.search).get('url') ?? '';
    const [address, setAddress] = useState(targetUrl);
    const [currentUrl, setCurrentUrl] = useState(targetUrl);
    const webviewRef = useRef<WebviewElement | null>(null);

    useEffect(() => {
        setAddress(targetUrl);
        setCurrentUrl(targetUrl);
    }, [targetUrl]);

    useEffect(() => {
        const webview = webviewRef.current;
        if (!webview) return;
        const syncUrl = (): void => {
            const url = webview.getURL?.() ?? '';
            if (url && url !== 'about:blank') { setAddress(url); setCurrentUrl(url); }
        };
        webview.addEventListener('did-navigate', syncUrl);
        webview.addEventListener('did-navigate-in-page', syncUrl);
        return () => {
            webview.removeEventListener('did-navigate', syncUrl);
            webview.removeEventListener('did-navigate-in-page', syncUrl);
        };
    }, []);

    const navigateTo = (): void => {
        const trimmed = address.trim();
        if (!trimmed) return;
        const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        setAddress(url);
        setCurrentUrl(url);
    };

    const openExternal = (): void => {
        if (currentUrl) window.open(currentUrl, '_blank', 'noopener');
    };

    return <div className="browser-page">
        <div className="browser-toolbar">
            <Tooltip title={t('后退')}><button type="button" className="browser-nav-btn" onClick={() => webviewRef.current?.goBack()}><ArrowLeft size={16} /></button></Tooltip>
            <Tooltip title={t('前进')}><button type="button" className="browser-nav-btn" onClick={() => webviewRef.current?.goForward()}><ArrowRight size={16} /></button></Tooltip>
            <Tooltip title={t('刷新')}><button type="button" className="browser-nav-btn" onClick={() => webviewRef.current?.reload()}><RotateCw size={16} /></button></Tooltip>
            <Input className="browser-address" value={address} onChange={(event) => setAddress(event.target.value)} onPressEnter={navigateTo} prefix={<Globe2 size={14} />} placeholder={t('输入网址，回车打开')} allowClear />
            <Tooltip title={t('在系统浏览器打开')}><button type="button" className="browser-nav-btn" onClick={openExternal}><ExternalLink size={16} /></button></Tooltip>
            <Tooltip title={t('关闭')}><button type="button" className="browser-nav-btn browser-close" onClick={() => navigate(-1)}><X size={16} /></button></Tooltip>
        </div>
        <div className="browser-content">
            <webview ref={(element) => { webviewRef.current = element as WebviewElement | null; }} src={currentUrl || 'about:blank'} className="browser-webview" partition="persist:browser" />
        </div>
    </div>;
}

function ApplicationsPage(): JSX.Element {
    const { t } = useI18n();
    const [category, setCategory] = useState('全部');
    const [selected, setSelected] = useState(appItems[0]);
    const { message } = AntdApp.useApp();
    const categories = ['全部', '办公协作', '研发提效', '营销增长', '智能客服', '数据分析'];
    const filteredApps = category === '全部' ? appItems : appItems.filter((item) => item.category === category);

    return <div className="workspace-page applications-page">
        <PageHeader title={t('AI 应用中心')} description={t('选择适合团队场景的智能应用')} />
        <div className="category-tabs">{categories.map((item) => <button className={category === item ? 'is-active' : ''} type="button" key={item} onClick={() => setCategory(item)}>{t(item)}</button>)}</div>
        <div className="application-layout">
            <div><h2 className="section-title">{t('平台推荐')}</h2><div className="application-grid">
                {filteredApps.map((item) => <button className={`application-card ${selected.name === item.name ? 'is-selected' : ''}`} type="button" key={item.name} onClick={() => setSelected(item)}><i className={`tone-${item.tone}`}>{item.icon}</i><strong>{t(item.name)}</strong><p>{t(item.description)}</p><span>{t('查看详情')}</span></button>)}
            </div></div>
            <aside className="application-detail"><div className="detail-heading"><i className={`tone-${selected.tone}`}>{selected.icon}</i><span><h2>{t(selected.name)}</h2><Tag>v2.1.0</Tag></span></div><p>{t('基于企业知识与大语言模型能力，为团队提供可靠、可控的智能工作支持。')}</p><dl><div><dt>{t('开发者')}</dt><dd>{t('CEES AI 团队')}</dd></div><div><dt>{t('更新时间')}</dt><dd>2026-09-07</dd></div><div><dt>{t('使用人数')}</dt><dd>{t('1,256 人')}</dd></div></dl><div className="application-example"><strong>{t('应用示例')}</strong><p>{t('请帮我总结这份报告，并提取需要跟进的关键事项。')}</p></div><Button type="primary" block onClick={() => message.success(t('已打开 {name}', { name: t(selected.name) }))}>{t('使用应用')}</Button></aside>
        </div>
    </div>;
}

function KnowledgePage({ documents, loading }: { documents: ManagedDocumentSummary[]; loading: boolean }): JSX.Element {
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const [search, setSearch] = useState('');
    const filteredDocuments = documents.filter((document) => document.title.toLowerCase().includes(search.toLowerCase()));
    const [selectedId, setSelectedId] = useState<string>();
    const selected = documents.find((document) => document.id === selectedId) ?? documents[0];

    return <div className="workspace-page knowledge-page">
        <PageHeader title={t('知识管理')} description={t('沉淀、组织并安全共享企业知识')} actions={<Button type="primary" icon={<PlusOutlined />}>{t('新建文档')}</Button>} />
        <div className="knowledge-layout">
            <aside className="knowledge-folders surface-panel"><h3>{t('受控文档')}</h3><button className="is-active" type="button"><BookOutlined />{t('全部文档')}<span>{documents.length}</span></button><button type="button"><FolderOutlined />{t('租户可见')}<span>{documents.filter((document) => document.visibility === 'TENANT').length}</span></button><button type="button"><FolderOutlined />{t('我的私有')}<span>{documents.filter((document) => document.visibility === 'PRIVATE').length}</span></button></aside>
            <section className="knowledge-list surface-panel"><div className="knowledge-toolbar"><Input value={search} onChange={(event) => setSearch(event.target.value)} prefix={<SearchOutlined />} placeholder={t('搜索受控文档')} /><Button icon={<StarOutlined />}>{t('收藏')}</Button></div><div className="knowledge-table-head"><span>{t('文档名称')}</span><span>{t('可见性')}</span><span>{t('更新时间')}</span><span>{t('版本')}</span></div>{loading ? <div className="data-loading"><Spin /></div> : filteredDocuments.length ? filteredDocuments.map((document) => <button className={`knowledge-row ${selected?.id === document.id ? 'is-selected' : ''}`} type="button" key={document.id} onClick={() => setSelectedId(document.id)}><span><i><FileTextOutlined /></i><b>{document.title}</b><small>{t('受控文档')}</small></span><span>{document.visibility === 'TENANT' ? t('租户可见') : t('私有')}</span><span>{formatDate(document.updatedAt)}</span><span><Tag>v{document.version}</Tag></span></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前权限范围内暂无文档')} />}</section>
            <aside className="knowledge-detail surface-panel">{selected ? <><i className="knowledge-file-icon"><FileTextOutlined /></i><h2>{selected.title}</h2><Tag>{selected.visibility === 'TENANT' ? t('租户可见') : t('私有')}</Tag><p>{t('该受控文档由 NestJS 统一执行权限、资源范围、版本控制与审计。')}</p><dl><div><dt>{t('最近更新')}</dt><dd>{formatDate(selected.updatedAt)}</dd></div><div><dt>{t('当前版本')}</dt><dd>v{selected.version}</dd></div><div><dt>{t('有效权限')}</dt><dd>{selected.currentPermissions?.join('、') || t('读取')}</dd></div></dl><Button type="primary" block>{t('打开文档')}</Button></> : <Empty description={t('请选择文档')} />}</aside>
        </div>
    </div>;
}

function CurrentPage({ authContext, members, documents, membersLoading, documentsLoading, onSessionExpired, onProfileUpdated }: { authContext: MeResult; members: TenantMember[]; documents: ManagedDocumentSummary[]; membersLoading: boolean; documentsLoading: boolean; onSessionExpired: () => void; onProfileUpdated: (displayName: string) => void }): JSX.Element {
    const navigate = useNavigate();
    const hasPermission = (code: string): boolean => authContext.permissions.includes(code);
    const dashboardQuery = useQuery({ queryKey: ['dashboard-overview'], queryFn: () => getDashboardOverview(), enabled: hasPermission('dashboard.read'), refetchInterval: 120_000 });
    const todosQuery = useQuery({ queryKey: ['dashboard-todos'], queryFn: () => getDashboardTodos({ taskLimit: 5, reportLimit: 5, meetingLimit: 5 }), enabled: hasPermission('dashboard.read'), refetchInterval: 120_000 });
    const upcomingQuery = useQuery({ queryKey: ['dashboard-upcoming'], queryFn: () => getDashboardUpcomingMeetings(5), enabled: hasPermission('dashboard.read') && hasPermission('meeting.read'), refetchInterval: 120_000 });
    const unreadQuery = useQuery({ queryKey: ['notifications-unread'], queryFn: () => getUnreadNotificationCount(), enabled: hasPermission('notification.read'), refetchInterval: 60_000 });

    const location = useLocation();
    if (location.pathname === '/browser') return <BrowserPage />;
    if (location.pathname === '/assistant') return <AssistantPage />;
    if (location.pathname === '/projects') return <ProjectManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/meetings') return <MeetingManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/reports') return <WorkReportPage authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/applications') return <ApplicationsPage />;
    if (location.pathname === '/architecture') return <OrganizationManagement authContext={authContext} fallbackMembers={members} membersLoading={membersLoading} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/assignment') return <AssignmentPolicyManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/hr') return <HrManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/finance') return <FinanceManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/roles') return <RoleManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/dingtalk') return <DingTalkOrganizationPage authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/knowledge') return <KnowledgePage documents={documents} loading={documentsLoading} />;
    if (location.pathname === '/profile') return <ProfileSettings tenantName={authContext.tenant.name} onProfileUpdated={onProfileUpdated} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/notifications') return <NotificationCenter authContext={authContext} onSessionExpired={onSessionExpired} />;
    return <HomePage
        authContext={authContext}
        documents={documents}
        memberCount={members.length}
        dashboard={dashboardQuery.data}
        todos={[...(todosQuery.data?.tasks ?? []), ...(todosQuery.data?.reports ?? []), ...(todosQuery.data?.meetings ?? [])]}
        upcomingMeetings={upcomingQuery.data?.items ?? []}
        dashboardLoading={dashboardQuery.isLoading || todosQuery.isLoading}
        onNavigate={(path) => navigate(path)}
    />;
}

export default function Workspace({ authContext, onSessionExpired, onProfileUpdated }: WorkspaceProps): JSX.Element {
    const [collapsed, setCollapsed] = useState(false);
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const navigate = useNavigate();
    const membersQuery = useQuery({ queryKey: ['tenant-members'], queryFn: () => listTenantMembers() });
    const documentsQuery = useQuery({ queryKey: ['documents'], queryFn: () => listDocuments() });
    const unreadQuery = useQuery({ queryKey: ['notifications-unread'], queryFn: () => getUnreadNotificationCount(), enabled: authContext.permissions.includes('notification.read'), refetchInterval: 60_000 });

    useEffect(() => {
        if ((membersQuery.error || documentsQuery.error) && !hasStoredSession()) onSessionExpired();
    }, [documentsQuery.error, membersQuery.error, onSessionExpired]);

    useEffect(() => {
        const handleClick = (event: MouseEvent): void => {
            if (event.defaultPrevented || event.button !== 0) return;
            const target = event.target as HTMLElement | null;
            const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!anchor) return;
            const href = anchor.getAttribute('href') ?? '';
            if (!/^https?:\/\//i.test(href)) return;
            event.preventDefault();
            event.stopPropagation();
            navigate(`/browser?url=${encodeURIComponent(href)}`);
        };
        document.addEventListener('click', handleClick, true);
        return () => document.removeEventListener('click', handleClick, true);
    }, [navigate]);

    const handleLogout = async (): Promise<void> => {
        await logout();
        message.success(t('已安全退出'));
        onSessionExpired();
    };

    return <div className={`workspace-shell ${collapsed ? 'nav-collapsed' : ''}`}>
        <SideNavigation collapsed={collapsed} permissions={authContext.permissions} unreadCount={unreadQuery.data ?? 0} onToggle={() => setCollapsed((current) => !current)} onLogout={() => void handleLogout()} />
        <main className="workspace-content"><CurrentPage authContext={authContext} members={membersQuery.data?.items ?? []} documents={documentsQuery.data?.items ?? []} membersLoading={membersQuery.isLoading} documentsLoading={documentsQuery.isLoading} onSessionExpired={onSessionExpired} onProfileUpdated={onProfileUpdated} /></main>
    </div>;
}
