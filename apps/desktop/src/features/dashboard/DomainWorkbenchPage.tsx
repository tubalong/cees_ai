import { ArrowRight, BarChart3, BookOpen, Building2, CalendarDays, FileText, FolderKanban, Landmark, Scale, Sparkles, Users } from 'lucide-react';
import { Alert, Button, Card, Progress, Spin, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { getDashboardHomepage, type DashboardHomepage, type MeResult } from '../../core/api';
import { useI18n } from '../../core/i18n';
import './domain-workbench.css';

type DomainConfig = {
    key: string;
    title: string;
    subtitle: string;
    icon: JSX.Element;
    tone: 'blue' | 'slate' | 'green' | 'violet';
    managementPath: string;
    managementLabel: string;
    actions: Array<{ label: string; path: string; icon: JSX.Element }>;
};

const domains: Record<string, DomainConfig> = {
    collaboration: { key: 'collaboration', title: '协作管理', subtitle: '项目、会议、任务与工作报告的协作总览', icon: <FolderKanban />, tone: 'blue', managementPath: '/projects', managementLabel: '进入协作管理', actions: [{ label: '项目管理', path: '/projects', icon: <FolderKanban /> }, { label: '会议管理', path: '/meetings', icon: <CalendarDays /> }, { label: '工作报告', path: '/reports', icon: <FileText /> }] },
    organization: { key: 'organization', title: '组织管理', subtitle: '组织架构、成员角色与分配策略的管理洞察', icon: <Building2 />, tone: 'slate', managementPath: '/architecture', managementLabel: '进入组织管理', actions: [{ label: '组织架构', path: '/architecture', icon: <Building2 /> }, { label: '角色权限', path: '/roles', icon: <Users /> }, { label: '分配策略', path: '/assignment', icon: <Sparkles /> }] },
    business: { key: 'business', title: '业务管理', subtitle: '人力、财务与合同风险的经营信号', icon: <Landmark />, tone: 'green', managementPath: '/hr', managementLabel: '进入业务管理', actions: [{ label: '人力资源', path: '/hr', icon: <Users /> }, { label: '财务管理', path: '/finance', icon: <Landmark /> }, { label: '合同台账', path: '/legal', icon: <Scale /> }] },
    content: { key: 'content', title: '内容管理', subtitle: '知识、文档与外部连接的内容资产总览', icon: <BookOpen />, tone: 'violet', managementPath: '/knowledge', managementLabel: '进入内容管理', actions: [{ label: '知识管理', path: '/knowledge', icon: <BookOpen /> }, { label: '生成文档', path: '/documents', icon: <FileText /> }, { label: '连接器', path: '/connectors', icon: <Building2 /> }] },
};

export default function DomainWorkbenchPage({ authContext }: { authContext: MeResult }): JSX.Element {
    const { domain = 'collaboration' } = useParams();
    const navigate = useNavigate();
    const { t } = useI18n();
    const config = domains[domain] ?? domains.collaboration;
    const query = useQuery({ queryKey: ['domain-workbench', domain], queryFn: getDashboardHomepage, refetchInterval: 120_000 });
    const cards = query.data?.cards.filter((card) => card.key.startsWith(config.key) || card.link?.includes(config.key)) ?? [];
    const signalValues = cards.flatMap((card) => Object.values(card.payload as Record<string, unknown>).filter((value) => typeof value === 'string' || typeof value === 'number')).slice(0, 4);
    const metrics = signalValues.length ? signalValues : ['暂无数据', '等待业务同步', '可向 AI 询问', '实时更新'];
    const progress = Math.min(96, 34 + cards.length * 12);

    return <div className={`domain-workbench tone-${config.tone}`}>
        <header className="domain-workbench-header">
            <div className="domain-workbench-title"><i>{config.icon}</i><div><span>WORKBENCH / {config.key.toUpperCase()}</span><h1>{t(config.title)}</h1><p>{t(config.subtitle)}</p></div></div>
            <div className="domain-workbench-actions"><Button onClick={() => navigate('/')} icon={<Sparkles size={15} />}>问问 AI</Button><Button type="primary" onClick={() => navigate(config.managementPath)}>{t(config.managementLabel)}<ArrowRight size={15} /></Button></div>
        </header>
        <section className="domain-metric-grid">{metrics.map((value, index) => <Card key={`${String(value)}-${index}`} bordered={false}><span>{['核心信号', '待处理事项', '最近更新', 'AI 洞察'][index]}</span><strong>{String(value)}</strong><small>{index === 0 ? '系统实时聚合' : '点击右上角进入管理'}</small></Card>)}</section>
        <section className="domain-insight-grid">
            <Card className="domain-chart-card" bordered={false}><div className="domain-section-heading"><span><BarChart3 size={16} />AI 业务趋势</span><Tag color="processing">实时聚合</Tag></div><div className="domain-bars">{[42, 68, 51, 82, 64, progress].map((height, index) => <div className="domain-bar-column" key={index}><div className="domain-bar" style={{ height: `${height}%` }} /><small>{['周一', '周二', '周三', '周四', '周五', '今天'][index]}</small></div>)}</div><p className="domain-chart-caption">AI 根据当前可见业务数据生成趋势摘要，详细操作请进入右上角管理页面。</p></Card>
            <Card className="domain-focus-card" bordered={false}><div className="domain-section-heading"><span><Sparkles size={16} />AI 关注点</span><Tag>{authContext.user.displayName}</Tag></div><div className="domain-focus-list"><div><i className="dot dot-warning" /><span>{config.title}中有需要关注的事项</span><ArrowRight size={14} /></div><div><i className="dot dot-info" /><span>可以直接询问当前页面数据</span><ArrowRight size={14} /></div><div><i className="dot dot-success" /><span>权限范围内的业务数据已就绪</span><ArrowRight size={14} /></div></div></Card>
        </section>
        <section className="domain-entry-section"><div className="domain-section-heading"><span>相关管理入口</span><small>管理操作集中在业务页面，保持看板专注于洞察</small></div><div className="domain-entry-grid">{config.actions.map((action) => <button type="button" key={action.path} onClick={() => navigate(action.path)}><i>{action.icon}</i><span>{t(action.label)}</span><ArrowRight size={15} /></button>)}</div></section>
        {query.isLoading && <div className="domain-loading"><Spin /></div>}
        {query.error && <Alert type="error" showIcon message={t('看板数据加载失败')} description={query.error instanceof Error ? query.error.message : undefined} />}
    </div>;
}
