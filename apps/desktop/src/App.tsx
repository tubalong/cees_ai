import {
    ApartmentOutlined, BellOutlined, BookOutlined, CalendarOutlined, DashboardOutlined,
    FileTextOutlined, FolderOpenOutlined, ProjectOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { Badge, Button, Card, Col, Layout, Menu, Progress, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

const { Header, Sider, Content } = Layout;
const menu = [
    ['/', '工作台', <DashboardOutlined />], ['/projects', '项目', <ProjectOutlined />],
    ['/tasks', '任务', <ApartmentOutlined />], ['/reports', '日报周报', <FileTextOutlined />],
    ['/knowledge', '知识库', <BookOutlined />], ['/meetings', '会议', <CalendarOutlined />],
    ['/briefing', '管理简报', <FolderOpenOutlined />], ['/organization', '组织与权限', <TeamOutlined />],
    ['/notifications', '通知中心', <BellOutlined />], ['/profile', '个人中心', <UserOutlined />],
];

const tasks = [
    { key: 'T-1042', title: '确认华东渠道本周回款计划', owner: '王敏', due: '今天 18:00', status: '进行中' },
    { key: 'T-1038', title: '提交建材项目报价复核', owner: '赵强', due: '已超期 1 天', status: '阻塞' },
    { key: 'T-1035', title: '整理重点客户拜访纪要', owner: '李然', due: '明天 12:00', status: '待处理' },
];

function Dashboard(): JSX.Element {
    return <>
        <div className="page-heading"><div><Typography.Title level={2}>经营工作台</Typography.Title><Typography.Text type="secondary">2025 年销售执行概览</Typography.Text></div><Button type="primary">生成今日简报</Button></div>
        <Row gutter={16} className="metrics">
            <Col span={6}><Card><Statistic title="进行中任务" value={46} suffix="项" /></Card></Col>
            <Col span={6}><Card><Statistic title="本周完成率" value={72} suffix="%" /></Card></Col>
            <Col span={6}><Card><Statistic title="超期任务" value={7} valueStyle={{ color: '#cf1322' }} suffix="项" /></Card></Col>
            <Col span={6}><Card><Statistic title="日报提交率" value={88} suffix="%" /></Card></Col>
        </Row>
        <Row gutter={16}>
            <Col span={16}><Card title="今日重点任务" extra={<Button type="link">查看全部</Button>}><Table pagination={false} dataSource={tasks} columns={[
                { title: '任务', dataIndex: 'title' }, { title: '负责人', dataIndex: 'owner', width: 100 },
                { title: '截止', dataIndex: 'due', width: 130 }, { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag color={value === '阻塞' ? 'red' : value === '进行中' ? 'blue' : 'default'}>{value}</Tag> },
            ]} /></Card></Col>
            <Col span={8}><Card title="项目健康度"><Space direction="vertical" size={18} style={{ width: '100%' }}>
                <div><span>华东渠道拓展</span><Progress percent={78} status="active" /></div>
                <div><span>工程客户回款专项</span><Progress percent={56} status="exception" /></div>
                <div><span>新品铺货计划</span><Progress percent={84} /></div>
            </Space></Card></Col>
        </Row>
    </>;
}

function Placeholder({ title }: { title: string }): JSX.Element {
    return <><div className="page-heading"><Typography.Title level={2}>{title}</Typography.Title><Button type="primary">新建</Button></div><Card><Typography.Text type="secondary">{title}模块已建立路由与布局，下一阶段接入 NestJS 分页 API 和权限数据范围。</Typography.Text></Card></>;
}

export default function App(): JSX.Element {
    const navigate = useNavigate();
    const location = useLocation();
    const current = menu.find(([path]) => path === location.pathname);
    return <Layout className="app-shell">
        <Sider width={224} theme="light"><div className="brand"><div className="brand-mark">C</div><div><strong>CEES</strong><small>企业协同工作台</small></div></div>
            <Menu mode="inline" selectedKeys={[location.pathname]} items={menu.map(([key, label, icon]) => ({ key: String(key), label, icon }))} onClick={({ key }) => navigate(key)} />
        </Sider>
        <Layout><Header className="topbar"><Typography.Text type="secondary">华东销售中心</Typography.Text><Space><Badge count={5}><Button shape="circle" icon={<BellOutlined />} /></Badge><Button icon={<UserOutlined />}>企业管理员</Button></Space></Header>
            <Content className="content">{location.pathname === '/' ? <Dashboard /> : <Placeholder title={String(current?.[1] ?? '页面')} />}</Content>
        </Layout>
    </Layout>;
}