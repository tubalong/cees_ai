import { CalendarOutlined, ClockCircleOutlined, FileDoneOutlined, PlusOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App as AntdApp, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag } from 'antd';
import { useMemo, useState } from 'react';
import {
    adjustHrLeaveBalance, cancelHrEmployeeChange, cancelHrLeaveRequest, cancelHrOvertimeRequest, createHrAttendanceRecord,
    createHrEmployeeChange, createHrLeaveRequest, createHrLeaveType, createHrOvertimeRequest, createHrProfile, deleteHrLeaveType,
    getHrAttendanceSummaryReport, getHrHeadcountReport, getHrLeaveSummaryReport, getHrOvertimeSummaryReport,
    hasStoredSession, importHrAttendanceRecords, listDepartments, listHrAttendanceRecords, listHrEmployeeChanges, listHrLeaveBalances,
    listHrLeaveRequests, listHrLeaveTypes, listHrOvertimeRequests, listHrProfiles, listTenantMembers,
    reviewHrAttendanceRecord, reviewHrEmployeeChange, reviewHrLeaveRequest, reviewHrOvertimeRequest,
    updateHrAttendanceRecord, updateHrLeaveType, updateHrProfile, withdrawHrLeaveRequest,
    type DepartmentNode, type HrAttendanceRecord, type HrAttendanceStatus, type HrEmployeeChange,
    type HrEmployeeChangeType, type HrLeaveType, type HrProfile, type HrRequestStatus, type MeResult,
} from '../../core/api';
import './hr.css';

type Dialog = 'profile' | 'leaveType' | 'balance' | 'leave' | 'attendance' | 'attendanceImport' | 'overtime' | 'change' | null;

export default function HrManagement({ authContext, onSessionExpired }: { authContext: MeResult; onSessionExpired: () => void }): JSX.Element {
    const permissions = new Set(authContext.permissions);
    const canReadSensitiveProfile = permissions.has('hr.profile.sensitive.read');
    const canManageSensitiveProfile = permissions.has('hr.profile.sensitive.manage');
    const queryClient = useQueryClient();
    const { message, modal } = AntdApp.useApp();
    const [dialog, setDialog] = useState<Dialog>(null);
    const [editingProfile, setEditingProfile] = useState<HrProfile>();
    const profileStatusOptions = editingProfile?.status === 'TERMINATED'
        ? [{ label: '离职（由人事异动维护）', value: 'TERMINATED', disabled: true }, ...editableProfileStatusOptions]
        : editableProfileStatusOptions;
    const [editingLeaveType, setEditingLeaveType] = useState<HrLeaveType>();
    const [editingAttendance, setEditingAttendance] = useState<HrAttendanceRecord>();
    const [attendanceImportText, setAttendanceImportText] = useState('');
    const [profileForm] = Form.useForm();
    const [leaveTypeForm] = Form.useForm();
    const [balanceForm] = Form.useForm();
    const [leaveForm] = Form.useForm();
    const [attendanceForm] = Form.useForm();
    const [overtimeForm] = Form.useForm();
    const [changeForm] = Form.useForm();

    const handleError = (error: unknown): void => {
        if (!hasStoredSession()) onSessionExpired();
        message.error(error instanceof Error ? error.message : '操作失败');
    };
    const refresh = (): void => { void queryClient.invalidateQueries({ queryKey: ['hr'] }); };
    const isOwnRecord = (membershipId: string): boolean => membershipId === authContext.membership.id;
    const mutation = useMutation({ mutationFn: async (work: () => Promise<unknown>) => work(), onSuccess: () => { message.success('操作成功'); setDialog(null); refresh(); }, onError: handleError });

    const membersQuery = useQuery({ queryKey: ['hr', 'members'], queryFn: () => listTenantMembers(), enabled: anyHrPermission(permissions) });
    const departmentsQuery = useQuery({ queryKey: ['hr', 'departments'], queryFn: () => listDepartments(), enabled: anyHrPermission(permissions) });
    const profilesQuery = useQuery({ queryKey: ['hr', 'profiles'], queryFn: () => listHrProfiles(), enabled: permissions.has('hr.profile.read') });
    const leaveTypesQuery = useQuery({ queryKey: ['hr', 'leave-types'], queryFn: listHrLeaveTypes, enabled: permissions.has('hr.leave.read') });
    const balancesQuery = useQuery({ queryKey: ['hr', 'balances'], queryFn: () => listHrLeaveBalances(new Date().getFullYear()), enabled: permissions.has('hr.leave.read') });
    const leaveRequestsQuery = useQuery({ queryKey: ['hr', 'leave-requests'], queryFn: () => listHrLeaveRequests(), enabled: permissions.has('hr.leave.read') });
    const attendanceQuery = useQuery({ queryKey: ['hr', 'attendance'], queryFn: listHrAttendanceRecords, enabled: permissions.has('hr.attendance.read') });
    const overtimeQuery = useQuery({ queryKey: ['hr', 'overtime'], queryFn: listHrOvertimeRequests, enabled: permissions.has('hr.overtime.read') });
    const changesQuery = useQuery({ queryKey: ['hr', 'changes'], queryFn: listHrEmployeeChanges, enabled: permissions.has('hr.employee_change.read') });

    const members = membersQuery.data?.items ?? [];
    const departments = useMemo(() => flattenDepartments(departmentsQuery.data?.items ?? []), [departmentsQuery.data]);
    const memberMap = useMemo(() => new Map(members.map((item) => [item.id, item.user.displayName])), [members]);
    const departmentMap = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments]);
    const leaveTypeMap = useMemo(() => new Map((leaveTypesQuery.data?.items ?? []).map((item) => [item.id, item.name])), [leaveTypesQuery.data]);
    const memberOptions = members.map((item) => ({ label: `${item.user.displayName}（${item.account}）`, value: item.id }));
    const departmentOptions = departments.map((item) => ({ label: item.name, value: item.id }));

    const openProfile = (profile?: HrProfile): void => {
        setEditingProfile(profile); profileForm.resetFields();
        profileForm.setFieldsValue(profile ?? { status: 'ACTIVE' }); setDialog('profile');
    };
    const submitProfile = async (): Promise<void> => {
        const values = normalizeEmptyValues(await profileForm.validateFields());
        // 离职状态与离职日期由人事异动审批写入，档案表单不再提交这两个字段。
        delete values.leaveDate;
        if (editingProfile?.status === 'TERMINATED') delete values.status;
        const canSubmitSensitiveProfile = canManageSensitiveProfile && (!editingProfile || canReadSensitiveProfile);
        const payload = canSubmitSensitiveProfile ? values : omitSensitiveProfileFields(values);
        mutation.mutate(() => editingProfile ? updateHrProfile(editingProfile.membershipId, { ...payload, version: editingProfile.version }) : createHrProfile(payload));
    };
    const openLeaveType = (item?: HrLeaveType): void => {
        setEditingLeaveType(item); leaveTypeForm.resetFields(); leaveTypeForm.setFieldsValue(item ?? { unit: 'DAY', paid: true, enabled: true }); setDialog('leaveType');
    };
    const submitLeaveType = async (): Promise<void> => {
        const values = await leaveTypeForm.validateFields();
        mutation.mutate(() => editingLeaveType ? updateHrLeaveType(editingLeaveType.id, { ...values, version: editingLeaveType.version }) : createHrLeaveType(values));
    };

    const profileColumns = [
        { title: '员工', dataIndex: 'displayName' },
        { title: '工号', dataIndex: 'employeeNo', render: (value: string | null) => value || '-' },
        { title: '部门', dataIndex: 'departmentId', render: (value: string | null) => value ? departmentMap.get(value) ?? value : '-' },
        { title: '职位', dataIndex: 'position', render: (value: string | null) => value || '-' },
        { title: '状态', dataIndex: 'status', render: statusTag },
        { title: '操作', render: (_: unknown, item: HrProfile) => permissions.has('hr.profile.manage') ? <Button type="link" onClick={() => openProfile(item)}>编辑</Button> : null },
    ];

    const leaveTypeColumns = [
        { title: '编码', dataIndex: 'code' }, { title: '名称', dataIndex: 'name' },
        { title: '单位', dataIndex: 'unit', render: unitLabel },
        { title: '带薪', dataIndex: 'paid', render: (value: boolean) => value ? '是' : '否' },
        { title: '默认额度', dataIndex: 'defaultDays', render: (value: number | null) => value ?? '-' },
        { title: '状态', dataIndex: 'enabled', render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '启用' : '停用'}</Tag> },
        { title: '操作', render: (_: unknown, item: HrLeaveType) => permissions.has('hr.leave.manage_all') ? <Space><Button type="link" onClick={() => openLeaveType(item)}>编辑</Button><Button type="link" danger onClick={() => modal.confirm({ title: `删除假期类型“${item.name}”？`, content: '存在有效请假申请时将拒绝删除。', onOk: () => deleteHrLeaveType(item.id, item.version).then(() => { message.success('已删除'); refresh(); }).catch(handleError) })}>删除</Button></Space> : null },
    ];

    const leaveRequestColumns = [
        { title: '员工', dataIndex: 'membershipId', render: memberName(memberMap) },
        { title: '类型', dataIndex: 'leaveTypeId', render: (value: string) => leaveTypeMap.get(value) ?? value },
        { title: '时间', render: (_: unknown, item: { startAt: string; endAt: string }) => `${formatTime(item.startAt)} — ${formatTime(item.endAt)}` },
        { title: '天数', dataIndex: 'durationDays' }, { title: '状态', dataIndex: 'status', render: statusTag },
        { title: '操作', render: (_: unknown, item: any) => <Space>
            {item.status === 'SUBMITTED' && !isOwnRecord(item.membershipId) && permissions.has('hr.leave.approve') && <><Button size="small" onClick={() => mutation.mutate(() => reviewHrLeaveRequest(item.id, 'APPROVE', item.version))}>通过</Button><Button size="small" danger onClick={() => mutation.mutate(() => reviewHrLeaveRequest(item.id, 'REJECT', item.version))}>拒绝</Button></>}
            {item.status === 'SUBMITTED' && item.membershipId === authContext.membership.id && permissions.has('hr.leave.request') && <Button size="small" onClick={() => mutation.mutate(() => withdrawHrLeaveRequest(item.id, item.version))}>撤回</Button>}
            {['SUBMITTED', 'APPROVED'].includes(item.status) && permissions.has('hr.leave.manage_all') && <Button size="small" danger onClick={() => mutation.mutate(() => cancelHrLeaveRequest(item.id, item.version))}>取消</Button>}
        </Space> },
    ];

    const profileTab = <Card className="hr-card" title="员工档案" extra={<Space><Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>{permissions.has('hr.profile.manage') && <Button type="primary" icon={<PlusOutlined />} onClick={() => openProfile()}>新建档案</Button>}</Space>}>
        <Table rowKey="id" loading={profilesQuery.isLoading} dataSource={profilesQuery.data?.items ?? []} columns={profileColumns} pagination={{ pageSize: 10 }} />
    </Card>;

    const leaveTab = <Space direction="vertical" size={16} className="hr-stack">
        <Card title="假期类型" extra={permissions.has('hr.leave.manage_all') && <Button type="primary" icon={<PlusOutlined />} onClick={() => openLeaveType()}>新增类型</Button>}>
            <Table rowKey="id" size="small" dataSource={leaveTypesQuery.data?.items ?? []} columns={leaveTypeColumns} pagination={false} />
        </Card>
        <Card title="年度余额" extra={permissions.has('hr.leave.manage_all') && <Button onClick={() => { balanceForm.resetFields(); balanceForm.setFieldsValue({ year: new Date().getFullYear() }); setDialog('balance'); }}>调整余额</Button>}>
            <Table rowKey="id" size="small" dataSource={balancesQuery.data?.items ?? []} pagination={{ pageSize: 8 }} columns={[
                { title: '员工', dataIndex: 'membershipId', render: memberName(memberMap) }, { title: '类型', dataIndex: 'leaveTypeId', render: (id: string) => leaveTypeMap.get(id) ?? id },
                { title: '年度', dataIndex: 'year' }, { title: '总额', dataIndex: 'totalDays' }, { title: '待审批', dataIndex: 'pendingDays' },
                { title: '已使用', dataIndex: 'usedDays' }, { title: '剩余', dataIndex: 'remainingDays' },
            ]} />
        </Card>
        <Card title="请假申请" extra={permissions.has('hr.leave.request') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { leaveForm.resetFields(); setDialog('leave'); }}>发起请假</Button>}>
            <Table rowKey="id" size="small" dataSource={leaveRequestsQuery.data?.items ?? []} columns={leaveRequestColumns} pagination={{ pageSize: 8 }} />
        </Card>
    </Space>;

    const attendanceTab = <Card title="考勤记录" extra={permissions.has('hr.attendance.manage') && <Space><Button onClick={() => { setAttendanceImportText(''); setDialog('attendanceImport'); }}>批量导入</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingAttendance(undefined); attendanceForm.resetFields(); attendanceForm.setFieldsValue({ status: 'NORMAL' }); setDialog('attendance'); }}>新增记录</Button></Space>}>
        <Table rowKey="id" dataSource={attendanceQuery.data?.items ?? []} pagination={{ pageSize: 10 }} columns={[
            { title: '员工', dataIndex: 'membershipId', render: memberName(memberMap) }, { title: '日期', dataIndex: 'workDate' },
            { title: '签到', dataIndex: 'checkInAt', render: formatTime }, { title: '签退', dataIndex: 'checkOutAt', render: formatTime },
            { title: '状态', dataIndex: 'status', render: statusTag }, { title: '来源', dataIndex: 'source' },
            { title: '操作', render: (_: unknown, item: HrAttendanceRecord) => <Space>
                {permissions.has('hr.attendance.manage') && <Button size="small" onClick={() => { setEditingAttendance(item); attendanceForm.setFieldsValue(item); setDialog('attendance'); }}>编辑</Button>}
                {permissions.has('hr.attendance.approve') && item.status === 'EXCEPTION' && !isOwnRecord(item.membershipId) && <Button size="small" onClick={() => mutation.mutate(() => reviewHrAttendanceRecord(item.id, 'APPROVE', item.version))}>确认修正</Button>}
            </Space> },
        ]} />
    </Card>;

    const overtimeTab = <Card title="加班申请" extra={permissions.has('hr.overtime.request') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { overtimeForm.resetFields(); setDialog('overtime'); }}>发起申请</Button>}>
        <Table rowKey="id" dataSource={overtimeQuery.data?.items ?? []} pagination={{ pageSize: 10 }} columns={[
            { title: '员工', dataIndex: 'membershipId', render: memberName(memberMap) },
            { title: '时间', render: (_: unknown, item: any) => `${formatTime(item.startAt)} — ${formatTime(item.endAt)}` },
            { title: '小时', dataIndex: 'durationHours' }, { title: '原因', dataIndex: 'reason' },
            { title: '状态', dataIndex: 'status', render: statusTag },
            { title: '操作', render: (_: unknown, item: any) => <Space>
                {item.status === 'SUBMITTED' && !isOwnRecord(item.membershipId) && permissions.has('hr.overtime.approve') && <><Button size="small" onClick={() => mutation.mutate(() => reviewHrOvertimeRequest(item.id, 'APPROVE', item.version))}>通过</Button><Button size="small" danger onClick={() => mutation.mutate(() => reviewHrOvertimeRequest(item.id, 'REJECT', item.version))}>拒绝</Button></>}
                {item.status === 'SUBMITTED' && item.membershipId === authContext.membership.id && permissions.has('hr.overtime.request') && <Button size="small" onClick={() => mutation.mutate(() => cancelHrOvertimeRequest(item.id, item.version))}>撤销</Button>}
            </Space> },
        ]} />
    </Card>;

    const changeTab = <Card title="人事异动" extra={permissions.has('hr.employee_change.manage') && <Button type="primary" icon={<PlusOutlined />} onClick={() => { changeForm.resetFields(); setDialog('change'); }}>发起异动</Button>}>
        <Table rowKey="id" dataSource={changesQuery.data?.items ?? []} pagination={{ pageSize: 10 }} columns={[
            { title: '员工', dataIndex: 'membershipId', render: memberName(memberMap) },
            { title: '类型', dataIndex: 'type', render: changeTypeLabel }, { title: '生效日期', dataIndex: 'effectiveDate' },
            { title: '目标部门', dataIndex: 'toDepartmentId', render: (id: string | null) => id ? departmentMap.get(id) ?? id : '-' },
            { title: '目标职位', dataIndex: 'toPosition', render: (value: string | null) => value || '-' },
            { title: '状态', dataIndex: 'status', render: statusTag },
            { title: '操作', render: (_: unknown, item: HrEmployeeChange) => <Space>
                {item.status === 'SUBMITTED' && !isOwnRecord(item.membershipId) && permissions.has('hr.employee_change.approve') && <><Button size="small" onClick={() => mutation.mutate(() => reviewHrEmployeeChange(item.id, 'APPROVE', item.version))}>通过并生效</Button><Button size="small" danger onClick={() => mutation.mutate(() => reviewHrEmployeeChange(item.id, 'REJECT', item.version))}>拒绝</Button></>}
                {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(item.status) && permissions.has('hr.employee_change.manage') && <Button size="small" onClick={() => mutation.mutate(() => cancelHrEmployeeChange(item.id, item.version))}>撤销</Button>}
            </Space> },
        ]} />
    </Card>;

    const reportTab = <HrReports enabled={permissions.has('hr.report.read')} />;
    const tabs = [
        permissions.has('hr.profile.read') && { key: 'profiles', label: <span><TeamOutlined />员工档案</span>, children: profileTab },
        permissions.has('hr.leave.read') && { key: 'leave', label: <span><CalendarOutlined />假勤管理</span>, children: leaveTab },
        permissions.has('hr.attendance.read') && { key: 'attendance', label: <span><ClockCircleOutlined />考勤</span>, children: attendanceTab },
        permissions.has('hr.overtime.read') && { key: 'overtime', label: '加班', children: overtimeTab },
        permissions.has('hr.employee_change.read') && { key: 'changes', label: '人事异动', children: changeTab },
        permissions.has('hr.report.read') && { key: 'reports', label: <span><FileDoneOutlined />人力报表</span>, children: reportTab },
    ].filter(Boolean) as Array<{ key: string; label: JSX.Element | string; children: JSX.Element }>;

    if (!tabs.length) return <Alert type="warning" showIcon message="暂无 HR 模块权限" description="请联系租户管理员分配员工档案、假勤、考勤或报表权限。" />;

    return <div className="workspace-page hr-page">
        <header className="hr-header"><div><h1>人力资源</h1><p>员工档案、假勤、考勤、加班、异动与经营报表统一管理</p></div></header>
        <Tabs items={tabs} />

        <Modal open={dialog === 'profile'} title={editingProfile ? '编辑员工档案' : '新建员工档案'} width={760} confirmLoading={mutation.isPending} onCancel={() => setDialog(null)} onOk={() => void submitProfile()}>
            {!canManageSensitiveProfile && <Alert type="info" showIcon message="敏感字段受保护" description="手机号、邮箱、证件和紧急联系人仅对具有员工敏感档案管理权限的角色开放编辑。" style={{ marginBottom: 16 }} />}
            {editingProfile && canManageSensitiveProfile && !canReadSensitiveProfile && <Alert type="warning" showIcon message="敏感字段不可编辑" description="当前角色可管理但不可读取敏感字段，为避免覆盖真实数据，本次编辑不会提交这些字段。" style={{ marginBottom: 16 }} />}
            <Form form={profileForm} layout="vertical"><Row gutter={16}>
                {!editingProfile && <Col span={12}><Form.Item name="membershipId" label="租户成员" rules={[{ required: true }]}><Select showSearch options={memberOptions} /></Form.Item></Col>}
                <Col span={12}><Form.Item name="employeeNo" label="工号"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="departmentId" label="部门"><Select allowClear options={departmentOptions} /></Form.Item></Col>
                <Col span={12}><Form.Item name="position" label="职位"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="jobLevel" label="职级"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="employmentType" label="用工类型"><Input placeholder="全职/兼职/实习" /></Form.Item></Col>
                <Col span={12}><Form.Item name="managerMembershipId" label="直属上级"><Select allowClear showSearch options={memberOptions} /></Form.Item></Col>
                <Col span={12}><Form.Item name="costCenter" label="成本中心"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="entryDate" label="入职日期"><Input type="date" /></Form.Item></Col>
                <Col span={12}><Form.Item name="probationEndDate" label="试用期结束"><Input type="date" /></Form.Item></Col>
                <Col span={12}><Form.Item name="regularDate" label="转正日期"><Input type="date" /></Form.Item></Col>
                <Col span={12}><Form.Item name="workLocation" label="工作地点"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="phone" label="手机号"><Input disabled={!canManageSensitiveProfile || Boolean(editingProfile && !canReadSensitiveProfile)} /></Form.Item></Col>
                <Col span={12}><Form.Item name="email" label="邮箱" rules={[{ type: 'email' }]}><Input disabled={!canManageSensitiveProfile || Boolean(editingProfile && !canReadSensitiveProfile)} /></Form.Item></Col>
                <Col span={12}><Form.Item name="idType" label="证件类型"><Input placeholder="身份证/护照" disabled={!canManageSensitiveProfile || Boolean(editingProfile && !canReadSensitiveProfile)} /></Form.Item></Col>
                <Col span={12}><Form.Item name="idNumber" label="证件号码"><Input disabled={!canManageSensitiveProfile || Boolean(editingProfile && !canReadSensitiveProfile)} /></Form.Item></Col>
                <Col span={12}><Form.Item name="educationLevel" label="学历"><Input /></Form.Item></Col>
                <Col span={12}><Form.Item name="emergencyContactName" label="紧急联系人"><Input disabled={!canManageSensitiveProfile || Boolean(editingProfile && !canReadSensitiveProfile)} /></Form.Item></Col>
                <Col span={12}><Form.Item name="emergencyContactPhone" label="紧急联系电话"><Input disabled={!canManageSensitiveProfile || Boolean(editingProfile && !canReadSensitiveProfile)} /></Form.Item></Col>
                {editingProfile && <Col span={12}><Form.Item name="status" label="状态" tooltip="离职状态由离职或解除人事异动维护"><Select options={profileStatusOptions} /></Form.Item></Col>}
            </Row></Form>
        </Modal>

        <Modal open={dialog === 'leaveType'} title={editingLeaveType ? '编辑假期类型' : '新增假期类型'} confirmLoading={mutation.isPending} onCancel={() => setDialog(null)} onOk={() => void submitLeaveType()}>
            <Form form={leaveTypeForm} layout="vertical"><Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
                <Row gutter={16}><Col span={12}><Form.Item name="unit" label="单位" rules={[{ required: true }]}><Select options={unitOptions} /></Form.Item></Col><Col span={12}><Form.Item name="defaultDays" label="默认额度"><InputNumber min={0} className="hr-full" /></Form.Item></Col></Row>
                <Space size={32}><Form.Item name="paid" label="带薪" valuePropName="checked"><Switch /></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item></Space>
            </Form>
        </Modal>

        <Modal open={dialog === 'balance'} title="调整假期余额" confirmLoading={mutation.isPending} onCancel={() => setDialog(null)} onOk={() => void balanceForm.validateFields().then((values) => mutation.mutate(() => adjustHrLeaveBalance(values)))}>
            <Form form={balanceForm} layout="vertical"><Form.Item name="membershipId" label="员工" rules={[{ required: true }]}><Select showSearch options={memberOptions} /></Form.Item><Form.Item name="leaveTypeId" label="假期类型" rules={[{ required: true }]}><Select options={(leaveTypesQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id }))} /></Form.Item><Form.Item name="year" label="年度" rules={[{ required: true }]}><InputNumber min={2024} max={2100} className="hr-full" /></Form.Item><Form.Item name="deltaDays" label="增减额度" rules={[{ required: true }]}><InputNumber className="hr-full" /></Form.Item><Form.Item name="reason" label="调整原因" rules={[{ required: true }]}><Input.TextArea /></Form.Item></Form>
        </Modal>

        <Modal open={dialog === 'leave'} title="发起请假" confirmLoading={mutation.isPending} onCancel={() => setDialog(null)} onOk={() => void leaveForm.validateFields().then((values) => mutation.mutate(() => createHrLeaveRequest({ ...values, startAt: dateTimeValue(values.startAt), endAt: dateTimeValue(values.endAt) })))}>
            <Alert type="info" showIcon message="时长由服务端折算" description="请假天数按申请时间与假期单位在服务端计算，跨年度申请会分别占用对应年度余额。" style={{ marginBottom: 16 }} />
            <Form form={leaveForm} layout="vertical"><Form.Item name="leaveTypeId" label="假期类型" rules={[{ required: true }]}><Select options={(leaveTypesQuery.data?.items ?? []).filter((item) => item.enabled).map((item) => ({ label: item.name, value: item.id }))} /></Form.Item><Row gutter={16}><Col span={12}><Form.Item name="startAt" label="开始时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item></Col><Col span={12}><Form.Item name="endAt" label="结束时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item></Col></Row><Form.Item name="reason" label="原因"><Input.TextArea /></Form.Item></Form>
        </Modal>

        <Modal open={dialog === 'attendance'} title={editingAttendance ? '编辑考勤记录' : '新增考勤记录'} confirmLoading={mutation.isPending} onCancel={() => setDialog(null)} onOk={() => void attendanceForm.validateFields().then((values) => mutation.mutate(() => editingAttendance ? updateHrAttendanceRecord(editingAttendance.id, { ...values, checkInAt: optionalDateTimeValue(values.checkInAt), checkOutAt: optionalDateTimeValue(values.checkOutAt), version: editingAttendance.version }) : createHrAttendanceRecord({ ...values, checkInAt: optionalDateTimeValue(values.checkInAt), checkOutAt: optionalDateTimeValue(values.checkOutAt) })))}>
            <Form form={attendanceForm} layout="vertical">{!editingAttendance && <Form.Item name="membershipId" label="员工" rules={[{ required: true }]}><Select showSearch options={memberOptions} /></Form.Item>}<Form.Item name="workDate" label="工作日期" rules={[{ required: true }]}><Input type="date" disabled={Boolean(editingAttendance)} /></Form.Item><Row gutter={16}><Col span={12}><Form.Item name="checkInAt" label="签到时间"><Input type="datetime-local" /></Form.Item></Col><Col span={12}><Form.Item name="checkOutAt" label="签退时间"><Input type="datetime-local" /></Form.Item></Col></Row><Form.Item name="status" label="状态" rules={[{ required: true }]}><Select options={attendanceStatusOptions} /></Form.Item><Form.Item name="note" label="备注"><Input.TextArea /></Form.Item></Form>
        </Modal>

        <Modal open={dialog === 'attendanceImport'} title="批量导入考勤" width={720} confirmLoading={mutation.isPending} onCancel={() => setDialog(null)} onOk={() => {
            try {
                const records = parseAttendanceImport(attendanceImportText);
                mutation.mutate(async () => {
                    const result = await importHrAttendanceRecords(records);
                    if (result.failed) message.warning(`成功 ${result.imported} 条，失败 ${result.failed} 条：${result.failures.map((item) => `第 ${item.index + 1} 行 ${item.message}`).join('；')}`);
                    return result;
                });
            } catch (error) { handleError(error); }
        }}>
            <Alert type="info" showIcon message="每行一条，逗号分隔" description="格式：成员ID,工作日期,状态,签到时间,签退时间,备注；状态示例 NORMAL、LATE、ABSENT。单批最多 500 条。" />
            <Input.TextArea className="hr-import" rows={10} value={attendanceImportText} onChange={(event) => setAttendanceImportText(event.target.value)} placeholder="membershipId,2026-09-17,NORMAL,2026-09-17T09:00,2026-09-17T18:00,正常出勤" />
        </Modal>

        <Modal open={dialog === 'overtime'} title="发起加班申请" confirmLoading={mutation.isPending} onCancel={() => setDialog(null)} onOk={() => void overtimeForm.validateFields().then((values) => mutation.mutate(() => createHrOvertimeRequest({ ...values, startAt: dateTimeValue(values.startAt), endAt: dateTimeValue(values.endAt) })))}>
            <Form form={overtimeForm} layout="vertical"><Row gutter={16}><Col span={12}><Form.Item name="startAt" label="开始时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item></Col><Col span={12}><Form.Item name="endAt" label="结束时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item></Col></Row><Form.Item name="durationHours" label="加班小时" rules={[{ required: true }]}><InputNumber min={0.5} step={0.5} className="hr-full" /></Form.Item><Form.Item name="reason" label="加班原因" rules={[{ required: true }]}><Input.TextArea /></Form.Item></Form>
        </Modal>

        <Modal open={dialog === 'change'} title="发起人事异动" confirmLoading={mutation.isPending} onCancel={() => setDialog(null)} onOk={() => void changeForm.validateFields().then((values) => mutation.mutate(() => createHrEmployeeChange(values)))}>
            <Form form={changeForm} layout="vertical"><Form.Item name="membershipId" label="员工" rules={[{ required: true }]}><Select showSearch options={memberOptions} /></Form.Item><Row gutter={16}><Col span={12}><Form.Item name="type" label="异动类型" rules={[{ required: true }]}><Select options={changeTypeOptions} /></Form.Item></Col><Col span={12}><Form.Item name="effectiveDate" label="生效日期" rules={[{ required: true }]}><Input type="date" /></Form.Item></Col></Row><Row gutter={16}><Col span={12}><Form.Item name="toDepartmentId" label="目标部门"><Select allowClear options={departmentOptions} /></Form.Item></Col><Col span={12}><Form.Item name="toPosition" label="目标职位"><Input /></Form.Item></Col></Row><Form.Item name="toManagerMembershipId" label="目标直属上级"><Select allowClear showSearch options={memberOptions} /></Form.Item><Form.Item name="reason" label="异动原因"><Input.TextArea /></Form.Item></Form>
        </Modal>
    </div>;
}

function HrReports({ enabled }: { enabled: boolean }): JSX.Element {
    const today = new Date();
    const year = today.getFullYear();
    const monthStart = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const todayText = today.toISOString().slice(0, 10);
    const headcount = useQuery({ queryKey: ['hr', 'report', 'headcount'], queryFn: getHrHeadcountReport, enabled });
    const leave = useQuery({ queryKey: ['hr', 'report', 'leave', year], queryFn: () => getHrLeaveSummaryReport(year), enabled });
    const attendance = useQuery({ queryKey: ['hr', 'report', 'attendance', monthStart, todayText], queryFn: () => getHrAttendanceSummaryReport(monthStart, todayText), enabled });
    const overtime = useQuery({ queryKey: ['hr', 'report', 'overtime', monthStart, todayText], queryFn: () => getHrOvertimeSummaryReport(monthStart, todayText), enabled });
    return <Space direction="vertical" size={16} className="hr-stack">
        <Row gutter={16}><Col span={6}><Card><Statistic title="在职人数" value={headcount.data?.total ?? 0} /></Card></Col><Col span={6}><Card><Statistic title={`${year} 年请假申请`} value={leave.data?.totalRequestedDays ?? 0} suffix="天" /></Card></Col><Col span={6}><Card><Statistic title="本月异常考勤" value={(attendance.data?.lateCount ?? 0) + (attendance.data?.earlyLeaveCount ?? 0) + (attendance.data?.absentDays ?? 0)} /></Card></Col><Col span={6}><Card><Statistic title="本月已批加班" value={overtime.data?.totalHours ?? 0} suffix="小时" /></Card></Col></Row>
        <Row gutter={16}><Col span={12}><Card title="部门人数"><Table size="small" rowKey="departmentId" pagination={false} dataSource={headcount.data?.byDepartment ?? []} columns={[{ title: '部门', dataIndex: 'departmentName' }, { title: '人数', dataIndex: 'headcount' }]} /></Card></Col><Col span={12}><Card title="假期使用"><Table size="small" rowKey="leaveTypeId" pagination={false} dataSource={leave.data?.byLeaveType ?? []} columns={[{ title: '类型', dataIndex: 'leaveTypeName' }, { title: '申请天数', dataIndex: 'requestedDays' }, { title: '批准天数', dataIndex: 'approvedDays' }]} /></Card></Col></Row>
        <Card title="成员加班汇总"><Table size="small" rowKey="membershipId" pagination={false} dataSource={overtime.data?.byMember ?? []} columns={[{ title: '员工', dataIndex: 'displayName' }, { title: '小时', dataIndex: 'overtimeHours' }]} /></Card>
    </Space>;
}

const editableProfileStatusOptions = [{ label: '在职', value: 'ACTIVE' }, { label: '停职', value: 'SUSPENDED' }, { label: '休假中', value: 'ON_LEAVE' }];
const unitOptions = [{ label: '天', value: 'DAY' }, { label: '半天', value: 'HALF_DAY' }, { label: '小时', value: 'HOUR' }];
const attendanceStatusOptions: Array<{ label: string; value: HrAttendanceStatus }> = [
    ['正常', 'NORMAL'], ['迟到', 'LATE'], ['早退', 'EARLY_LEAVE'], ['缺勤', 'ABSENT'], ['请假', 'LEAVE'], ['加班', 'OVERTIME'], ['异常', 'EXCEPTION'], ['已修正', 'CORRECTED'],
].map(([label, value]) => ({ label, value: value as HrAttendanceStatus }));
const changeTypeOptions: Array<{ label: string; value: HrEmployeeChangeType }> = [
    ['入职', 'ONBOARD'], ['转正', 'PROBATION'], ['调岗', 'TRANSFER'], ['晋升', 'PROMOTION'], ['降级', 'DEMOTION'], ['离职', 'RESIGNATION'], ['解除', 'TERMINATION'],
].map(([label, value]) => ({ label, value: value as HrEmployeeChangeType }));

function anyHrPermission(permissions: Set<string>): boolean { return [...permissions].some((permission) => permission.startsWith('hr.')); }
function flattenDepartments(items: DepartmentNode[]): Array<{ id: string; name: string }> { return items.flatMap((item) => [{ id: item.id, name: item.name }, ...flattenDepartments(item.children ?? [])]); }
function memberName(map: Map<string, string>): (value: string) => string { return (value) => map.get(value) ?? value; }
function unitLabel(value: string): string { return value === 'DAY' ? '天' : value === 'HALF_DAY' ? '半天' : '小时'; }
function changeTypeLabel(value: HrEmployeeChangeType): string { return changeTypeOptions.find((item) => item.value === value)?.label ?? value; }
function formatTime(value?: string | null): string { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'; }
function dateTimeValue(value: string): string { return new Date(value).toISOString(); }
function optionalDateTimeValue(value?: string | null): string | null { return value ? dateTimeValue(value) : null; }
function normalizeEmptyValues<T extends Record<string, unknown>>(values: T): T { return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === '' ? null : value])) as T; }
function omitSensitiveProfileFields<T extends Record<string, unknown>>(values: T): T {
    const result = { ...values };
    delete result.phone;
    delete result.email;
    delete result.idType;
    delete result.idNumber;
    delete result.emergencyContactName;
    delete result.emergencyContactPhone;
    return result;
}
function parseAttendanceImport(value: string): Array<{ membershipId: string; workDate: string; status: HrAttendanceStatus; checkInAt?: string | null; checkOutAt?: string | null; note?: string | null }> {
    const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error('请输入至少一条考勤记录');
    if (lines.length > 500) throw new Error('单批最多导入 500 条');
    return lines.map((line, index) => {
        const [membershipId, workDate, status, checkInAt, checkOutAt, note] = line.split(',').map((part) => part.trim());
        if (!membershipId || !workDate || !status) throw new Error(`第 ${index + 1} 行缺少成员ID、工作日期或状态`);
        if (!attendanceStatusOptions.some((item) => item.value === status)) throw new Error(`第 ${index + 1} 行考勤状态无效`);
        return { membershipId, workDate, status: status as HrAttendanceStatus, checkInAt: optionalDateTimeValue(checkInAt), checkOutAt: optionalDateTimeValue(checkOutAt), note: note || null };
    });
}
function statusTag(value: HrRequestStatus | HrAttendanceStatus | string): JSX.Element {
    const labels: Record<string, string> = { ACTIVE: '在职', SUSPENDED: '停职', TERMINATED: '离职', ON_LEAVE: '休假中', DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已通过', REJECTED: '已拒绝', CANCELLED: '已取消', EFFECTIVE: '已生效', NORMAL: '正常', LATE: '迟到', EARLY_LEAVE: '早退', ABSENT: '缺勤', LEAVE: '请假', OVERTIME: '加班', EXCEPTION: '异常', CORRECTED: '已修正' };
    const color = ['ACTIVE', 'APPROVED', 'EFFECTIVE', 'NORMAL', 'CORRECTED'].includes(value) ? 'green' : ['REJECTED', 'TERMINATED', 'ABSENT', 'EXCEPTION'].includes(value) ? 'red' : value === 'SUBMITTED' ? 'blue' : 'default';
    return <Tag color={color}>{labels[value] ?? value}</Tag>;
}
