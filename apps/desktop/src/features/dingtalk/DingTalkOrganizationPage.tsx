import {
    CheckCircleOutlined,
    CloudSyncOutlined,
    FileExcelOutlined,
    ReloadOutlined,
    SafetyCertificateOutlined,
    SettingOutlined,
    TeamOutlined,
} from '@ant-design/icons';
import {
    Alert,
    App as AntdApp,
    Badge,
    Button,
    Card,
    Checkbox,
    Col,
    Descriptions,
    Empty,
    Form,
    type FormInstance,
    Input,
    Modal,
    Row,
    Select,
    Space,
    Spin,
    Statistic,
    Switch,
    Table,
    Tabs,
    Tag,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
    applyDingTalkMapping,
    createDingTalkIntegration,
    getDingTalkIntegration,
    importDingTalkVisibleOrganizationSnapshot,
    hasStoredSession,
    listDingTalkDepartments,
    listDingTalkSyncJobs,
    listDingTalkUsers,
    listTenantRoles,
    previewDingTalkMapping,
    syncDingTalkOrganization,
    updateDingTalkIntegration,
    verifyDingTalkIntegration,
    type DingTalkDepartment,
    type DingTalkIntegration,
    type DingTalkMappingCredential,
    type DingTalkMappingDepartmentResolution,
    type DingTalkMappingPreview,
    type DingTalkMappingUserResolution,
    type DingTalkRoleAssignment,
    type DingTalkSyncJob,
    type DingTalkUser,
    type MeResult,
} from '../../core/api';
import { useDateFormatter, useI18n } from '../../core/i18n';
import './dingtalk.css';

interface DingTalkOrganizationPageProps {
    authContext: MeResult;
    onSessionExpired: () => void;
}

interface IntegrationFormValues {
    corpId: string;
    appKey: string;
    appSecret?: string;
    status: boolean;
}

type DwsStatus = DingTalkConnectorStatus;

interface DwsSnapshot {
    corpId: string;
    externalUserId: string;
    externalUserName: string;
    profile: string;
    fetchedAt: string;
    capabilities: string[];
    departments: Array<{
        externalDepartmentId: string;
        parentExternalDepartmentId: string | null;
        name: string;
        displayOrder: number;
    }>;
    users: Array<{
        externalUserId: string;
        unionId: string | null;
        name: string;
        title: string | null;
        jobNumber: string | null;
        departmentExternalIds: string[];
        active: boolean;
        admin: boolean;
        boss: boolean;
    }>;
}

type ResolutionAction = 'BIND_EXISTING' | 'CREATE' | 'SKIP';
type RoleSelections = Record<string, string[]>;
type DingTalkTab = 'integration' | 'sync' | 'mirror' | 'mapping';

export default function DingTalkOrganizationPage({ authContext, onSessionExpired }: DingTalkOrganizationPageProps): JSX.Element {
    const { t } = useI18n();
    const { message, modal } = AntdApp.useApp();
    const formatDate = useDateFormatter();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [activeTab, setActiveTab] = useState<DingTalkTab>(() => normalizeDingTalkTab(searchParams.get('tab')));
    const [includeDeleted, setIncludeDeleted] = useState(false);
    const [preview, setPreview] = useState<DingTalkMappingPreview>();
    const [departmentResolutions, setDepartmentResolutions] = useState<Record<string, DingTalkMappingDepartmentResolution>>({});
    const [userResolutions, setUserResolutions] = useState<Record<string, DingTalkMappingUserResolution>>({});
    const [roleSelections, setRoleSelections] = useState<RoleSelections>({});
    const [selectedRoleId, setSelectedRoleId] = useState<string>();
    const [mappingResult, setMappingResult] = useState<{ credentials: DingTalkMappingCredential[] }>();
    const [dwsStatus, setDwsStatus] = useState<DwsStatus>();
    const [dwsSnapshot, setDwsSnapshot] = useState<DwsSnapshot>();
    const [selectedDwsProfile, setSelectedDwsProfile] = useState<string>();
    const [integrationForm] = Form.useForm<IntegrationFormValues>();
    const permissions = new Set(authContext.permissions);
    const canReadIntegration = permissions.has('dingtalk.integration.read');
    const canManageIntegration = permissions.has('dingtalk.integration.manage');
    const canReadOrganization = permissions.has('dingtalk.organization.read');
    const isTenantAdmin = authContext.membership.roles.includes('tenant_admin');
    const canSyncOrganization = isTenantAdmin && permissions.has('dingtalk.organization.sync');
    const canPreviewMapping = isTenantAdmin && permissions.has('dingtalk.organization.mapping.preview');
    const canApplyMapping = isTenantAdmin && permissions.has('dingtalk.organization.mapping.manage');

    const integrationQuery = useQuery({
        queryKey: ['dingtalk-integration'],
        queryFn: getDingTalkIntegration,
        enabled: canReadIntegration,
        retry: false,
    });
    const jobsQuery = useQuery({
        queryKey: ['dingtalk-sync-jobs'],
        queryFn: () => listDingTalkSyncJobs({ limit: 50 }),
        enabled: activeTab === 'sync' && canReadIntegration,
    });
    const departmentsQuery = useQuery({
        queryKey: ['dingtalk-departments', includeDeleted],
        queryFn: () => listDingTalkDepartments({ limit: 100, includeDeleted }),
        enabled: activeTab === 'mirror' && canReadOrganization,
    });
    const usersQuery = useQuery({
        queryKey: ['dingtalk-users', includeDeleted],
        queryFn: () => listDingTalkUsers({ limit: 100, includeDeleted }),
        enabled: activeTab === 'mirror' && canReadOrganization,
    });
    const rolesQuery = useQuery({
        queryKey: ['tenant-roles', 'dingtalk-organization'],
        queryFn: listTenantRoles,
        enabled: activeTab === 'mapping' && canApplyMapping,
    });

    const roles = (rolesQuery.data?.items ?? []).filter((role) => role.code !== 'tenant_admin');
    const createUsers = (preview?.users ?? []).filter((user) => user.action === 'CREATE');
    const assignedUserIds = useMemo(() => new Set(Object.values(roleSelections).flat()), [roleSelections]);
    const selectedRoleUserIds = selectedRoleId ? roleSelections[selectedRoleId] ?? [] : [];
    const hasMappingConflicts = Boolean(preview && (preview.summary.departmentConflictCount > 0 || preview.summary.userConflictCount > 0));
    const unresolvedDepartmentCount = preview?.departments.filter((department) => {
        if (department.action !== 'CONFLICT') return false;
        const resolution = departmentResolutions[department.dingtalkDepartmentId];
        return !resolution || (resolution.action === 'BIND_EXISTING' && !resolution.departmentId);
    }).length ?? 0;
    const unresolvedUserCount = preview?.users.filter((user) => {
        if (user.action !== 'CONFLICT') return false;
        const resolution = userResolutions[user.dingtalkUserId];
        return !resolution || (resolution.action === 'BIND_EXISTING' && !resolution.membershipId);
    }).length ?? 0;
    const unassignedCreateCount = createUsers.filter((user) => !assignedUserIds.has(user.dingtalkUserId) && userResolutions[user.dingtalkUserId]?.action !== 'SKIP').length;
    const latestJob = jobsQuery.data?.items?.[0];

    const changeTab = (tab: DingTalkTab): void => {
        setActiveTab(tab);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('tab', tab);
        setSearchParams(nextParams, { replace: true });
    };

    useEffect(() => {
        const requestedTab = normalizeDingTalkTab(searchParams.get('tab'));
        setActiveTab((currentTab) => currentTab === requestedTab ? currentTab : requestedTab);
    }, [searchParams]);

    useEffect(() => {
        if (integrationQuery.error || jobsQuery.error || departmentsQuery.error || usersQuery.error || rolesQuery.error) {
            if (!hasStoredSession()) onSessionExpired();
        }
    }, [departmentsQuery.error, integrationQuery.error, jobsQuery.error, onSessionExpired, rolesQuery.error, usersQuery.error]);

    useEffect(() => {
        // 加载态下 IntegrationPanel 只渲染 Spin、不会挂载 <Form>，此时调用表单实例会触发
        // antd 的 "Instance created by `useForm` is not connected to any Form element" 警告。
        if (integrationQuery.isLoading) return;
        if (!integrationQuery.data) {
            integrationForm.resetFields();
            integrationForm.setFieldValue('status', true);
            return;
        }
        integrationForm.setFieldsValue({
            corpId: integrationQuery.data.corpId ?? '',
            appKey: integrationQuery.data.appKey ?? '',
            appSecret: '',
            status: integrationQuery.data.status === 'ACTIVE',
        });
    }, [integrationForm, integrationQuery.data, integrationQuery.isLoading]);

    useEffect(() => {
        if (!window.cees?.dingtalkDws) return;
        void window.cees.dingtalkDws.status().then(setDwsStatus);
        return window.cees.connectors?.dingtalk.onStatusChanged((status) => {
            setDwsStatus(status);
            if (status.state !== 'PROFILE_REQUIRED') setSelectedDwsProfile(undefined);
        });
    }, []);

    const refreshDingTalkData = (): void => {
        void queryClient.invalidateQueries({ queryKey: ['dingtalk-integration'] });
        void queryClient.invalidateQueries({ queryKey: ['dingtalk-sync-jobs'] });
        void queryClient.invalidateQueries({ queryKey: ['dingtalk-departments'] });
        void queryClient.invalidateQueries({ queryKey: ['dingtalk-users'] });
        void window.cees?.dingtalkDws?.status().then(setDwsStatus);
    };

    const integrationMutation = useMutation({
        mutationFn: async (values: IntegrationFormValues): Promise<DingTalkIntegration> => {
            if (!integrationQuery.data) {
                if (!values.appSecret) throw new Error(t('首次绑定必须填写 AppSecret'));
                return createDingTalkIntegration({ corpId: values.corpId, appKey: values.appKey, appSecret: values.appSecret });
            }
            return updateDingTalkIntegration({
                appKey: values.appKey,
                appSecret: values.appSecret,
                status: values.status ? 'ACTIVE' : 'DISABLED',
                version: integrationQuery.data.version,
            });
        },
        onSuccess: () => {
            message.success(t('钉钉企业绑定已保存'));
            void queryClient.invalidateQueries({ queryKey: ['dingtalk-integration'] });
            integrationForm.setFieldValue('appSecret', '');
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('保存钉钉绑定失败')),
    });

    const verifyMutation = useMutation({
        mutationFn: verifyDingTalkIntegration,
        onSuccess: () => {
            message.success(t('钉钉凭证验证成功'));
            void queryClient.invalidateQueries({ queryKey: ['dingtalk-integration'] });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('钉钉凭证验证失败')),
    });

    const syncMutation = useMutation({
        mutationFn: syncDingTalkOrganization,
        onSuccess: (job) => {
            message.success(t('钉钉组织同步完成，共同步 {departments} 个部门、{users} 名人员', { departments: job.departmentCount, users: job.userCount }));
            refreshDingTalkData();
            changeTab('sync');
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('钉钉组织同步失败')),
    });

    const dwsLoginMutation = useMutation({
        mutationFn: async (): Promise<DwsStatus> => {
            if (!window.cees?.connectors?.dingtalk) throw new Error(t('当前桌面运行环境不支持 DWS 连接器'));
            return window.cees.connectors.dingtalk.connect();
        },
        onSuccess: (status) => {
            setDwsStatus(status);
            if (!status.authenticated) message.error(status.error ?? t('钉钉授权未完成'));
            else message.success(t('钉钉授权连接成功'));
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : t('钉钉授权失败'));
            void window.cees?.dingtalkDws?.status().then(setDwsStatus);
        },
    });

    const dwsProfileMutation = useMutation({
        mutationFn: async (profile: string): Promise<DwsStatus> => {
            if (!window.cees?.dingtalkDws) throw new Error(t('当前桌面运行环境不支持 DWS 连接器'));
            return window.cees.dingtalkDws.selectProfile(profile);
        },
        onSuccess: (status) => {
            setDwsStatus(status);
            setSelectedDwsProfile(undefined);
            message.success(t('已切换钉钉当前组织'));
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('切换钉钉组织失败')),
    });

    const dwsFetchMutation = useMutation({
        mutationFn: async (): Promise<DwsSnapshot> => {
            if (!window.cees?.dingtalkDws) throw new Error(t('当前桌面运行环境不支持 DWS 连接器'));
            return window.cees.dingtalkDws.fetchOrganization();
        },
        onSuccess: (snapshot) => {
            setDwsSnapshot(snapshot);
            setDwsStatus((current) => current ? {
                ...current,
                authenticated: true,
                corpId: snapshot.corpId,
                externalUserId: snapshot.externalUserId,
                externalUserName: snapshot.externalUserName,
                profile: snapshot.profile,
            } : current);
            message.success(t('已读取钉钉可见组织：{departments} 个部门、{users} 名人员', { departments: snapshot.departments.length, users: snapshot.users.length }));
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : t('读取钉钉组织失败'));
            void window.cees?.dingtalkDws?.status().then(setDwsStatus);
        },
    });

    const dwsImportMutation = useMutation({
        mutationFn: async (): Promise<DingTalkSyncJob> => {
            if (!isTenantAdmin) throw new Error(t('只有 CEES 租户管理员可以导入钉钉组织'));
            const snapshot = dwsSnapshot ?? await (async () => {
                if (!window.cees?.dingtalkDws) throw new Error(t('当前桌面运行环境不支持 DWS 连接器'));
                return window.cees.dingtalkDws.fetchOrganization();
            })();
            return importDingTalkVisibleOrganizationSnapshot(snapshot);
        },
        onSuccess: (job) => {
            setDwsSnapshot(undefined);
            message.success(t('钉钉可见组织已导入，共 {departments} 个部门、{users} 名人员', { departments: job.departmentCount, users: job.userCount }));
            refreshDingTalkData();
            changeTab('sync');
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('导入钉钉组织失败')),
    });

    const previewMutation = useMutation({
        mutationFn: () => previewDingTalkMapping({ activationExpiresInDays: 7, createMissingDepartments: true, createMissingMembers: true }),
        onSuccess: (result) => {
            setPreview(result);
            setDepartmentResolutions({});
            setUserResolutions({});
            setRoleSelections({});
            setMappingResult(undefined);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('加载映射预览失败')),
    });

    const applyMutation = useMutation({
        mutationFn: () => applyDingTalkMapping({
            activationExpiresInDays: preview?.activationExpiresInDays ?? 7,
            createMissingDepartments: true,
            createMissingMembers: true,
            departmentResolutions: Object.values(departmentResolutions),
            userResolutions: Object.values(userResolutions),
            roleAssignments: Object.entries(roleSelections)
                .filter(([, dingtalkUserIds]) => dingtalkUserIds.length > 0)
                .map(([roleId, dingtalkUserIds]): DingTalkRoleAssignment => ({ roleId, dingtalkUserIds })),
        }),
        onSuccess: (result) => {
            setMappingResult(result);
            message.success(t('钉钉组织映射已应用'));
            refreshDingTalkData();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : t('应用钉钉组织映射失败')),
    });

    const setDepartmentAction = (departmentId: string, action: ResolutionAction, targetId?: string): void => {
        setDepartmentResolutions((current) => ({ ...current, [departmentId]: { dingtalkDepartmentId: departmentId, action, ...(targetId ? { departmentId: targetId } : {}) } }));
    };

    const setUserAction = (userId: string, action: ResolutionAction, targetId?: string, account?: string): void => {
        setUserResolutions((current) => ({ ...current, [userId]: { dingtalkUserId: userId, action, ...(targetId ? { membershipId: targetId } : {}), ...(account ? { account } : {}) } }));
    };

    const updateRoleSelection = (userId: string, checked: boolean): void => {
        if (!selectedRoleId) return;
        setRoleSelections((current) => {
            const next = new Set(current[selectedRoleId] ?? []);
            if (checked) next.add(userId);
            else next.delete(userId);
            return { ...current, [selectedRoleId]: [...next] };
        });
    };

    const exportCredentials = (): void => {
        const credentials = mappingResult?.credentials ?? [];
        if (!credentials.length) return;
        const rows = credentials.map((credential) => ({
            '姓名': credential.displayName,
            '登录账号': credential.account,
            '租户编码': credential.tenantCode,
            '角色编码': credential.roleCodes.join('、'),
            '激活码': credential.activationToken,
            '过期时间': credential.activationExpiresAt.replace('T', ' ').slice(0, 19),
        }));
        const sheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, '激活凭证');
        XLSX.writeFile(workbook, `钉钉成员激活凭证-${authContext.tenant.code}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
    };

    const tabItems = [
        {
            key: 'integration',
            label: <span><SettingOutlined /> {t('企业绑定')}</span>,
            // 表单在非激活标签页下默认不挂载，会导致 integrationForm 未连接 Form 元素
            // （antd 警告 "Instance created by useForm is not connected to any Form element"）。
            forceRender: true,
            children: <IntegrationPanel
                integration={integrationQuery.data ?? null}
                loading={integrationQuery.isLoading}
                canManage={canManageIntegration}
                form={integrationForm}
                mutation={integrationMutation}
                verifyMutation={verifyMutation}
                onVerify={() => verifyMutation.mutate()}
                dwsStatus={dwsStatus}
                dwsSnapshot={dwsSnapshot}
                dwsLoginPending={dwsLoginMutation.isPending}
                dwsProfilePending={dwsProfileMutation.isPending}
                dwsFetchPending={dwsFetchMutation.isPending}
                dwsImportPending={dwsImportMutation.isPending}
                canImportDws={isTenantAdmin && canSyncOrganization}
                onDwsLogin={() => dwsLoginMutation.mutate()}
                selectedDwsProfile={selectedDwsProfile}
                onDwsProfileChange={setSelectedDwsProfile}
                onDwsProfileSelect={() => selectedDwsProfile && dwsProfileMutation.mutate(selectedDwsProfile)}
                onDwsFetch={() => dwsFetchMutation.mutate()}
                onDwsImport={() => dwsImportMutation.mutate()}
            />,
        },
        {
            key: 'sync',
            label: <span><CloudSyncOutlined /> {t('组织同步')}</span>,
            disabled: !canSyncOrganization,
            children: <SyncPanel
                integration={integrationQuery.data ?? null}
                jobs={jobsQuery.data?.items ?? []}
                latestJob={latestJob}
                loading={jobsQuery.isLoading}
                canSync={canSyncOrganization}
                syncing={syncMutation.isPending}
                onSync={() => syncMutation.mutate()}
                onRefresh={() => void jobsQuery.refetch()}
                formatDate={(value) => value ? formatDate(value) : '-'}
            />,
        },
        {
            key: 'mirror',
            label: <span><TeamOutlined /> {t('组织镜像')}</span>,
            disabled: !canReadOrganization,
            children: <MirrorPanel
                departments={departmentsQuery.data?.items ?? []}
                users={usersQuery.data?.items ?? []}
                loading={departmentsQuery.isLoading || usersQuery.isLoading}
                includeDeleted={includeDeleted}
                onIncludeDeletedChange={setIncludeDeleted}
                onRefresh={() => { void departmentsQuery.refetch(); void usersQuery.refetch(); }}
                formatDate={(value) => value ? formatDate(value) : '-'}
            />,
        },
        {
            key: 'mapping',
            label: <span><SafetyCertificateOutlined /> {t('映射导入')}</span>,
            disabled: !canPreviewMapping,
            children: <MappingPanel
                preview={preview}
                roles={roles}
                rolesLoading={rolesQuery.isLoading}
                previewLoading={previewMutation.isPending}
                applyLoading={applyMutation.isPending}
                selectedRoleId={selectedRoleId}
                roleSelections={roleSelections}
                selectedRoleUserIds={selectedRoleUserIds}
                departmentResolutions={departmentResolutions}
                userResolutions={userResolutions}
                mappingResult={mappingResult}
                unassignedCreateCount={unassignedCreateCount}
                unresolvedDepartmentCount={unresolvedDepartmentCount}
                unresolvedUserCount={unresolvedUserCount}
                canPreview={canPreviewMapping}
                canApply={canApplyMapping}
                onSelectRole={setSelectedRoleId}
                onSelectUser={updateRoleSelection}
                onDepartmentAction={setDepartmentAction}
                onUserAction={setUserAction}
                onPreview={() => previewMutation.mutate()}
                onApply={() => applyMutation.mutate()}
                onExport={exportCredentials}
            />,
        },
    ];

    return <div className="workspace-page dingtalk-page">
        <header className="workspace-page-header">
            <div><h1>{t('钉钉连接器')}</h1><p>{t('通过 DWS/MCP 授权读取钉钉数据，租户管理员可将可见组织导入 CEES')}</p></div>
            <div className="header-actions"><Tag color={dwsStatus?.authenticated ? 'green' : integrationQuery.data?.status === 'ACTIVE' ? 'green' : 'default'}>{dwsStatus?.authenticated ? t('DWS 已连接') : integrationQuery.data ? dingTalkIntegrationStatusLabel(integrationQuery.data.status) : t('未连接')}</Tag><Button icon={<ReloadOutlined />} onClick={refreshDingTalkData}>{t('刷新')}</Button></div>
        </header>
        <Tabs activeKey={activeTab} onChange={(tab) => changeTab(normalizeDingTalkTab(tab))} items={tabItems} />
    </div>;
}

function IntegrationPanel({ integration, loading, canManage, form, mutation, verifyMutation, onVerify, dwsStatus, dwsSnapshot, dwsLoginPending, dwsProfilePending, dwsFetchPending, dwsImportPending, canImportDws, onDwsLogin, selectedDwsProfile, onDwsProfileChange, onDwsProfileSelect, onDwsFetch, onDwsImport }: {
    integration: DingTalkIntegration | null;
    loading: boolean;
    canManage: boolean;
    form: FormInstance<IntegrationFormValues>;
    mutation: { isPending: boolean; mutate: (values: IntegrationFormValues) => void };
    verifyMutation: { isPending: boolean };
    onVerify: () => void;
    dwsStatus?: DwsStatus;
    dwsSnapshot?: DwsSnapshot;
    dwsLoginPending: boolean;
    dwsProfilePending: boolean;
    dwsFetchPending: boolean;
    dwsImportPending: boolean;
    canImportDws: boolean;
    onDwsLogin: () => void;
    selectedDwsProfile?: string;
    onDwsProfileChange: (profile: string) => void;
    onDwsProfileSelect: () => void;
    onDwsFetch: () => void;
    onDwsImport: () => void;
}): JSX.Element {
    const { t } = useI18n();
    if (loading) return <div className="dingtalk-loading"><Spin /></div>;
    return <div className="dingtalk-stack"><Card title={<span><CloudSyncOutlined /> {t('连接钉钉')}</span>}>
        <Alert type="info" showIcon message={t('通过 DWS/MCP 授权读取当前账号可见的钉钉组织数据')} description={t('普通用户可以查询可见数据；只有 CEES 租户管理员可以导入当前租户。不会检查钉钉管理员身份。')} />
        <Space wrap style={{ marginTop: 16 }}>
            <Button type="primary" loading={dwsLoginPending} onClick={onDwsLogin}>{dwsStatus?.authenticated ? t('重新授权') : t('使用钉钉账号连接')}</Button>
            <Button disabled={!dwsStatus?.authenticated} loading={dwsFetchPending} onClick={onDwsFetch}>{t('读取可见组织')}</Button>
            {canImportDws && <Button type="primary" ghost disabled={!dwsStatus?.authenticated} loading={dwsImportPending} onClick={onDwsImport}>{t('导入当前租户')}</Button>}
        </Space>
        {dwsStatus?.state === 'PROFILE_REQUIRED' && <Space.Compact style={{ width: '100%', marginTop: 16 }}>
            <Select
                style={{ flex: 1 }}
                placeholder={t('选择当前钉钉组织账号')}
                value={selectedDwsProfile}
                onChange={onDwsProfileChange}
                options={dwsStatus.profiles.map((profile) => ({
                    value: profile.profile,
                    label: `${profile.corpName || profile.corpId || t('未知组织')} · ${profile.externalUserName || profile.externalUserId || t('未知用户')}`,
                }))}
            />
            <Button type="primary" disabled={!selectedDwsProfile} loading={dwsProfilePending} onClick={onDwsProfileSelect}>{t('确认组织')}</Button>
        </Space.Compact>}
        {dwsStatus && <Descriptions column={2} size="small" style={{ marginTop: 16 }}>
            <Descriptions.Item label={t('DWS 状态')}>{dwsStatus.state === 'READY' ? <Tag color="green">{t('已连接')}</Tag> : dwsStatus.state === 'PROFILE_REQUIRED' ? <Tag color="gold">{t('待选择组织')}</Tag> : dwsStatus.state === 'ERROR' ? <Tag color="red">{t('连接异常')}</Tag> : <Tag>{dwsStatus.installed ? t('未授权') : t('未安装')}</Tag>}</Descriptions.Item>
            <Descriptions.Item label={t('当前组织')}>{dwsStatus.corpName ?? dwsStatus.corpId ?? '-'}</Descriptions.Item>
            <Descriptions.Item label={t('当前用户')}>{dwsStatus.externalUserName ?? dwsStatus.externalUserId ?? '-'}</Descriptions.Item>
            <Descriptions.Item label={t('Profile')}>{dwsStatus.profile ?? '-'}</Descriptions.Item>
        </Descriptions>}
        {dwsStatus?.error && <Alert type="warning" showIcon style={{ marginTop: 12 }} message={dwsStatus.error} />}
        {dwsSnapshot && <Alert type="success" showIcon style={{ marginTop: 12 }} message={t('已读取 {departments} 个部门、{users} 名人员', { departments: dwsSnapshot.departments.length, users: dwsSnapshot.users.length })} description={t('本次结果是当前授权账号可见范围，未返回的数据不会被标记删除。')} />}
    </Card>{(!integration || integration.mode !== 'DWS_LOCAL') && <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
            <Card title={<span><SettingOutlined /> {t('钉钉企业凭证')}</span>} extra={integration ? <Tag color={integration.status === 'ACTIVE' ? 'green' : 'orange'}>{dingTalkIntegrationStatusLabel(integration.status)}</Tag> : <Tag>{t('未绑定')}</Tag>}>
                {!canManage && <Alert type="info" showIcon message={t('当前账号只有查看权限')} />}
                <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)} disabled={!canManage}>
                    <Form.Item name="corpId" label="CorpId" rules={[{ required: true, message: t('请输入 CorpId') }]}><Input placeholder="dingxxxxxxxx" /></Form.Item>
                    <Form.Item name="appKey" label="AppKey" rules={[{ required: true, message: t('请输入 AppKey') }]}><Input placeholder="dingxxxxxxxx" /></Form.Item>
                    <Form.Item name="appSecret" label="AppSecret" rules={[{ required: !integration, message: t('请输入 AppSecret') }]}><Input.Password placeholder={integration ? t('留空表示不修改 AppSecret') : t('请输入钉钉应用密钥')} /></Form.Item>
                    {integration && <Form.Item name="status" label={t('启用集成')} valuePropName="checked"><Switch checkedChildren={t('启用')} unCheckedChildren={t('停用')} /></Form.Item>}
                    {canManage && <Space><Button type="primary" htmlType="submit" loading={mutation.isPending}>{integration ? t('保存绑定') : t('创建绑定')}</Button>{integration && <Button onClick={onVerify} loading={verifyMutation.isPending}>{t('验证凭证')}</Button>}</Space>}
                </Form>
            </Card>
        </Col>
        <Col xs={24} lg={9}>
            <Card title={t('连接信息')}>
                {integration ? <Descriptions column={1} size="small">
                    <Descriptions.Item label={t('连接模式')}>{integration.mode === 'DWS_LOCAL' ? t('DWS/MCP 本地授权') : t('企业应用凭证')}</Descriptions.Item>
                    <Descriptions.Item label={t('企业 CorpId')}>{integration.corpId ?? '-'}</Descriptions.Item>
                    <Descriptions.Item label={t('AppKey')}>{integration.appKey}</Descriptions.Item>
                    {integration.authorizedExternalUserId && <Descriptions.Item label={t('授权用户')}>{integration.authorizedExternalUserId}</Descriptions.Item>}
                    <Descriptions.Item label={t('最近验证')}>{integration.lastVerifiedAt ? new Date(integration.lastVerifiedAt).toLocaleString() : '-'}</Descriptions.Item>
                    <Descriptions.Item label={t('最近同步')}>{integration.lastSyncedAt ? new Date(integration.lastSyncedAt).toLocaleString() : '-'}</Descriptions.Item>
                    <Descriptions.Item label={t('版本')}>{integration.version}</Descriptions.Item>
                    {integration.lastErrorMessage && <Descriptions.Item label={t('最近错误')}><span className="dingtalk-error-text">{integration.lastErrorMessage}</span></Descriptions.Item>}
                </Descriptions> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前租户尚未绑定钉钉企业')} />}
            </Card>
        </Col>
    </Row>}</div>;
}

function SyncPanel({ integration, jobs, latestJob, loading, canSync, syncing, onSync, onRefresh, formatDate }: {
    integration: DingTalkIntegration | null;
    jobs: DingTalkSyncJob[];
    latestJob?: DingTalkSyncJob;
    loading: boolean;
    canSync: boolean;
    syncing: boolean;
    onSync: () => void;
    onRefresh: () => void;
    formatDate: (value: string | null | undefined) => string;
}): JSX.Element {
    const { t } = useI18n();
    return <div className="dingtalk-stack">
        {!integration && <Alert type="warning" showIcon message={t('请先在连接钉钉页完成授权')} />}
        {integration?.mode === 'DWS_LOCAL' && <Alert type="info" showIcon message={t('当前使用 DWS/MCP 可见范围同步')} description={t('请回到连接钉钉页读取最新快照并导入当前租户。未返回的数据不会被标记删除。')} />}
        {!canSync && <Alert type="info" showIcon message={t('当前账号没有发起组织同步的权限')} />}
        <Card title={<span><CloudSyncOutlined /> {t('组织同步')}</span>} extra={<Space><Button icon={<ReloadOutlined />} onClick={onRefresh}>{t('刷新')}</Button><Button type="primary" icon={<CloudSyncOutlined />} disabled={!integration || integration.mode === 'DWS_LOCAL' || !canSync} loading={syncing} onClick={onSync}>{t('企业应用全量同步')}</Button></Space>}>
            <Row gutter={16}>
                <Col xs={24} sm={8}><Statistic title={t('最近部门数')} value={integration && latestJob?.departmentCount !== undefined ? latestJob.departmentCount : '-'} /></Col>
                <Col xs={24} sm={8}><Statistic title={t('最近人员数')} value={integration && latestJob?.userCount !== undefined ? latestJob.userCount : '-'} /></Col>
                <Col xs={24} sm={8}><Statistic title={t('最近状态')} value={latestJob?.status ? dingTalkSyncStatusLabel(latestJob.status) : '-'} /></Col>
            </Row>
        </Card>
        <Card title={t('同步历史')}>
            <Table<DingTalkSyncJob> size="small" rowKey="id" loading={loading} pagination={{ pageSize: 8 }} dataSource={jobs} columns={[
                { title: t('状态'), dataIndex: 'status', render: (status: string) => <Badge status={status === 'SUCCEEDED' ? 'success' : status === 'FAILED' ? 'error' : 'processing'} text={dingTalkSyncStatusLabel(status)} /> },
                { title: t('类型'), dataIndex: 'type', render: (type: string) => dingTalkSyncTypeLabel(type) },
                { title: t('部门数'), dataIndex: 'departmentCount' },
                { title: t('人员数'), dataIndex: 'userCount' },
                { title: t('开始时间'), dataIndex: 'startedAt', render: (value: string) => formatDate(value) },
                { title: t('完成时间'), dataIndex: 'completedAt', render: (value: string | null) => formatDate(value) },
                { title: t('错误信息'), dataIndex: 'errorMessage', render: (value: string | null) => value || '-' },
            ]} />
        </Card>
    </div>;
}

function MirrorPanel({ departments, users, loading, includeDeleted, onIncludeDeletedChange, onRefresh, formatDate }: {
    departments: DingTalkDepartment[];
    users: DingTalkUser[];
    loading: boolean;
    includeDeleted: boolean;
    onIncludeDeletedChange: (value: boolean) => void;
    onRefresh: () => void;
    formatDate: (value: string | null | undefined) => string;
}): JSX.Element {
    const { t } = useI18n();
    return <Card title={t('钉钉组织镜像')} extra={<Space><Checkbox checked={includeDeleted} onChange={(event) => onIncludeDeletedChange(event.target.checked)}>{t('包含已删除')}</Checkbox><Button icon={<ReloadOutlined />} onClick={onRefresh}>{t('刷新')}</Button></Space>}>
        <Tabs items={[{
            key: 'departments',
            label: `${t('部门')} (${departments.length})`,
            children: <Table<DingTalkDepartment> size="small" rowKey="id" loading={loading} pagination={{ pageSize: 12 }} dataSource={departments} columns={[
                { title: t('部门名称'), dataIndex: 'name' },
                { title: t('钉钉部门 ID'), dataIndex: 'externalDepartmentId' },
                { title: t('上级部门 ID'), dataIndex: 'parentExternalDepartmentId', render: (value: string | null) => value || '-' },
                { title: t('CEES 部门'), dataIndex: 'departmentId', render: (value: string | null) => value ? <Tag color="green">{t('已映射')}</Tag> : <Tag>{t('未映射')}</Tag> },
                { title: t('状态'), dataIndex: 'isDeleted', render: (deleted: boolean) => deleted ? <Tag color="red">{t('已删除')}</Tag> : <Tag color="green">{t('有效')}</Tag> },
                { title: t('最后发现'), dataIndex: 'lastSeenAt', render: (value: string) => formatDate(value) },
            ]} />,
        }, {
            key: 'users',
            label: `${t('人员')} (${users.length})`,
            children: <Table<DingTalkUser> size="small" rowKey="id" loading={loading} pagination={{ pageSize: 12 }} dataSource={users} columns={[
                { title: t('姓名'), dataIndex: 'name' },
                { title: t('钉钉用户 ID'), dataIndex: 'externalUserId' },
                { title: t('职位'), dataIndex: 'title', render: (value: string | null) => value || '-' },
                { title: t('工号'), dataIndex: 'jobNumber', render: (value: string | null) => value || '-' },
                { title: t('CEES 成员'), dataIndex: 'membershipId', render: (value: string | null) => value ? <Tag color="green">{t('已映射')}</Tag> : <Tag>{t('未映射')}</Tag> },
                { title: t('状态'), dataIndex: 'active', render: (active: boolean, user: DingTalkUser) => user.isDeleted ? <Tag color="red">{t('已删除')}</Tag> : active ? <Tag color="green">{t('在职')}</Tag> : <Tag color="orange">{t('停用')}</Tag> },
                { title: t('最后发现'), dataIndex: 'lastSeenAt', render: (value: string) => formatDate(value) },
            ]} />,
        }]} />
    </Card>;
}

function MappingPanel({ preview, roles, rolesLoading, previewLoading, applyLoading, selectedRoleId, roleSelections, selectedRoleUserIds, departmentResolutions, userResolutions, mappingResult, unassignedCreateCount, unresolvedDepartmentCount, unresolvedUserCount, canPreview, canApply, onSelectRole, onSelectUser, onDepartmentAction, onUserAction, onPreview, onApply, onExport }: {
    preview?: DingTalkMappingPreview;
    roles: Array<{ id: string; code: string; name: string }>;
    rolesLoading: boolean;
    previewLoading: boolean;
    applyLoading: boolean;
    selectedRoleId?: string;
    roleSelections: RoleSelections;
    selectedRoleUserIds: string[];
    departmentResolutions: Record<string, DingTalkMappingDepartmentResolution>;
    userResolutions: Record<string, DingTalkMappingUserResolution>;
    mappingResult?: { credentials: DingTalkMappingCredential[] };
    unassignedCreateCount: number;
    unresolvedDepartmentCount: number;
    unresolvedUserCount: number;
    canPreview: boolean;
    canApply: boolean;
    onSelectRole: (roleId: string) => void;
    onSelectUser: (userId: string, checked: boolean) => void;
    onDepartmentAction: (departmentId: string, action: ResolutionAction, targetId?: string) => void;
    onUserAction: (userId: string, action: ResolutionAction, targetId?: string, account?: string) => void;
    onPreview: () => void;
    onApply: () => void;
    onExport: () => void;
}): JSX.Element {
    const { t } = useI18n();
    const { modal } = AntdApp.useApp();
    const [departmentFilter, setDepartmentFilter] = useState('ALL');
    const [userFilter, setUserFilter] = useState('ALL');
    if (!canPreview) return <Alert type="info" showIcon message={t('当前账号没有预览组织映射的权限')} />;
    return <div className="dingtalk-stack">
        <Card title={<span><SafetyCertificateOutlined /> {t('映射预览与应用')}</span>} extra={<Space><Button icon={<ReloadOutlined />} loading={previewLoading} onClick={onPreview}>{preview ? t('重新预览') : t('加载预览')}</Button>{mappingResult && <Button type="primary" icon={<FileExcelOutlined />} onClick={onExport}>{t('导出激活凭证 Excel')}</Button>}</Space>}>
            {!preview && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('请先加载钉钉组织映射预览')} />}
            {preview && <>
                <Row gutter={[12, 12]} className="dingtalk-stat-row">
                    <Col xs={12} md={4}><Statistic title={t('部门已匹配')} value={preview.summary.departmentMatchedCount} /></Col>
                    <Col xs={12} md={4}><Statistic title={t('部门待创建')} value={preview.summary.departmentCreateCount} /></Col>
                    <Col xs={12} md={4}><Statistic title={t('部门冲突')} value={preview.summary.departmentConflictCount} /></Col>
                    <Col xs={12} md={4}><Statistic title={t('人员已匹配')} value={preview.summary.userMatchedCount} /></Col>
                    <Col xs={12} md={4}><Statistic title={t('人员待创建')} value={preview.summary.userCreateCount} /></Col>
                    <Col xs={12} md={4}><Statistic title={t('人员冲突')} value={preview.summary.userConflictCount} /></Col>
                </Row>
                {(unresolvedDepartmentCount > 0 || unresolvedUserCount > 0) && <Alert type="warning" showIcon message={t('仍有映射冲突未处理')} description={t('部门剩余 {departments} 项，人员剩余 {users} 项。处理完成后才能应用映射。', { departments: unresolvedDepartmentCount, users: unresolvedUserCount })} />}
                {unassignedCreateCount > 0 && <Alert type="warning" showIcon message={t('仍有新成员未分配角色')} description={t('请在角色分配区域为 {count} 名新成员至少分配一个角色。', { count: unassignedCreateCount })} />}
                <Tabs items={[{
                    key: 'departments',
                    label: t('部门处理'),
                    children: <Table size="small" rowKey="dingtalkDepartmentId" pagination={{ pageSize: 10 }} dataSource={preview.departments.filter((department) => departmentFilter === 'ALL' || department.action === departmentFilter)} columns={[
                        { title: t('路径'), dataIndex: 'path' },
                        { title: t('动作'), dataIndex: 'action', render: (action: string) => <Tag color={action === 'CREATE' ? 'blue' : action === 'CONFLICT' ? 'orange' : 'green'}>{dingTalkMappingActionLabel(action)}</Tag> },
                        { title: t('原因'), dataIndex: 'reason' },
                        { title: t('处理'), render: (_, department) => department.action !== 'CONFLICT' ? <Tag>{t('自动处理')}</Tag> : <Space><Select style={{ minWidth: 150 }} placeholder={t('选择处理方式')} value={departmentResolutions[department.dingtalkDepartmentId]?.action} onChange={(action: ResolutionAction) => onDepartmentAction(department.dingtalkDepartmentId, action)} options={[{ value: 'CREATE', label: t('创建新部门') }, { value: 'SKIP', label: t('跳过') }, ...(department.candidateDepartmentIds.length ? [{ value: 'BIND_EXISTING', label: t('绑定候选部门') }] : [])]} />{departmentResolutions[department.dingtalkDepartmentId]?.action === 'BIND_EXISTING' && <Select style={{ minWidth: 180 }} placeholder={t('选择候选部门')} value={departmentResolutions[department.dingtalkDepartmentId]?.departmentId} onChange={(departmentId: string) => onDepartmentAction(department.dingtalkDepartmentId, 'BIND_EXISTING', departmentId)} options={department.candidateDepartmentIds.map((departmentId) => ({ value: departmentId, label: departmentId }))} />}</Space> },
                    ]} title={() => <Select value={departmentFilter} onChange={setDepartmentFilter} options={[{ value: 'ALL', label: t('全部') }, { value: 'CONFLICT', label: t('仅冲突') }, { value: 'CREATE', label: t('待创建') }, { value: 'MATCH_EXISTING', label: t('已匹配') }]} />} />,
                }, {
                    key: 'users',
                    label: t('人员处理'),
                    children: <Table size="small" rowKey="dingtalkUserId" pagination={{ pageSize: 10 }} dataSource={preview.users.filter((user) => userFilter === 'ALL' || user.action === userFilter)} columns={[
                        { title: t('姓名'), dataIndex: 'name' },
                        { title: t('部门'), dataIndex: 'departmentPaths', render: (paths: string[]) => paths.join('、') || '-' },
                        { title: t('建议账号'), dataIndex: 'suggestedAccount' },
                        { title: t('动作'), dataIndex: 'action', render: (action: string) => <Tag color={action === 'CREATE' ? 'blue' : action === 'CONFLICT' ? 'orange' : 'green'}>{dingTalkMappingActionLabel(action)}</Tag> },
                        { title: t('处理'), width: 420, render: (_, user) => user.action !== 'CONFLICT' ? <Tag>{t('自动处理')}</Tag> : <Space direction="vertical" size={4}><Space><Select style={{ minWidth: 150 }} placeholder={t('选择处理方式')} value={userResolutions[user.dingtalkUserId]?.action} onChange={(action: ResolutionAction) => onUserAction(user.dingtalkUserId, action)} options={[{ value: 'CREATE', label: t('创建新成员') }, { value: 'SKIP', label: t('跳过') }, ...(user.candidateMembershipIds.length ? [{ value: 'BIND_EXISTING', label: t('绑定候选成员') }] : [])]} />{userResolutions[user.dingtalkUserId]?.action === 'BIND_EXISTING' && <Select style={{ minWidth: 210 }} placeholder={t('选择候选成员')} value={userResolutions[user.dingtalkUserId]?.membershipId} onChange={(membershipId: string) => onUserAction(user.dingtalkUserId, 'BIND_EXISTING', membershipId)} options={user.candidateMembershipIds.map((membershipId) => ({ value: membershipId, label: membershipId }))} />}</Space>{userResolutions[user.dingtalkUserId]?.action === 'CREATE' && <Input size="small" placeholder={t('可选：自定义登录账号')} onChange={(event) => onUserAction(user.dingtalkUserId, 'CREATE', undefined, event.target.value)} />}</Space> },
                    ]} title={() => <Select value={userFilter} onChange={setUserFilter} options={[{ value: 'ALL', label: t('全部') }, { value: 'CONFLICT', label: t('仅冲突') }, { value: 'CREATE', label: t('待创建') }, { value: 'MATCH_EXISTING', label: t('已匹配') }]} />} />,
                }, {
                    key: 'roles',
                    label: t('角色分配'),
                    children: <RoleAssignmentPanel preview={preview} roles={roles} rolesLoading={rolesLoading} selectedRoleId={selectedRoleId} roleSelections={roleSelections} selectedRoleUserIds={selectedRoleUserIds} onSelectRole={onSelectRole} onSelectUser={onSelectUser} />,
                }]} />
                <div className="dingtalk-apply-bar"><span>{unresolvedDepartmentCount === 0 && unresolvedUserCount === 0 && unassignedCreateCount === 0 ? <Tag color="green">{t('已满足应用条件')}</Tag> : <Tag color="orange">{t('尚不能应用')}</Tag>}</span><Button type="primary" icon={<CheckCircleOutlined />} disabled={!canApply || unresolvedDepartmentCount > 0 || unresolvedUserCount > 0 || unassignedCreateCount > 0} loading={applyLoading} onClick={() => modal.confirm({ title: t('确认应用钉钉组织映射？'), content: t('应用后会创建部门、成员和激活凭证，请确认映射和角色分配无误。'), okText: t('确认应用'), cancelText: t('取消'), onOk: onApply })}>{t('应用映射')}</Button></div>
                {mappingResult && <Alert type="success" showIcon message={t('映射已应用')} description={t('本次创建 {count} 名待激活成员，请立即导出激活凭证。', { count: mappingResult.credentials.length })} />}
            </>}
        </Card>
    </div>;
}

function RoleAssignmentPanel({ preview, roles, rolesLoading, selectedRoleId, roleSelections, selectedRoleUserIds, onSelectRole, onSelectUser }: {
    preview: DingTalkMappingPreview;
    roles: Array<{ id: string; code: string; name: string }>;
    rolesLoading: boolean;
    selectedRoleId?: string;
    roleSelections: RoleSelections;
    selectedRoleUserIds: string[];
    onSelectRole: (roleId: string) => void;
    onSelectUser: (userId: string, checked: boolean) => void;
}): JSX.Element {
    const { t } = useI18n();
    const users = preview.users.filter((user) => user.action !== 'SKIP');
    const selectedSet = new Set(selectedRoleUserIds);
    const allSelected = users.length > 0 && selectedSet.size === users.length;
    const selectedRole = roles.find((role) => role.id === selectedRoleId);
    return <div className="dingtalk-role-assignment">
        {rolesLoading ? <Spin /> : roles.length === 0 ? <Empty description={t('当前租户没有可分配角色，请先创建角色')} /> : <>
            <div className="dingtalk-role-list">{roles.map((role) => <button type="button" className={role.id === selectedRoleId ? 'is-active' : ''} key={role.id} onClick={() => onSelectRole(role.id)}><span><strong>{role.name}</strong><small>{role.code}</small></span><Tag>{(roleSelections[role.id] ?? []).length}</Tag></button>)}</div>
            <div className="dingtalk-role-users"><div className="dingtalk-role-users-heading"><div><h3>{selectedRole?.name ?? t('请选择角色')}</h3><small>{t('同一人员可以加入多个角色')}</small></div><Checkbox checked={allSelected} indeterminate={selectedSet.size > 0 && !allSelected} onChange={(event) => users.forEach((user) => onSelectUser(user.dingtalkUserId, event.target.checked))}>{t('全选人员')}</Checkbox></div><Table size="small" rowKey="dingtalkUserId" pagination={{ pageSize: 10 }} dataSource={users} columns={[
                { title: t('选择'), width: 70, render: (_, user) => <Checkbox checked={selectedSet.has(user.dingtalkUserId)} onChange={(event) => onSelectUser(user.dingtalkUserId, event.target.checked)} /> },
                { title: t('姓名'), dataIndex: 'name' },
                { title: t('部门'), dataIndex: 'departmentPaths', render: (paths: string[]) => paths.join('、') || '-' },
                { title: t('动作'), dataIndex: 'action', render: (action: string) => <Tag>{dingTalkMappingActionLabel(action)}</Tag> },
            ]} /></div>
        </>}
    </div>;
}

function dingTalkIntegrationStatusLabel(status: string): string {
    switch (status) {
        case 'ACTIVE': return '已启用';
        case 'DISABLED': return '已停用';
        case 'ERROR': return '连接异常';
        default: return status;
    }
}

function dingTalkSyncStatusLabel(status: string): string {
    switch (status) {
        case 'RUNNING': return '同步中';
        case 'SUCCEEDED': return '同步成功';
        case 'FAILED': return '同步失败';
        default: return status;
    }
}

function dingTalkSyncTypeLabel(type: string): string {
    switch (type) {
        case 'FULL_ORGANIZATION': return '全量组织架构';
        default: return type;
    }
}

function dingTalkMappingActionLabel(action: string): string {
    switch (action) {
        case 'MATCH_EXISTING': return '已匹配';
        case 'CREATE': return '待创建';
        case 'CONFLICT': return '存在冲突';
        case 'SKIP': return '已跳过';
        default: return action;
    }
}

function normalizeDingTalkTab(value: string | null): DingTalkTab {
    return value === 'sync' || value === 'mirror' || value === 'mapping' ? value : 'integration';
}
