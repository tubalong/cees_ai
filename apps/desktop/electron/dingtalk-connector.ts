import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
    ConnectorContext,
    ConnectorPlannedCall,
    ConnectorTool,
} from './connectors/core/connector.types';
export { DINGTALK_CONNECTOR_MANIFEST } from './connectors/dingtalk/dingtalk.manifest';
import {
    configureDingTalkDwsExecutable,
    fetchDingTalkVisibleOrganization,
    getDingTalkDwsStatus,
    loginDingTalkDws,
    readDingTalkDwsSchema,
    runDws,
    runDwsJson,
    type DingTalkDwsSnapshot,
    type DingTalkDwsStatus,
} from './dingtalk-dws';

const execFileAsync = promisify(execFile);
const DWS_VERSION = 'v1.0.62';
const DWS_INSTALLER_URL = `https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/${DWS_VERSION}/scripts/install.ps1`;
const DWS_INSTALLER_SHA256 = 'bebc585dfe53d7c77cb10096c3ae9e9311a766b57dcd4c4556c50e7251721955';
const DWS_STABLE_VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;
const DWS_OFFICIAL_RELEASE_ENV: NodeJS.ProcessEnv = {
    DWS_UPGRADE_URL: 'https://api.github.com',
    DWS_UPGRADE_REPOSITORY: 'DingTalk-Real-AI/dingtalk-workspace-cli',
    DWS_NO_SKILLS: '1',
};
const MAX_CONTEXT_BYTES = 56 * 1024;
const MAX_VISIBLE_ORGANIZATION_CONTEXT_BYTES = 40 * 1024;
const MAX_VISIBLE_ORGANIZATION_DEPARTMENT_BYTES = 16 * 1024;
const MAX_TOOL_COUNT = 1500;
const MAX_CALLS = 3;
const TOOL_ID_PATTERN = /^dws_read_[a-f0-9]{16}$/;
const UNSAFE_PARAMETER_PATTERN = /(?:token|secret|cookie|authorization|credential|password|app[-_]?key|app[-_]?secret)/i;
const CONTROL_PARAMETERS = new Set(['help', 'format', 'output', 'jq', 'fields', 'dry-run', 'confirm', 'confirmed', 'force', 'yes']);
const ATTENDANCE_RECORD_TOOL_NAMES = new Set([
    'attendance.shortcut_my_attendance',
    'attendance.shortcut_check_record',
]);
const VISIBLE_ORGANIZATION_TOOL_ID = `dws_read_${createHash('sha256').update('cees.visible.organization').digest('hex').slice(0, 16)}`;
const MY_ATTENDANCE_APPROVALS_TOOL_ID = `dws_read_${createHash('sha256').update('cees.my.attendance.approvals').digest('hex').slice(0, 16)}`;
const MY_ATTENDANCE_RECORDS_TOOL_ID = `dws_read_${createHash('sha256').update('cees.my.attendance.records').digest('hex').slice(0, 16)}`;

let installRoot: string | null = null;
let installPromise: Promise<DingTalkDwsStatus> | null = null;
let releaseOperationPromise: Promise<DingTalkConnectorReleaseResult> | null = null;

export type DingTalkConnectorContext = ConnectorContext<'DINGTALK'>;

export type DingTalkConnectorTool = ConnectorTool;

export type DingTalkConnectorPlannedCall = ConnectorPlannedCall;

export interface NormalizedDingTalkAttendanceRecord {
    id: string | null;
    userId: string | null;
    workDate: string | null;
    checkType: string | null;
    actualCheckTime: string | null;
    actualCheckTimeLocal: string | null;
    baseCheckTime: string | null;
    baseCheckTimeLocal: string | null;
    status: string | null;
    sourceFields: Record<string, string>;
}

export interface DingTalkConnectorReleaseStatus {
    version: string;
    license: string;
    channel: 'stable';
    installedVersion: string | null;
    latestVersion: string | null;
    updateAvailable: boolean;
    checkSupported: boolean;
    upgradeSupported: boolean;
    rollbackAvailable: boolean;
    rollbackVersion: string | null;
    checkedAt: string | null;
    releaseDate: string | null;
    releaseUrl: string | null;
    changelog: string[];
    error: string | null;
    lastOperation: DingTalkConnectorReleaseOperation | null;
}

export interface DingTalkConnectorReleaseResult {
    release: DingTalkConnectorReleaseStatus;
    status: DingTalkDwsStatus;
}

export interface DingTalkConnectorReleaseOperation {
    type: 'UPGRADE' | 'ROLLBACK';
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ROLLED_BACK';
    fromVersion: string | null;
    targetVersion: string | null;
    startedAt: string;
    completedAt: string | null;
    message: string | null;
}

interface PersistedDingTalkReleaseState {
    latestVersion?: string;
    checkedAt?: string;
    releaseDate?: string;
    releaseUrl?: string;
    changelog?: string[];
    rollbackAvailable?: boolean;
    rollbackVersion?: string;
    lastOperation?: DingTalkConnectorReleaseOperation;
}

export interface DiscoveredDwsTool extends ConnectorTool {
    cliPath: string;
    rawParameters: Record<string, DwsParameter>;
    positionals: DwsPositional[];
}

interface DwsParameter {
    type?: string;
    description?: string;
    required?: boolean;
    cli_required?: boolean;
    required_when?: string;
    default?: unknown;
    format?: string;
    enum?: unknown[];
    anyOf?: Array<Record<string, unknown>>;
}

interface DwsPositional {
    name?: string;
    type?: string;
    description?: string;
    required?: boolean;
    variadic?: boolean;
    index?: number;
}

let discoveredTools = new Map<string, DiscoveredDwsTool>();

export function resetDingTalkConnectorTools(): void {
    discoveredTools.clear();
}

export function configureDingTalkConnector(userDataPath: string): void {
    installRoot = path.join(userDataPath, 'connectors', 'dingtalk');
    configureDingTalkDwsExecutable(path.join(installRoot, 'bin', 'dws.exe'));
}

export async function getDingTalkConnectorRelease(): Promise<DingTalkConnectorReleaseStatus> {
    const [status, state] = await Promise.all([getDingTalkDwsStatus(), readReleaseState()]);
    return buildReleaseStatus(status, state);
}

export async function checkDingTalkConnectorUpdate(): Promise<DingTalkConnectorReleaseStatus> {
    const status = await requireInstalledDws();
    try {
        const payload = await runDwsJson(
            ['upgrade', '--check', '--format', 'json'],
            60_000,
            DWS_OFFICIAL_RELEASE_ENV,
        );
        const check = parseDingTalkUpgradeCheck(payload);
        const state = await readReleaseState();
        const nextState: PersistedDingTalkReleaseState = {
            ...state,
            latestVersion: check.latestVersion,
            checkedAt: new Date().toISOString(),
            releaseDate: check.releaseDate ?? undefined,
            releaseUrl: check.releaseUrl ?? undefined,
            changelog: check.changelog,
        };
        await writeReleaseState(nextState);
        return buildReleaseStatus(status, nextState);
    } catch (error) {
        const state = await readReleaseState();
        return buildReleaseStatus(status, state, safeOperationError(error));
    }
}

export async function upgradeDingTalkConnector(targetVersion?: string): Promise<DingTalkConnectorReleaseResult> {
    return runReleaseOperation(async () => {
        const before = await requireManagedDws();
        const fromVersion = normalizeDwsVersion(before.version);
        if (!fromVersion) throw new Error('无法识别当前 DWS 版本');
        const checked = await checkDingTalkConnectorUpdate();
        if (checked.error) throw new Error(checked.error);
        const target = targetVersion?.trim() || checked.latestVersion;
        if (!target || !DWS_STABLE_VERSION_PATTERN.test(target)) throw new Error('没有可用的 DWS 正式版本');
        if (target !== checked.latestVersion) throw new Error('只能升级到刚刚检查到的最新稳定版本');
        if (compareDwsVersions(fromVersion, target) >= 0) throw new Error(`当前已是最新稳定版本 ${fromVersion}`);

        const startedAt = new Date().toISOString();
        let state = await readReleaseState();
        state = {
            ...state,
            lastOperation: releaseOperation('UPGRADE', 'RUNNING', fromVersion, target, startedAt),
        };
        await writeReleaseState(state);
        try {
            await runDws(
                ['upgrade', '--version', target, '--skip-skills', '-y'],
                10 * 60_000,
                DWS_OFFICIAL_RELEASE_ENV,
            );
            const status = await verifyManagedDwsHealth(target);
            const nextState: PersistedDingTalkReleaseState = {
                ...state,
                rollbackAvailable: true,
                rollbackVersion: fromVersion,
                lastOperation: releaseOperation('UPGRADE', 'SUCCEEDED', fromVersion, target, startedAt, '升级和健康检查已完成'),
            };
            await writeReleaseState(nextState);
            resetDingTalkConnectorTools();
            return { release: buildReleaseStatus(status, nextState), status };
        } catch (upgradeError) {
            const upgradeMessage = safeOperationError(upgradeError);
            try {
                await runDws(
                    ['upgrade', '--rollback', '-y'],
                    5 * 60_000,
                    DWS_OFFICIAL_RELEASE_ENV,
                );
                await verifyManagedDwsHealth(fromVersion);
            } catch (rollbackError) {
                const failedState: PersistedDingTalkReleaseState = {
                    ...state,
                    rollbackAvailable: true,
                    rollbackVersion: fromVersion,
                    lastOperation: releaseOperation('UPGRADE', 'FAILED', fromVersion, target, startedAt, `升级失败且自动回滚失败：${safeOperationError(rollbackError)}`),
                };
                await writeReleaseState(failedState);
                throw new Error(`DWS 升级失败且自动回滚失败，请手动回滚：${upgradeMessage}`);
            }
            const rollbackState: PersistedDingTalkReleaseState = {
                ...state,
                rollbackAvailable: false,
                rollbackVersion: undefined,
                lastOperation: releaseOperation('UPGRADE', 'ROLLED_BACK', fromVersion, target, startedAt, `升级失败，已自动回滚：${upgradeMessage}`),
            };
            await writeReleaseState(rollbackState);
            resetDingTalkConnectorTools();
            throw new Error(`DWS 升级失败，已自动回滚到 ${fromVersion}：${upgradeMessage}`);
        }
    });
}

export async function rollbackDingTalkConnector(): Promise<DingTalkConnectorReleaseResult> {
    return runReleaseOperation(async () => {
        const before = await requireManagedDws();
        const currentVersion = normalizeDwsVersion(before.version);
        const state = await readReleaseState();
        const targetVersion = state.rollbackVersion ?? null;
        if (!state.rollbackAvailable || !targetVersion) throw new Error('当前没有由 CEES 升级流程创建的可用回滚版本');
        const startedAt = new Date().toISOString();
        const runningState: PersistedDingTalkReleaseState = {
            ...state,
            lastOperation: releaseOperation('ROLLBACK', 'RUNNING', currentVersion, targetVersion, startedAt),
        };
        await writeReleaseState(runningState);
        try {
            await runDws(
                ['upgrade', '--rollback', '-y'],
                5 * 60_000,
                DWS_OFFICIAL_RELEASE_ENV,
            );
            const status = await verifyManagedDwsHealth(targetVersion);
            const nextState: PersistedDingTalkReleaseState = {
                ...runningState,
                rollbackAvailable: false,
                rollbackVersion: undefined,
                lastOperation: releaseOperation('ROLLBACK', 'SUCCEEDED', currentVersion, targetVersion, startedAt, '已回滚并通过健康检查'),
            };
            await writeReleaseState(nextState);
            resetDingTalkConnectorTools();
            return { release: buildReleaseStatus(status, nextState), status };
        } catch (error) {
            const failedState: PersistedDingTalkReleaseState = {
                ...runningState,
                rollbackAvailable: true,
                rollbackVersion: targetVersion,
                lastOperation: releaseOperation('ROLLBACK', 'FAILED', currentVersion, targetVersion, startedAt, safeOperationError(error)),
            };
            await writeReleaseState(failedState);
            throw error;
        }
    });
}

export function parseDingTalkUpgradeCheck(payload: unknown): {
    currentVersion: string;
    latestVersion: string;
    needsUpgrade: boolean;
    releaseDate: string | null;
    releaseUrl: string | null;
    changelog: string[];
} {
    if (!isRecord(payload)) throw new Error('DWS 更新检查返回格式无效');
    const currentVersion = normalizeDwsVersion(payload.current_version);
    const latestRaw = typeof payload.latest_version === 'string' ? payload.latest_version.trim() : '';
    const latestVersion = /^v?\d+\.\d+\.\d+$/.test(latestRaw)
        ? normalizeDwsVersion(latestRaw)
        : null;
    if (!currentVersion || !latestVersion || !DWS_STABLE_VERSION_PATTERN.test(latestVersion)) {
        throw new Error('DWS 更新检查未返回有效的正式版本');
    }
    if (payload.prerelease === true || payload.track && payload.track !== 'release') {
        throw new Error('CEES 只允许使用 DWS 正式稳定版本');
    }
    return {
        currentVersion,
        latestVersion,
        needsUpgrade: payload.needs_upgrade === true,
        releaseDate: typeof payload.release_date === 'string' && payload.release_date.trim() ? payload.release_date.trim() : null,
        releaseUrl: typeof payload.release_url === 'string' && /^https:\/\/github\.com\/DingTalk-Real-AI\/dingtalk-workspace-cli\/releases\//.test(payload.release_url)
            ? payload.release_url
            : null,
        changelog: Array.isArray(payload.changelog)
            ? payload.changelog.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 10).map((item) => item.slice(0, 500))
            : [],
    };
}

export function normalizeDwsVersion(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = value.match(/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
    return match ? `v${match[1]}` : null;
}

export function compareDwsVersions(left: string, right: string): number {
    const leftVersion = parseVersionParts(left);
    const rightVersion = parseVersionParts(right);
    for (let index = 0; index < 3; index += 1) {
        if (leftVersion.parts[index] !== rightVersion.parts[index]) {
            return leftVersion.parts[index]! < rightVersion.parts[index]! ? -1 : 1;
        }
    }
    if (!leftVersion.prerelease && !rightVersion.prerelease) return 0;
    if (!leftVersion.prerelease) return 1;
    if (!rightVersion.prerelease) return -1;
    return leftVersion.prerelease.localeCompare(rightVersion.prerelease, 'en', { numeric: true });
}

function parseVersionParts(version: string): { parts: [number, number, number]; prerelease: string } {
    const normalized = normalizeDwsVersion(version);
    if (!normalized) throw new Error(`DWS 版本格式无效：${version}`);
    const [core, prerelease = ''] = normalized.slice(1).split('-', 2);
    const parts = core!.split('.').map(Number);
    return { parts: [parts[0]!, parts[1]!, parts[2]!], prerelease };
}

function buildReleaseStatus(
    status: DingTalkDwsStatus,
    state: PersistedDingTalkReleaseState,
    error: string | null = null,
): DingTalkConnectorReleaseStatus {
    const installedVersion = normalizeDwsVersion(status.version);
    const latestVersion = normalizeDwsVersion(state.latestVersion);
    const managed = process.platform === 'win32' && status.source === 'MANAGED';
    return {
        version: DWS_VERSION,
        license: 'Apache-2.0',
        channel: 'stable',
        installedVersion,
        latestVersion,
        updateAvailable: Boolean(installedVersion && latestVersion && compareDwsVersions(installedVersion, latestVersion) < 0),
        checkSupported: status.installed,
        upgradeSupported: managed,
        rollbackAvailable: managed && state.rollbackAvailable === true && Boolean(state.rollbackVersion),
        rollbackVersion: normalizeDwsVersion(state.rollbackVersion),
        checkedAt: state.checkedAt ?? null,
        releaseDate: state.releaseDate ?? null,
        releaseUrl: state.releaseUrl ?? null,
        changelog: Array.isArray(state.changelog) ? state.changelog.slice(0, 10) : [],
        error,
        lastOperation: state.lastOperation ?? null,
    };
}

async function requireInstalledDws(): Promise<DingTalkDwsStatus> {
    const status = await getDingTalkDwsStatus();
    if (!status.installed) throw new Error('请先安装 DWS 再检查更新');
    return status;
}

async function requireManagedDws(): Promise<DingTalkDwsStatus> {
    const status = await requireInstalledDws();
    if (process.platform !== 'win32' || status.source !== 'MANAGED') {
        throw new Error('CEES 只能升级由连接器管理的 Windows DWS');
    }
    return status;
}

async function verifyManagedDwsHealth(expectedVersion: string): Promise<DingTalkDwsStatus> {
    const versionOutput = await runDws(['--version'], 30_000);
    const actualVersion = normalizeDwsVersion(versionOutput);
    if (actualVersion !== expectedVersion) {
        throw new Error(`升级后版本不匹配，期望 ${expectedVersion}，实际 ${actualVersion ?? '未知'}`);
    }
    const schema = await readDingTalkDwsSchema();
    if (!isRecord(schema)) throw new Error('升级后 DWS Schema 健康检查失败');
    return getDingTalkDwsStatus();
}

async function runReleaseOperation(
    operation: () => Promise<DingTalkConnectorReleaseResult>,
): Promise<DingTalkConnectorReleaseResult> {
    if (releaseOperationPromise) return releaseOperationPromise;
    releaseOperationPromise = operation();
    try {
        return await releaseOperationPromise;
    } finally {
        releaseOperationPromise = null;
    }
}

function releaseOperation(
    type: DingTalkConnectorReleaseOperation['type'],
    status: DingTalkConnectorReleaseOperation['status'],
    fromVersion: string | null,
    targetVersion: string | null,
    startedAt: string,
    message: string | null = null,
): DingTalkConnectorReleaseOperation {
    return {
        type,
        status,
        fromVersion,
        targetVersion,
        startedAt,
        completedAt: status === 'RUNNING' ? null : new Date().toISOString(),
        message,
    };
}

async function readReleaseState(): Promise<PersistedDingTalkReleaseState> {
    if (!installRoot) return {};
    try {
        const raw = await readFile(path.join(installRoot, 'release-state.json'), 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        return isRecord(parsed) ? parsed as PersistedDingTalkReleaseState : {};
    } catch {
        return {};
    }
}

async function writeReleaseState(state: PersistedDingTalkReleaseState): Promise<void> {
    if (!installRoot) throw new Error('DWS 连接器安装目录尚未初始化');
    await mkdir(installRoot, { recursive: true });
    const statePath = path.join(installRoot, 'release-state.json');
    const tempPath = path.join(installRoot, `release-state-${randomUUID()}.json`);
    try {
        await writeFile(tempPath, JSON.stringify(state, null, 2), { encoding: 'utf8', flag: 'wx' });
        await rm(statePath, { force: true });
        await rename(tempPath, statePath);
    } finally {
        await rm(tempPath, { force: true });
    }
}

function safeOperationError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? 'DWS 版本操作失败');
    return message
        .replace(/(?:access|refresh)?[_-]?token["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, 'token=[REDACTED]')
        .replace(/authorization\s*[:=]\s*bearer\s+\S+/gi, 'authorization=[REDACTED]')
        .slice(0, 1000);
}

export async function installAndAuthorizeDingTalkConnector(): Promise<DingTalkDwsStatus> {
    if (installPromise) return installPromise;
    installPromise = installAndAuthorize();
    try {
        return await installPromise;
    } finally {
        installPromise = null;
    }
}

async function installAndAuthorize(): Promise<DingTalkDwsStatus> {
    const current = await getDingTalkDwsStatus();
    if (!current.installed || (process.platform === 'win32' && current.source !== 'MANAGED')) await installDws();
    const status = await loginDingTalkDws();
    resetDingTalkConnectorTools();
    return status;
}

async function installDws(): Promise<void> {
    if (process.platform !== 'win32') throw new Error('当前版本仅支持在 Windows 中一键安装 DWS');
    if (!installRoot) throw new Error('DWS 连接器安装目录尚未初始化');
    const installDir = path.join(installRoot, 'bin');
    const tempDir = path.join(installRoot, 'temp');
    await mkdir(installDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });
    const installerPath = path.join(tempDir, `install-${randomUUID()}.ps1`);
    try {
        const response = await fetch(DWS_INSTALLER_URL, { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
        if (!response.ok) throw new Error(`下载安装组件失败（HTTP ${response.status}）`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== DWS_INSTALLER_SHA256) throw new Error('DWS 官方安装组件完整性校验失败');
        await writeFile(installerPath, bytes, { flag: 'wx' });
        const persisted = await readFile(installerPath);
        if (createHash('sha256').update(persisted).digest('hex') !== DWS_INSTALLER_SHA256) {
            throw new Error('DWS 安装组件落盘后完整性校验失败');
        }
        await execFileAsync('powershell.exe', [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            installerPath,
        ], {
            encoding: 'utf8',
            timeout: 10 * 60_000,
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
            env: {
                ...process.env,
                DWS_INSTALL_DIR: installDir,
                DWS_VERSION,
                DWS_NO_SKILLS: '1',
            },
        });
    } finally {
        await rm(installerPath, { force: true });
    }
    const status = await getDingTalkDwsStatus();
    if (!status.installed || status.source !== 'MANAGED') throw new Error('DWS 安装完成后未找到受管可执行文件');
}

export async function discoverDingTalkReadTools(): Promise<DingTalkConnectorTool[]> {
    const status = await getDingTalkDwsStatus();
    if (!status.installed) throw new Error('请先在连接器页面安装钉钉连接器');
    if (process.platform === 'win32' && status.source !== 'MANAGED') {
        throw new Error('请在连接器页面使用一键安装的受管 DWS 后重试');
    }
    if (status.state === 'PROFILE_REQUIRED') throw new Error('请先在连接器页面选择当前钉钉组织');
    if (status.state !== 'READY') throw new Error(status.error || '请先在连接器页面完成钉钉授权');
    const tools = buildDingTalkReadToolCatalog(await readDingTalkDwsSchema());
    discoveredTools = new Map(tools.map((tool) => [tool.toolId, tool]));
    return tools.map(({ toolId, name, description, parameters }) => ({ toolId, name, description, parameters }));
}

export async function executeDingTalkReadCalls(calls: DingTalkConnectorPlannedCall[]): Promise<DingTalkConnectorContext[]> {
    if (!Array.isArray(calls) || calls.length > MAX_CALLS) throw new Error('钉钉连接器调用计划无效');
    if (discoveredTools.size === 0 && calls.length > 0) await discoverDingTalkReadTools();
    const contexts: DingTalkConnectorContext[] = [];
    for (const call of calls) {
        if (!TOOL_ID_PATTERN.test(call.toolId) || !isRecord(call.arguments)) throw new Error('钉钉连接器调用计划无效');
        const tool = discoveredTools.get(call.toolId);
        if (!tool) throw new Error('钉钉 DWS 工具目录已变化，请重试');
        if (call.toolId === VISIBLE_ORGANIZATION_TOOL_ID) {
            const snapshot = await fetchDingTalkVisibleOrganization();
            contexts.push(connectorContext(tool, buildVisibleOrganizationContextData(snapshot)));
            continue;
        }
        if (call.toolId === MY_ATTENDANCE_RECORDS_TOOL_ID) {
            const status = await getDingTalkDwsStatus();
            if (!status.externalUserId) throw new Error('DWS 当前 Profile 未返回用户 ID');
            const args = buildPersonalAttendanceRecordArguments(status.externalUserId, call.arguments);
            const payload = await runDwsJson(args, 60_000);
            contexts.push(connectorContext(tool, normalizeDingTalkAttendanceContext(payload)));
            continue;
        }
        if (call.toolId === MY_ATTENDANCE_APPROVALS_TOOL_ID) {
            const status = await getDingTalkDwsStatus();
            if (!status.externalUserId) throw new Error('DWS 当前 Profile 未返回用户 ID');
            const args = buildPersonalAttendanceApprovalArguments(status.externalUserId, call.arguments);
            const payload = await runDwsJson(args, 60_000);
            contexts.push(connectorContext(tool, sanitizeConnectorData(payload)));
            continue;
        }
        const current = parseDingTalkReadTools(await readDingTalkDwsSchema(tool.cliPath))
            .find((item) => item.toolId === call.toolId && item.name === tool.name && item.cliPath === tool.cliPath);
        if (!current) throw new Error('钉钉 DWS 工具安全属性已变化，已拒绝执行');
        const args = buildDwsArguments(current, call.arguments);
        const payload = await runDwsJson(args, 60_000);
        const data = ATTENDANCE_RECORD_TOOL_NAMES.has(current.name)
            ? normalizeDingTalkAttendanceContext(payload)
            : sanitizeConnectorData(payload);
        contexts.push(connectorContext(current, data));
    }
    if (Buffer.byteLength(JSON.stringify(contexts), 'utf8') > MAX_CONTEXT_BYTES) {
        throw new Error('钉钉连接器返回数据过多，请缩小查询范围');
    }
    return contexts;
}

function connectorContext(tool: DiscoveredDwsTool, data: Record<string, unknown>): DingTalkConnectorContext {
    return {
        provider: 'DINGTALK',
        toolId: tool.toolId,
        toolName: tool.name,
        fetchedAt: new Date().toISOString(),
        data,
        // DWS 只暴露 effect=read 且 confirmation=not_required 的工具，因此固定为只读。
        riskLevel: 'READ',
    };
}

export function parseDingTalkReadTools(payload: unknown): DiscoveredDwsTool[] {
    const records = schemaToolRecords(payload);
    const tools: DiscoveredDwsTool[] = [];
    const ids = new Set<string>();
    for (const record of records) {
        if (record.effect !== 'read' || record.confirmation !== 'not_required' || record.availability !== 'available') continue;
        const canonicalPath = stringValue(record.canonical_path);
        const cliPath = stringValue(record.primary_cli_path) ?? stringValue(record.cli_path);
        if (!canonicalPath || !cliPath || !isSafeCliPath(cliPath)) continue;
        const rawParameters = parameterMap(record.parameters);
        const positionals = positionalList(record.positionals);
        if (hasRequiredSensitiveParameter(rawParameters, positionals)) continue;
        const toolId = `dws_read_${createHash('sha256').update(canonicalPath).digest('hex').slice(0, 16)}`;
        if (ids.has(toolId)) throw new Error('DWS Schema 生成了重复工具 ID');
        ids.add(toolId);
        const description = [record.agent_summary, record.description, record.title]
            .map(stringValue)
            .find(Boolean) ?? canonicalPath;
        tools.push({
            toolId,
            name: canonicalPath,
            cliPath,
            description: description.slice(0, 2000),
            parameters: toJsonSchema(rawParameters, positionals),
            rawParameters,
            positionals,
        });
        if (tools.length > MAX_TOOL_COUNT) throw new Error('DWS 只读工具数量超过安全上限');
    }
    return tools;
}

export function buildDingTalkReadToolCatalog(payload: unknown): DiscoveredDwsTool[] {
    return [
        ...parseDingTalkReadTools(payload),
        createVisibleOrganizationTool(),
        createPersonalAttendanceRecordsTool(),
        createPersonalAttendanceApprovalsTool(),
    ];
}

function createVisibleOrganizationTool(): DiscoveredDwsTool {
    return {
        toolId: VISIBLE_ORGANIZATION_TOOL_ID,
        name: 'cees.visible_organization',
        cliPath: 'cees visible organization',
        description: '读取当前钉钉账号可见的完整部门树和人员列表，包含递归部门、部门成员和人员详情',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        rawParameters: {},
        positionals: [],
    };
}

export function buildVisibleOrganizationContextData(snapshot: DingTalkDwsSnapshot): Record<string, unknown> {
    const departments: DingTalkDwsSnapshot['departments'] = [];
    const users: DingTalkDwsSnapshot['users'] = [];
    const build = (complete: boolean, warnings: string[]): Record<string, unknown> => ({
        scope: 'VISIBLE_SCOPE',
        complete,
        departmentCount: snapshot.departments.length,
        userCount: snapshot.users.length,
        returnedDepartmentCount: departments.length,
        returnedUserCount: users.length,
        departments,
        users,
        warnings,
    });
    for (const department of snapshot.departments) {
        departments.push(department);
        if (jsonBytes(build(false, [])) > MAX_VISIBLE_ORGANIZATION_DEPARTMENT_BYTES) {
            departments.pop();
            break;
        }
    }
    for (const user of snapshot.users) {
        users.push(user);
        if (jsonBytes(build(false, [])) > MAX_VISIBLE_ORGANIZATION_CONTEXT_BYTES) {
            users.pop();
            break;
        }
    }
    const complete = departments.length === snapshot.departments.length && users.length === snapshot.users.length;
    return build(complete, complete ? [] : ['组织数据超过单轮连接器上下文上限，结果已截断']);
}

function jsonBytes(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function createPersonalAttendanceRecordsTool(): DiscoveredDwsTool {
    return {
        toolId: MY_ATTENDANCE_RECORDS_TOOL_ID,
        name: 'cees.my_attendance_records',
        cliPath: 'cees my attendance records',
        description: '查询当前登录用户本人的考勤打卡流水；日期省略时默认查询今天。返回结果已按本机时区确定性换算并明确区分工作日期、实际打卡时间和应打卡时间，回答时禁止重新换算原始时间戳',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                start: { type: 'string', format: 'date', description: '开始日期 YYYY-MM-DD，默认今天' },
                end: { type: 'string', format: 'date', description: '结束日期 YYYY-MM-DD，默认与开始日期相同，区间最多一个月' },
            },
        },
        rawParameters: {},
        positionals: [],
    };
}

export function buildPersonalAttendanceRecordArguments(
    userId: string,
    input: Record<string, unknown>,
    now = new Date(),
    timeZone = systemTimeZone(),
): string[] {
    const allowed = new Set(['start', 'end']);
    for (const name of Object.keys(input)) {
        if (!allowed.has(name)) throw new Error(`钉钉 DWS 工具参数 ${name} 未在 Schema 中声明`);
    }
    const today = formatDateInTimeZone(now, timeZone);
    const start = input.start === undefined
        ? input.end === undefined ? today : requireValidDateArgument('end', input.end)
        : requireValidDateArgument('start', input.start);
    const end = input.end === undefined ? start : requireValidDateArgument('end', input.end);
    if (start > end) throw new Error('钉钉 DWS 工具参数 start 不能晚于 end');
    if (!isWithinOneCalendarMonth(start, end)) throw new Error('钉钉考勤查询日期区间不能超过一个月');
    return [
        'attendance', '+check-record',
        '--users', userId,
        '--start', start,
        '--end', end,
        '--format', 'json',
    ];
}

export function normalizeDingTalkAttendanceContext(
    payload: unknown,
    timeZone = systemTimeZone(),
): Record<string, unknown> {
    assertTimeZone(timeZone);
    if (isRecord(payload) && (payload.success === false || payload.outcome === 'failure')) {
        throw new Error(stringValue(payload.message) ?? stringValue(payload.error) ?? '钉钉考勤查询失败');
    }
    const sourceRecords = attendanceRecordList(payload);
    const records = sourceRecords.map((record, index) => normalizeAttendanceRecord(record, index, timeZone));
    const reportedCount = attendanceReportedCount(payload);
    const warnings: string[] = [];
    if (reportedCount !== null && reportedCount !== records.length) {
        warnings.push(`钉钉返回记录数 ${reportedCount}，本次标准化记录数 ${records.length}`);
    }
    const countsMatch = reportedCount === null || reportedCount === records.length;
    if (reportedCount !== null && reportedCount > 0 && records.length === 0) {
        throw new Error('钉钉返回了考勤记录数量，但没有返回可解析的记录');
    }
    const complete = attendanceResultComplete(payload) && countsMatch;
    if (!complete) warnings.push('钉钉考勤结果仍有后续分页，本次结果不完整');
    return {
        schemaVersion: 'cees.dingtalk.attendance.v1',
        timezone: timeZone,
        complete,
        count: records.length,
        warnings,
        fieldSemantics: {
            workDate: '考勤归属日期，不是打卡时刻',
            actualCheckTime: '员工实际打卡时间，已按 timezone 换算',
            baseCheckTime: '排班规定的应打卡时间，已按 timezone 换算',
        },
        records,
    };
}

function normalizeAttendanceRecord(
    record: Record<string, unknown>,
    index: number,
    timeZone: string,
): NormalizedDingTalkAttendanceRecord {
    const actualField = firstRecordField(record, ['userCheckTime', 'actualCheckTime', 'checkTime', 'checkTimeMillis']);
    if (!actualField) throw new Error(`第 ${index + 1} 条钉钉考勤记录缺少实际打卡时间`);
    const actualCheckTime = normalizeAttendanceTimestamp(actualField.value, timeZone);
    if (!actualCheckTime) throw new Error(`第 ${index + 1} 条钉钉考勤记录的实际打卡时间无效`);
    const baseField = firstRecordField(record, ['baseCheckTime', 'scheduledCheckTime', 'planCheckTime']);
    const baseCheckTime = baseField ? normalizeAttendanceTimestamp(baseField.value, timeZone) : null;
    if (baseField && !baseCheckTime) throw new Error(`第 ${index + 1} 条钉钉考勤记录的应打卡时间无效`);
    const workDateField = firstRecordField(record, ['workDate', 'attendanceDate', 'date']);
    const workDate = workDateField ? normalizeAttendanceDate(workDateField.value, timeZone) : actualCheckTime.date;
    if (!workDate) throw new Error(`第 ${index + 1} 条钉钉考勤记录的工作日期无效`);
    const checkTypeField = firstRecordField(record, ['checkType', 'check_type']);
    const statusField = firstRecordField(record, ['timeResult', 'checkResult', 'status']);
    return {
        id: scalarText(record.id ?? record.recordId ?? record.record_id),
        userId: scalarText(record.userId ?? record.user_id),
        workDate,
        checkType: normalizeCheckType(checkTypeField?.value),
        actualCheckTime: actualCheckTime.iso,
        actualCheckTimeLocal: actualCheckTime.local,
        baseCheckTime: baseCheckTime?.iso ?? null,
        baseCheckTimeLocal: baseCheckTime?.local ?? null,
        status: scalarText(statusField?.value),
        sourceFields: {
            workDate: workDateField?.name ?? 'derivedFromActualCheckTime',
            actualCheckTime: actualField.name,
            ...(baseField ? { baseCheckTime: baseField.name } : {}),
            ...(checkTypeField ? { checkType: checkTypeField.name } : {}),
            ...(statusField ? { status: statusField.name } : {}),
        },
    };
}

function attendanceRecordList(payload: unknown): Record<string, unknown>[] {
    const candidates = [
        payload,
        isRecord(payload) ? payload.records : undefined,
        isRecord(payload) ? payload.data : undefined,
        isRecord(payload) ? payload.result : undefined,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate.filter(isRecord);
        if (isRecord(candidate) && Array.isArray(candidate.records)) return candidate.records.filter(isRecord);
    }
    throw new Error('钉钉考勤返回结构缺少 records 数组');
}

function attendanceReportedCount(payload: unknown): number | null {
    if (!isRecord(payload)) return null;
    const candidates = [payload.count, isRecord(payload.data) ? payload.data.count : undefined, isRecord(payload.result) ? payload.result.count : undefined];
    const count = candidates.find((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
    return typeof count === 'number' ? count : null;
}

function attendanceResultComplete(payload: unknown): boolean {
    if (!isRecord(payload) || !isRecord(payload.meta) || !isRecord(payload.meta.pagination)) return true;
    return payload.meta.pagination.endpoint_exhausted !== false;
}

function firstRecordField(record: Record<string, unknown>, names: string[]): { name: string; value: unknown } | null {
    for (const name of names) {
        if (record[name] !== undefined && record[name] !== null && record[name] !== '') return { name, value: record[name] };
    }
    return null;
}

function normalizeCheckType(value: unknown): string | null {
    const normalized = scalarText(value)?.replace(/[\s-]+/g, '_').toUpperCase();
    if (!normalized) return null;
    if (normalized === 'ONDUTY' || normalized === 'ON_DUTY') return 'ON_DUTY';
    if (normalized === 'OFFDUTY' || normalized === 'OFF_DUTY') return 'OFF_DUTY';
    return normalized;
}

function normalizeAttendanceDate(value: unknown, timeZone: string): string | null {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return isValidDate(value) ? value : null;
    return normalizeAttendanceTimestamp(value, timeZone)?.date ?? null;
}

function normalizeAttendanceTimestamp(
    value: unknown,
    timeZone: string,
): { iso: string; local: string; date: string } | null {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)) {
        const date = value.slice(0, 10);
        const [, time] = value.split(/[ T]/);
        if (!isValidDate(date) || !isValidTime(time)) return null;
        const offset = timeZoneOffsetForLocalDate(value.replace(' ', 'T'), timeZone);
        return { iso: `${value.replace(' ', 'T')}${offset}`, local: value.replace('T', ' '), date };
    }
    let epochMilliseconds: number | null = null;
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
        const digits = String(Math.abs(value)).length;
        epochMilliseconds = digits === 10 ? value * 1000 : digits === 13 ? value : null;
    } else if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        const digits = value.replace('-', '').length;
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) epochMilliseconds = digits === 10 ? parsed * 1000 : digits === 13 ? parsed : null;
    } else if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) epochMilliseconds = parsed;
    }
    if (epochMilliseconds === null) return null;
    const date = new Date(epochMilliseconds);
    if (Number.isNaN(date.getTime())) return null;
    return formatInstantInTimeZone(date, timeZone);
}

function formatInstantInTimeZone(value: Date, timeZone: string): { iso: string; local: string; date: string } {
    const parts = dateTimeParts(value, timeZone);
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}:${parts.second}`;
    const localIso = `${date}T${time}`;
    return { iso: `${localIso}${timeZoneOffsetForInstant(value, timeZone)}`, local: `${date} ${time}`, date };
}

function dateTimeParts(value: Date, timeZone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string> {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(value);
    const output = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return output as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>;
}

function timeZoneOffsetForInstant(value: Date, timeZone: string): string {
    const parts = dateTimeParts(value, timeZone);
    const representedUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return formatOffset(Math.round((representedUtc - value.getTime()) / 60_000));
}

function timeZoneOffsetForLocalDate(localIso: string, timeZone: string): string {
    const [datePart, timePart] = localIso.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);
    const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const firstOffset = offsetMinutesAtInstant(guess, timeZone);
    const instant = new Date(guess.getTime() - firstOffset * 60_000);
    return formatOffset(offsetMinutesAtInstant(instant, timeZone));
}

function offsetMinutesAtInstant(value: Date, timeZone: string): number {
    const parts = dateTimeParts(value, timeZone);
    const representedUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return Math.round((representedUtc - value.getTime()) / 60_000);
}

function formatOffset(offsetMinutes: number): string {
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absolute = Math.abs(offsetMinutes);
    return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function systemTimeZone(): string {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone || 'Asia/Shanghai';
}

function assertTimeZone(timeZone: string): void {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format();
    } catch {
        throw new Error('钉钉考勤时区无效');
    }
}

function formatDateInTimeZone(value: Date, timeZone: string): string {
    assertTimeZone(timeZone);
    const parts = dateTimeParts(value, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function requireValidDateArgument(name: string, value: unknown): string {
    const date = requireDateArgument(name, value);
    if (!isValidDate(date)) throw new Error(`钉钉 DWS 工具参数 ${name} 不是有效日期`);
    return date;
}

function isValidDate(value: string): boolean {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isValidTime(value: string): boolean {
    const [hour, minute, second] = value.split(':').map(Number);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function isWithinOneCalendarMonth(start: string, end: string): boolean {
    const [year, month, day] = start.split('-').map(Number);
    const targetMonth = month === 12 ? 1 : month + 1;
    const targetYear = month === 12 ? year + 1 : year;
    const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    const maximum = new Date(Date.UTC(targetYear, targetMonth - 1, Math.min(day, lastDayOfTargetMonth)));
    const endDate = new Date(`${end}T00:00:00.000Z`);
    return endDate.getTime() <= maximum.getTime();
}

function scalarText(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function createPersonalAttendanceApprovalsTool(): DiscoveredDwsTool {
    return {
        toolId: MY_ATTENDANCE_APPROVALS_TOOL_ID,
        name: 'cees.my_attendance_approvals',
        cliPath: 'cees my attendance approvals',
        description: '查询当前登录用户本人的请假、加班、出差外出和补卡审批记录；不需要提供用户 ID，日期省略时默认查询本月截至今天',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
                start: { type: 'string', format: 'date', description: '开始日期 YYYY-MM-DD，默认本月第一天' },
                end: { type: 'string', format: 'date', description: '结束日期 YYYY-MM-DD，默认今天' },
                types: {
                    type: 'array',
                    items: { type: 'string', enum: ['leave', 'overtime', 'trip', 'patch'] },
                    description: '审批类型，默认查询请假、加班、出差外出和补卡',
                },
            },
        },
        rawParameters: {},
        positionals: [],
    };
}

function buildPersonalAttendanceApprovalArguments(userId: string, input: Record<string, unknown>): string[] {
    const allowed = new Set(['start', 'end', 'types']);
    for (const name of Object.keys(input)) {
        if (!allowed.has(name)) throw new Error(`钉钉 DWS 工具参数 ${name} 未在 Schema 中声明`);
    }
    const today = new Date();
    const defaultEnd = formatLocalDate(today);
    const defaultStart = `${defaultEnd.slice(0, 8)}01`;
    const start = input.start === undefined ? defaultStart : requireDateArgument('start', input.start);
    const end = input.end === undefined ? defaultEnd : requireDateArgument('end', input.end);
    if (start > end) throw new Error('钉钉 DWS 工具参数 start 不能晚于 end');
    const allowedTypes = new Set(['leave', 'overtime', 'trip', 'patch']);
    const types = input.types === undefined ? [...allowedTypes] : input.types;
    if (!Array.isArray(types) || types.length === 0 || types.some((value) => typeof value !== 'string' || !allowedTypes.has(value))) {
        throw new Error('钉钉 DWS 工具参数 types 类型无效');
    }
    return [
        'attendance', '+list-approve',
        '--users', userId,
        '--types', [...new Set(types)].join(','),
        '--start', start,
        '--end', end,
        '--format', 'json',
    ];
}

function requireDateArgument(name: string, value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`钉钉 DWS 工具参数 ${name} 必须是 YYYY-MM-DD`);
    }
    return value;
}

function formatLocalDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function sanitizeConnectorData(value: unknown, depth = 0): Record<string, unknown> {
    const sanitized = sanitizeValue(value, depth);
    return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? sanitized as Record<string, unknown>
        : { value: sanitized };
}

function sanitizeValue(value: unknown, depth: number): unknown {
    if (depth > 10) return '[TRUNCATED]';
    if (typeof value === 'string') return value.slice(0, 4000);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 1000).map((item) => sanitizeValue(item, depth + 1));
    if (!value || typeof value !== 'object') return String(value ?? '');
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (/(?:token|secret|cookie|authorization|credential|password)/i.test(key)) continue;
        result[key] = sanitizeValue(item, depth + 1);
    }
    return result;
}

export function buildDwsArguments(tool: DiscoveredDwsTool, input: Record<string, unknown>): string[] {
    const allowed = new Set([
        ...Object.keys(tool.rawParameters).filter((name) => !CONTROL_PARAMETERS.has(name) && !UNSAFE_PARAMETER_PATTERN.test(name)),
        ...tool.positionals.map((item) => item.name).filter((name): name is string => typeof name === 'string' && !UNSAFE_PARAMETER_PATTERN.test(name)),
    ]);
    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw new Error(`钉钉 DWS 工具参数 ${key} 未在 Schema 中声明`);
    }
    const args = tool.cliPath.split(/\s+/);
    for (const positional of [...tool.positionals].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))) {
        const name = positional.name;
        if (!name) continue;
        const value = input[name];
        if (value === undefined) {
            if (positional.required) throw new Error(`钉钉 DWS 工具缺少必填参数 ${name}`);
            continue;
        }
        appendPositional(args, value, positional);
    }
    for (const [name, parameter] of Object.entries(tool.rawParameters)) {
        if (name === 'format') {
            args.push('--format', 'json');
            continue;
        }
        if (CONTROL_PARAMETERS.has(name) || UNSAFE_PARAMETER_PATTERN.test(name)) continue;
        let value = input[name];
        if (value === undefined) {
            if ((parameter.required || parameter.cli_required) && parameter.default === undefined) {
                throw new Error(`钉钉 DWS 工具缺少必填参数 ${name}`);
            }
            continue;
        }
        validateParameterValue(name, value, parameter);
        appendFlag(args, name, value);
    }
    return args;
}

function toJsonSchema(parameters: Record<string, DwsParameter>, positionals: DwsPositional[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [name, parameter] of Object.entries(parameters)) {
        if (CONTROL_PARAMETERS.has(name) || UNSAFE_PARAMETER_PATTERN.test(name)) continue;
        properties[name] = parameterSchema(parameter);
        if ((parameter.required || parameter.cli_required) && parameter.default === undefined) required.push(name);
    }
    for (const positional of positionals) {
        if (!positional.name || UNSAFE_PARAMETER_PATTERN.test(positional.name)) continue;
        properties[positional.name] = {
            type: positional.variadic ? 'array' : normalizeJsonType(positional.type),
            ...(positional.variadic ? { items: { type: normalizeJsonType(positional.type) } } : {}),
            ...(positional.description ? { description: positional.description } : {}),
        };
        if (positional.required) required.push(positional.name);
    }
    return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) };
}

function parameterSchema(parameter: DwsParameter): Record<string, unknown> {
    const type = normalizeJsonType(parameter.type);
    return {
        type,
        ...(type === 'array' ? { items: { type: 'string' } } : {}),
        ...(parameter.description ? { description: parameter.description.slice(0, 1000) } : {}),
        ...(parameter.format ? { format: parameter.format } : {}),
        ...(Array.isArray(parameter.enum) && parameter.enum.length ? { enum: parameter.enum } : {}),
        ...(parameter.default !== undefined ? { default: parameter.default } : {}),
    };
}

function validateParameterValue(name: string, value: unknown, parameter: DwsParameter): void {
    const type = normalizeJsonType(parameter.type);
    const valid = type === 'array' ? Array.isArray(value)
        : type === 'boolean' ? typeof value === 'boolean'
            : type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value)
                : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
                    : typeof value === 'string';
    if (!valid) throw new Error(`钉钉 DWS 工具参数 ${name} 类型无效`);
    if (parameter.enum?.length && !parameter.enum.includes(value)) throw new Error(`钉钉 DWS 工具参数 ${name} 不在允许范围内`);
}

function appendFlag(args: string[], name: string, value: unknown): void {
    if (Array.isArray(value)) {
        args.push(`--${name}`, value.map(stringArgument).join(','));
        return;
    }
    if (typeof value === 'boolean') {
        args.push(`--${name}=${value ? 'true' : 'false'}`);
        return;
    }
    args.push(`--${name}`, stringArgument(value));
}

function appendPositional(args: string[], value: unknown, positional: DwsPositional): void {
    if (positional.variadic) {
        if (!Array.isArray(value)) throw new Error(`钉钉 DWS 工具参数 ${positional.name} 类型无效`);
        args.push(...value.map(stringArgument));
        return;
    }
    args.push(stringArgument(value));
}

function stringArgument(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    throw new Error('钉钉 DWS 工具参数值无效');
}

function schemaToolRecords(payload: unknown): Record<string, unknown>[] {
    if (!isRecord(payload)) return [];
    if (stringValue(payload.canonical_path)) return [payload];
    const records: Record<string, unknown>[] = [];
    if (Array.isArray(payload.products)) {
        for (const product of payload.products) {
            if (!isRecord(product) || !Array.isArray(product.tools)) continue;
            for (const tool of product.tools) if (isRecord(tool)) records.push(tool);
        }
    }
    if (isRecord(payload.tool)) records.push(payload.tool);
    if (isRecord(payload.data)) records.push(...schemaToolRecords(payload.data));
    return records;
}

function parameterMap(value: unknown): Record<string, DwsParameter> {
    if (!isRecord(value)) return {};
    const result: Record<string, DwsParameter> = {};
    for (const [name, parameter] of Object.entries(value)) if (isRecord(parameter)) result[name] = parameter;
    return result;
}

function positionalList(value: unknown): DwsPositional[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function hasRequiredSensitiveParameter(parameters: Record<string, DwsParameter>, positionals: DwsPositional[]): boolean {
    return Object.entries(parameters).some(([name, parameter]) =>
        UNSAFE_PARAMETER_PATTERN.test(name) && (parameter.required || parameter.cli_required),
    ) || positionals.some((item) => Boolean(item.required && item.name && UNSAFE_PARAMETER_PATTERN.test(item.name)));
}

function normalizeJsonType(value: unknown): 'string' | 'boolean' | 'integer' | 'number' | 'array' {
    return value === 'boolean' || value === 'integer' || value === 'number' || value === 'array' ? value : 'string';
}

function isSafeCliPath(value: string): boolean {
    const parts = value.trim().split(/\s+/);
    return parts.length > 0 && parts.every((part) => /^(?:[A-Za-z0-9][A-Za-z0-9+._:-]*|\+[A-Za-z0-9][A-Za-z0-9._:-]*)$/.test(part));
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
