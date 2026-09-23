import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ConnectorContext, ConnectorPlannedCall, ConnectorStatus, ConnectorTool } from '../core/connector.types';
import { LocalCliCommandError, LocalCliTransport, decodeLocalCliOutput } from '../transports/local-cli.transport';

export const WECOM_CLI_VERSION = '1.3.2';
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_BINARY_BYTES = 24 * 1024 * 1024;
const MAX_CONTEXT_BYTES = 56 * 1024;
const MAX_TOOL_COUNT = 256;
const MAX_CALLS = 3;
const MAX_TOOL_SCHEMA_BYTES = 16 * 1024;
const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;
const QR_CODE_WAIT_MS = 15_000;
const SENSITIVE_KEY_PATTERN = /(?:token|secret|cookie|authorization|credential|password|bot[_-]?id)/i;
const LOCAL_PATH_KEY_PATTERN = /(?:file_path|local_path|output_path|output_dir|directory_path)/i;
const TOOL_ID_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;

interface WeComPlatformRelease {
    url: string;
    sha256: string;
    binaryName: string;
}

const RELEASES: Record<string, WeComPlatformRelease> = {
    'win32-x64': {
        url: 'https://registry.npmjs.org/@wecom/cli-win32-x64/-/cli-win32-x64-1.3.2.tgz',
        sha256: '0ef73dd55d33c83df1291bd49abb41b0c110b19bdcaeebe570bfad56820464b5',
        binaryName: 'wecom-cli.exe',
    },
    'darwin-arm64': {
        url: 'https://registry.npmjs.org/@wecom/cli-darwin-arm64/-/cli-darwin-arm64-1.3.2.tgz',
        sha256: '4b17bcb2e4ce4d08ef91e5a0b478529b47ae028c9bb29329f1740bda690746d3',
        binaryName: 'wecom-cli',
    },
    'darwin-x64': {
        url: 'https://registry.npmjs.org/@wecom/cli-darwin-x64/-/cli-darwin-x64-1.3.2.tgz',
        sha256: 'de2701a721bc1ff1c63fce0c37a943dae10b30ce2591145e6191f8466dfb0829',
        binaryName: 'wecom-cli',
    },
    'linux-arm64': {
        url: 'https://registry.npmjs.org/@wecom/cli-linux-arm64/-/cli-linux-arm64-1.3.2.tgz',
        sha256: '9bfb25afa4d117aa61f2127f301505f7443ba2aa6f7a4687d256fcdebbf71f95',
        binaryName: 'wecom-cli',
    },
    'linux-x64': {
        url: 'https://registry.npmjs.org/@wecom/cli-linux-x64/-/cli-linux-x64-1.3.2.tgz',
        sha256: 'c706072ee5cba8b0f6ef33339bbdf43ef4dc30be4c1348a70e837ae0f2e656c4',
        binaryName: 'wecom-cli',
    },
};

export interface WeComConnectorStatus extends ConnectorStatus {
    source: 'MANAGED' | null;
    installSupported: boolean;
    authorizationState: 'UNAUTHORIZED' | 'AUTHORIZING' | 'AUTHORIZED';
    qrCodeDataUrl: string | null;
    authorizationExpiresAt: string | null;
    toolCount: number;
}

export type WeComConnectorTool = ConnectorTool;
export type WeComConnectorPlannedCall = ConnectorPlannedCall;
export type WeComConnectorContext = ConnectorContext<'WECOM'>;

let connectorRoot: string | undefined;
let executablePath: string | undefined;
let configDirectory: string | undefined;
let qrCodePath: string | undefined;
let downloadDirectory: string | undefined;
let installPromise: Promise<void> | null = null;
let authorizationProcess: ChildProcess | null = null;
let authorizationExpiresAt: string | null = null;
let authorizationError: string | null = null;
let toolCache: WeComConnectorTool[] | undefined;

const transport = new LocalCliTransport({
    resolveExecutable: () => ({ command: requireExecutablePath(), source: 'MANAGED' }),
    maxBufferBytes: 16 * 1024 * 1024,
});

export function configureWeComConnector(userDataPath: string): void {
    const root = path.resolve(userDataPath, 'connectors', 'wecom');
    connectorRoot = root;
    const release = currentRelease();
    executablePath = path.join(root, 'bin', release?.binaryName ?? (process.platform === 'win32' ? 'wecom-cli.exe' : 'wecom-cli'));
    configDirectory = path.join(root, 'config');
    qrCodePath = path.join(root, 'auth', 'authorization.png');
    downloadDirectory = path.join(root, 'downloads');
}

export async function getWeComConnectorStatus(): Promise<WeComConnectorStatus> {
    const checkedAt = new Date().toISOString();
    const release = currentRelease();
    if (!release || !executablePath || !await fileExists(executablePath)) {
        return {
            state: 'NOT_INSTALLED', installed: false, authenticated: false, version: null, checkedAt,
            issueCode: release ? 'WECOM_CLI_NOT_INSTALLED' : 'WECOM_CLI_PLATFORM_UNSUPPORTED',
            recoveryAction: release ? 'INSTALL' : 'MANUAL_INSTALL',
            error: release ? null : `当前平台不受企业微信 CLI ${WECOM_CLI_VERSION} 支持`,
            source: null, installSupported: Boolean(release), authorizationState: 'UNAUTHORIZED',
            qrCodeDataUrl: null, authorizationExpiresAt: null, toolCount: 0,
        };
    }

    let version: string;
    try {
        version = normalizeVersion(await runWeCom(['--version'], 15_000));
    } catch (error) {
        return errorStatus(error, checkedAt, true);
    }

    try {
        const authorization = (await runWeCom(['auth', 'show', '--status'], 15_000)).trim().toLowerCase();
        if (authorization === 'authorized') {
            authorizationError = null;
            const toolCount = await discoverMethodSummaries().then((items) => items.length).catch(() => 0);
            return readyStatus(version, checkedAt, toolCount);
        }
        if (authorization !== 'unauthorized') throw new Error('企业微信 CLI 返回了未知授权状态');
    } catch (error) {
        return errorStatus(error, checkedAt, true, version);
    }

    if (authorizationProcess && authorizationProcess.exitCode === null) {
        if (authorizationExpiresAt && Date.parse(authorizationExpiresAt) <= Date.now()) {
            stopAuthorization();
            authorizationExpiresAt = null;
            authorizationError = '企业微信授权二维码已过期，请重新连接';
        } else {
            return authorizingStatus(version, checkedAt);
        }
    }
    return {
        state: 'AUTH_REQUIRED', installed: true, authenticated: false, version, checkedAt,
        issueCode: authorizationError ? 'WECOM_AUTHORIZATION_FAILED' : 'WECOM_AUTHORIZATION_REQUIRED',
        recoveryAction: 'AUTHORIZE', error: authorizationError,
        source: 'MANAGED', installSupported: true, authorizationState: 'UNAUTHORIZED',
        qrCodeDataUrl: null, authorizationExpiresAt: null, toolCount: 0,
    };
}

export async function installAndAuthorizeWeComConnector(): Promise<WeComConnectorStatus> {
    await ensureInstalled();
    const current = await getWeComConnectorStatus();
    if (current.state === 'READY' || current.authorizationState === 'AUTHORIZING') return current;
    await startAuthorization();
    return getWeComConnectorStatus();
}

export async function disconnectWeComConnector(): Promise<WeComConnectorStatus> {
    stopAuthorization();
    resetWeComConnectorTools();
    authorizationError = null;
    authorizationExpiresAt = null;
    if (configDirectory) await removeDirectoryWithinRoot(configDirectory);
    if (qrCodePath) await rm(qrCodePath, { force: true });
    return getWeComConnectorStatus();
}

export function resetWeComConnectorTools(): void {
    toolCache = undefined;
}

export async function discoverWeComTools(): Promise<WeComConnectorTool[]> {
    if (toolCache) return toolCache.map(cloneTool);
    await requireAuthorized();
    const summaries = await discoverMethodSummaries();
    const tools = await mapWithConcurrency(summaries.slice(0, MAX_TOOL_COUNT), 8, async (summary) => {
        try {
            const payload = await runWeComJson(['schema', 'get', summary.method], 30_000);
            return normalizeWeComToolDefinition(payload, summary.description);
        } catch {
            return null;
        }
    });
    const available = tools.filter((tool): tool is WeComConnectorTool => Boolean(tool));
    if (available.length === 0) throw new Error('企业微信 CLI 未返回可用工具');
    toolCache = available;
    return available.map(cloneTool);
}

export async function executeWeComCalls(calls: WeComConnectorPlannedCall[]): Promise<WeComConnectorContext[]> {
    if (!Array.isArray(calls) || calls.length === 0 || calls.length > MAX_CALLS) {
        throw new Error('企业微信连接器每次必须执行一至三个工具调用');
    }
    await requireAuthorized();
    const tools = await discoverWeComTools();
    const toolMap = new Map(tools.map((tool) => [tool.toolId, tool]));
    const contexts: WeComConnectorContext[] = [];
    for (const call of calls) {
        const tool = toolMap.get(call.toolId);
        if (!tool) throw new Error(`企业微信工具不存在：${call.toolId}`);
        assertWeComCallAllowed(tool, call);
        validateArguments(call.arguments);
        const args = [...call.toolId.split('.'), '--json', JSON.stringify(call.arguments)];
        if (call.toolId.endsWith('.download')) {
            const outputDir = requireDownloadDirectory();
            await mkdir(outputDir, { recursive: true });
            args.push('--output-dir', outputDir);
        }
        const result = await runWeComJson(args, 60_000);
        contexts.push({
            provider: 'WECOM',
            toolId: tool.toolId,
            toolName: tool.name,
            fetchedAt: new Date().toISOString(),
            data: limitContext(sanitizeValue(result, 0)),
        });
    }
    return contexts;
}

export function normalizeWeComToolDefinition(value: unknown, fallbackDescription = ''): WeComConnectorTool {
    if (!isRecord(value)) throw new Error('企业微信工具 Schema 无效');
    const method = stringValue(value.method);
    const description = stringValue(value.description) ?? fallbackDescription.trim();
    const schemas = isRecord(value.schemas) ? value.schemas : {};
    if (!method || !TOOL_ID_PATTERN.test(method) || !description) throw new Error('企业微信工具名称或描述无效');
    const request = resolveSchema(value.request, schemas, new Set(), 0);
    if (!isRecord(request) || request.type !== 'object') throw new Error('企业微信工具请求 Schema 无效');
    const parameters = compactSchema(request, 0);
    if (Buffer.byteLength(JSON.stringify(parameters), 'utf8') > MAX_TOOL_SCHEMA_BYTES) {
        throw new Error('企业微信工具请求 Schema 过大');
    }
    if (containsUnsafeParameter(parameters)) throw new Error('企业微信工具包含不允许的本地路径或凭据参数');
    const riskLevel = classifyWeComToolRisk(method);
    return {
        toolId: method,
        name: method,
        description,
        parameters,
        riskLevel,
        requiresConfirmation: riskLevel !== 'READ',
    };
}

export function classifyWeComToolRisk(method: string): 'READ' | 'WRITE' | 'DESTRUCTIVE' {
    const action = method.split('.').at(-1) ?? '';
    if (/^(?:delete|cancel|remove|clear|overwrite)$/.test(action)) return 'DESTRUCTIVE';
    if (/^(?:get|list|search|query|whoami|download|read|check|show)$/.test(action)) return 'READ';
    if (/^(?:create|update|send|reply|forward|append|import|upload|add|finish|rename|write|set)$/.test(action)) return 'WRITE';
    return 'DESTRUCTIVE';
}

export function assertWeComCallAllowed(tool: WeComConnectorTool, call: WeComConnectorPlannedCall): void {
    if (tool.toolId !== call.toolId) throw new Error('企业微信工具调用与定义不一致');
    if (tool.requiresConfirmation && call.confirmed !== true) {
        throw new Error(`企业微信操作 ${tool.name} 需要用户确认`);
    }
}

export function extractWeComBinaryArchive(archive: Buffer, expectedBinaryName: string): Buffer {
    const tar = gunzipSync(archive, { maxOutputLength: MAX_BINARY_BYTES * 2 });
    let offset = 0;
    const expected = `package/bin/${expectedBinaryName}`;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;
        const name = tarString(header.subarray(0, 100));
        const prefix = tarString(header.subarray(345, 500));
        const entryPath = prefix ? `${prefix}/${name}` : name;
        const size = Number.parseInt(tarString(header.subarray(124, 136)).replace(/\0/g, '').trim() || '0', 8);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BINARY_BYTES) throw new Error('企业微信 CLI 安装包条目无效');
        const dataStart = offset + 512;
        const dataEnd = dataStart + size;
        if (dataEnd > tar.length) throw new Error('企业微信 CLI 安装包已损坏');
        if (entryPath === expected) return Buffer.from(tar.subarray(dataStart, dataEnd));
        offset = dataStart + Math.ceil(size / 512) * 512;
    }
    throw new Error('企业微信 CLI 安装包缺少平台可执行文件');
}

async function ensureInstalled(): Promise<void> {
    if (await fileExists(requireExecutablePath())) return;
    if (installPromise) return installPromise;
    installPromise = installManagedCli().finally(() => { installPromise = null; });
    return installPromise;
}

async function installManagedCli(): Promise<void> {
    const release = currentRelease();
    if (!release) throw new Error(`当前平台不受企业微信 CLI ${WECOM_CLI_VERSION} 支持`);
    const root = requireConnectorRoot();
    const target = requireExecutablePath();
    assertWithinRoot(target, root);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
        const response = await fetch(release.url, { redirect: 'error', signal: controller.signal });
        if (!response.ok) throw new Error(`下载企业微信 CLI 失败（HTTP ${response.status}）`);
        const contentLength = Number(response.headers.get('content-length') ?? 0);
        if (contentLength > MAX_ARCHIVE_BYTES) throw new Error('企业微信 CLI 安装包超过大小限制');
        const archive = Buffer.from(await response.arrayBuffer());
        if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error('企业微信 CLI 安装包大小无效');
        const digest = createHash('sha256').update(archive).digest('hex');
        if (digest !== release.sha256) throw new Error('企业微信 CLI 安装包完整性校验失败');
        const binary = extractWeComBinaryArchive(archive, release.binaryName);
        await mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.tmp`;
        await rm(temporary, { force: true });
        await writeFile(temporary, binary, { mode: 0o755 });
        if (process.platform !== 'win32') await chmod(temporary, 0o755);
        await rm(target, { force: true });
        await rename(temporary, target);
    } catch (error) {
        if (controller.signal.aborted) throw new Error('下载企业微信 CLI 超时');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function startAuthorization(): Promise<void> {
    stopAuthorization();
    const root = requireConnectorRoot();
    const executable = requireExecutablePath();
    const config = requireConfigDirectory();
    const qrPath = requireQrCodePath();
    assertWithinRoot(config, root);
    assertWithinRoot(qrPath, root);
    await mkdir(config, { recursive: true });
    await mkdir(path.dirname(qrPath), { recursive: true });
    await rm(qrPath, { force: true });
    authorizationError = null;
    authorizationExpiresAt = new Date(Date.now() + AUTHORIZATION_TIMEOUT_MS).toISOString();
    const child = spawn(executable, [
        'auth', 'init', '--noninteractive', '--no-browser', '--output-qrcode', qrPath,
    ], {
        cwd: root,
        env: weComEnvironment(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    authorizationProcess = child;
    let errorOutput = '';
    child.stderr?.on('data', (chunk: Buffer) => {
        if (errorOutput.length < 4000) errorOutput += decodeLocalCliOutput(chunk).slice(0, 4000 - errorOutput.length);
    });
    child.once('error', (error) => {
        if (authorizationProcess === child) authorizationProcess = null;
        authorizationError = safeError(error);
    });
    child.once('close', (code) => {
        if (authorizationProcess === child) authorizationProcess = null;
        if (code !== 0 && code !== null) authorizationError = sanitizeText(errorOutput) || '企业微信扫码授权未完成';
    });
    await waitForFile(qrPath, QR_CODE_WAIT_MS);
}

function stopAuthorization(): void {
    if (!authorizationProcess) return;
    authorizationProcess.kill();
    authorizationProcess = null;
}

async function discoverMethodSummaries(): Promise<Array<{ method: string; description: string }>> {
    const payload = await runWeComJson(['schema', 'list'], 30_000);
    if (!Array.isArray(payload)) throw new Error('企业微信 CLI 工具目录无效');
    const result: Array<{ method: string; description: string }> = [];
    const seen = new Set<string>();
    for (const service of payload) {
        if (!isRecord(service) || !Array.isArray(service.methods)) continue;
        for (const item of service.methods) {
            if (!isRecord(item)) continue;
            const method = stringValue(item.name);
            const description = stringValue(item.description);
            if (!method || !description || !TOOL_ID_PATTERN.test(method) || seen.has(method)) continue;
            seen.add(method);
            result.push({ method, description });
            if (result.length >= MAX_TOOL_COUNT) return result;
        }
    }
    return result;
}

function resolveSchema(value: unknown, schemas: Record<string, unknown>, stack: Set<string>, depth: number): unknown {
    if (depth > 8) return { type: 'object', properties: {} };
    if (Array.isArray(value)) return value.map((item) => resolveSchema(item, schemas, stack, depth + 1));
    if (!isRecord(value)) return value;
    const reference = stringValue(value.$ref);
    if (reference) {
        if (stack.has(reference)) return { type: 'object', properties: {} };
        const target = schemas[reference];
        if (!isRecord(target)) return { type: 'object', properties: {} };
        const nextStack = new Set(stack).add(reference);
        const merged = { ...target, ...value };
        delete merged.$ref;
        return resolveSchema(merged, schemas, nextStack, depth + 1);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveSchema(item, schemas, stack, depth + 1)]));
}

function compactSchema(value: unknown, depth: number): Record<string, unknown> {
    if (!isRecord(value)) return { type: 'object', properties: {} };
    const result: Record<string, unknown> = {};
    for (const key of ['type', 'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'additionalProperties']) {
        if (value[key] !== undefined) result[key] = value[key];
    }
    if (typeof value.description === 'string') result.description = value.description.slice(0, 300);
    if (Array.isArray(value.enum)) result.enum = value.enum.slice(0, 50);
    if (Array.isArray(value.required)) result.required = value.required.filter((item): item is string => typeof item === 'string').slice(0, 64);
    if (depth < 6 && isRecord(value.properties)) {
        result.properties = Object.fromEntries(Object.entries(value.properties).slice(0, 64).map(([key, item]) => [key, compactSchema(item, depth + 1)]));
    } else if (value.type === 'object') {
        result.properties = {};
    }
    if (depth < 6 && value.items !== undefined) result.items = compactSchema(value.items, depth + 1);
    if (depth === 0) {
        result.type = 'object';
        result.additionalProperties = false;
        if (!isRecord(result.properties)) result.properties = {};
    }
    return result;
}

function containsUnsafeParameter(schema: Record<string, unknown>): boolean {
    const visit = (value: unknown): boolean => {
        if (!isRecord(value)) return false;
        if (isRecord(value.properties)) {
            for (const [key, nested] of Object.entries(value.properties)) {
                if (SENSITIVE_KEY_PATTERN.test(key) || LOCAL_PATH_KEY_PATTERN.test(key)) return true;
                if (visit(nested)) return true;
            }
        }
        return visit(value.items);
    };
    return visit(schema);
}

function validateArguments(value: Record<string, unknown>): void {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 64 * 1024) throw new Error('企业微信工具参数过大');
    const visit = (item: unknown): void => {
        if (Array.isArray(item)) {
            item.forEach(visit);
            return;
        }
        if (!isRecord(item)) return;
        for (const [key, nested] of Object.entries(item)) {
            if (SENSITIVE_KEY_PATTERN.test(key) || LOCAL_PATH_KEY_PATTERN.test(key)) throw new Error('企业微信工具参数包含不允许的凭据或本地路径');
            visit(nested);
        }
    };
    visit(value);
}

function limitContext(value: unknown): Record<string, unknown> {
    const record = isRecord(value) ? value : { result: value };
    const serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_CONTEXT_BYTES) return record;
    return {
        truncated: true,
        summary: serialized.slice(0, MAX_CONTEXT_BYTES - 512),
        notice: '企业微信返回内容超过单轮上下文限制，已截断',
    };
}

function sanitizeValue(value: unknown, depth: number): unknown {
    if (depth > 12) return '[内容层级过深]';
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
    if (!isRecord(value)) return typeof value === 'string' && value.length > 20_000 ? `${value.slice(0, 20_000)}…` : value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) continue;
        result[key] = sanitizeValue(item, depth + 1);
    }
    return result;
}

async function requireAuthorized(): Promise<void> {
    const status = await getWeComConnectorStatus();
    if (status.state !== 'READY') throw new Error(status.error || '请先在连接器页面扫码授权企业微信机器人');
}

function readyStatus(version: string, checkedAt: string, toolCount: number): WeComConnectorStatus {
    return {
        state: 'READY', installed: true, authenticated: true, version, checkedAt,
        issueCode: null, recoveryAction: 'NONE', error: null,
        source: 'MANAGED', installSupported: true, authorizationState: 'AUTHORIZED',
        qrCodeDataUrl: null, authorizationExpiresAt: null, toolCount,
    };
}

function authorizingStatus(version: string, checkedAt: string): WeComConnectorStatus {
    return {
        state: 'AUTH_REQUIRED', installed: true, authenticated: false, version, checkedAt,
        issueCode: 'WECOM_AUTHORIZING', recoveryAction: 'AUTHORIZE', error: null,
        source: 'MANAGED', installSupported: true, authorizationState: 'AUTHORIZING',
        qrCodeDataUrl: readQrCodeDataUrl(), authorizationExpiresAt, toolCount: 0,
    };
}

function errorStatus(error: unknown, checkedAt: string, installed: boolean, version: string | null = null): WeComConnectorStatus {
    return {
        state: 'ERROR', installed, authenticated: false, version, checkedAt,
        issueCode: 'WECOM_CLI_ERROR', recoveryAction: installed ? 'RETRY' : 'INSTALL', error: safeError(error),
        source: installed ? 'MANAGED' : null, installSupported: Boolean(currentRelease()), authorizationState: 'UNAUTHORIZED',
        qrCodeDataUrl: null, authorizationExpiresAt: null, toolCount: 0,
    };
}

function readQrCodeDataUrl(): string | null {
    if (!qrCodePath) return null;
    try {
        const content = readFileSync(qrCodePath);
        return content.byteLength ? `data:image/png;base64,${content.toString('base64')}` : null;
    } catch {
        return null;
    }
}

function currentRelease(): WeComPlatformRelease | undefined {
    return RELEASES[`${process.platform}-${process.arch}`];
}

function weComEnvironment(): NodeJS.ProcessEnv {
    return { ...process.env, WECOM_CLI_CONFIG_DIR: requireConfigDirectory() };
}

function runWeCom(args: string[], timeoutMs: number): Promise<string> {
    return transport.execute(args, { timeoutMs, envOverrides: weComEnvironment(), outputLabel: '企业微信 CLI' });
}

function runWeComJson(args: string[], timeoutMs: number): Promise<unknown> {
    return transport.executeJson(args, { timeoutMs, envOverrides: weComEnvironment(), outputLabel: '企业微信 CLI' });
}

async function removeDirectoryWithinRoot(target: string): Promise<void> {
    const root = requireConnectorRoot();
    assertWithinRoot(target, root);
    await rm(target, { recursive: true, force: true });
}

function assertWithinRoot(target: string, root: string): void {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('企业微信连接器路径越界');
    }
}

async function waitForFile(file: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await fileExists(file)) {
            const info = await stat(file);
            if (info.size > 0) return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    stopAuthorization();
    throw new Error('企业微信 CLI 未能生成授权二维码');
}

async function fileExists(file: string): Promise<boolean> {
    try {
        await stat(file);
        return true;
    } catch {
        return false;
    }
}

async function mapWithConcurrency<Input, Output>(
    items: Input[],
    concurrency: number,
    mapper: (item: Input) => Promise<Output>,
): Promise<Output[]> {
    const result = new Array<Output>(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            result[index] = await mapper(items[index]!);
        }
    });
    await Promise.all(workers);
    return result;
}

function tarString(value: Buffer): string {
    const end = value.indexOf(0);
    return value.subarray(0, end >= 0 ? end : value.length).toString('utf8').trim();
}

function normalizeVersion(value: string): string {
    const match = value.match(/\b\d+\.\d+\.\d+\b/);
    return match?.[0] ?? value.trim().slice(0, 80);
}

function sanitizeText(value: string): string {
    return value
        .replace(/(?:bot[_-]?id|secret|token|authorization)\s*[:=]\s*\S+/gi, '[REDACTED]')
        .trim()
        .slice(0, 500);
}

function safeError(error: unknown): string {
    if (error instanceof LocalCliCommandError) return sanitizeText(error.stderr || error.message);
    return sanitizeText(error instanceof Error ? error.message : '企业微信连接器执行失败');
}

function cloneTool(tool: WeComConnectorTool): WeComConnectorTool {
    return { ...tool, parameters: structuredClone(tool.parameters) };
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireConnectorRoot(): string {
    if (!connectorRoot) throw new Error('企业微信连接器尚未初始化');
    return connectorRoot;
}

function requireExecutablePath(): string {
    if (!executablePath) throw new Error('企业微信连接器尚未初始化');
    return executablePath;
}

function requireConfigDirectory(): string {
    if (!configDirectory) throw new Error('企业微信连接器尚未初始化');
    return configDirectory;
}

function requireQrCodePath(): string {
    if (!qrCodePath) throw new Error('企业微信连接器尚未初始化');
    return qrCodePath;
}

function requireDownloadDirectory(): string {
    if (!downloadDirectory) throw new Error('企业微信连接器尚未初始化');
    return downloadDirectory;
}
