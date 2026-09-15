import { DownloadOutlined, ExclamationCircleOutlined, FileExcelOutlined, UploadOutlined } from '@ant-design/icons';
import { App as AntdApp, Alert, Button, Input, Modal, Select, Spin, Table, Tag, Upload } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import {
    confirmOrganizationImport, listTenantRoles, suggestTenantAccount,
    validateOrganizationImport,
    type OrganizationImportRequest,
    type OrganizationImportResult, type OrganizationImportValidation,
    type TenantRole,
} from '../../core/api';
import '../../styles/shared.css';
import { useI18n } from '../../core/i18n';

/**
 * 组织导入 Excel 模板的 CDN 下载地址。
 * 部署时替换为实际的模板文件地址（模板包含「部门」与「人员」两个 Sheet）。 
 */
export const ORGANIZATION_IMPORT_TEMPLATE_URL = 'https://modus.cool.cees.top/static-docs/Enterprise-template-implementation.xlsx';

interface ParsedDepartmentRow {
    rowNumber: number;
    path: string;
    name: string;
    parentPath: string | null;
    sortOrder: number;
    description: string;
    clientRef: string;
    parentClientRef: string | null;
}

interface ParsedMemberRow {
    rowNumber: number;
    account: string;
    accountLocked: boolean;
    displayName: string;
    departmentPath: string;
    roleIds: string[];
    clientRef: string;
    departmentClientRef: string;
}

interface ImportSheetRow {
    rowNumber: number;
    values: Record<string, unknown>;
}

interface OrganizationImportModalProps {
    open: boolean;
    tenantCode: string;
    onClose: () => void;
    onImported: () => void;
}

function normalizePath(path: string): string {
    return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

function readImportSheet(sheet: XLSX.WorkSheet, requiredHeaders: string[]): ImportSheetRow[] {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    const headerIndex = rows.findIndex((row) => {
        const headers = row.map((cell) => String(cell).replace(/^\uFEFF/, '').trim());
        return requiredHeaders.every((header) => headers.includes(header));
    });
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map((cell) => String(cell).replace(/^\uFEFF/, '').trim());
    return rows.slice(headerIndex + 1).map((row, index) => ({
        rowNumber: headerIndex + index + 2,
        values: headers.reduce<Record<string, unknown>>((record, header, columnIndex) => {
            if (header) record[header] = row[columnIndex] ?? '';
            return record;
        }, {}),
    }));
}

function isTemplateInstruction(value: string): boolean {
    return /^规则提示[：:]/.test(value);
}

export default function OrganizationImportModal({ open, tenantCode, onClose, onImported }: OrganizationImportModalProps): JSX.Element {
    const { message } = AntdApp.useApp();
    const { t } = useI18n();
    const rolesQuery = useQuery({ queryKey: ['tenant-roles'], queryFn: () => listTenantRoles(), enabled: open });
    const assignableRoles = (rolesQuery.data?.items ?? []).filter((role) => role.code !== 'tenant_admin');

    const [departments, setDepartments] = useState<ParsedDepartmentRow[]>([]);
    const [members, setMembers] = useState<ParsedMemberRow[]>([]);
    const [fileName, setFileName] = useState('');
    const [parsing, setParsing] = useState(false);
    const [defaultRoleIds, setDefaultRoleIds] = useState<string[]>([]);
    const [activationDays, setActivationDays] = useState(7);
    const [validating, setValidating] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [validation, setValidation] = useState<OrganizationImportValidation | null>(null);
    const [result, setResult] = useState<OrganizationImportResult | null>(null);
    const [suggestedAccounts, setSuggestedAccounts] = useState<Record<string, string>>({});

    const buildRequest = (): OrganizationImportRequest | null => {
        if (!defaultRoleIds.length) {
            message.warning(t('请选择批次默认角色'));
            return null;
        }
        const issueRows = members.filter((member) => !/^[a-zA-Z0-9]{3,32}$/.test(member.account));
        if (issueRows.length) {
            message.warning(t('第 {row} 行登录账号必须为 3～32 位英文字母或数字', { row: issueRows.map((row) => row.rowNumber).join('、') }));
            return null;
        }
        return {
            defaultRoleIds,
            departments: departments.map((row) => ({
                clientRef: row.clientRef,
                name: row.name,
                parentClientRef: row.parentClientRef,
                sortOrder: row.sortOrder,
                ...(row.description ? { description: row.description } : {}),
            })),
            members: members.map((row) => ({
                clientRef: row.clientRef,
                account: row.account.trim().toLowerCase(),
                displayName: row.displayName,
                departmentClientRef: row.departmentClientRef,
                ...(row.roleIds.length ? { roleIds: row.roleIds } : {}),
            })),
            activationExpiresInDays: activationDays,
        };
    };

    const handleFile = async (file: File): Promise<void> => {
        setParsing(true);
        setValidation(null);
        setResult(null);
        setSuggestedAccounts({});
        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const departmentSheet = workbook.Sheets['部门'];
            const memberSheet = workbook.Sheets['人员'];
            if (!departmentSheet || !memberSheet) {
                message.error(t('模板必须包含「部门」和「人员」两个 Sheet'));
                return;
            }
            const departmentRows = readImportSheet(departmentSheet, ['部门路径']);
            const memberRows = readImportSheet(memberSheet, ['姓名', '部门路径']);
            if (!departmentRows.length) {
                message.error(t('部门 Sheet 中没有找到包含「部门路径」的表头')); 
                return;
            }
            if (!memberRows.length) {
                message.error(t('人员 Sheet 中没有找到包含「姓名」和「部门路径」的表头'));
                return;
            }

            const deptPathByRef = new Map<string, string>();
            const deptRefByPath = new Map<string, string>();
            const parsedDepartments: ParsedDepartmentRow[] = [];
            let failed = false;
            departmentRows.forEach(({ rowNumber, values: row }) => {
                const rawPath = String(row['部门路径'] ?? '').trim();
                if (!rawPath || isTemplateInstruction(rawPath)) return;
                if (rawPath.startsWith('/') || rawPath.endsWith('/') || rawPath.includes('//') || rawPath.split('/').some((segment) => !segment.trim())) {
                    message.error(t('部门 Sheet 第 {row} 行路径格式不正确', { row: rowNumber }));
                    failed = true;
                    return;
                }
                const path = normalizePath(rawPath);
                if (deptRefByPath.has(path)) {
                    message.error(t('部门 Sheet 第 {row} 行路径重复：{path}', { row: rowNumber, path }));
                    failed = true;
                    return;
                }
                const segments = path.split('/');
                const name = segments[segments.length - 1];
                const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : null;
                if (parentPath && !deptRefByPath.has(parentPath)) {
                    message.error(t('部门 Sheet 第 {row} 行的父路径「{path}」不存在', { row: rowNumber, path: parentPath }));
                    failed = true;
                    return;
                }
                if (segments.length > 10) {
                    message.error(t('部门 Sheet 第 {row} 行超过 10 级层级', { row: rowNumber }));
                    failed = true;
                    return;
                }
                const clientRef = `department-row-${rowNumber}`;
                deptPathByRef.set(clientRef, path);
                deptRefByPath.set(path, clientRef);
                parsedDepartments.push({
                    rowNumber,
                    path,
                    name,
                    parentPath,
                    sortOrder: Number(row['排序']) || 0,
                    description: String(row['部门说明'] ?? '').trim(),
                    clientRef,
                    parentClientRef: parentPath ? deptRefByPath.get(parentPath)! : null,
                });
            });
            if (failed) return;

            const parsedMembers: ParsedMemberRow[] = [];
            memberRows.forEach(({ rowNumber, values: row }) => {
                const displayName = String(row['姓名'] ?? '').trim();
                if (!displayName || isTemplateInstruction(displayName)) return;
                const departmentPath = normalizePath(String(row['部门路径'] ?? '').trim());
                if (!departmentPath) {
                    message.error(t('人员 Sheet 第 {row} 行成员「{name}」未填写部门路径', { row: rowNumber, name: displayName }));
                    failed = true;
                    return;
                }
                const departmentClientRef = deptRefByPath.get(departmentPath);
                if (!departmentClientRef) {
                    message.error(t('人员 Sheet 第 {row} 行的部门路径「{path}」无效', { row: rowNumber, path: departmentPath }));
                    failed = true;
                    return;
                }
                const rawAccount = String(row['登录账号（可选）'] ?? row['登录账号'] ?? '').trim();
                parsedMembers.push({
                    rowNumber,
                    account: rawAccount,
                    accountLocked: Boolean(rawAccount),
                    displayName,
                    departmentPath,
                    roleIds: [],
                    clientRef: `member-row-${rowNumber}`,
                    departmentClientRef,
                });
            });
            if (failed) return;
            if (!parsedMembers.length) {
                message.warning(t('人员 Sheet 中没有可导入的成员'));
                return;
            }
            const accounts = new Set<string>();
            parsedMembers.forEach((member) => {
                if (member.account) {
                    const normalized = member.account.toLowerCase();
                    if (accounts.has(normalized)) {
                        message.error(t('人员 Sheet 中登录账号「{account}」重复', { account: member.account }));
                        failed = true;
                        return;
                    }
                    accounts.add(normalized);
                }
            });
            if (failed) return;

            setDepartments(parsedDepartments);
            setMembers(parsedMembers);
            setFileName(file.name);
            message.success(t('已解析 {departments} 个部门、{members} 名成员', { departments: parsedDepartments.length, members: parsedMembers.length }));

            const missing = parsedMembers.filter((member) => !member.account);
            if (missing.length) {
                const suggestions: Record<string, string> = {};
                await Promise.all(missing.map(async (member) => {
                    try {
                        const result = await suggestTenantAccount(member.displayName);
                        const account = result.account ?? result.suggestedAccount ?? result.suggestions?.[0];
                        if (account) suggestions[member.clientRef] = account.toLowerCase();
                    } catch {
                        // 账号建议失败时保留空值由管理员手动填写
                    }
                }));
                setMembers((current) => current.map((item) => {
                    if (item.account || !suggestions[item.clientRef]) return item;
                    const existing = new Set(current.map((entry) => entry.account.toLowerCase()).filter(Boolean));
                    let account = suggestions[item.clientRef].toLowerCase();
                    let suffix = 1;
                    while (existing.has(account) || accounts.has(account)) {
                        account = `${suggestions[item.clientRef].toLowerCase()}${suffix += 1}`;
                    }
                    return { ...item, account };
                }));
                setSuggestedAccounts(suggestions);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('Excel 解析失败'));
        } finally {
            setParsing(false);
        }
    };

    const runValidate = async (): Promise<void> => {
        const request = buildRequest();
        if (!request) return;
        setValidating(true);
        try {
            const data = await validateOrganizationImport(request);
            setValidation(data);
            if (data.valid) message.success(t('校验通过，可以确认导入'));
            else message.warning(t('校验发现 {count} 个问题，请处理后重试', { count: data.issues.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('校验失败'));
        } finally {
            setValidating(false);
        }
    };

    const runConfirm = async (): Promise<void> => {
        const request = buildRequest();
        if (!request) return;
        setConfirming(true);
        try {
            const data = await confirmOrganizationImport(request);
            setResult(data);
            message.success(t('已成功导入 {count} 名成员', { count: data.members.length }));
            onImported();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('导入失败'));
        } finally {
            setConfirming(false);
        }
    };

    const exportCredentials = (): void => {
        if (!result) return;
        const rows = result.members.map((member) => ({
            '姓名': member.displayName,
            '部门': member.departmentPath,
            '租户编码': member.tenantCode || tenantCode,
            '登录账号': member.account,
            '激活码': member.activationToken,
            '过期时间': member.activationExpiresAt ? member.activationExpiresAt.replace('T', ' ').slice(0, 19) : '',
        }));
        const sheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, '激活凭证');
        XLSX.writeFile(workbook, `成员激活凭证-${result.members[0]?.tenantCode ?? tenantCode}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
    };

    const issueMemberRefs = new Set((validation?.issues ?? []).filter((issue) => issue.scope === 'MEMBER').map((issue) => issue.clientRef));
    const issueMessages = (validation?.issues ?? []).map((issue) => `${issue.clientRef}: ${issue.message}`);

    return <Modal
        open={open}
        width={960}
        title={t('批量导入组织架构与成员')}
        footer={null}
        onCancel={onClose}
    >
        <div className="task-detail-sections">
            {result ? <>
                <Alert type="success" showIcon message={t('导入完成')} description={t('已创建 {departments} 个部门（复用 {reused} 个），导入 {members} 名成员，激活有效期 {days} 天', {
                    departments: result.summary.departmentCreateCount,
                    reused: result.summary.departmentReuseCount,
                    members: result.summary.memberCount,
                    days: activationDays,
                })} />
                <Alert type="warning" showIcon message={t('请立即导出激活凭证 Excel 并分发给成员，激活码只显示这一次')} />
                <Button type="primary" icon={<FileExcelOutlined />} onClick={exportCredentials}>{t('导出激活凭证 Excel')}</Button>
                <Table
                    size="small"
                    rowKey="membershipId"
                    pagination={false}
                    dataSource={result.members}
                    columns={[
                        { title: t('姓名'), dataIndex: 'displayName' },
                        { title: t('部门'), dataIndex: 'departmentPath' },
                        { title: t('登录账号'), dataIndex: 'account' },
                        { title: t('激活码'), dataIndex: 'activationToken', render: (token: string) => <code style={{ fontSize: 11 }}>{token}</code> },
                    ]}
                />
                <Button onClick={onClose}>{t('关闭')}</Button>
            </> : <>
                <div className="task-toolbar">
                    <Button icon={<DownloadOutlined />} onClick={() => window.open(ORGANIZATION_IMPORT_TEMPLATE_URL, '_blank')}>{t('下载 Excel 模板')}</Button>
                    <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => { void handleFile(file); return false; }}>
                        <Button icon={<UploadOutlined />} loading={parsing}>{t('上传填写后的 Excel')}</Button>
                    </Upload>
                    {fileName && <small style={{ color: 'var(--cees-muted)' }}>{fileName}</small>}
                </div>
                <small style={{ color: 'var(--cees-muted)' }}>{t('模板包含「部门」和「人员」两个 Sheet；部门路径用 / 分隔层级，人员登录账号留空时自动按拼音生成建议')}</small>

                {members.length > 0 && <>
                    <div className="form-grid">
                        <div className="form-row">
                            <label><span>{t('批次默认角色')}</span><Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder={t('选择默认角色')} value={defaultRoleIds} onChange={setDefaultRoleIds} style={{ minWidth: 260 }} options={assignableRoles.map((role: TenantRole) => ({ value: role.id, label: role.name }))} /></label>
                            <label><span>{t('激活有效期（天）')}</span><Select value={activationDays} onChange={setActivationDays} style={{ width: 100 }} options={Array.from({ length: 30 }, (_, index) => index + 1).map((day) => ({ value: day, label: `${day}` }))} /></label>
                        </div>
                    </div>
                    <section>
                        <div className="panel-heading"><h3>{t('部门预览')}</h3><small>{departments.length}</small></div>
                        <Table
                            size="small"
                            rowKey="clientRef"
                            pagination={false}
                            dataSource={departments}
                            columns={[
                                { title: t('部门路径'), dataIndex: 'path' },
                                { title: t('排序'), dataIndex: 'sortOrder', width: 70 },
                                { title: t('说明'), dataIndex: 'description', ellipsis: true },
                            ]}
                        />
                    </section>
                    <section>
                        <div className="panel-heading"><h3>{t('成员预览')}</h3><small>{members.length}</small></div>
                        <Table
                            size="small"
                            rowKey="clientRef"
                            pagination={false}
                            dataSource={members}
                            rowClassName={(record) => (issueMemberRefs.has(record.clientRef) ? 'import-issue-row' : '')}
                            columns={[
                                { title: t('姓名'), dataIndex: 'displayName', width: 110 },
                                { title: t('部门'), dataIndex: 'departmentPath' },
                                {
                                    title: t('登录账号'),
                                    dataIndex: 'account',
                                    width: 170,
                                    render: (_: string, record: ParsedMemberRow) => record.accountLocked
                                        ? <span>{record.account}</span>
                                        : <Input size="small" value={record.account} onChange={(event) => setMembers((current) => current.map((item) => item.clientRef === record.clientRef ? { ...item, account: event.target.value } : item))} />,
                                },
                                {
                                    title: t('专属角色（可选）'),
                                    dataIndex: 'roleIds',
                                    width: 220,
                                    render: (_: string[], record: ParsedMemberRow) => <Select mode="multiple" allowClear size="small" showSearch optionFilterProp="label" style={{ width: '100%' }} placeholder={t('继承默认角色')} value={record.roleIds} onChange={(value) => setMembers((current) => current.map((item) => item.clientRef === record.clientRef ? { ...item, roleIds: value } : item))} options={assignableRoles.map((role) => ({ value: role.id, label: role.name }))} />,
                                },
                            ]}
                        />
                        {Object.keys(suggestedAccounts).length > 0 && <small style={{ color: 'var(--cees-muted)' }}>{t('账号列为自动生成的拼音建议，可直接修改')}</small>}
                    </section>
                    {issueMessages.length > 0 && <Alert type="error" showIcon icon={<ExclamationCircleOutlined />} message={t('校验问题')} description={<ul style={{ margin: 0, paddingLeft: 18 }}>{issueMessages.map((item) => <li key={item}>{item}</li>)}</ul>} />}
                    <div className="task-toolbar">
                        <Button loading={validating} onClick={() => void runValidate()}>{t('校验数据')}</Button>
                        <Button type="primary" disabled={!validation?.valid} loading={confirming} onClick={() => void runConfirm()}>{t('确认导入')}</Button>
                        {validation && <Tag color={validation.valid ? 'success' : 'error'}>{validation.valid ? t('校验通过') : t('校验未通过')}</Tag>}
                        {validation && <small style={{ color: 'var(--cees-muted)' }}>{t('新建部门 {create} · 复用 {reuse} · 成员 {member}', { create: validation.summary.departmentCreateCount, reuse: validation.summary.departmentReuseCount, member: validation.summary.memberCount })}</small>}
                    </div>
                </>}
                {parsing && <div className="data-loading"><Spin /></div>}
            </>}
        </div>
    </Modal>;
}
