import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT_DEPARTMENT_ID = '1';
const MAX_DEPARTMENTS = 5000;
const MAX_USERS = 20000;
let managedExecutablePath: string | null = null;

export function configureDingTalkDwsExecutable(executablePath: string): void {
    managedExecutablePath = executablePath;
}

export interface DingTalkDwsStatus {
    installed: boolean;
    authenticated: boolean;
    source: 'MANAGED' | 'SYSTEM' | null;
    installSupported: boolean;
    version: string | null;
    profile: string | null;
    corpId: string | null;
    corpName: string | null;
    externalUserId: string | null;
    externalUserName: string | null;
    error: string | null;
}

export interface DingTalkDwsSnapshot {
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

export interface DingTalkDwsSchemaTool {
    toolId: string;
    canonicalPath: string;
    cliPath: string;
    description: string;
    parameters: Record<string, Record<string, unknown>>;
    positionals: Array<Record<string, unknown>>;
    effect: string;
    risk: string;
    confirmation: string;
    availability: string;
}

export async function getDingTalkDwsStatus(): Promise<DingTalkDwsStatus> {
    let version: string;
    try {
        version = (await runDws(['--version'], 15_000)).trim();
    } catch (error) {
        return {
            installed: false,
            authenticated: false,
            source: null,
            installSupported: process.platform === 'win32',
            version: null,
            profile: null,
            corpId: null,
            corpName: null,
            externalUserId: null,
            externalUserName: null,
            error: safeError(error),
        };
    }
    try {
        const authStatus = await runDwsJson(['auth', 'status', '--format', 'json'], 30_000);
        if (!isAuthenticatedPayload(authStatus)) {
            throw new Error('DWS 当前账号未完成授权');
        }
        const profiles = await runDwsJson(['profile', 'list', '--format', 'json'], 30_000);
        const profile = selectCurrentProfile(profiles);
        return {
            installed: true,
            authenticated: true,
            source: resolveDwsExecutable().source,
            installSupported: process.platform === 'win32',
            version,
            profile: stringField(profile, 'profile'),
            corpId: externalId(profile.corpId ?? profile.orgId ?? profile.organizationId),
            corpName: stringField(profile, 'corpName', 'orgName', 'organizationName'),
            externalUserId: externalId(profile.userId ?? profile.staffId ?? profile.externalUserId),
            externalUserName: stringField(profile, 'userName', 'name'),
            error: null,
        };
    } catch (error) {
        return {
            installed: true,
            authenticated: false,
            source: resolveDwsExecutable().source,
            installSupported: process.platform === 'win32',
            version,
            profile: null,
            corpId: null,
            corpName: null,
            externalUserId: null,
            externalUserName: null,
            error: safeError(error),
        };
    }
}

export async function loginDingTalkDws(): Promise<DingTalkDwsStatus> {
    await runDws(['auth', 'login'], 5 * 60_000);
    return getDingTalkDwsStatus();
}

export async function fetchDingTalkVisibleOrganization(): Promise<DingTalkDwsSnapshot> {
    const profilesPayload = await runDwsJson(['profile', 'list', '--format', 'json'], 30_000);
    const profileRecord = selectCurrentProfile(profilesPayload);
    const selfPayload = await runDwsJson(['contact', 'user', 'get-self', '--format', 'json'], 30_000);
    const selfRecord = selectSelfRecord(selfPayload);
    const corpId = externalId(profileRecord.corpId ?? profileRecord.orgId ?? profileRecord.organizationId)
        ?? externalId(selfRecord.corpId ?? selfRecord.orgId ?? selfRecord.organizationId);
    const externalUserId = externalId(profileRecord.userId ?? profileRecord.staffId ?? profileRecord.externalUserId)
        ?? externalId(selfRecord.userId ?? selfRecord.userid ?? selfRecord.staffId);
    const profile = stringField(profileRecord, 'profile') ?? (corpId && externalUserId ? `${corpId}:${externalUserId}` : null);
    const externalUserName = stringField(selfRecord, 'orgUserName', 'userName', 'name')
        ?? stringField(profileRecord, 'userName', 'name');
    if (!corpId || !externalUserId || !profile || !externalUserName) {
        throw new Error('DWS 未返回完整的当前组织和用户身份');
    }

    const departments = await fetchDepartments();
    const departmentIds = [ROOT_DEPARTMENT_ID, ...departments.map((department) => department.externalDepartmentId)];
    const memberIds = await fetchMemberIds(departmentIds);
    const users = await fetchUsers(memberIds);
    return {
        corpId,
        externalUserId,
        externalUserName,
        profile,
        fetchedAt: new Date().toISOString(),
        capabilities: ['contact.organization.visible.read'],
        departments,
        users,
    };
}

async function fetchDepartments(): Promise<DingTalkDwsSnapshot['departments']> {
    const departments: DingTalkDwsSnapshot['departments'] = [];
    const queue = [ROOT_DEPARTMENT_ID];
    const visited = new Set<string>();
    while (queue.length > 0) {
        const parentId = queue.shift()!;
        if (visited.has(parentId)) continue;
        assertSafeIdentifier(parentId);
        visited.add(parentId);
        const payload = await runDwsJson(['contact', 'dept', 'list-children', '--dept', parentId, '--format', 'json'], 60_000);
        for (const record of collectRecords(payload)) {
            const departmentId = externalId(record.deptId ?? record.dept_id ?? record.departmentId ?? record.id);
            const name = stringField(record, 'deptName', 'name');
            if (!departmentId || departmentId === ROOT_DEPARTMENT_ID || !name) continue;
            if (departments.some((department) => department.externalDepartmentId === departmentId)) continue;
            const resolvedParentId = externalId(record.parentDeptId ?? record.parent_id ?? record.parentId) ?? parentId;
            departments.push({
                externalDepartmentId: departmentId,
                parentExternalDepartmentId: resolvedParentId,
                name,
                displayOrder: integerField(record, 'order', 'displayOrder', 'sort') ?? 0,
            });
            queue.push(departmentId);
            if (departments.length > MAX_DEPARTMENTS) throw new Error('钉钉可见部门数量超过同步上限');
        }
    }
    return departments;
}

async function fetchMemberIds(departmentIds: string[]): Promise<string[]> {
    const memberIds = new Set<string>();
    for (const departmentId of departmentIds) {
        assertSafeIdentifier(departmentId);
        const payload = await runDwsJson(['contact', 'dept', 'list-members', '--ids', departmentId, '--format', 'json'], 60_000);
        for (const record of collectRecords(payload)) {
            const userId = externalId(record.userId ?? record.userid ?? record.staffId ?? record.externalUserId);
            if (userId) memberIds.add(userId);
            if (memberIds.size > MAX_USERS) throw new Error('钉钉可见人员数量超过同步上限');
        }
    }
    return [...memberIds];
}

async function fetchUsers(userIds: string[]): Promise<DingTalkDwsSnapshot['users']> {
    const users: DingTalkDwsSnapshot['users'] = [];
    for (let index = 0; index < userIds.length; index += 30) {
        const ids = userIds.slice(index, index + 30);
        ids.forEach(assertSafeIdentifier);
        const payload = await runDwsJson(['contact', 'user', 'get', '--ids', ids.join(','), '--format', 'json'], 60_000);
        for (const raw of collectRecords(payload)) {
            const record = isRecord(raw.orgEmployeeModel) ? raw.orgEmployeeModel : raw;
            const externalUserId = externalId(record.userId ?? record.userid ?? record.staffId ?? record.externalUserId);
            const name = stringField(record, 'orgUserName', 'name', 'userName');
            if (!externalUserId || !name || users.some((user) => user.externalUserId === externalUserId)) continue;
            users.push({
                externalUserId,
                unionId: stringField(record, 'unionId', 'unionid'),
                name,
                title: stringField(record, 'title', 'position'),
                jobNumber: stringField(record, 'jobNumber', 'job_number', 'jobNo'),
                departmentExternalIds: extractDepartmentIds(record),
                active: booleanField(record, 'active', 'isActive') ?? true,
                admin: booleanField(record, 'admin', 'isAdmin') ?? false,
                boss: booleanField(record, 'boss', 'isBoss') ?? false,
            });
        }
    }
    return users;
}

export async function runDwsJson(args: string[], timeout: number): Promise<unknown> {
    return parseJsonOutput(await runDws(args, timeout));
}

export async function readDingTalkDwsSchema(cliPath?: string): Promise<unknown> {
    const args = cliPath
        ? ['schema', '--cli-path', cliPath, '--compact', '--format', 'json']
        : ['schema', '--all', '--compact', '--format', 'json'];
    return runDwsJson(args, 60_000);
}

async function runDws(args: string[], timeout: number): Promise<string> {
    const executable = resolveDwsExecutable();
    const command = executable.source === 'MANAGED'
        ? executable.command
        : process.platform === 'win32' ? 'cmd.exe' : 'dws';
    const commandArgs = executable.source === 'MANAGED'
        ? args
        : process.platform === 'win32' ? ['/d', '/s', '/c', 'dws', ...args] : args;
    try {
        const result = await execFileAsync(command, commandArgs, {
            encoding: 'utf8',
            timeout,
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        return result.stdout;
    } catch (error) {
        throw new Error(safeError(error));
    }
}

function resolveDwsExecutable(): { command: string; source: 'MANAGED' | 'SYSTEM' } {
    if (managedExecutablePath && existsSync(managedExecutablePath)) {
        return { command: managedExecutablePath, source: 'MANAGED' };
    }
    return { command: 'dws', source: 'SYSTEM' };
}

export function parseJsonOutput(output: string): unknown {
    const trimmed = output.trim();
    if (!trimmed) throw new Error('DWS 未返回 JSON 数据');
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            try {
                return JSON.parse(lines[index]!) as unknown;
            } catch {
                continue;
            }
        }
        const jsonStarts = [trimmed.indexOf('{'), trimmed.indexOf('[')]
            .filter((index) => index >= 0)
            .sort((left, right) => left - right);
        for (const jsonStart of jsonStarts) {
            try {
                return JSON.parse(trimmed.slice(jsonStart)) as unknown;
            } catch {
            }
        }
        throw new Error('DWS 返回了无法解析的 JSON 数据');
    }
}

export function selectCurrentProfile(payload: unknown): Record<string, unknown> {
    const profiles = collectRecords(payload).filter((record) => stringField(record, 'profile') || record.corpId || record.userId);
    const currentProfiles = profiles.filter((record) => record.isCurrent === true || record.current === true);
    if (currentProfiles.length === 1) return currentProfiles[0]!;
    if (currentProfiles.length > 1) throw new Error('DWS 返回了多个当前组织，请先选择唯一组织');
    if (profiles.length === 1) return profiles[0]!;
    const corpIds = new Set(profiles.map((record) => externalId(record.corpId ?? record.orgId ?? record.organizationId)).filter(Boolean));
    if (corpIds.size === 1) {
        const organizationCurrentProfiles = profiles.filter((record) => record.isOrgCurrent === true);
        if (organizationCurrentProfiles.length === 1) return organizationCurrentProfiles[0]!;
    }
    throw new Error(profiles.length === 0 ? 'DWS 未返回已登录组织' : 'DWS 存在多个组织，请先选择当前组织');
}

function selectSelfRecord(payload: unknown): Record<string, unknown> {
    const records = collectRecords(payload);
    const wrapped = records.find((record) => isRecord(record.orgEmployeeModel));
    if (wrapped && isRecord(wrapped.orgEmployeeModel)) return wrapped.orgEmployeeModel;
    const self = records.find((record) => record.userId || record.userid || record.staffId || record.externalUserId);
    if (!self) throw new Error('DWS 未返回当前用户通讯录信息');
    return self;
}

function collectRecords(value: unknown): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = [];
    const visit = (current: unknown): void => {
        if (Array.isArray(current)) {
            current.forEach(visit);
            return;
        }
        if (!isRecord(current)) return;
        records.push(current);
        for (const nested of Object.values(current)) {
            if (Array.isArray(nested) || isRecord(nested)) visit(nested);
        }
    };
    visit(value);
    return records;
}

export function isAuthenticatedPayload(payload: unknown): boolean {
    const records = collectRecords(payload);
    if (records.length === 0) return false;
    const explicit = records.find((record) =>
        typeof record.authenticated === 'boolean'
        || typeof record.isAuthenticated === 'boolean'
        || typeof record.loggedIn === 'boolean'
        || typeof record.status === 'string',
    );
    if (!explicit) return true;
    if (explicit.authenticated === false || explicit.isAuthenticated === false || explicit.loggedIn === false) return false;
    if (typeof explicit.status === 'string' && ['unauthenticated', 'logged_out', 'expired', '未授权'].includes(explicit.status.toLowerCase())) {
        return false;
    }
    return true;
}

function extractDepartmentIds(record: Record<string, unknown>): string[] {
    const values = [record.depts, record.departments, record.deptIdList, record.dept_id_list];
    const ids = new Set<string>();
    for (const value of values) {
        if (!Array.isArray(value)) continue;
        for (const item of value) {
            const id = isRecord(item)
                ? externalId(item.deptId ?? item.dept_id ?? item.id)
                : externalId(item);
            if (id) ids.add(id === '-1' ? ROOT_DEPARTMENT_ID : id);
        }
    }
    return [...ids];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function externalId(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    return null;
}

function assertSafeIdentifier(value: string): void {
    if (!/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error('DWS 返回了不安全的组织标识');
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

function integerField(record: Record<string, unknown>, ...keys: string[]): number | null {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    }
    return null;
}

function booleanField(record: Record<string, unknown>, ...keys: string[]): boolean | null {
    for (const key of keys) {
        if (typeof record[key] === 'boolean') return record[key] as boolean;
    }
    return null;
}

function safeError(error: unknown): string {
    if (isRecord(error)) {
        const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
        const message = typeof error.message === 'string' ? error.message.trim() : '';
        const value = stderr || message;
        if (value) {
            return value
                .replace(/(?:access|refresh)?[_-]?token["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, 'token=[REDACTED]')
                .replace(/authorization\s*[:=]\s*bearer\s+\S+/gi, 'authorization=[REDACTED]')
                .slice(0, 500);
        }
    }
    return error instanceof Error ? error.message.slice(0, 500) : 'DWS 调用失败';
}
