import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT_DEPARTMENT_ID = '1';
const MAX_DEPARTMENTS = 5000;
const MAX_USERS = 20000;
let managedExecutablePath: string | null = null;

export type DingTalkConnectorState = 'NOT_INSTALLED' | 'AUTH_REQUIRED' | 'PROFILE_REQUIRED' | 'READY' | 'ERROR';
export type DingTalkConnectorRecoveryAction = 'INSTALL' | 'MANUAL_INSTALL' | 'AUTHORIZE' | 'SELECT_PROFILE' | 'RETRY' | 'NONE';

export interface DingTalkDwsProfile {
    profile: string;
    corpId: string | null;
    corpName: string | null;
    externalUserId: string | null;
    externalUserName: string | null;
    current: boolean;
    organizationCurrent: boolean;
}

export interface DwsFailureDetails {
    category: string | null;
    reason: string | null;
    retryable: boolean | null;
    retryAfterSeconds: number | null;
    hint: string | null;
}

class DingTalkDwsCommandError extends Error {
    constructor(message: string, readonly details: DwsFailureDetails) {
        super(message);
        this.name = 'DingTalkDwsCommandError';
    }
}

export function configureDingTalkDwsExecutable(executablePath: string): void {
    managedExecutablePath = executablePath;
}

export interface DingTalkDwsStatus {
    state: DingTalkConnectorState;
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
    profiles: DingTalkDwsProfile[];
    checkedAt: string;
    issueCode: string | null;
    recoveryAction: DingTalkConnectorRecoveryAction;
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
    const checkedAt = new Date().toISOString();
    let version: string;
    try {
        version = (await runDws(['--version'], 15_000)).trim();
    } catch (error) {
        if (!isDwsMissingError(error)) {
            const issue = classifyDwsIssue(error);
            return disconnectedStatus({
                state: issue.state,
                version: null,
                checkedAt,
                issueCode: issue.code,
                recoveryAction: issue.recoveryAction,
                error: safeError(error),
            });
        }
        return {
            state: 'NOT_INSTALLED',
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
            profiles: [],
            checkedAt,
            issueCode: 'DWS_NOT_INSTALLED',
            recoveryAction: process.platform === 'win32' ? 'INSTALL' : 'MANUAL_INSTALL',
            error: safeError(error),
        };
    }
    try {
        const authStatus = await runDwsJson(['auth', 'status', '--format', 'json'], 30_000);
        if (!isAuthenticatedPayload(authStatus)) {
            return disconnectedStatus({
                state: 'AUTH_REQUIRED',
                version,
                checkedAt,
                issueCode: 'DWS_AUTH_REQUIRED',
                recoveryAction: 'AUTHORIZE',
                error: authStatusMessage(authStatus) ?? 'DWS 当前账号未完成授权',
            });
        }
        const profiles = await runDwsJson(['profile', 'list', '--format', 'json'], 30_000);
        const availableProfiles = listDingTalkDwsProfiles(profiles);
        let profile: Record<string, unknown>;
        try {
            profile = selectCurrentProfile(profiles);
        } catch (error) {
            return disconnectedStatus({
                state: 'PROFILE_REQUIRED',
                version,
                checkedAt,
                profiles: availableProfiles,
                issueCode: 'DWS_PROFILE_REQUIRED',
                recoveryAction: 'SELECT_PROFILE',
                error: safeError(error),
            });
        }
        return {
            state: 'READY',
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
            profiles: availableProfiles,
            checkedAt,
            issueCode: null,
            recoveryAction: 'NONE',
            error: null,
        };
    } catch (error) {
        const issue = classifyDwsIssue(error);
        return disconnectedStatus({
            state: issue.state,
            version,
            checkedAt,
            issueCode: issue.code,
            recoveryAction: issue.recoveryAction,
            error: safeError(error),
        });
    }
}

export async function loginDingTalkDws(): Promise<DingTalkDwsStatus> {
    await runDws(['auth', 'login'], 5 * 60_000);
    return getDingTalkDwsStatus();
}

export function dingTalkLogoutArguments(): string[] {
    return ['auth', 'logout', '-y'];
}

export async function logoutDingTalkDws(): Promise<DingTalkDwsStatus> {
    await runDws(dingTalkLogoutArguments(), 30_000);
    return getDingTalkDwsStatus();
}

export async function selectDingTalkDwsProfile(profile: string): Promise<DingTalkDwsStatus> {
    const normalized = profile.trim();
    if (!normalized) throw new Error('请选择钉钉组织账号');
    assertSafeIdentifier(normalized);
    const profilesPayload = await runDwsJson(['profile', 'list', '--format', 'json'], 30_000);
    const profiles = listDingTalkDwsProfiles(profilesPayload);
    if (!profiles.some((item) => item.profile === normalized)) {
        throw new Error('选择的钉钉组织账号已不存在，请刷新后重试');
    }
    await runDws(['profile', 'switch', normalized], 30_000);
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
        for (const user of parseDingTalkUserRecords(payload)) {
            if (users.some((item) => item.externalUserId === user.externalUserId)) continue;
            users.push(user);
        }
    }
    return users;
}

export function parseDingTalkUserRecords(payload: unknown): DingTalkDwsSnapshot['users'] {
    const users: DingTalkDwsSnapshot['users'] = [];
    for (const raw of collectRecords(payload)) {
        const record = isRecord(raw.orgEmployeeModel) ? raw.orgEmployeeModel : raw;
        const externalUserId = externalId(record.orgUserId ?? record.userId ?? record.userid ?? record.staffId ?? record.externalUserId);
        const name = stringField(record, 'orgUserName', 'name', 'userName');
        if (!externalUserId || !name || users.some((user) => user.externalUserId === externalUserId)) continue;
        users.push({
            externalUserId,
            unionId: stringField(record, 'unionId', 'unionid'),
            name,
            title: stringField(record, 'orgTitle', 'title', 'position'),
            jobNumber: stringField(record, 'jobNumber', 'job_number', 'jobNo'),
            departmentExternalIds: extractDepartmentIds(record),
            active: booleanField(record, 'active', 'isActive') ?? true,
            admin: booleanField(raw, 'admin', 'isAdmin') ?? booleanField(record, 'admin', 'isAdmin') ?? false,
            boss: booleanField(raw, 'boss', 'isBoss') ?? booleanField(record, 'boss', 'isBoss') ?? false,
        });
    }
    return users;
}

export async function runDwsJson(
    args: string[],
    timeout: number,
    envOverrides: NodeJS.ProcessEnv = {},
): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            return parseJsonOutput(await runDws(args, timeout, envOverrides));
        } catch (error) {
            const delayMs = dwsRetryDelayMilliseconds(error);
            if (attempt > 0 || delayMs === null) throw error;
            await delay(delayMs);
        }
    }
    throw new Error('DWS 查询重试失败');
}

export async function readDingTalkDwsSchema(cliPath?: string): Promise<unknown> {
    const args = cliPath
        ? ['schema', '--cli-path', cliPath, '--compact', '--format', 'json']
        : ['schema', '--all', '--compact', '--format', 'json'];
    return runDwsJson(args, 60_000);
}

export async function runDws(
    args: string[],
    timeout: number,
    envOverrides: NodeJS.ProcessEnv = {},
): Promise<string> {
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
            env: {
                ...process.env,
                ...envOverrides,
            },
        });
        return result.stdout;
    } catch (error) {
        throw new DingTalkDwsCommandError(safeError(error), parseDwsFailureDetails(error));
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

export function listDingTalkDwsProfiles(payload: unknown): DingTalkDwsProfile[] {
    const profiles = collectRecords(payload).filter((record) => stringField(record, 'profile'));
    const result = new Map<string, DingTalkDwsProfile>();
    for (const record of profiles) {
        const profile = stringField(record, 'profile');
        if (!profile || result.has(profile)) continue;
        result.set(profile, {
            profile,
            corpId: externalId(record.corpId ?? record.orgId ?? record.organizationId),
            corpName: stringField(record, 'corpName', 'orgName', 'organizationName'),
            externalUserId: externalId(record.userId ?? record.staffId ?? record.externalUserId),
            externalUserName: stringField(record, 'userName', 'name'),
            current: record.isCurrent === true || record.current === true,
            organizationCurrent: record.isOrgCurrent === true,
        });
    }
    return [...result.values()];
}

function disconnectedStatus(input: {
    state: Exclude<DingTalkConnectorState, 'NOT_INSTALLED' | 'READY'>;
    version: string | null;
    checkedAt: string;
    profiles?: DingTalkDwsProfile[];
    issueCode: string;
    recoveryAction: Exclude<DingTalkConnectorRecoveryAction, 'INSTALL' | 'MANUAL_INSTALL' | 'NONE'>;
    error: string;
}): DingTalkDwsStatus {
    return {
        state: input.state,
        installed: true,
        authenticated: false,
        source: resolveDwsExecutable().source,
        installSupported: process.platform === 'win32',
        version: input.version,
        profile: null,
        corpId: null,
        corpName: null,
        externalUserId: null,
        externalUserName: null,
        profiles: input.profiles ?? [],
        checkedAt: input.checkedAt,
        issueCode: input.issueCode,
        recoveryAction: input.recoveryAction,
        error: input.error,
    };
}

function classifyDwsIssue(error: unknown): {
    state: 'AUTH_REQUIRED' | 'PROFILE_REQUIRED' | 'ERROR';
    code: string;
    recoveryAction: 'AUTHORIZE' | 'SELECT_PROFILE' | 'RETRY';
} {
    const details = dwsFailureDetails(error);
    const message = safeError(error).toLowerCase();
    if (details.category === 'auth' || details.reason === 'auth_refresh_failed'
        || /未授权|未完成授权|logged[_ -]?out|expired|auth[_ -]?refresh[_ -]?failed|unauthenticated/.test(message)) {
        return { state: 'AUTH_REQUIRED', code: 'DWS_AUTH_REQUIRED', recoveryAction: 'AUTHORIZE' };
    }
    if (/多个.*组织|multiple.*profile|选择.*组织|profile.*(required|ambiguous)/.test(message)) {
        return { state: 'PROFILE_REQUIRED', code: 'DWS_PROFILE_REQUIRED', recoveryAction: 'SELECT_PROFILE' };
    }
    if (/timed out|timeout|etimedout/.test(message)) {
        return { state: 'ERROR', code: 'DWS_TIMEOUT', recoveryAction: 'RETRY' };
    }
    return { state: 'ERROR', code: 'DWS_UNAVAILABLE', recoveryAction: 'RETRY' };
}

export function parseDwsFailureDetails(error: unknown): DwsFailureDetails {
    if (error instanceof DingTalkDwsCommandError) return error.details;
    const raw = isRecord(error) && typeof error.stderr === 'string'
        ? error.stderr
        : error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const payload = tryParseJsonFragment(raw);
    const record = isRecord(payload) && isRecord(payload.error) ? payload.error : isRecord(payload) ? payload : {};
    const retryAfter = record.retry_after_seconds ?? record.retryAfterSeconds;
    return {
        category: stringField(record, 'category'),
        reason: stringField(record, 'reason'),
        retryable: typeof record.retryable === 'boolean' ? record.retryable : null,
        retryAfterSeconds: typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
        hint: stringField(record, 'hint'),
    };
}

function dwsFailureDetails(error: unknown): DwsFailureDetails {
    return error instanceof DingTalkDwsCommandError ? error.details : parseDwsFailureDetails(error);
}

export function dwsRetryDelayMilliseconds(error: unknown): number | null {
    const details = dwsFailureDetails(error);
    if (details.retryable !== true) return null;
    const delayMs = details.retryAfterSeconds === null ? 250 : details.retryAfterSeconds * 1000;
    return delayMs <= 5000 ? delayMs : null;
}

function tryParseJsonFragment(value: string): unknown {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const candidates = [trimmed, ...trimmed.split(/\r?\n/).reverse()];
    const objectStart = trimmed.indexOf('{');
    if (objectStart >= 0) candidates.push(trimmed.slice(objectStart));
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate) as unknown;
        } catch {
            continue;
        }
    }
    return null;
}

function isDwsMissingError(error: unknown): boolean {
    const message = safeError(error).toLowerCase();
    return /enoent|not recognized|not found|找不到|无法找到|no such file/.test(message);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function authStatusMessage(payload: unknown): string | null {
    for (const record of collectRecords(payload)) {
        const hint = stringField(record, 'hint', 'message', 'reason');
        if (hint) return hint.slice(0, 500);
    }
    return null;
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
    if (records.some((record) => record.category === 'auth'
        || record.reason === 'auth_refresh_failed'
        || record.authenticated === false
        || record.isAuthenticated === false
        || record.loggedIn === false)) return false;
    const explicit = records.find((record) =>
        typeof record.authenticated === 'boolean'
        || typeof record.isAuthenticated === 'boolean'
        || typeof record.loggedIn === 'boolean'
        || typeof record.status === 'string',
    );
    if (!explicit) return true;
    if (typeof explicit.status === 'string' && ['unauthenticated', 'logged_out', 'expired', 'failed', 'error', '未授权'].includes(explicit.status.toLowerCase())) {
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
