import { ArrowRight, BookOpen, BriefcaseBusiness, Building2, CalendarDays, FileText, FolderKanban, Landmark, MessageSquareText, Network, Scale, Send, Sparkles, Users } from 'lucide-react';
import { Alert, Button, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getDashboardHomepage, type DashboardHomepage, type MeResult } from '../../core/api';
import { useI18n } from '../../core/i18n';
import './ai-workspace-home.css';

type BoardDefinition = {
    key: string;
    title: string;
    description: string;
    path: string;
    icon: JSX.Element;
    tone: 'amber' | 'red' | 'green' | 'violet' | 'blue' | 'slate';
    permissions?: string[];
    actions: Array<{ label: string; path: string; icon: JSX.Element; permissions?: string[] }>;
};

const boards: BoardDefinition[] = [
    { key: 'collaboration', title: '协作管理', description: '项目推进、会议协同与工作汇报', path: '/projects', icon: <FolderKanban />, tone: 'blue', permissions: ['project.read', 'meeting.read', 'work_report.read'], actions: [{ label: '项目', path: '/projects', icon: <FolderKanban />, permissions: ['project.read'] }, { label: '会议', path: '/meetings', icon: <CalendarDays />, permissions: ['meeting.read'] }, { label: '报告', path: '/reports', icon: <FileText />, permissions: ['work_report.read'] }] },
    { key: 'organization', title: '组织管理', description: '组织架构、角色权限与成员策略', path: '/architecture', icon: <Building2 />, tone: 'slate', actions: [{ label: '架构', path: '/architecture', icon: <Building2 /> }, { label: '角色', path: '/roles', icon: <Users />, permissions: ['role.read'] }, { label: '策略', path: '/assignment', icon: <Sparkles />, permissions: ['assignment.policy.read'] }] },
    { key: 'business', title: '业务管理', description: '人力、财务与合同风险统一洞察', path: '/hr', icon: <Landmark />, tone: 'green', permissions: ['hr.profile.read', 'finance.expense.read', 'legal.contract.read'], actions: [{ label: '人力', path: '/hr', icon: <Users />, permissions: ['hr.profile.read', 'hr.leave.read', 'hr.attendance.read', 'hr.report.read'] }, { label: '财务', path: '/finance', icon: <Landmark />, permissions: ['finance.ledger.read', 'finance.expense.read', 'finance.expense.request'] }, { label: '法务', path: '/legal', icon: <Scale />, permissions: ['legal.contract.read', 'legal.contract.create'] }] },
    { key: 'content', title: '内容管理', description: '企业知识、生成文档与外部数据连接', path: '/knowledge', icon: <BookOpen />, tone: 'violet', permissions: ['knowledge_base.read', 'document.read'], actions: [{ label: '知识库', path: '/knowledge', icon: <BookOpen />, permissions: ['knowledge_base.read'] }, { label: '文档', path: '/documents', icon: <FileText />, permissions: ['document.read'] }, { label: '连接器', path: '/connectors', icon: <Network /> }] },
];

const suggestions = ['整理今天的待办并给出优先级', '分析本月财务收支异常', '查询我负责的项目和任务', '生成一份经营周报'];

interface AiWorkspaceHomeProps {
    authContext: MeResult;
    onStartConversation?: (content: string, options: { webSearch: boolean; knowledgeSearch: boolean }) => void;
}

export default function AiWorkspaceHome({ authContext, onStartConversation }: AiWorkspaceHomeProps): JSX.Element {
    const { t } = useI18n();
    const navigate = useNavigate();
    const location = useLocation();
    const [prompt, setPrompt] = useState('');
    const [webSearch, setWebSearch] = useState(false);
    const [knowledgeSearch, setKnowledgeSearch] = useState(true);
    const query = useQuery({ queryKey: ['dashboard-home'], queryFn: getDashboardHomepage, refetchInterval: 120_000 });
    const boardsOnly = location.pathname === '/workbench';
    const visibleBoards = useMemo(() => boards.filter((board) => !board.permissions || board.permissions.some((permission) => authContext.permissions.includes(permission))), [authContext.permissions]);

    const startConversation = (value = prompt): void => {
        const content = value.trim();
        if (!content) return;
        if (onStartConversation) {
            onStartConversation(content, { webSearch, knowledgeSearch });
            return;
        }
        navigate('/assistant', { state: { createNewConversation: true, initialPrompt: content, webSearchEnabled: webSearch, knowledgeBaseEnabled: knowledgeSearch } });
    };

    return <div className={`ai-home ${boardsOnly ? 'is-boards-only' : ''}`}>
        {!boardsOnly && <>
            <section className="ai-home-hero">
                <div className="ai-home-presence"><span />{greeting(authContext.user.displayName)}</div>
                <h1>CEES <strong>AI Workspace</strong></h1>
                <p>{t('问任何问题，创建任何事务，让企业 AI 为你工作')}</p>
                <div className="ai-home-composer">
                    <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); startConversation(); } }} placeholder={t('问任何问题，创建任何事务…')} rows={2} />
                    <div className="ai-home-composer-actions">
                        <button type="button" className={webSearch ? 'is-active' : ''} onClick={() => setWebSearch((value) => !value)}><Network size={15} />{t('联网')}</button>
                        <button type="button" className={knowledgeSearch ? 'is-active' : ''} onClick={() => setKnowledgeSearch((value) => !value)}><BookOpen size={15} />{t('知识库')}</button>
                        <span />
                        <Button type="primary" shape="circle" icon={<Send size={16} />} disabled={!prompt.trim()} onClick={() => startConversation()} aria-label={t('发送')} />
                    </div>
                </div>
                <div className="ai-home-suggestions">
                    {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => startConversation(suggestion)}><Sparkles size={13} />{t(suggestion)}</button>)}
                </div>
                <div className="ai-home-agents">
                    <button type="button" onClick={() => startConversation('给我一份今天的经营简报')}><i className="tone-amber"><BriefcaseBusiness /></i><span>{t('经营简报')}</span></button>
                    <button type="button" onClick={() => startConversation('分析目前需要我决策的事项')}><i className="tone-violet"><Sparkles /></i><span>{t('决策助手')}</span></button>
                    <button type="button" onClick={() => startConversation('帮我生成一份演示文稿')}><i className="tone-blue"><FileText /></i><span>{t('AI 幻灯片')}</span></button>
                    <button type="button" onClick={() => startConversation('扫描当前业务中的风险并按优先级汇总')}><i className="tone-red"><MessageSquareText /></i><span>{t('风险哨兵')}</span></button>
                </div>
            </section>
            {query.data?.alerts.length ? <section className="ai-home-alerts">{query.data.alerts.slice(0, 3).map((alert) => <button type="button" key={alert.code} onClick={() => alert.link && navigate(alert.link)}><span className={`severity-${alert.severity.toLowerCase()}`} /><strong>{alert.title}</strong><small>{alert.detail}</small><ArrowRight size={14} /></button>)}</section> : null}
        </>}

        <section className="ai-board-wall">
            <div className="ai-board-wall-head">
                <div><span>{t('WORKBENCH')}</span><h2>{boardsOnly ? t('全部看板') : t('我的看板')}</h2></div>
                {!boardsOnly && <button type="button" onClick={() => navigate('/workbench')}>{t('全部看板')}<ArrowRight size={14} /></button>}
            </div>
            {query.isLoading && <div className="data-loading"><Spin /></div>}
            {query.error && <Alert type="error" showIcon message={query.error instanceof Error ? query.error.message : t('首页加载失败')} />}
            <div className="ai-board-grid">
                {visibleBoards.map((board) => <BoardCard key={board.key} board={board} dashboard={query.data} permissions={authContext.permissions} onNavigate={navigate} />)}
            </div>
        </section>
    </div>;
}

function BoardCard({ board, dashboard, permissions, onNavigate }: { board: BoardDefinition; dashboard?: DashboardHomepage; permissions: string[]; onNavigate: (path: string) => void }): JSX.Element {
    const signal = boardSignal(board.key, dashboard);
    const actions = board.actions.filter((action) => !action.permissions || action.permissions.some((permission) => permissions.includes(permission)));
    return <article className={`ai-board-card tone-${board.tone}`}>
        <button type="button" className="ai-board-card-main" onClick={() => onNavigate(board.path)}>
            <div className="ai-board-card-head"><i>{board.icon}</i><span><strong>{board.title}</strong><small><Sparkles size={11} />AI 实时聚合</small></span><ArrowRight size={15} /></div>
            <p>{signal || board.description}</p>
        </button>
        <footer>{actions.map((action) => <button type="button" key={action.path} onClick={() => onNavigate(action.path)}>{action.icon}<span>{action.label}</span></button>)}</footer>
    </article>;
}

function boardSignal(key: string, dashboard?: DashboardHomepage): string | null {
    const card = dashboard?.cards.find((item) => item.key.startsWith(key) || item.link?.includes(key));
    if (!card) return null;
    const values = Object.values(card.payload as Record<string, unknown>).filter((value) => typeof value === 'number' || typeof value === 'string').slice(0, 3);
    return values.length ? values.join(' · ') : null;
}

function greeting(name: string): string {
    const hour = new Date().getHours();
    return `${hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'}，${name}`;
}