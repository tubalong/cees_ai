import {
    AppstoreOutlined, BankOutlined, BellOutlined, BookOutlined, CheckCircleOutlined,
    CodeOutlined, DatabaseOutlined, DownloadOutlined, FileTextOutlined, FolderOutlined,
    HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, MoreOutlined,
    PlusOutlined, RobotOutlined, SafetyCertificateOutlined, SearchOutlined, SendOutlined, SettingOutlined,
    StarOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { App as AntdApp, Avatar, Button, Empty, Input, Spin, Tag, Tooltip } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    downloadDocumentDocx, hasStoredSession, listDocuments, listTenantMembers, logout,
    type ManagedDocumentSummary, type MeResult, type TenantMember,
} from './api';
import OrganizationManagement from './OrganizationManagement';
import ProfileSettings from './ProfileSettings';
import RoleManagement from './RoleManagement';
import { useDateFormatter, useI18n } from './i18n';

interface NavItem {
    path: string;
    label: string;
    icon: JSX.Element;
}

const navItems: NavItem[] = [
    { path: '/', label: '首页', icon: <HomeOutlined /> },
    { path: '/assistant', label: 'AI 助手', icon: <MessageOutlined /> },
    { path: '/applications', label: '应用中心', icon: <AppstoreOutlined /> },
    { path: '/architecture', label: '架构管理', icon: <TeamOutlined /> },
    { path: '/roles', label: '角色权限', icon: <SafetyCertificateOutlined /> },
    { path: '/knowledge', label: '知识管理', icon: <BookOutlined /> },
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

interface WorkspaceProps {
    authContext: MeResult;
    onSessionExpired: () => void;
    onProfileUpdated: (displayName: string) => void;
}

function SideNavigation({ collapsed, permissions, onToggle, onLogout }: { collapsed: boolean; permissions: string[]; onToggle: () => void; onLogout: () => void }): JSX.Element {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useI18n();

    return <aside className={`side-navigation ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="workspace-brand">
            <span className="workspace-brand-mark">B</span>
            {!collapsed && <span><strong>CEES AI</strong><small>{t('企业智能工作台')}</small></span>}
        </div>
        <nav className="nav-list">
            {navItems.filter((item) => item.path !== '/roles' || permissions.includes('role.read')).map((item) => <Tooltip key={item.path} title={collapsed ? t(item.label) : ''} placement="right">
                <button className={`nav-item ${location.pathname === item.path ? 'is-active' : ''}`} type="button" onClick={() => navigate(item.path)}>
                    {item.icon}{!collapsed && <span>{t(item.label)}</span>}
                </button>
            </Tooltip>)}
        </nav>
        <div className="nav-bottom">
            <Tooltip title={collapsed ? t('个人中心') : ''} placement="right"><button className={`nav-item ${location.pathname === '/profile' ? 'is-active' : ''}`} type="button" onClick={() => navigate('/profile')}><UserOutlined />{!collapsed && <span>{t('个人中心')}</span>}</button></Tooltip>
            <Tooltip title={collapsed ? t('退出登录') : ''} placement="right"><button className="nav-item" type="button" onClick={onLogout}><LogoutOutlined />{!collapsed && <span>{t('退出登录')}</span>}</button></Tooltip>
            <Tooltip title={collapsed ? t('收起导航') : ''} placement="right"><button className="nav-item nav-toggle" type="button" onClick={onToggle}>{collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}{!collapsed && <span>{t('收起导航')}</span>}</button></Tooltip>
        </div>
    </aside>;
}

function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: JSX.Element }): JSX.Element {
    const { t } = useI18n();
    return <header className="workspace-page-header">
        <div><h1>{t(title)}</h1>{description && <p>{t(description)}</p>}</div>
        {actions}
    </header>;
}

function HomePage({ authContext, documents, memberCount }: { authContext: MeResult; documents: ManagedDocumentSummary[]; memberCount: number }): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    return <div className="workspace-page home-page">
        <PageHeader title={t('下午好，{name}', { name: authContext.user.displayName })} description={t('欢迎回到 {tenant}，今天也一起高效工作', { tenant: authContext.tenant.name })} actions={<div className="header-actions"><Input prefix={<SearchOutlined />} placeholder={t('搜索文档、应用、成员')} /><Button type="primary" icon={<PlusOutlined />}>{t('新建')}</Button></div>} />
        <div className="metric-grid">
            {[
                ['今日待办', '12', '3 项即将到期', <CheckCircleOutlined />, 'indigo'],
                ['受控文档', String(documents.length), documents.length ? '来自当前权限范围' : '暂无文档', <BookOutlined />, 'violet'],
                ['常用应用', '8', '本月使用 126 次', <AppstoreOutlined />, 'green'],
                ['组织成员', String(memberCount), '当前租户可见成员', <BellOutlined />, 'orange'],
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
                    <div className="panel-heading"><h3>{t('待办事项')}</h3><button type="button">{t('全部待办')}</button></div>
                    <div className="task-row"><span>{t('审核「技术架构设计文档」')}</span><strong className="warning-text">{t('今天 18:00 截止')}</strong></div>
                    <div className="task-row"><span>{t('确认新员工「王五」权限配置')}</span><small>{t('明天 12:00 截止')}</small></div>
                </section>
            </div>
            <div className="home-side-column">
                <section className="assistant-widget">
                    <div className="assistant-widget-title"><i><RobotOutlined /></i><strong>{t('AI 助手')}</strong></div>
                    <p>{t('有什么可以帮你的？')}</p>
                    <button type="button" onClick={() => message.info(t('请从左侧进入 AI 助手开始对话'))}>{t('输入你的问题…')}<SendOutlined /></button>
                </section>
                <section className="surface-panel activity-panel">
                    <div className="panel-heading"><h3>{t('最近动态')}</h3></div>
                    {['李四上传了新文档', '王五加入了项目「智能客服」', '系统更新了 AI 文档助手'].map((activity, index) => <div className="activity-row" key={activity}><Avatar size={26}>{index + 1}</Avatar><span>{t(activity)}<small>{index === 0 ? t('2 小时前') : t('昨天')}</small></span></div>)}
                </section>
            </div>
        </div>
    </div>;
}

function AssistantPage(): JSX.Element {
    const { t } = useI18n();
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState(() => [
        { role: 'user', content: t('帮我总结一下这份季度报告的核心要点') },
        { role: 'assistant', content: t('根据这份季度报告，核心要点如下：\n• Q1 营收同比增长 23%，超出预期目标\n• 新增 3 个企业客户，客户留存率提升至 92%\n• 产品迭代 5 个版本，核心功能使用率提升 18%') },
    ]);
    const sendMessage = (): void => {
        if (!input.trim()) return;
        setMessages((current) => [...current, { role: 'user', content: input.trim() }, { role: 'assistant', content: t('这是当前的界面原型回复。后续接入 AI Service 后，我会基于企业知识与权限范围生成答案。') }]);
        setInput('');
    };

    return <div className="assistant-layout">
        <aside className="conversation-list">
            <div className="conversation-heading"><h2>{t('对话')}</h2><Button type="primary" icon={<PlusOutlined />}>{t('新对话')}</Button></div>
            {['帮我总结这份季度报告', '代码性能优化建议', '翻译技术文档'].map((title, index) => <button className={`conversation-item ${index === 0 ? 'is-active' : ''}`} type="button" key={title}><strong>{t(title)}</strong><small>{index === 0 ? t('刚刚') : index === 1 ? t('昨天') : t('3 天前')}</small></button>)}
        </aside>
        <section className="chat-panel">
            <header className="chat-header"><span><i><RobotOutlined /></i><strong>{t('CEES AI 助手')}</strong></span><Button type="text" icon={<MoreOutlined />} /></header>
            <div className="message-stream">
                {messages.map((item, index) => <div className={`chat-message ${item.role}`} key={`${item.role}-${index}`}>
                    {item.role === 'assistant' && <i className="assistant-avatar"><RobotOutlined /></i>}
                    <div>{item.content.split('\n').map((line) => <p key={line}>{line}</p>)}</div>
                </div>)}
            </div>
            <div className="composer-area">
                <div className="prompt-chips">{['总结文档要点', '翻译内容', '生成代码'].map((prompt) => <button type="button" key={prompt} onClick={() => setInput(prompt)}>{t(prompt)}</button>)}</div>
                <div className="message-composer"><Input value={input} onChange={(event) => setInput(event.target.value)} onPressEnter={sendMessage} placeholder={t('输入消息，Enter 发送')} /><Button type="primary" icon={<SendOutlined />} onClick={sendMessage}>{t('发送')}</Button></div>
            </div>
        </section>
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
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const formatDate = useDateFormatter();
    const [search, setSearch] = useState('');
    const filteredDocuments = documents.filter((document) => document.title.toLowerCase().includes(search.toLowerCase()));
    const [selectedId, setSelectedId] = useState<string>();
    const selected = documents.find((document) => document.id === selectedId) ?? documents[0];
    const [exporting, setExporting] = useState(false);

    const handleExport = async (): Promise<void> => {
        if (!selected || exporting) return;
        setExporting(true);
        try {
            await downloadDocumentDocx(selected.id, selected.title);
            message.success(t('已导出 DOCX'));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('导出失败，请稍后重试'));
        } finally {
            setExporting(false);
        }
    };

    return <div className="workspace-page knowledge-page">
        <PageHeader title={t('知识管理')} description={t('沉淀、组织并安全共享企业知识')} actions={<Button type="primary" icon={<PlusOutlined />}>{t('新建文档')}</Button>} />
        <div className="knowledge-layout">
            <aside className="knowledge-folders surface-panel"><h3>{t('受控文档')}</h3><button className="is-active" type="button"><BookOutlined />{t('全部文档')}<span>{documents.length}</span></button><button type="button"><FolderOutlined />{t('租户可见')}<span>{documents.filter((document) => document.visibility === 'TENANT').length}</span></button><button type="button"><FolderOutlined />{t('我的私有')}<span>{documents.filter((document) => document.visibility === 'PRIVATE').length}</span></button></aside>
            <section className="knowledge-list surface-panel"><div className="knowledge-toolbar"><Input value={search} onChange={(event) => setSearch(event.target.value)} prefix={<SearchOutlined />} placeholder={t('搜索受控文档')} /><Button icon={<StarOutlined />}>{t('收藏')}</Button></div><div className="knowledge-table-head"><span>{t('文档名称')}</span><span>{t('可见性')}</span><span>{t('更新时间')}</span><span>{t('版本')}</span></div>{loading ? <div className="data-loading"><Spin /></div> : filteredDocuments.length ? filteredDocuments.map((document) => <button className={`knowledge-row ${selected?.id === document.id ? 'is-selected' : ''}`} type="button" key={document.id} onClick={() => setSelectedId(document.id)}><span><i><FileTextOutlined /></i><b>{document.title}</b><small>{t('受控文档')}</small></span><span>{document.visibility === 'TENANT' ? t('租户可见') : t('私有')}</span><span>{formatDate(document.updatedAt)}</span><span><Tag>v{document.version}</Tag></span></button>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前权限范围内暂无文档')} />}</section>
            <aside className="knowledge-detail surface-panel">{selected ? <><i className="knowledge-file-icon"><FileTextOutlined /></i><h2>{selected.title}</h2><Tag>{selected.visibility === 'TENANT' ? t('租户可见') : t('私有')}</Tag><p>{t('该受控文档由 NestJS 统一执行权限、资源范围、版本控制与审计。')}</p><dl><div><dt>{t('最近更新')}</dt><dd>{formatDate(selected.updatedAt)}</dd></div><div><dt>{t('当前版本')}</dt><dd>v{selected.version}</dd></div><div><dt>{t('有效权限')}</dt><dd>{selected.currentPermissions?.join('、') || t('读取')}</dd></div></dl><Button type="primary" block>{t('打开文档')}</Button><Button block icon={<DownloadOutlined />} loading={exporting} onClick={() => void handleExport()}>{t('导出 DOCX')}</Button></> : <Empty description={t('请选择文档')} />}</aside>
        </div>
    </div>;
}

function CurrentPage({ authContext, members, documents, membersLoading, documentsLoading, onSessionExpired, onProfileUpdated }: { authContext: MeResult; members: TenantMember[]; documents: ManagedDocumentSummary[]; membersLoading: boolean; documentsLoading: boolean; onSessionExpired: () => void; onProfileUpdated: (displayName: string) => void }): JSX.Element {
    const location = useLocation();
    if (location.pathname === '/assistant') return <AssistantPage />;
    if (location.pathname === '/applications') return <ApplicationsPage />;
    if (location.pathname === '/architecture') return <OrganizationManagement authContext={authContext} fallbackMembers={members} membersLoading={membersLoading} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/roles') return <RoleManagement authContext={authContext} onSessionExpired={onSessionExpired} />;
    if (location.pathname === '/knowledge') return <KnowledgePage documents={documents} loading={documentsLoading} />;
    if (location.pathname === '/profile') return <ProfileSettings tenantName={authContext.tenant.name} onProfileUpdated={onProfileUpdated} onSessionExpired={onSessionExpired} />;
    return <HomePage authContext={authContext} documents={documents} memberCount={members.length} />;
}

export default function Workspace({ authContext, onSessionExpired, onProfileUpdated }: WorkspaceProps): JSX.Element {
    const [collapsed, setCollapsed] = useState(false);
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const membersQuery = useQuery({ queryKey: ['tenant-members'], queryFn: () => listTenantMembers() });
    const documentsQuery = useQuery({ queryKey: ['documents'], queryFn: () => listDocuments() });

    useEffect(() => {
        if ((membersQuery.error || documentsQuery.error) && !hasStoredSession()) onSessionExpired();
    }, [documentsQuery.error, membersQuery.error, onSessionExpired]);

    const handleLogout = async (): Promise<void> => {
        await logout();
        message.success(t('已安全退出'));
        onSessionExpired();
    };

    return <div className={`workspace-shell ${collapsed ? 'nav-collapsed' : ''}`}>
        <SideNavigation collapsed={collapsed} permissions={authContext.permissions} onToggle={() => setCollapsed((current) => !current)} onLogout={() => void handleLogout()} />
        <main className="workspace-content"><CurrentPage authContext={authContext} members={membersQuery.data?.items ?? []} documents={documentsQuery.data?.items ?? []} membersLoading={membersQuery.isLoading} documentsLoading={documentsQuery.isLoading} onSessionExpired={onSessionExpired} onProfileUpdated={onProfileUpdated} /></main>
    </div>;
}
