import {
    AppstoreOutlined, BankOutlined, BellOutlined, BookOutlined, CheckCircleOutlined,
    CloudSyncOutlined, CodeOutlined, CopyOutlined, DatabaseOutlined, FileProtectOutlined, FileTextOutlined, FolderOutlined,
    HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, MoreOutlined,
    PartitionOutlined, PlusOutlined, ProjectOutlined, SafetyCertificateOutlined, SearchOutlined, SettingOutlined,
    CalendarOutlined, NotificationOutlined, ProfileOutlined,
    TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { App as AntdApp, Avatar, Badge, Button, Empty, Image as AntImage, Input, Modal, Select, Spin, Tag, Tooltip, Dropdown } from 'antd';
import { useQuery } from '@tanstack/react-query';
// import { ArrowLeft, ArrowRight, BookOpen, Download, ExternalLink, Eye, FileImage, FileText as FileTextIcon, Globe2, ImagePlus, Pencil, RotateCw, Send, Trash2, Upload, X } from 'lucide-react';
import { ArrowLeft, ArrowRight, BookOpen, Download, ExternalLink, Eye, FileImage, FileText as FileTextIcon, Globe2, ImagePlus, Pencil, RotateCw, Save, Send, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useLocation, useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import {
    cancelActionDraft, cancelTurn, confirmActionDraft, createConversation, createTurn, deleteConversation, exportDocument, getConversation, getDashboardOverview, getDashboardTodos, getDashboardUpcomingMeetings, getDocument, getImage, planDingTalkConnectorQueries, planTencentMeetingConnectorQueries, planWeComConnectorQueries, replayTurnEvents, updateConversation, uploadAttachmentFile,
    getUnreadNotificationCount, hasStoredSession, listConversations, listDocuments, listTenantMembers, logout,
    createKnowledgeDocument, deleteKnowledgeDocument, listWritableKnowledgeBases,
    type Conversation, type ConversationMessage, type DashboardOverview, type DashboardTodoItem, type DashboardUpcomingMeeting, type ImageAccess,
    type ConnectorContext, type TencentMeetingConnectorTool, type TurnStreamEvent, type WeComConnectorTool,
    type KnowledgeBaseSummary, type KnowledgeSourceType,
    type ManagedDocumentSummary, type MeResult, type TenantMember,
} from '../core/api';
import MeetingManagement from '../features/meetings/MeetingManagement';
import DingTalkOrganizationPage from '../features/dingtalk/DingTalkOrganizationPage';
import ConnectorMarketplacePage from '../features/connectors/ConnectorMarketplacePage';
import NotificationCenter from '../features/notifications/NotificationCenter';
import OrganizationManagement from '../features/organization/OrganizationManagement';
import ProjectManagement from '../features/projects/ProjectManagement';
import WorkReportPage from '../features/reports/WorkReportPage';
import ProfileSettings from '../features/profile/ProfileSettings';
import RoleManagement from '../features/roles/RoleManagement';
import AssignmentPolicyManagement from '../features/assignment/AssignmentPolicyManagement';
import HrManagement from '../features/hr/HrManagement';
import FinanceManagement from '../features/finance/FinanceManagement';
import LegalContractManagement from '../features/legal/LegalContractManagement';
import KnowledgeManagement from '../features/knowledge/KnowledgeManagement';
import ManagedDocumentsPage from '../features/documents/ManagedDocumentsPage';
import RoleBasedHomePage from '../features/dashboard/HomePage';
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

interface NavSection {
    key: string;
    label: string;
    icon: JSX.Element;
    items: NavItem[];
}

function CeesLogo({ className }: { className?: string }): JSX.Element {
    return <img className={className} src="./assests/logo.webp" alt="CEES AI" />;
}

/**
 * 分组折叠箭头：自绘细线 chevron，未展开指向右（>），展开后指向下（v）。
 * 不用 antd 的实心三角/线条图标，避免在 12px 字号下笔画发粗、显得笨重。
 */
function NavCaret({ open }: { open: boolean }): JSX.Element {
    return <span className={`nav-group-caret ${open ? 'is-open' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
    </span>;
}

/**
 * 回答/预览正文里的 Markdown 图片一律不渲染为 <img>。
 *
 * 契约（docs/api/assistant-api.md）规定图片只以服务端 resources 的稳定引用为准，
 * 不从消息正文文本中解析图片地址；模型在正文里写出的地址通常是幻觉或上一轮
 * 搜索结果残留，直接渲染就会出现「打不开/一片空白」的坏图。这里降级为可见的
 * 文字提示：既不再产生坏图，也不丢失模型想表达的信息。
 */
const markdownRenderComponents: Components = {
    img: ({ alt }) => <span className="chat-inline-image-fallback">{(alt ?? '').trim() || '图片'}</span>,
};

/** 始终置顶的独立入口：首页、AI 助手、连接器 */
const pinnedNavItems: NavItem[] = [
    { path: '/', label: '首页', icon: <HomeOutlined /> },
    { path: '/assistant', label: 'AI 助手', icon: <MessageOutlined /> },
    { path: '/connectors', label: '连接器', icon: <AppstoreOutlined /> },
];

/** 其余功能按业务域归类到可折叠的父级管理中 */
const navSections: NavSection[] = [
    {
        key: 'collaboration',
        label: '协作管理',
        icon: <ProjectOutlined />,
        items: [
            { path: '/projects', label: '项目管理', icon: <ProjectOutlined /> },
            { path: '/meetings', label: '会议管理', icon: <CalendarOutlined /> },
            { path: '/reports', label: '工作报告', icon: <ProfileOutlined /> },
        ],
    },
    {
        key: 'organization',
        label: '组织管理',
        icon: <TeamOutlined />,
        items: [
            { path: '/architecture', label: '架构管理', icon: <TeamOutlined /> },
            { path: '/roles', label: '角色权限', icon: <SafetyCertificateOutlined /> },
            { path: '/assignment', label: '分配策略', icon: <PartitionOutlined /> },
            { path: '/dingtalk', label: '钉钉管理', icon: <CloudSyncOutlined /> },
        ],
    },
    {
        key: 'business',
        label: '业务管理',
        icon: <BankOutlined />,
        items: [
            { path: '/hr', label: '人力资源', icon: <UserOutlined /> },
            { path: '/finance', label: '财务管理', icon: <BankOutlined /> },
            { path: '/legal', label: '合同台账', icon: <FileProtectOutlined /> },
        ],
    },
    {
        key: 'content',
        label: '内容管理',
        icon: <FolderOutlined />,
        items: [
            { path: '/documents', label: '生成文档', icon: <FileTextOutlined /> },
            { path: '/knowledge', label: '知识管理', icon: <BookOutlined /> },
        ],
    },
    {
        key: 'message',
        label: '消息中心',
        icon: <BellOutlined />,
        items: [
            { path: '/notifications', label: '通知中心', icon: <NotificationOutlined /> },
        ],
    },
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
    '/documents': 'document.read',
    '/knowledge': 'knowledge_base.read',
    '/notifications': 'notification.read',
};

const navAnyPermissionByPath: Record<string, string[]> = {
    '/hr': ['hr.profile.read', 'hr.leave.read', 'hr.attendance.read', 'hr.overtime.read', 'hr.employee_change.read', 'hr.report.read'],
    '/finance': ['finance.expense.read', 'finance.expense.request', 'finance.expense.approve', 'finance.expense.manage_all'],
    '/legal': ['legal.contract.read', 'legal.contract.create', 'legal.contract.update', 'legal.contract.delete', 'legal.contract.manage_all'],
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
    const [openSections, setOpenSections] = useState<string[]>([]);
    const debugClickTimes = useRef<number[]>([]);

    const isPermitted = (item: NavItem): boolean => {
        const requiredPermission = navPermissionByPath[item.path];
        const anyPermissions = navAnyPermissionByPath[item.path];
        return (!requiredPermission || permissions.includes(requiredPermission)) && (!anyPermissions || anyPermissions.some((permission) => permissions.includes(permission)));
    };

    const visiblePinnedItems = pinnedNavItems.filter(isPermitted);
    const visibleSections = navSections
        .map((section) => ({ ...section, items: section.items.filter(isPermitted) }))
        .filter((section) => section.items.length > 0);
    const activeSectionKey = visibleSections.find((section) => section.items.some((item) => item.path === location.pathname))?.key;

    useEffect(() => {
        if (!activeSectionKey) return;
        setOpenSections((previous) => previous.includes(activeSectionKey) ? previous : [...previous, activeSectionKey]);
    }, [activeSectionKey]);

    const toggleSection = (key: string): void => {
        setOpenSections((previous) => previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]);
    };

    const renderNavItem = (item: NavItem, isChild = false): JSX.Element => <Tooltip key={item.path} title={collapsed ? t(item.label) : ''} placement="right">
        <button className={`nav-item ${isChild ? 'is-child' : ''} ${location.pathname === item.path ? 'is-active' : ''}`} type="button" onClick={() => navigate(item.path)}>
            {item.path === '/notifications' ? <Badge count={unreadCount} size="small" offset={[2, -2]}>{item.icon}</Badge> : item.icon}{!collapsed && <span>{t(item.label)}</span>}
        </button>
    </Tooltip>;

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
            {visiblePinnedItems.map((item) => renderNavItem(item))}
            {collapsed
                ? visibleSections.map((section, index) => <div className="nav-group-collapsed" key={section.key}>
                    {index > 0 && <span className="nav-divider" />}
                    {section.items.map((item) => renderNavItem(item))}
                </div>)
                : visibleSections.map((section) => {
                    const isOpen = openSections.includes(section.key);
                    return <div className="nav-group" key={section.key}>
                        <button className={`nav-group-header ${activeSectionKey === section.key ? 'is-active' : ''}`} type="button" onClick={() => toggleSection(section.key)} aria-expanded={isOpen}>
                            {section.icon}
                            <span className="nav-group-label">{t(section.label)}</span>
                            <NavCaret open={isOpen} />
                        </button>
                        {isOpen && <div className="nav-group-items">{section.items.map((item) => renderNavItem(item, true))}</div>}
                    </div>;
                })}
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

function HomePage({ authContext, documents, memberCount }: {
    authContext: MeResult;
    documents: ManagedDocumentSummary[];
    memberCount: number;
}): JSX.Element {
    const navigate = useNavigate();
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const hasPermission = (code: string): boolean => authContext.permissions.includes(code);
    const dashboardQuery = useQuery({ queryKey: ['dashboard-overview'], queryFn: () => getDashboardOverview(), enabled: hasPermission('dashboard.read'), refetchInterval: 120_000 });
    const todosQuery = useQuery({ queryKey: ['dashboard-todos'], queryFn: () => getDashboardTodos({ taskLimit: 5, reportLimit: 5, meetingLimit: 5 }), enabled: hasPermission('dashboard.read'), refetchInterval: 120_000 });
    const upcomingQuery = useQuery({ queryKey: ['dashboard-upcoming'], queryFn: () => getDashboardUpcomingMeetings(5), enabled: hasPermission('dashboard.read') && hasPermission('meeting.read'), refetchInterval: 120_000 });
    const dashboard = dashboardQuery.data;
    const todos = [...(todosQuery.data?.tasks ?? []), ...(todosQuery.data?.reports ?? []), ...(todosQuery.data?.meetings ?? [])];
    const upcomingMeetings = upcomingQuery.data?.items ?? [];
    const dashboardLoading = dashboardQuery.isLoading || todosQuery.isLoading;
    const numberValue = (value: unknown): string => value === undefined || value === null ? '-' : String(value);
    const todoTasks = todos;
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
                    <div className="panel-heading"><h3>{t('待办事项')}</h3><button type="button" onClick={() => navigate('/projects')}>{t('全部待办')}</button></div>
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
                    <div className="panel-heading"><h3>{t('近期会议')}</h3><button type="button" onClick={() => navigate('/meetings')}>{t('查看全部')}</button></div>
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
    citations?: ChatCitation[];
    /** 写操作待确认卡片；副作用尚未发生，需用户在本页确认。 */
    confirmation?: PendingActionConfirmation;
    /** 企业微信业务域缺权后的官方授权入口，可从历史 connectorContexts 恢复。 */
    weComAuthorizations?: WeComAuthorizationRequest[];
    /** 已持久化的历史消息才有稳定 message id，才能转存到知识库（块 7c）。 */
    persisted?: boolean;
}

interface WeComAuthorizationRequest {
    capability: string;
    notice: string;
    authorizationUrl: string | null;
    originalQuery: string;
    creatorRequired: boolean;
}

function normalizeWeComAuthorizationUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== 'work.weixin.qq.com') return null;
        if (!url.pathname.startsWith('/ai/aiHelper/')) return null;
        url.username = '';
        url.password = '';
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function extractWeComAuthorizationRequests(
    contexts: readonly ConnectorContext[] | null | undefined,
    originalQuery: string,
): WeComAuthorizationRequest[] {
    const requests = new Map<string, WeComAuthorizationRequest>();
    for (const context of contexts ?? []) {
        if (context.provider !== 'WECOM' || context.data.permissionRequired !== true) continue;
        const capability = typeof context.data.capability === 'string'
            ? context.data.capability
            : typeof context.data.missingPermission === 'string'
                ? context.data.missingPermission
                : '对应业务';
        const authorizationUrl = normalizeWeComAuthorizationUrl(
            context.data.permissionGrantUrl ?? context.data.authorizationUrl,
        );
        const notice = typeof context.data.notice === 'string'
            ? context.data.notice
            : `当前企业微信机器人尚未获得${capability}使用权限`;
        const request = {
            capability,
            notice,
            authorizationUrl,
            originalQuery,
            creatorRequired: context.data.creatorRequired !== false,
        };
        requests.set(`${capability}:${authorizationUrl ?? ''}`, request);
    }
    return [...requests.values()];
}

/**
 * 待确认的写操作。客户端只持有 draftId 与展示用的预览，
 * 参数快照保存在服务端，确认时不可能被前端篡改。
 */
interface PendingActionConfirmation {
    draftId: string;
    toolName: string;
    title: string;
    fields: Array<{ label: string; value: string }>;
    expiresAt: string;
    /** 请求进行中，用于禁用按钮并避免双击。 */
    resolving?: boolean;
    resolved?: 'executed' | 'cancelled' | 'failed';
    resultSummary?: string;
}

interface ChatResource {
    id: string;
    type: 'IMAGE' | 'DOCUMENT';
    url?: string | null;
    format?: 'docx' | 'pdf' | 'pptx';
}

/** 资源在「流式追加」与「历史回放」两条路径上共用的去重键，同时作为列表渲染 key，避免同一资源重复渲染。 */
function chatResourceKey(resource: ChatResource): string {
    return `${resource.type}-${resource.id}`;
}

interface ChatSource {
    id: string;
    title: string;
    url: string;
    domain: string;
    snippet: string;
    publishedAt?: string | null;
}

interface ChatCitation {
    id: string;
    title: string;
    snippet: string;
    pageIndex?: number | null;
    knowledgeBaseId?: string | null;
    deletable?: boolean;
    /** 本地标记：该文档已在当前客户端被删除，历史缓存恢复时直接展示已删除态。 */
    deleted?: boolean;
}

/** 转存目标：确定性按钮携带的来源三元组，弹确认框选目标库与可见范围（块 7c）。 */
interface SaveTarget {
    sourceType: KnowledgeSourceType;
    sourceId: string;
    defaultName?: string;
}

function ChatResourceCard({ resource, onPreviewDocument, onSaveToKnowledge }: { resource: ChatResource; onPreviewDocument: (document: { id: string; title: string; content: string }) => void; onSaveToKnowledge?: (target: SaveTarget) => void }): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const [image, setImage] = useState<ImageAccess>();
    const [documentTitle, setDocumentTitle] = useState('生成文档');
    const [documentContent, setDocumentContent] = useState<string>();
    const [documentFormat, setDocumentFormat] = useState(resource.format);
    const [documentExportable, setDocumentExportable] = useState(false);
    useEffect(() => {
        if (resource.type === 'IMAGE' && !resource.url) void getImage(resource.id).then(setImage).catch(() => undefined);
        if (resource.type === 'DOCUMENT') void getDocument(resource.id).then((document) => {
            setDocumentTitle(document.title);
            setDocumentContent(document.content);
            setDocumentFormat(resource.format ?? documentFormatFromMimeType(document.fileMimeType));
            // 生成类文档携带 documentSpec，可随时渲染为 DOCX/PDF/PPTX 真文件；
            // 规格缺失（人工创建或历史数据）时才退回 Markdown 交付。
            setDocumentExportable(document.documentSpec != null);
        }).catch(() => undefined);
    }, [resource.id, resource.type, resource.url, resource.format]);
    const exportAs = async (format: 'docx' | 'pdf' | 'pptx'): Promise<void> => {
        try { await exportDocument(resource.id, format, documentTitle); }
        catch (error) { message.error(error instanceof Error ? error.message : '资源下载失败'); }
    };
    const download = async (): Promise<void> => {
        try {
            if (resource.type === 'IMAGE') {
                const access = image ?? (resource.url ? { url: resource.url, mimeType: 'image/png' as const } : await getImage(resource.id));
                const response = await fetch(access.url);
                const blobUrl = URL.createObjectURL(await response.blob());
                const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = `${resource.id}.${access.mimeType.split('/')[1]}`; anchor.click(); URL.revokeObjectURL(blobUrl);
            } else if (documentFormat) {
                await exportDocument(resource.id, documentFormat, documentTitle);
            } else if (documentExportable) {
                // 无法判定原始格式时默认导出 PDF（通用可打开），避免把 Markdown 字节当作 pptx/pdf 交付。
                await exportDocument(resource.id, 'pdf', documentTitle);
            } else if (documentContent !== undefined) {
                const blobUrl = URL.createObjectURL(new Blob([documentContent], { type: 'text/markdown;charset=utf-8' }));
                const anchor = document.createElement('a'); anchor.href = blobUrl; anchor.download = `${documentTitle}.md`; anchor.click(); URL.revokeObjectURL(blobUrl);
            }
        } catch (error) { message.error(error instanceof Error ? error.message : '资源下载失败'); }
    };
    return <div className={`chat-resource ${resource.type.toLowerCase()}`}>
        {resource.type === 'IMAGE' && <>{image || resource.url ? <AntImage className="chat-resource-image" src={image?.url ?? resource.url ?? undefined} alt="AI 生成图片" preview={{ mask: '点击放大' }} /> : <Spin size="small" />}<Button size="small" disabled={!image && !resource.url} icon={<Download size={15} />} onClick={() => void download()}>{'下载'}</Button></>}
        {resource.type === 'DOCUMENT' && <>
            <div className="chat-resource-header"><span><FileTextIcon size={17} />{documentTitle}</span><span className="chat-resource-actions"><Tooltip title={onSaveToKnowledge ? undefined : t('无存入知识库权限')}><span><Button size="small" disabled={!onSaveToKnowledge} icon={<Save size={15} />} onClick={() => onSaveToKnowledge?.({ sourceType: 'DOCUMENT', sourceId: resource.id, defaultName: documentTitle })}>{t('存入知识库')}</Button></span></Tooltip><Button size="small" disabled={documentContent === undefined} icon={<Eye size={15} />} onClick={() => documentContent !== undefined && onPreviewDocument({ id: resource.id, title: documentTitle, content: documentContent })}>{'查看内容'}</Button>{documentFormat ? <Button size="small" disabled={documentContent === undefined} icon={<Download size={15} />} onClick={() => void download()}>{`下载 ${documentFormat.toUpperCase()}`}</Button> : documentExportable ? <Dropdown trigger={['click']} menu={{ items: [{ key: 'docx', label: 'DOCX' }, { key: 'pdf', label: 'PDF' }, { key: 'pptx', label: 'PPTX' }], onClick: ({ key }) => void exportAs(key as 'docx' | 'pdf' | 'pptx') }}><Button size="small" icon={<Download size={15} />}>{'导出文档'}</Button></Dropdown> : <Button size="small" disabled={documentContent === undefined} icon={<Download size={15} />} onClick={() => void download()}>{'下载 Markdown'}</Button>}</span></div>
        </>}
    </div>;
}

function documentFormatFromMimeType(mimeType: string | null): ChatResource['format'] {
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
    return undefined;
}

function ChatSourceCard({ source }: { source: ChatSource }): JSX.Element {
    return <a className="chat-source" href={source.url} target="_blank" rel="noreferrer">
        <span className="chat-source-heading"><Globe2 size={15} /><strong>{source.title || source.domain}</strong></span>
        <span className="chat-source-domain">{source.domain}</span>
        {source.snippet && <span className="chat-source-snippet">{source.snippet}</span>}
    </a>;
}

interface GroupedCitation {
    id: string;
    title: string;
    knowledgeBaseId?: string | null;
    deletable?: boolean;
    /** 本地标记：该文档已在当前客户端被删除，历史缓存恢复时直接展示已删除态。 */
    deleted?: boolean;
    fragments: Array<{ snippet: string; pageIndex?: number | null }>;
}

/** 同一文档的多个命中片段合并为一张引用卡片，避免标题重复刷屏。 */
function groupCitations(citations: ChatCitation[]): GroupedCitation[] {
    const order: string[] = [];
    const groups = new Map<string, GroupedCitation>();
    for (const citation of citations) {
        const existing = groups.get(citation.id);
        if (existing) {
            existing.fragments.push({ snippet: citation.snippet, pageIndex: citation.pageIndex });
            continue;
        }
        order.push(citation.id);
        groups.set(citation.id, { id: citation.id, title: citation.title, knowledgeBaseId: citation.knowledgeBaseId, deletable: citation.deletable, deleted: citation.deleted, fragments: [{ snippet: citation.snippet, pageIndex: citation.pageIndex }] });
    }
    return order.map((id) => groups.get(id) as GroupedCitation);
}

/** 知识库引用卡片：点击展开查看完整命中片段（默认截断两行，同文档多片段合并展示）；deletable 时提供删除入口（二次确认）。 */
function KnowledgeCitationCard({ citation, onDeleted }: { citation: GroupedCitation; onDeleted?: (citationId: string) => void }): JSX.Element {
    const { t } = useI18n();
    const { message } = AntdApp.useApp();
    const [expanded, setExpanded] = useState(false);
    const [deleted, setDeleted] = useState(citation.deleted === true);
    const multiple = citation.fragments.length > 1;
    const confirmDelete = (): void => {
        const knowledgeBaseId = citation.knowledgeBaseId;
        if (!knowledgeBaseId) return;
        Modal.confirm({
            title: t('删除文档'),
            content: t('删除后文档将无法被知识库检索引用，确认删除吗？'),
            okText: t('删除'),
            okButtonProps: { danger: true },
            cancelText: t('取消'),
            onOk: async () => {
                try {
                    await deleteKnowledgeDocument(knowledgeBaseId, citation.id);
                    setDeleted(true);
                    onDeleted?.(citation.id);
                    message.success(t('文档已删除'));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t('删除失败'));
                }
            },
        });
    };
    if (deleted) return <div className="chat-source chat-citation is-deleted">
        <span className="chat-source-heading"><BookOpen size={15} /><strong>{citation.title}</strong><em className="chat-citation-page">{t('已删除')}</em></span>
    </div>;
    const fragments = expanded ? citation.fragments : citation.fragments.slice(0, 1);
    return <div className={`chat-source chat-citation${expanded ? ' is-expanded' : ''}`} onClick={() => setExpanded((value) => !value)} title={expanded ? t('点击收起') : t('点击展开完整片段')}>
        <span className="chat-source-heading"><BookOpen size={15} /><strong>{citation.title}</strong>{multiple && <em className="chat-citation-count">{t('{count} 处引用', { count: citation.fragments.length })}</em>}</span>
        {fragments.map((fragment, index) => <span className="chat-source-snippet" key={index}>{fragment.pageIndex !== null && fragment.pageIndex !== undefined && <em className="chat-citation-page">{t('第 {page} 页', { page: fragment.pageIndex + 1 })}</em>}{fragment.snippet}</span>)}
        {citation.deletable && citation.knowledgeBaseId && <button className="chat-citation-delete" type="button" title={t('删除文档')} onClick={(event) => { event.stopPropagation(); confirmDelete(); }}><Trash2 size={13} /></button>}
    </div>;
}

/** 转存确认框：选目标库（用户 EDITOR 权限的库）与可见范围，直接调转存端点（块 7c）。 */
function SaveToKnowledgeModal({ target, onClose, onSaved }: {
    target: SaveTarget;
    onClose: () => void;
    onSaved: (document: { name: string }) => void;
}): JSX.Element {
    const { t } = useI18n();
    const { message } = AntdApp.useApp();
    const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>();
    const [knowledgeBaseId, setKnowledgeBaseId] = useState<string>();
    const [name, setName] = useState(target.defaultName ?? '');
    const [visibilityScope, setVisibilityScope] = useState<'PRIVATE' | 'TENANT'>('PRIVATE');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        void listWritableKnowledgeBases()
            .then((result) => {
                setKnowledgeBases(result.items);
                if (result.items.length === 1) setKnowledgeBaseId(result.items[0].id);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t('加载知识库失败')));
    }, []);
    const submit = async (): Promise<void> => {
        if (!knowledgeBaseId || saving) return;
        setSaving(true);
        try {
            const document = await createKnowledgeDocument(knowledgeBaseId, {
                sourceType: target.sourceType,
                sourceId: target.sourceId,
                name: name.trim() || undefined,
                visibilityScope,
            });
            onSaved(document);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('转存失败'));
        } finally {
            setSaving(false);
        }
    };
    return <Modal open title={t('存入知识库')} okText={t('确定')} cancelText={t('取消')} confirmLoading={saving}
        okButtonProps={{ disabled: !knowledgeBaseId }}
        onOk={() => void submit()}
        onCancel={onClose}>
        <div className="save-to-knowledge-form">
            <div className="save-to-knowledge-field"><label>{t('文档名称')}</label><Input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder={t('留空则使用默认名称')} /></div>
            <div className="save-to-knowledge-field"><label>{t('目标知识库')}</label>
                {knowledgeBases === undefined
                    ? <Spin size="small" />
                    : knowledgeBases.length
                        ? <Select value={knowledgeBaseId} onChange={setKnowledgeBaseId} options={knowledgeBases.map((item) => ({ value: item.id, label: item.name }))} />
                        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有可写入的知识库')} />}
            </div>
            <div className="save-to-knowledge-field"><label>{t('可见范围')}</label>
                <Select value={visibilityScope} onChange={(value) => setVisibilityScope(value as 'PRIVATE' | 'TENANT')} options={[{ value: 'PRIVATE', label: t('私有（仅自己可见）') }, { value: 'TENANT', label: t('租户可见') }]} />
            </div>
        </div>
    </Modal>;
}

/** 已删除引用按会话记录，只保存文档 ID；不再整份缓存来源/引用，避免把历史轮次的来源串到当前回答上。 */
const DELETED_CITATIONS_KEY = 'cees.chat.citations.deleted';

interface AssistantNavigationState {
    createNewConversation?: boolean;
    source?: 'DINGTALK_CONNECTOR' | 'TENCENT_MEETING_CONNECTOR' | 'WECOM_CONNECTOR' | 'CONNECTOR_MARKETPLACE';
}

interface ConfirmableConnectorTool {
    toolId: string;
    name: string;
    riskLevel: 'READ' | 'WRITE' | 'DESTRUCTIVE';
    requiresConfirmation: boolean;
}

async function confirmConnectorCalls(
    calls: Array<{ toolId: string; arguments: Record<string, unknown> }>,
    tools: ConfirmableConnectorTool[],
    connectorName: string,
    credentialDescription: string,
    modal: ReturnType<typeof AntdApp.useApp>['modal'],
    t: (text: string, values?: Record<string, string | number>) => string,
): Promise<boolean> {
    const toolMap = new Map(tools.map((tool) => [tool.toolId, tool]));
    const sensitiveCalls = calls.filter((call) => toolMap.get(call.toolId)?.requiresConfirmation !== false);
    if (sensitiveCalls.length === 0) return true;
    const summary = sensitiveCalls.map((call) => {
        const tool = toolMap.get(call.toolId);
        return {
            name: tool?.name || call.toolId,
            risk: tool?.riskLevel || 'DESTRUCTIVE',
            arguments: JSON.stringify(call.arguments, null, 2),
        };
    });
    return new Promise((resolve) => {
        modal.confirm({
            title: t('确认执行{connectorName}操作', { connectorName }),
            width: 620,
            content: <div className="connector-action-confirmation">
                <p>{t('以下操作将使用{credentialDescription}执行。确认前不会产生任何变更。', { credentialDescription })}</p>
                {summary.map((item) => <div key={`${item.name}:${item.arguments}`} className="connector-action-confirmation-item">
                    <strong>{item.name}</strong>
                    <Tag color={item.risk === 'DESTRUCTIVE' ? 'red' : 'orange'}>{item.risk}</Tag>
                    <pre>{item.arguments}</pre>
                </div>)}
            </div>,
            okText: t('确认执行'),
            cancelText: t('取消'),
            okButtonProps: { danger: summary.some((item) => item.risk === 'DESTRUCTIVE') },
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        });
    });
}

function readDeletedCitationIds(conversationId: string): Set<string> {
    try {
        const raw = JSON.parse(localStorage.getItem(`${DELETED_CITATIONS_KEY}.${conversationId}`) ?? '[]') as unknown;
        return new Set(Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []);
    } catch {
        return new Set();
    }
}

/**
 * 写操作确认卡片。展示服务端返回的参数快照预览，并把用户的决策还原为一次
 * 「只带 draftId」的确认/取消请求——参数不在客户端流转，因此不可能被篡改。
 * 确认后卡片立刻转为终态文案，避免用户重复点击。
 */
function ActionConfirmationCard({ confirmation, onResolve }: {
    confirmation: PendingActionConfirmation;
    onResolve: (decision: 'confirm' | 'cancel') => void;
}): JSX.Element {
    const { t } = useI18n();
    const resolved = confirmation.resolved;
    const expired = !resolved && new Date(confirmation.expiresAt).getTime() <= Date.now();
    const status = resolved === 'executed'
        ? { className: 'is-executed', text: t('已执行') }
        : resolved === 'cancelled'
            ? { className: 'is-cancelled', text: t('已取消') }
            : resolved === 'failed'
                ? { className: 'is-failed', text: t('执行失败') }
                : expired
                    ? { className: 'is-expired', text: t('已过期') }
                    : { className: 'is-pending', text: t('待确认') };
    return <div className={`action-confirmation ${status.className}`}>
        <div className="action-confirmation-head">
            <CheckCircleOutlined />
            <strong>{confirmation.title}</strong>
            <span className="action-confirmation-status">{status.text}</span>
        </div>
        <dl className="action-confirmation-fields">
            {confirmation.fields.map((field) => <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
            </div>)}
        </dl>
        {resolved
            ? <p className="action-confirmation-result">{confirmation.resultSummary}</p>
            : expired
                ? <p className="action-confirmation-hint">{t('该操作已过期，请重新发起对话生成新的待确认操作。')}</p>
                : <div className="action-confirmation-actions">
                    <Button type="primary" loading={confirmation.resolving} disabled={confirmation.resolving}
                        onClick={() => onResolve('confirm')}>{t('确认执行')}</Button>
                    <Button disabled={confirmation.resolving} onClick={() => onResolve('cancel')}>{t('取消')}</Button>
                    <span className="action-confirmation-hint">{t('确认前不会产生任何变更')}</span>
                </div>}
    </div>;
}

function WeComAuthorizationCard({ request, retrying, onRetry }: {
    request: WeComAuthorizationRequest;
    retrying: boolean;
    onRetry: () => void;
}): JSX.Element {
    const { t } = useI18n();
    const { message } = AntdApp.useApp();
    const openAuthorization = async (): Promise<void> => {
        const safeUrl = normalizeWeComAuthorizationUrl(request.authorizationUrl);
        if (!safeUrl) {
            message.warning(t('企业微信未返回可用的官方授权入口，请联系机器人创建者在企业微信中完成授权'));
            return;
        }
        const desktopBridge = window.cees;
        if (!desktopBridge) {
            message.error(t('当前环境无法打开外部授权页面'));
            return;
        }
        try {
            await desktopBridge.openExternal(safeUrl);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('无法打开企业微信授权页面'));
        }
    };
    return <div className="wecom-authorization-card">
        <div className="wecom-authorization-head">
            <SafetyCertificateOutlined />
            <strong>{t('需要企业微信{capability}权限', { capability: request.capability })}</strong>
        </div>
        <p>{request.notice}</p>
        {request.creatorRequired && <p className="wecom-authorization-hint">{t('如果你是机器人创建者，请打开官方页面授权；否则请联系机器人创建者在企业微信「工作台 → 智能机器人」中完成授权。')}</p>}
        <div className="wecom-authorization-actions">
            {request.authorizationUrl && <Button type="primary" icon={<ExternalLink size={14} />} onClick={() => void openAuthorization()}>{t('去授权')}</Button>}
            <Button icon={<RotateCw size={14} />} loading={retrying} disabled={retrying} onClick={onRetry}>{t('授权完成，重新查询')}</Button>
        </div>
    </div>;
}

function AssistantPage({ permissions }: { permissions: string[] }): JSX.Element {
    const { t } = useI18n();
    const { message, modal } = AntdApp.useApp();
    const location = useLocation();
    const navigate = useNavigate();
    const canSaveToKnowledge = permissions.includes('knowledge_base.read');
    const [input, setInput] = useState('');
    const [selectedPrompt, setSelectedPrompt] = useState<string>();
    const [mode, setMode] = useState<'standard' | 'ultra'>('standard');
    const [networkSearch, setNetworkSearch] = useState(false);
    const [knowledgeBase, setKnowledgeBase] = useState(false);
    const [autoEnabledCapabilities, setAutoEnabledCapabilities] = useState<Array<'web_search' | 'knowledge_search'>>([]);
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
    const messageStream = useRef<HTMLDivElement>(null);
    const questionAnchors = useRef(new Map<string, HTMLDivElement>());
    const pendingQuestionFocus = useRef<string>();
    const [activeQuestionId, setActiveQuestionId] = useState<string>();
    const [previewDocument, setPreviewDocument] = useState<{ id: string; title: string; content: string }>();
    const [saveTarget, setSaveTarget] = useState<SaveTarget>();
    const [renameTarget, setRenameTarget] = useState<Conversation>();
    const [renameValue, setRenameValue] = useState('');
    const [dingtalkConnected, setDingtalkConnected] = useState(false);
    const [preferredConnector, setPreferredConnector] = useState<'dingtalk' | 'tencent-meeting' | 'wecom'>();
    const initialConversationLoadStarted = useRef(false);

    /** 就地更新某条消息上的确认卡片状态（不重建消息，避免滚动位置跳动）。 */
    const patchConfirmation = (messageId: string, patch: Partial<PendingActionConfirmation>): void => {
        setMessages((items) => items.map((item) => item.id === messageId && item.confirmation
            ? { ...item, confirmation: { ...item.confirmation, ...patch } }
            : item));
    };

    /**
     * 确认或取消写操作草稿。只提交 draftId；服务端重新鉴权并重新校验参数，
     * 因此即使权限在确认前被回收也不会误写（会返回 403 并在这里提示）。
     */
    const resolveActionDraft = async (messageId: string, draftId: string, decision: 'confirm' | 'cancel'): Promise<void> => {
        patchConfirmation(messageId, { resolving: true });
        try {
            const result = decision === 'confirm' ? await confirmActionDraft(draftId) : await cancelActionDraft(draftId);
            const resolved = result.status === 'EXECUTED' ? 'executed' : result.status === 'REJECTED' ? 'cancelled' : 'failed';
            patchConfirmation(messageId, { resolving: false, resolved, resultSummary: result.summary });
            if (resolved === 'executed') message.success(result.summary);
            else if (resolved === 'cancelled') message.info(result.summary);
            else message.error(result.summary);
        } catch (error) {
            patchConfirmation(messageId, { resolving: false });
            message.error(error instanceof Error ? error.message : t('操作未完成，请刷新后重试'));
        }
    };

    const createAndActivateConversation = async (): Promise<void> => {
        const conversation = await createConversation();
        setConversations((items) => [conversation, ...items.filter((item) => item.id !== conversation.id)]);
        setActiveConversationId(conversation.id);
        setMessages([]);
        setPreviewDocument(undefined);
    };

    useEffect(() => {
        if (initialConversationLoadStarted.current) return;
        initialConversationLoadStarted.current = true;
        const navigationState = location.state as AssistantNavigationState | null;
        const createNewConversation = navigationState?.createNewConversation === true;
        if (navigationState?.source === 'DINGTALK_CONNECTOR') setPreferredConnector('dingtalk');
        if (navigationState?.source === 'TENCENT_MEETING_CONNECTOR') setPreferredConnector('tencent-meeting');
        if (navigationState?.source === 'WECOM_CONNECTOR') setPreferredConnector('wecom');
        void listConversations()
            .then(async (result) => {
                setConversations(result.items);
                if (createNewConversation) {
                    try {
                        await createAndActivateConversation();
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : t('创建会话失败'));
                        if (result.items[0]) await selectConversation(result.items[0]);
                    } finally {
                        navigate('/assistant', { replace: true, state: null });
                    }
                    return;
                }
                if (result.items[0]) await selectConversation(result.items[0]);
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t('加载会话失败')));
    }, []);
    useEffect(() => {
        const connector = window.cees?.connectors?.dingtalk;
        if (!connector) return;
        void connector.status()
            .then((status) => setDingtalkConnected(status.state === 'READY'))
            .catch(() => setDingtalkConnected(false));
        return connector.onStatusChanged((status) => setDingtalkConnected(status.state === 'READY'));
    }, []);
    useEffect(() => () => abortController.current?.abort(), []);
    useEffect(() => {
        const questionId = pendingQuestionFocus.current;
        if (!questionId) return;
        const anchor = questionAnchors.current.get(questionId);
        if (!anchor) return;
        pendingQuestionFocus.current = undefined;
        setActiveQuestionId(questionId);
        anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [messages]);

    const syncActiveQuestion = (): void => {
        const stream = messageStream.current;
        if (!stream) return;
        const streamTop = stream.getBoundingClientRect().top;
        let closestId: string | undefined;
        let closestDistance = Number.POSITIVE_INFINITY;
        for (const [questionId, anchor] of questionAnchors.current) {
            const distance = Math.abs(anchor.getBoundingClientRect().top - streamTop - 18);
            if (distance < closestDistance) {
                closestId = questionId;
                closestDistance = distance;
            }
        }
        if (closestId) setActiveQuestionId(closestId);
    };

    const scrollToQuestion = (questionId: string): void => {
        setActiveQuestionId(questionId);
        questionAnchors.current.get(questionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

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
        void createAndActivateConversation().catch((error) => message.error(error instanceof Error ? error.message : t('创建会话失败')));
    };

    /** 删除成功后只记录该文档 ID，重开对话时按 ID 标记已删除态（块 4）。 */
    const handleCitationDeleted = (citationId: string): void => {
        if (!activeConversationId) return;
        const deleted = readDeletedCitationIds(activeConversationId);
        deleted.add(citationId);
        localStorage.setItem(`${DELETED_CITATIONS_KEY}.${activeConversationId}`, JSON.stringify([...deleted]));
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
        const deletedCitationIds = readDeletedCitationIds(conversation.id);
        // 服务端把资源、来源、引用按轮次落库在 TOOL 消息上，这里按 turnId 归组，
        // 再挂回同一轮次的 assistant 回答，避免历史来源/引用串到当前问题。
        const resourcesByTurn = new Map<string, Map<string, ChatResource>>();
        const sourcesByTurn = new Map<string, ChatSource[]>();
        const citationsByTurn = new Map<string, ChatCitation[]>();
        const weComAuthorizationsByTurn = new Map<string, WeComAuthorizationRequest[]>();
        for (const item of detail.messages) {
            if (!item.turnId) continue;
            if (item.role === 'USER') {
                const requests = extractWeComAuthorizationRequests(item.connectorContexts, item.content);
                if (requests.length) weComAuthorizationsByTurn.set(item.turnId, requests);
            }
            const resources = item.resources?.map((resource): ChatResource => ({ id: resource.id || resource.resourceId || '', type: resource.type, url: resource.url ?? resource.resourceUrl })) ?? [];
            if (resources.length) {
                const resourcesForTurn = resourcesByTurn.get(item.turnId) ?? new Map<string, ChatResource>();
                resources.forEach((resource) => resourcesForTurn.set(chatResourceKey(resource), resource));
                resourcesByTurn.set(item.turnId, resourcesForTurn);
            }
            if (item.sources?.length) sourcesByTurn.set(item.turnId, [...(sourcesByTurn.get(item.turnId) ?? []), ...item.sources]);
            if (item.citations?.length) citationsByTurn.set(item.turnId, [...(citationsByTurn.get(item.turnId) ?? []), ...item.citations.map((citation): ChatCitation => ({ ...citation, deleted: deletedCitationIds.has(citation.id) }))]);
        }
        const restored: LocalChatMessage[] = detail.messages.filter((item) => item.role !== 'TOOL').map((item) => {
            const message: LocalChatMessage = { id: item.id, role: item.role === 'USER' ? 'user' : 'assistant', content: item.content, persisted: true };
            if (item.role === 'ASSISTANT' && item.turnId) {
                message.resources = [...(resourcesByTurn.get(item.turnId)?.values() ?? [])];
                message.sources = sourcesByTurn.get(item.turnId);
                message.citations = citationsByTurn.get(item.turnId);
                message.weComAuthorizations = weComAuthorizationsByTurn.get(item.turnId);
            }
            return message;
        });
        setMessages(restored);
    };

    const sendMessage = async (overrideContent?: string, forcedConnector?: 'wecom'): Promise<void> => {
        const isRetry = typeof overrideContent === 'string';
        const text = (overrideContent ?? input).trim();
        const turnAttachment = isRetry ? undefined : attachment;
        const imageFileIds = turnAttachment?.isImage ? [turnAttachment.id] : [];
        const fileIds = turnAttachment && !turnAttachment.isImage ? [turnAttachment.id] : [];
        const options = [turnAttachment && !turnAttachment.isImage && `参考附件：${turnAttachment.name}`].filter(Boolean);
        const content = isRetry
            ? text
            : [selectedPrompt, ...options, text].filter(Boolean).join('\n') || (imageFileIds.length ? t('请分析这张图片') : '');
        if ((!content && !imageFileIds.length && !fileIds.length) || sending) return;
        setSending(true);
        const version = ++requestVersion.current;
        const controller = new AbortController();
        abortController.current = controller;
        try {
            let connectorContexts: ConnectorContext[] = [];
            const dingtalkConnector = window.cees?.connectors?.dingtalk;
            if (dingtalkConnector) {
                const mentionsDingTalk = /钉钉|dingtalk|dws/i.test(content);
                let connectorRequired = false;
                try {
                    const status = await dingtalkConnector.status();
                    if (status.state === 'READY') {
                        const tools = await dingtalkConnector.tools();
                        if (tools.length > 0) {
                            const plan = await planDingTalkConnectorQueries(content, tools);
                            connectorRequired = plan.calls.length > 0;
                            connectorContexts.push(...await dingtalkConnector.execute(plan.calls));
                        }
                    } else if (mentionsDingTalk) {
                        if (status.state === 'PROFILE_REQUIRED') {
                            throw new Error('当前钉钉连接已登录多个组织，请先在连接器页面选择当前组织');
                        }
                        throw new Error(status.error || '请先在连接器页面安装并授权钉钉连接器');
                    }
                } catch (error) {
                    const latestStatus = await dingtalkConnector.status().catch(() => undefined);
                    setDingtalkConnected(latestStatus?.state === 'READY');
                    if (mentionsDingTalk || connectorRequired) throw error;
                }
            }
            const tencentMeetingConnector = window.cees?.connectors;
            const mentionsTencentMeeting = /腾讯会议|wemeet|腾讯.*会议/i.test(content)
                || preferredConnector === 'tencent-meeting';
            if (tencentMeetingConnector && mentionsTencentMeeting) {
                const status = await tencentMeetingConnector.status('tencent-meeting');
                if (status.state !== 'READY') {
                    throw new Error(status.error || '请先在连接器页面安装并授权腾讯会议连接器');
                }
                const tools = await tencentMeetingConnector.tools('tencent-meeting') as TencentMeetingConnectorTool[];
                const plan = await planTencentMeetingConnectorQueries(content, tools);
                if (plan.calls.length > 0) {
                    if (connectorContexts.length + plan.calls.length > 3) {
                        throw new Error('单轮最多执行三个连接器调用，请将钉钉和腾讯会议请求拆成多轮');
                    }
                    const confirmed = await confirmConnectorCalls(
                        plan.calls,
                        tools,
                        '腾讯会议',
                        '当前电脑已授权的腾讯会议账号',
                        modal,
                        t,
                    );
                    if (!confirmed) {
                        message.info(t('已取消腾讯会议操作'));
                        return;
                    }
                    connectorContexts.push(...await tencentMeetingConnector.execute(
                        'tencent-meeting',
                        plan.calls.map((call) => ({ ...call, confirmed: true })),
                    ));
                }
            }
            const weComConnector = window.cees?.connectors;
            const mentionsWeCom = /企业微信|企微|wecom/i.test(content) || preferredConnector === 'wecom' || forcedConnector === 'wecom';
            if (weComConnector && mentionsWeCom) {
                const status = await weComConnector.status('wecom');
                if (status.state !== 'READY') {
                    throw new Error(status.error || '请先在连接器页面安装并扫码授权企业微信连接器');
                }
                const tools = await weComConnector.tools('wecom') as WeComConnectorTool[];
                const plan = await planWeComConnectorQueries(content, tools);
                if (plan.calls.length > 0) {
                    if (connectorContexts.length + plan.calls.length > 3) {
                        throw new Error('单轮最多执行三个连接器调用，请将多个连接器请求拆成多轮');
                    }
                    const confirmed = await confirmConnectorCalls(
                        plan.calls,
                        tools,
                        '企业微信',
                        '当前电脑中企业微信官方 CLI 保存的机器人授权',
                        modal,
                        t,
                    );
                    if (!confirmed) {
                        message.info(t('已取消企业微信操作'));
                        return;
                    }
                    connectorContexts.push(...await weComConnector.execute(
                        'wecom',
                        plan.calls.map((call) => ({ ...call, confirmed: true })),
                    ));
                }
            }
            if (connectorContexts.length > 3) throw new Error('单轮连接器上下文不能超过三个');
            const weComAuthorizations = extractWeComAuthorizationRequests(connectorContexts, content);
            if (!isRetry) {
                setInput('');
                setSelectedPrompt(undefined);
                setAttachment(undefined);
            }
            setAutoEnabledCapabilities([]);
            const userMessage: LocalChatMessage = { id: `m-${Date.now()}`, role: 'user', content };
            pendingQuestionFocus.current = userMessage.id;
            setMessages((items) => [...items, userMessage]);
            const conversationId = activeConversationId ?? (await createConversation()).id;
            setActiveConversationId(conversationId);
            if (!conversations.some((item) => item.id === conversationId)) setConversations((items) => [{ id: conversationId, title: t('新对话'), mode, visibility: 'PRIVATE', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...items]);
            let turnId = ''; let seq = 0; let answer = ''; let terminal = false; const streamingMessageId = `streaming-${Date.now()}`; const resources = new Map<string, ChatResource>(); const sources: ChatSource[] = []; const citations: ChatCitation[] = []; const toolTypes = new Map<string, ChatResource['type']>(); const toolFormats = new Map<string, ChatResource['format']>(); const confirmations = new Map<string, PendingActionConfirmation>();
            const updateStreamingMessage = (): void => setMessages((items) => [...items.filter((item) => item.id !== streamingMessageId), { id: streamingMessageId, role: 'assistant', content: answer, resources: [...resources.values()], sources: [...sources], citations: [...citations], confirmation: [...confirmations.values()].at(-1), weComAuthorizations }]);
            if (weComAuthorizations.length) updateStreamingMessage();
            const handle = (event: TurnStreamEvent): void => {
                if (event.seq <= seq) return;
                seq = event.seq;
                if (event.type === 'started') { turnId = event.turnId; setActiveTurn({ conversationId, turnId, seq }); setAutoEnabledCapabilities(event.capabilities?.autoEnabled ?? []); }
                if (event.type === 'content_delta') { answer += event.text; if (!streamFlush.current) streamFlush.current = setTimeout(() => { streamFlush.current = undefined; updateStreamingMessage(); }, 50); }
                if (event.type === 'tool_call') {
                    if (event.name === 'generate_document' || event.name === 'generate_docx' || event.name === 'generate_pdf' || event.name === 'generate_pptx') {
                        toolTypes.set(event.toolCallId, 'DOCUMENT');
                        if (event.name !== 'generate_document') toolFormats.set(event.toolCallId, event.name.replace('generate_', '') as ChatResource['format']);
                    } else if (event.name === 'generate_image') { toolTypes.set(event.toolCallId, 'IMAGE'); setImageGenerating(true); }
                    else if (event.name === 'insert_document_image') { toolTypes.set(event.toolCallId, 'DOCUMENT'); }
                }
                if (event.type === 'tool_result' && event.status === 'awaiting_confirmation' && event.confirmation) {
                    // 写操作：服务端已落待确认草稿，副作用尚未发生。把预览挂在流式消息上，
                    // 用户点击确认后由 resolveActionDraft 提交 draftId。
                    confirmations.set(event.toolCallId, { ...event.confirmation });
                    updateStreamingMessage();
                }
                if (event.type === 'tool_result' && event.status === 'completed') {
                    if (event.sources?.length) { sources.push(...event.sources); updateStreamingMessage(); }
                    if (event.citations?.length) { citations.push(...event.citations); updateStreamingMessage(); }
                    const resourceId = event.resource?.id ?? event.resourceId;
                    const resourceType = event.resource?.type ?? toolTypes.get(event.toolCallId);
                    if (resourceId && resourceType) { const resource = { id: resourceId, type: resourceType, url: event.resourceUrl, format: toolFormats.get(event.toolCallId) }; resources.set(chatResourceKey(resource), resource); if (resourceType === 'IMAGE') setImageGenerating(false); updateStreamingMessage(); }
                }
                if (event.type === 'error') { terminal = true; setImageGenerating(false); throw new Error(event.error.message); }
                if (event.type === 'completed') {
                    terminal = true;
                    setImageGenerating(false);
                    if (streamFlush.current) {
                        clearTimeout(streamFlush.current);
                        streamFlush.current = undefined;
                        updateStreamingMessage();
                    }
                    if (version === requestVersion.current) {
                        setSending(false);
                        setActiveTurn(undefined);
                    }
                    if (event.finishReason === 'length') message.warning(t('回答达到长度上限，内容可能不完整'));
                }
            };
            const replay = async (): Promise<void> => {
                for (let attempt = 0; attempt < 3 && !terminal; attempt += 1) await replayTurnEvents(conversationId, turnId, seq, handle, controller.signal);
                if (!terminal) throw new Error(t('连接已断开，请稍后重试'));
            };
            try {
                await createTurn(conversationId, { content, mode, imageFileIds, fileIds, connectorContexts: connectorContexts.length ? connectorContexts : undefined, knowledgeBaseEnabled: knowledgeBase, webSearchEnabled: networkSearch }, crypto.randomUUID(), handle, controller.signal);
            } catch (error) {
                if (!turnId || controller.signal.aborted || terminal) throw error;
                await replay();
            }
            if (!terminal && turnId && !controller.signal.aborted) await replay();
            if (version === requestVersion.current) setActiveTurn(undefined);
        } catch (error) {
            if (!controller.signal.aborted && version === requestVersion.current) {
                const errorMessage = error instanceof Error ? error.message : t('AI 请求失败，请稍后重试');
                if (errorMessage.includes('连接器页面')) {
                    Modal.confirm({
                        title: errorMessage.includes('腾讯会议')
                            ? t('需要连接腾讯会议')
                            : errorMessage.includes('企业微信')
                                ? t('需要连接企业微信')
                                : t('需要连接钉钉'),
                        content: errorMessage,
                        okText: t('前往连接器'),
                        cancelText: t('取消'),
                        onOk: () => navigate('/connectors'),
                    });
                } else message.error(errorMessage);
            }
        } finally {
            if (version === requestVersion.current) { setSending(false); abortController.current = undefined; }
        }
    };

    const questions = messages.filter((item) => item.role === 'user');

    return <div className={`assistant-layout ${previewDocument ? 'has-preview' : ''}`}>
        <aside className="conversation-list">
            <div className="conversation-heading"><h2>{t('对话')}</h2><Button type="primary" icon={<PlusOutlined />} onClick={newConversation}>{t('新对话')}</Button></div>
            {conversations.map((conversation) => <Dropdown key={conversation.id} trigger={['contextMenu']} menu={{ items: [{ key: 'rename', icon: <Pencil size={15} />, label: t('重命名'), onClick: () => { setRenameTarget(conversation); setRenameValue(conversation.title); } }, { key: 'delete', danger: true, icon: <Trash2 size={15} />, label: t('删除对话'), onClick: () => Modal.confirm({ title: t('删除对话'), content: t('删除后无法恢复，确认删除吗？'), onOk: async () => { await deleteConversation(conversation.id, conversation.version); localStorage.removeItem(`${DELETED_CITATIONS_KEY}.${conversation.id}`); setConversations((items) => items.filter((item) => item.id !== conversation.id)); if (activeConversationId === conversation.id) { setActiveConversationId(undefined); setMessages([]); } } }) }] }}><button className={`conversation-item ${conversation.id === activeConversationId ? 'is-active' : ''}`} type="button" onClick={() => void selectConversation(conversation)}><strong>{conversation.title || t('新对话')}</strong><small>{conversation.lastTurnAt ? new Date(conversation.lastTurnAt).toLocaleString() : t('尚未开始')}</small></button></Dropdown>)}
        </aside>
        <section className="chat-panel">
            <header className="chat-header"><span><i><CeesLogo /></i><strong>{t('CEES AI 助手')}</strong></span><span>{activeTurn && <Button size="small" danger onClick={() => { abortController.current?.abort(); setImageGenerating(false); void cancelTurn(activeTurn.conversationId, activeTurn.turnId).finally(() => setActiveTurn(undefined)); }}>{t('停止生成')}</Button>}</span></header>
            <div className="message-stream-shell">
                <div className="message-stream" ref={messageStream} onScroll={syncActiveQuestion}>
                    {messages.map((item) => <div className={`chat-message ${item.role}`} key={item.id} ref={item.role === 'user' ? (element) => { if (element) questionAnchors.current.set(item.id, element); else questionAnchors.current.delete(item.id); } : undefined}>
                        {item.role === 'assistant' && <i className="assistant-avatar"><CeesLogo /></i>}
                        <div className="chat-message-body">
                            <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownRenderComponents}>{item.content}</ReactMarkdown></div>
                            {item.confirmation && <ActionConfirmationCard confirmation={item.confirmation}
                                onResolve={(decision) => void resolveActionDraft(item.id, item.confirmation!.draftId, decision)} />}
                            {item.weComAuthorizations?.map((request) => <WeComAuthorizationCard
                                key={`${request.capability}:${request.authorizationUrl ?? ''}`}
                                request={request}
                                retrying={sending}
                                onRetry={() => void sendMessage(request.originalQuery, 'wecom')}
                            />)}
                            {item.resources?.map((resource) => <ChatResourceCard key={chatResourceKey(resource)} resource={resource} onPreviewDocument={setPreviewDocument} onSaveToKnowledge={canSaveToKnowledge ? setSaveTarget : undefined} />)}
                            {item.sources?.length ? <div className="chat-sources">{item.sources.map((source) => <ChatSourceCard key={source.id} source={source} />)}</div> : null}
                            {item.citations?.length ? <div className="chat-sources">{groupCitations(item.citations).map((citation) => <KnowledgeCitationCard key={citation.id} citation={citation} onDeleted={handleCitationDeleted} />)}</div> : null}
                            <div className="chat-message-actions">
                                <button className="chat-copy" type="button" onClick={() => void copyText(item.content)}><CopyOutlined />{t('复制')}</button>
                                {item.persisted && canSaveToKnowledge && <button className="chat-copy chat-save-to-knowledge" type="button" onClick={() => setSaveTarget({ sourceType: 'MESSAGE', sourceId: item.id })}><Save size={13} />{t('存入知识库')}</button>}
                            </div>
                        </div>
                    </div>)}
                    {sending && <div className="chat-message assistant"><i className="assistant-avatar"><CeesLogo /></i><div className={`chat-generation-status ${imageGenerating ? 'is-image-generation' : ''}`}><span className={imageGenerating ? 'image-generating-orbit' : 'thinking-dots'} />{imageGenerating ? <span>图片生成中</span> : <span>{t('正在思考…')}</span>}</div></div>}
                </div>
                {questions.length > 0 && <nav className="chat-question-nav" aria-label={t('历史提问快速跳转')}>
                    {questions.map((question) => <button className={question.id === activeQuestionId ? 'is-active' : ''} type="button" key={question.id} onClick={() => scrollToQuestion(question.id)} title={question.content}>
                        <span className="chat-question-nav-line" />
                        <span className="chat-question-nav-label">{question.content.replace(/\s+/g, ' ').trim()}</span>
                    </button>)}
                </nav>}
            </div>
            <div className="composer-area">
                {autoEnabledCapabilities.length > 0 && <div className="composer-auto-capabilities">
                    <span>{t('本轮已自动启用：')}</span>
                    {autoEnabledCapabilities.map((capability) => <Tag key={capability} closable color="processing" onClose={() => setAutoEnabledCapabilities((items) => items.filter((item) => item !== capability))}>{capability === 'web_search' ? t('联网搜索') : t('知识库检索')}</Tag>)}
                </div>}
                <div className="message-composer">
                    <div className="message-editor">
                        {selectedPrompt && <Tag closable onClose={() => setSelectedPrompt(undefined)}>{t(selectedPrompt)}</Tag>}
                        {attachment && <Tag closable icon={attachment.isImage ? <FileImage size={14} /> : <FileTextIcon size={14} />} onClose={() => setAttachment(undefined)}>{attachment.name}{canSaveToKnowledge && <button className="attachment-save" type="button" title={t('存入知识库')} onClick={() => setSaveTarget({ sourceType: 'FILE_OBJECT', sourceId: attachment.id, defaultName: attachment.name })}><Save size={12} /></button>}</Tag>}
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} value={input} onChange={(event) => setInput(event.target.value)} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={t('输入消息，Enter 发送')} />
                        <div className="composer-footer">
                            <Dropdown trigger={['click']} menu={{ items: [{ key: 'upload', icon: <Upload size={16} />, label: '上传文件或图片', onClick: () => fileInput.current?.click() }, { key: 'image', icon: <ImagePlus size={16} />, label: '生成图片', onClick: () => setSelectedPrompt('生成图片') }, { key: 'document', icon: <FileTextIcon size={16} />, label: '生成文档', onClick: () => setSelectedPrompt('生成文档') }] }}><Button type="text" className="composer-add" icon={<PlusOutlined />} /></Dropdown>
                            <input ref={fileInput} type="file" hidden accept="image/*,.pdf,.doc,.docx,.txt,.md" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void uploadAttachmentFile(file).then((id) => setAttachment({ name: file.name, id, isImage: file.type.startsWith('image/') })).catch((error) => message.error(error instanceof Error ? error.message : '附件上传失败')); event.target.value = ''; }} />
                            <Button type="text" className={`composer-option ${networkSearch ? 'is-selected' : ''}`} icon={<Globe2 size={15} />} onClick={() => setNetworkSearch((value) => !value)}>联网搜索</Button>
                            <Button type="text" className={`composer-option ${knowledgeBase ? 'is-selected' : ''}`} icon={<BookOpen size={15} />} onClick={() => setKnowledgeBase((value) => !value)}>知识库</Button>
                            {dingtalkConnected ? <Tag color="success">{t('钉钉已连接')}</Tag> : null}
                            <Select className="composer-mode" size="small" value={mode} onChange={setMode} options={[{ label: '快速模式', value: 'standard' }, { label: '深度模式', value: 'ultra' }]} />
                            <Button type="primary" className="composer-send" icon={<Send size={16} />} loading={sending} onClick={() => void sendMessage()}>发送</Button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
        {previewDocument && <aside className="document-preview-panel"><div className="document-preview-heading"><span><FileTextIcon size={18} /><strong>{previewDocument.title}</strong></span><Button type="text" onClick={() => setPreviewDocument(undefined)}>×</Button></div><div className="document-preview-content chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownRenderComponents}>{previewDocument.content}</ReactMarkdown></div></aside>}
        {saveTarget && <SaveToKnowledgeModal target={saveTarget} onClose={() => setSaveTarget(undefined)} onSaved={(document) => { message.success(t('已存入知识库：文档《{name}》正在解析索引，处理完成后即可被知识库检索引用。', { name: document.name })); setSaveTarget(undefined); }} />}
        <Modal open={!!renameTarget} title={t('重命名对话')} okText={t('确定')} cancelText={t('取消')} onOk={submitRename} onCancel={() => setRenameTarget(undefined)}>
            <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onPressEnter={submitRename} maxLength={128} autoFocus placeholder={t('请输入新的对话名称')} />
        </Modal>
    </div >;
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

function CurrentPage({ authContext, members, documents, membersLoading, documentsLoading, onSessionExpired, onProfileUpdated }: { authContext: MeResult; members: TenantMember[]; documents: ManagedDocumentSummary[]; membersLoading: boolean; documentsLoading: boolean; onSessionExpired: () => void; onProfileUpdated: (displayName: string) => void }): JSX.Element {
    const location = useLocation();
    if (location.pathname === '/browser') return <BrowserPage />;
    // if (location.pathname === '/assistant') return <AssistantPage />;
    if (location.pathname === '/assistant') return <AssistantPage permissions={authContext.permissions} />;
    if (location.pathname === '/projects') return <ProjectManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/meetings') return <MeetingManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/reports') return <WorkReportPage authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/connectors' || location.pathname === '/applications') return <ConnectorMarketplacePage />;
    if (location.pathname === '/architecture') return <OrganizationManagement authContext={authContext} fallbackMembers={members} membersLoading={membersLoading} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/assignment') return <AssignmentPolicyManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/hr') return <HrManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/finance') return <FinanceManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/legal') return <LegalContractManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/roles') return <RoleManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/dingtalk') return <DingTalkOrganizationPage authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/documents') return <ManagedDocumentsPage documents={documents} loading={documentsLoading} />;
    if (location.pathname === '/knowledge') return <KnowledgeManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/profile') return <ProfileSettings tenantName={authContext.tenant.name} onProfileUpdated={onProfileUpdated} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/notifications') return <NotificationCenter authContext={authContext} onSessionExpired={onSessionExpired} />;
    return <RoleBasedHomePage authContext={authContext} />;
    /*
    function DocumentEditorModal({ documentId, onClose }: { documentId?: string; onClose: () => void }): JSX.Element {
        const { message } = AntdApp.useApp();
        const { t } = useI18n();
        const [document, setDocument] = useState<ManagedDocumentDetail>();
        const [content, setContent] = useState('');
        const [loading, setLoading] = useState(false);
        const [saving, setSaving] = useState(false);
        const [exporting, setExporting] = useState<'docx' | 'pdf' | 'pptx'>();

        useEffect(() => {
            if (!documentId) return;
            setLoading(true);
            getDocument(documentId)
                .then((doc) => { setDocument(doc); setContent(doc.content); })
                .catch((error) => message.error(error instanceof Error ? error.message : t('加载文档失败')))
                .finally(() => setLoading(false));
        }, [documentId, message, t]);

        const handleSave = async (): Promise<void> => {
            if (!document) return;
            setSaving(true);
            try {
                const updated = await updateDocument(document.id, { content, version: document.version });
                setDocument(updated);
                message.success(t('已保存'));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t('保存失败'));
            } finally {
                setSaving(false);
            }
        };

        const handleExport = async (format: 'docx' | 'pdf' | 'pptx'): Promise<void> => {
            if (!document) return;
            setExporting(format);
            try {
                await exportDocument(document.id, format, document.title);
            } catch (error) {
                message.error(error instanceof Error ? error.message : t('导出失败'));
            } finally {
                setExporting(undefined);
            }
        };

        return <Modal open={Boolean(documentId)} onCancel={onClose} footer={null} width={760} title={document?.title ?? t('文档')} destroyOnHidden>
            {loading ? <div className="data-loading"><Spin /></div> : <>
                <Input.TextArea value={content} onChange={(event) => setContent(event.target.value)} rows={16} style={{ fontFamily: 'Menlo, Consolas, monospace' }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                    <Button icon={<Download size={15} />} loading={exporting === 'docx'} onClick={() => void handleExport('docx')}>{t('DOCX')}</Button>
                    <Button icon={<Download size={15} />} loading={exporting === 'pdf'} onClick={() => void handleExport('pdf')}>{t('PDF')}</Button>
                    <Button icon={<Download size={15} />} loading={exporting === 'pptx'} onClick={() => void handleExport('pptx')}>{t('PPTX')}</Button>
                    <Button type="primary" loading={saving} onClick={() => void handleSave()}>{t('保存')}</Button>
                </div>
            </>}
        </Modal>;
    }

    function KnowledgePage({ documents, loading }: { documents: ManagedDocumentSummary[]; loading: boolean }): JSX.Element {
        const { t } = useI18n();
        const formatDate = useDateFormatter();
        const [search, setSearch] = useState('');
        const filteredDocuments = documents.filter((document) => document.title.toLowerCase().includes(search.toLowerCase()));
        const [selectedId, setSelectedId] = useState<string>();
        const [editingId, setEditingId] = useState<string>();
        const selected = documents.find((document) => document.id === selectedId) ?? documents[0];

        return <div className="workspace-page knowledge-page">
            <PageHeader title={t('知识管理')} description={t('沉淀、组织并安全共享企业知识')} actions={<Button type="primary" icon={<PlusOutlined />}>{t('新建文档')}</Button>} />
            <div className="knowledge-layout">
                <aside className="knowledge-folders surface-panel"><h3>{t('受控文档')}</h3><button className="is-active" type="button"><BookOutlined />{t('全部文档')}<span>{documents.length}</span></button><button type="button"><FolderOutlined />{t('租户可见')}<span>{documents.filter((document) => document.visibility === 'TENANT').length}</span></button><button type="button"><FolderOutlined />{t('我的私有')}<span>{documents.filter((document) => document.visibility === 'PRIVATE').length}</span></button></aside>
                <section className="knowledge-list surface-panel"><div className="knowledge-toolbar"><Input value={search} onChange={(event) => setSearch(event.target.value)} prefix={<SearchOutlined />} placeholder={t('搜索受控文档')} /><Button icon={<StarOutlined />}>{t('收藏')}</Button></div><div className="knowledge-table-head"><span>{t('文档名称')}</span><span>{t('可见性')}</span><span>{t('更新时间')}</span><span>{t('版本')}</span></div>{loading ? <div className="data-loading"><Spin /></div> : filteredDocuments.length ? filteredDocuments.map((document) => <button className={`knowledge-row ${selected?.id === document.id ? 'is-selected' : ''}`} type="button" key={document.id} onClick={() => setSelectedId(document.id)}><span><i><FileTextOutlined /></i><b>{document.title}</b><small>{t('受控文档')}</small></span><span>{document.visibility === 'TENANT' ? t('租户可见') : t('私有')}</span><span>{formatDate(document.updatedAt)}</span><span><Tag>v{document.version}</Tag></span></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前权限范围内暂无文档')} />}</section>
                <aside className="knowledge-detail surface-panel">{selected ? <><i className="knowledge-file-icon"><FileTextOutlined /></i><h2>{selected.title}</h2><Tag>{selected.visibility === 'TENANT' ? t('租户可见') : t('私有')}</Tag><p>{t('该受控文档由 NestJS 统一执行权限、资源范围、版本控制与审计。')}</p><dl><div><dt>{t('最近更新')}</dt><dd>{formatDate(selected.updatedAt)}</dd></div><div><dt>{t('当前版本')}</dt><dd>v{selected.version}</dd></div><div><dt>{t('有效权限')}</dt><dd>{selected.currentPermissions?.join('、') || t('读取')}</dd></div></dl><Button type="primary" block onClick={() => setEditingId(selected.id)}>{t('打开文档')}</Button></> : <Empty description={t('请选择文档')} />}</aside>
            </div>
            <DocumentEditorModal documentId={editingId} onClose={() => setEditingId(undefined)} />
        </div>;
    }

    function CurrentPage({ authContext, members, documents, membersLoading, documentsLoading, onSessionExpired, onProfileUpdated }: { authContext: MeResult; members: TenantMember[]; documents: ManagedDocumentSummary[]; membersLoading: boolean; documentsLoading: boolean; onSessionExpired: () => void; onProfileUpdated: (displayName: string) => void }): JSX.Element {
        return <Routes>
            <Route path="/" element={<RoleBasedHomePage authContext={authContext} />} />
            <Route path="/browser" element={<BrowserPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/projects" element={<ProjectManagement authContext={authContext} onSessionExpired={onSessionExpired} />} />
            <Route path="/meetings" element={<MeetingManagement authContext={authContext} onSessionExpired={onSessionExpired} />} />
            <Route path="/reports" element={<WorkReportPage authContext={authContext} onSessionExpired={onSessionExpired} />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/architecture" element={<OrganizationManagement authContext={authContext} fallbackMembers={members} membersLoading={membersLoading} onSessionExpired={onSessionExpired} />} />
            <Route path="/roles" element={<RoleManagement authContext={authContext} onSessionExpired={onSessionExpired} />} />
            <Route path="/knowledge" element={<KnowledgePage documents={documents} loading={documentsLoading} />} />
            <Route path="/profile" element={<ProfileSettings tenantName={authContext.tenant.name} onProfileUpdated={onProfileUpdated} onSessionExpired={onSessionExpired} />} />
            <Route path="/notifications" element={<NotificationCenter authContext={authContext} onSessionExpired={onSessionExpired} />} />
        </Routes>;
    */
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
