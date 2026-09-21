import { Alert, Button, Empty, Progress, Spin, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import { CalendarOutlined, CheckCircleOutlined, DollarOutlined, FileProtectOutlined, ProjectOutlined, SendOutlined } from '@ant-design/icons';
import { getDashboardHomepage, type DashboardHomepageCard, type MeResult } from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';
import './dashboard.css';

export default function HomePage({ authContext }: { authContext: MeResult }): JSX.Element {
    const { t } = useI18n();
    const navigate = useNavigate();
    const query = useQuery({ queryKey: ['dashboard-home'], queryFn: getDashboardHomepage, refetchInterval: 120_000 });
    const dashboard = query.data;
    return <div className={`workspace-page homepage-shell homepage-${dashboard?.archetype.skeleton.toLowerCase() ?? 'employee'}`}>
        <header className="workspace-page-header homepage-header"><div><h1>{greeting(authContext.user.displayName, t)}</h1><p>{t('昨天和今天的关键工作，都集中在这里')}</p></div><div className="header-actions"><Tag color="blue">{dashboard?.archetype.skeleton ?? 'EMPLOYEE'}</Tag><Button icon={<SendOutlined />} onClick={() => navigate('/assistant')}>{t('问 AI')}</Button></div></header>
        {query.isLoading && <div className="data-loading"><Spin /></div>}
        {query.error && <Alert type="error" showIcon message={query.error instanceof Error ? query.error.message : t('首页加载失败')} />}
        {dashboard && <>
            {dashboard.alerts.length > 0 && <section className="homepage-alerts">{dashboard.alerts.map((alert) => <button type="button" key={alert.code} className={`homepage-alert homepage-alert-${alert.severity.toLowerCase()}`} onClick={() => alert.link && navigate(alert.link)}><strong>{alert.title}</strong><span>{alert.detail}</span></button>)}</section>}
            <main className="homepage-grid">{dashboard.cards.map((item) => <DashboardCard key={item.key} card={item} navigate={navigate} t={t} />)}</main>
        </>}
    </div>;
}

function DashboardCard({ card, navigate, t }: { card: DashboardHomepageCard; navigate: (path: string) => void; t: (value: string, values?: Record<string, string | number>) => string }): JSX.Element {
    const payload = card.payload as any;
    if (card.key === 'project.health') return <ProjectHealthCard payload={payload} span={card.span} />;
    if (card.key === 'finance.yesterdayLedger' || card.key === 'finance.monthLedger') return <LedgerCard card={card} navigate={navigate} />;
    if (card.key === 'finance.pendingPayment') return <MetricCard title={t('已批准待支付')} value={`¥${payload.amount}`} note={`${payload.count} 笔`} icon={<DollarOutlined />} span={card.span} onClick={() => card.link && navigate(card.link)} />;
    if (card.key === 'legal.funnel') return <MetricCard title={t('合同状态漏斗')} value={String(payload.status?.ACTIVE ?? 0)} note={`在期 · 待续签 ${payload.status?.PENDING_RENEWAL ?? 0}`} icon={<FileProtectOutlined />} span={card.span} onClick={() => card.link && navigate(card.link)} />;
    if (card.key === 'legal.expiring') return <ListCard title={t('合同到期预警')} items={(payload.items ?? []).map((item: any) => `${item.name} · ${item.endDate?.slice(0, 10) ?? '未设置到期日'}`)} span={card.span} onClick={() => card.link && navigate(card.link)} />;
    if (card.key === 'employee.focus') return <ListCard title={t('今日聚焦')} items={[...(payload.tasks ?? []).map((item: any) => item.title), ...(payload.reports ?? []).map(() => t('补交昨日工作日报'))]} span={card.span} icon={<CheckCircleOutlined />} />;
    if (card.key === 'employee.timeline') return <ListCard title={t('今日会议时间轴')} items={(payload.meetings ?? []).map((item: any) => `${item.title} · ${new Date(item.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)} span={card.span} icon={<CalendarOutlined />} />;
    if (card.key === 'employee.dailyReport') return <MetricCard title={t('昨日工作日报')} value={payload.dailyReportPending ? t('待提交') : t('已提交')} note={payload.dailyReportPending ? t('完成后今天更轻松') : t('记录已同步')} icon={<CheckCircleOutlined />} span={card.span} />;
    if (card.key === 'employee.notifications') return <MetricCard title={t('未读通知')} value={String(payload.unreadCount ?? 0)} note={t('通知中心')} icon={<SendOutlined />} span={card.span} />;
    if (card.key === 'overview.keyMetrics') return <OverviewCard payload={payload} span={card.span} />;
    if (card.key === 'manager.approvals') return <MetricCard title={t('待我审批')} value={String(payload.pendingReports ?? 0)} note={t('日报待审')} icon={<CheckCircleOutlined />} span={card.span} />;
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂不支持的首页卡片')} />;
}

function MetricCard({ title, value, note, icon, span, onClick }: { title: string; value: string; note: string; icon: JSX.Element; span: string; onClick?: () => void }): JSX.Element {
    return <section className={`homepage-card homepage-card-${span.toLowerCase()} homepage-metric-card`} onClick={onClick}><div><span>{title}</span><strong>{value}</strong><small>{note}</small></div><i>{icon}</i></section>;
}

function ListCard({ title, items, span, icon, onClick }: { title: string; items: string[]; span: string; icon?: JSX.Element; onClick?: () => void }): JSX.Element {
    return <section className={`homepage-card homepage-card-${span.toLowerCase()} homepage-list-card`} onClick={onClick}><h3>{icon}{title}</h3>{items.length ? items.slice(0, 8).map((item) => <div className="homepage-list-row" key={item}>{item}</div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待办" />}</section>;
}

function OverviewCard({ payload, span }: { payload: any; span: string }): JSX.Element {
    return <section className={`homepage-card homepage-card-${span.toLowerCase()} homepage-overview-card`}><h3><ProjectOutlined /> 昨日关键指标</h3><div className="homepage-mini-metrics"><MetricCell label="进行中项目" value={payload.project?.active} /><MetricCell label="逾期任务" value={payload.task?.overdue} /><MetricCell label="日报待审" value={payload.report?.pendingReview} /><MetricCell label="今日会议" value={payload.meeting?.today} /></div></section>;
}

function MetricCell({ label, value }: { label: string; value?: number }): JSX.Element { return <div><span>{label}</span><strong>{value ?? '-'}</strong></div>; }

function LedgerCard({ card, navigate }: { card: DashboardHomepageCard; navigate: (path: string) => void }): JSX.Element {
    const payload = card.payload as any;
    const income = Number(payload.income ?? 0); const expense = Number(payload.expense ?? 0); const net = Number(payload.net ?? 0);
    return <section className={`homepage-card homepage-card-${card.span.toLowerCase()} homepage-ledger-card`} onClick={() => card.link && navigate(card.link)}><h3><DollarOutlined /> {card.key.includes('yesterday') ? '昨日收支' : '上月收支'}</h3><div className="ledger-values"><MetricCell label="收入" value={income} /><MetricCell label="支出" value={expense} /><MetricCell label="净额" value={net} /></div><Progress percent={income ? Math.max(0, Math.min(100, Math.round((net / income) * 100))) : 0} showInfo={false} /></section>;
}

function ProjectHealthCard({ payload, span }: { payload: any; span: string }): JSX.Element {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { if (!ref.current) return; const chart = echarts.init(ref.current); chart.setOption({ animation: false, tooltip: {}, xAxis: { type: 'value', name: '完成率', max: 1 }, yAxis: { type: 'value', name: '逾期率', max: 1 }, series: [{ type: 'scatter', symbolSize: (value: number[]) => Math.max(12, (value[2] ?? 1) * 4), data: (payload.items ?? []).map((item: any) => [item.completionRate, item.overdueRate, item.memberCount, item.name]) }] }); return () => chart.dispose(); }, [payload]);
    return <section className={`homepage-card homepage-card-${span.toLowerCase()} homepage-chart-card`}><h3><ProjectOutlined /> 项目健康度矩阵</h3><div ref={ref} className="homepage-chart" /></section>;
}

function greeting(name: string, t: (value: string, values?: Record<string, string | number>) => string): string { const hour = new Date().getHours(); return t(hour < 12 ? '早上好，{name}' : hour < 18 ? '下午好，{name}' : '晚上好，{name}', { name }); }