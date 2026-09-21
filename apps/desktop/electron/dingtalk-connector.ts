import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    configureDingTalkDwsExecutable,
    getDingTalkDwsStatus,
    loginDingTalkDws,
    readDingTalkDwsSchema,
    runDws,
    runDwsJson,
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
const MAX_TOOL_COUNT = 1500;
const MAX_CALLS = 3;
const TOOL_ID_PATTERN = /^dws_read_[a-f0-9]{16}$/;
const UNSAFE_PARAMETER_PATTERN = /(?:token|secret|cookie|authorization|credential|password|app[-_]?key|app[-_]?secret)/i;
const CONTROL_PARAMETERS = new Set(['help', 'format', 'output', 'jq', 'fields', 'dry-run', 'confirm', 'confirmed', 'force', 'yes']);

let installRoot: string | null = null;
let installPromise: Promise<DingTalkDwsStatus> | null = null;
let releaseOperationPromise: Promise<DingTalkConnectorReleaseResult> | null = null;

export interface DingTalkConnectorContext {
    provider: 'DINGTALK';
    toolId: string;
    toolName: string;
    fetchedAt: string;
    data: Record<string, unknown>;
}

export interface DingTalkConnectorTool {
    toolId: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface DingTalkConnectorPlannedCall {
    toolId: string;
    arguments: Record<string, unknown>;
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

export interface DiscoveredDwsTool extends DingTalkConnectorTool {
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
    const tools = parseDingTalkReadTools(await readDingTalkDwsSchema());
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
        const current = parseDingTalkReadTools(await readDingTalkDwsSchema(tool.cliPath))
            .find((item) => item.toolId === call.toolId && item.name === tool.name && item.cliPath === tool.cliPath);
        if (!current) throw new Error('钉钉 DWS 工具安全属性已变化，已拒绝执行');
        const args = buildDwsArguments(current, call.arguments);
        const payload = await runDwsJson(args, 60_000);
        contexts.push(connectorContext(current, sanitizeConnectorData(payload)));
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
    return parts.length > 0 && parts.every((part) => /^[A-Za-z0-9][A-Za-z0-9+._:-]*$/.test(part));
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
