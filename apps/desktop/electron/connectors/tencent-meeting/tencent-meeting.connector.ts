import { createHash } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type {
    ConnectorContext,
    ConnectorPlannedCall,
    ConnectorStatus,
    ConnectorTool,
} from '../core/connector.types';
import { LocalCliCommandError, LocalCliTransport } from '../transports/local-cli.transport';

export type TencentMeetingConnectorContext = ConnectorContext<'TENCENT_MEETING'>;
export type TencentMeetingConnectorPlannedCall = ConnectorPlannedCall;
export type TencentMeetingConnectorTool = ConnectorTool;

export interface TencentMeetingConnectorStatus extends ConnectorStatus {
    source: 'MANAGED' | null;
    installSupported: boolean;
    authorizationState: 'UNAUTHORIZED' | 'AUTHORIZED';
    authorizedUserName: string | null;
    authorizedOpenId: string | null;
    toolCount: number;
}

interface TencentMeetingRelease {
    url: string;
    sha256: string;
    archiveEntry: string;
    binaryName: string;
}

interface TencentMeetingCommandDescriptor {
    toolId: string;
    command: readonly [string, string];
    name: string;
    description: string;
}

interface TencentMeetingAuthIdentity {
    authenticated: boolean;
    userName: string | null;
    openId: string | null;
}

export const TENCENT_MEETING_CLI_VERSION = '1.0.18';
export const TENCENT_MEETING_PACKAGE_URL = `https://registry.npmjs.org/@tencentcloud/tmeet/-/tmeet-${TENCENT_MEETING_CLI_VERSION}.tgz`;
export const TENCENT_MEETING_PACKAGE_SHA256 = '51d0cbb69d8400e29e73e88a5e1a0a3b6ef84323e8fa723e7da6725974025e61';
const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;
const MAX_BINARY_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXT_BYTES = 56 * 1024;
const MAX_CALLS = 3;
const AUTHORIZATION_TIMEOUT_MS = 330_000;
const TOOL_DISCOVERY_CONCURRENCY = 6;
const SENSITIVE_KEY_PATTERN = /(?:token|secret|cookie|authorization|credential|password|(?:^|_)pwd(?:$|_))/i;

const RELEASES: Record<string, TencentMeetingRelease> = {
    'win32-x64': {
        url: TENCENT_MEETING_PACKAGE_URL,
        sha256: TENCENT_MEETING_PACKAGE_SHA256,
        archiveEntry: 'package/dist/tmeet-Windows-x86_64.exe',
        binaryName: 'tmeet.exe',
    },
    'darwin-arm64': {
        url: TENCENT_MEETING_PACKAGE_URL,
        sha256: TENCENT_MEETING_PACKAGE_SHA256,
        archiveEntry: 'package/dist/tmeet-macOS-AppleSilicon',
        binaryName: 'tmeet',
    },
    'darwin-x64': {
        url: TENCENT_MEETING_PACKAGE_URL,
        sha256: TENCENT_MEETING_PACKAGE_SHA256,
        archiveEntry: 'package/dist/tmeet-macOS-Intel',
        binaryName: 'tmeet',
    },
    'linux-arm64': {
        url: TENCENT_MEETING_PACKAGE_URL,
        sha256: TENCENT_MEETING_PACKAGE_SHA256,
        archiveEntry: 'package/dist/tmeet-Linux-ARM64',
        binaryName: 'tmeet',
    },
    'linux-x64': {
        url: TENCENT_MEETING_PACKAGE_URL,
        sha256: TENCENT_MEETING_PACKAGE_SHA256,
        archiveEntry: 'package/dist/tmeet-Linux-x86_64',
        binaryName: 'tmeet',
    },
};

export const TENCENT_MEETING_COMMANDS: readonly TencentMeetingCommandDescriptor[] = [
    command('app.get', '查询 CLI 应用信息', '查询当前账号的腾讯会议 CLI 应用展示配置'),
    command('app.set', '设置 CLI 应用信息', '修改当前账号的腾讯会议 CLI 应用展示配置'),
    command('meeting.get', '查询会议详情', '按会议 ID 查询会议详情'),
    command('meeting.list', '查询待开始会议', '查询当前账号进行中或即将开始的会议'),
    command('meeting.list-ended', '查询已结束会议', '按时间范围查询当前账号已结束的会议'),
    command('meeting.search', '搜索会议', '按关键词、会议码或时间范围搜索当前账号可见会议'),
    command('meeting.create', '创建会议', '创建普通或周期性腾讯会议'),
    command('meeting.update', '更新会议', '更新会议主题、时间、入会限制、录制或受邀成员配置'),
    command('meeting.cancel', '取消会议', '取消普通会议、周期会议或指定子会议'),
    command('meeting.invitees-list', '查询会议受邀成员', '查询指定会议的受邀成员列表'),
    command('meeting.invitees-add', '添加会议受邀成员', '向指定会议添加受邀成员'),
    command('meeting.invitees-remove', '移除会议受邀成员', '从指定会议移除受邀成员'),
    command('meeting.invitees-replace', '替换会议受邀成员', '全量替换指定会议的受邀成员列表'),
    command('record.list', '查询会议录制', '查询指定会议的云录制列表'),
    command('record.address', '查询录制播放地址', '查询指定录制文件的播放或下载地址'),
    command('record.search', '搜索会议录制', '按关键词和时间范围搜索当前账号可见录制'),
    command('record.smart-minutes', '查询录制智能纪要', '查询指定录制的智能纪要'),
    command('record.transcript-get', '查询录制转写', '查询指定录制的完整转写内容'),
    command('record.transcript-paragraphs', '查询录制转写段落', '分页查询指定录制的转写段落'),
    command('record.transcript-search', '搜索录制转写', '在指定录制转写中搜索关键词'),
    command('record.permission-apply-prepare', '预览录制权限申请', '预览获取指定录制访问权限所需的申请'),
    command('record.permission-apply-commit', '提交录制权限申请', '在用户确认后提交指定录制访问权限申请'),
    command('report.participants', '查询参会成员报告', '查询指定会议的参会成员明细'),
    command('report.waiting-room-log', '查询等候室记录', '查询指定会议的等候室成员记录'),
    command('report.participants-export', '导出参会成员报告', '创建参会成员明细导出任务'),
    command('report.job-result', '查询报告导出结果', '查询异步参会报告导出任务结果'),
    command('minutes.search', '搜索元宝纪要', '按关键词和时间范围搜索腾讯会议元宝纪要'),
    command('minutes.get', '查询元宝纪要详情', '查询指定腾讯会议元宝纪要的稳态或滚动内容'),
    command('control.call', '呼叫成员入会', '呼叫指定成员加入当前会议'),
    command('control.kick', '移出会议成员', '将指定成员移出当前会议'),
    command('control.waiting-room', '管理等候室成员', '允许或拒绝等候室中的指定成员入会'),
];

let connectorRoot: string | undefined;
let executablePath: string | undefined;
let configDirectory: string | undefined;
let dataDirectory: string | undefined;
let installPromise: Promise<void> | null = null;
let toolCache: TencentMeetingConnectorTool[] | undefined;

const transport = new LocalCliTransport({
    resolveExecutable: () => ({ command: requireExecutablePath(), source: 'MANAGED' }),
    maxBufferBytes: 16 * 1024 * 1024,
});

export function configureTencentMeetingConnector(userDataPath: string): void {
    const root = path.resolve(userDataPath, 'connectors', 'tencent-meeting');
    const release = currentRelease();
    connectorRoot = root;
    configDirectory = path.join(root, 'config');
    dataDirectory = path.join(root, 'data');
    executablePath = release
        ? path.join(root, 'runtime', TENCENT_MEETING_CLI_VERSION, release.binaryName)
        : undefined;
    installPromise = null;
    toolCache = undefined;
}

export async function getTencentMeetingConnectorStatus(): Promise<TencentMeetingConnectorStatus> {
    const checkedAt = new Date().toISOString();
    const release = currentRelease();
    if (!release || !executablePath) return unsupportedStatus(checkedAt);
    if (!(await fileExists(executablePath))) return notInstalledStatus(checkedAt);

    let version: string;
    try {
        version = normalizeTencentMeetingVersion(await runTencentMeeting(['--version'], 15_000));
    } catch (error) {
        return errorStatus(error, checkedAt, true);
    }

    try {
        const identity = parseTencentMeetingAuthStatus(await runTencentMeeting(['auth', 'status'], 30_000));
        if (!identity.authenticated) return authRequiredStatus(version, checkedAt);
        return readyStatus(version, checkedAt, identity);
    } catch (error) {
        return errorStatus(error, checkedAt, true, version);
    }
}

export async function installAndAuthorizeTencentMeetingConnector(): Promise<TencentMeetingConnectorStatus> {
    await ensureTencentMeetingInstalled();
    const current = await getTencentMeetingConnectorStatus();
    if (current.state === 'READY') return current;
    await runTencentMeeting(['auth', 'login'], AUTHORIZATION_TIMEOUT_MS);
    const status = await getTencentMeetingConnectorStatus();
    if (status.state !== 'READY') throw new Error(status.error || '腾讯会议 OAuth 授权尚未完成');
    return status;
}

export async function disconnectTencentMeetingConnector(): Promise<TencentMeetingConnectorStatus> {
    resetTencentMeetingConnectorTools();
    if (executablePath && await fileExists(executablePath)) {
        try {
            await runTencentMeeting(['auth', 'logout'], 30_000);
        } catch (error) {
            if (!isAlreadyLoggedOut(error)) throw error;
        }
    }
    if (configDirectory) await removeDirectoryWithinRoot(configDirectory);
    if (dataDirectory) await removeDirectoryWithinRoot(dataDirectory);
    return getTencentMeetingConnectorStatus();
}

export function resetTencentMeetingConnectorTools(): void {
    toolCache = undefined;
}

export async function discoverTencentMeetingTools(): Promise<TencentMeetingConnectorTool[]> {
    if (toolCache) return toolCache.map(cloneTool);
    await requireAuthorized();
    const discovered = await mapWithConcurrency(
        TENCENT_MEETING_COMMANDS,
        TOOL_DISCOVERY_CONCURRENCY,
        async (descriptor) => {
            try {
                const help = await runTencentMeeting([...descriptor.command, '--help'], 15_000);
                return parseTencentMeetingCommandHelp(descriptor, help);
            } catch {
                return null;
            }
        },
    );
    const tools = discovered.filter((tool): tool is TencentMeetingConnectorTool => Boolean(tool));
    if (tools.length === 0) throw new Error('腾讯会议 CLI 未返回可用命令');
    toolCache = tools;
    return tools.map(cloneTool);
}

export async function executeTencentMeetingCalls(
    calls: TencentMeetingConnectorPlannedCall[],
): Promise<TencentMeetingConnectorContext[]> {
    if (!Array.isArray(calls) || calls.length === 0 || calls.length > MAX_CALLS) {
        throw new Error('腾讯会议连接器每次必须执行一至三个工具调用');
    }
    await requireAuthorized();
    const tools = await discoverTencentMeetingTools();
    const toolMap = new Map(tools.map((tool) => [tool.toolId, tool]));
    const contexts: TencentMeetingConnectorContext[] = [];
    for (const call of calls) {
        const tool = toolMap.get(call.toolId);
        if (!tool) throw new Error(`腾讯会议 CLI 工具不存在：${call.toolId}`);
        assertTencentMeetingCallAllowed(tool, call);
        const args = buildTencentMeetingCliArguments(tool, call.arguments);
        const payload = await runTencentMeetingJson(args, 90_000);
        const data = normalizeTencentMeetingCliResult(payload);
        if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_CONTEXT_BYTES) {
            throw new Error(`腾讯会议工具 ${tool.name} 返回内容过大，请缩小查询范围`);
        }
        contexts.push({
            provider: 'TENCENT_MEETING',
            toolId: tool.toolId,
            toolName: tool.name,
            fetchedAt: new Date().toISOString(),
            data,
            riskLevel: tool.riskLevel ?? 'DESTRUCTIVE',
            confirmed: call.confirmed === true,
        });
    }
    return contexts;
}

export function parseTencentMeetingCommandHelp(
    descriptor: TencentMeetingCommandDescriptor,
    helpOutput: string,
): TencentMeetingConnectorTool {
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];
    let inFlags = false;
    for (const line of helpOutput.split(/\r?\n/)) {
        if (line.trim() === 'Flags:') {
            inFlags = true;
            continue;
        }
        if (line.trim() === 'Global Flags:') break;
        if (!inFlags) continue;
        const match = line.match(/^\s+(?:-[A-Za-z],\s+)?--([a-z0-9-]+)(?:\s+(string|strings|int|int32|int64|float|float64|duration))?\s{2,}(.+)$/i);
        if (!match || match[1] === 'help') continue;
        const [, flagName, flagType, rawDescription] = match;
        const parameterName = flagName.replace(/-/g, '_');
        properties[parameterName] = {
            ...schemaForFlagType(flagType),
            description: rawDescription.trim(),
        };
        if (/\(required\)/i.test(rawDescription)) required.push(parameterName);
    }
    return {
        toolId: descriptor.toolId,
        name: descriptor.name,
        description: `${descriptor.description}。官方命令：tmeet ${descriptor.command.join(' ')}`,
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties,
            ...(required.length > 0 ? { required } : {}),
        },
        riskLevel: classifyTencentMeetingToolRisk(descriptor.toolId),
        requiresConfirmation: classifyTencentMeetingToolRisk(descriptor.toolId) !== 'READ',
    };
}

export function classifyTencentMeetingToolRisk(toolId: string): 'READ' | 'WRITE' | 'DESTRUCTIVE' {
    if (/^(?:meeting\.cancel|control\.kick|record\.permission-apply-commit)$/.test(toolId)) return 'DESTRUCTIVE';
    if (/^(?:app\.set|meeting\.(?:create|update|invitees-add|invitees-remove|invitees-replace)|control\.(?:call|waiting-room)|report\.participants-export)$/.test(toolId)) return 'WRITE';
    if (/^(?:app\.get|meeting\.(?:get|list|list-ended|search|invitees-list)|record\.(?:list|address|search|smart-minutes|transcript-get|transcript-paragraphs|transcript-search|permission-apply-prepare)|report\.(?:participants|waiting-room-log|job-result)|minutes\.(?:search|get))$/.test(toolId)) return 'READ';
    return 'DESTRUCTIVE';
}

export function buildTencentMeetingCliArguments(
    tool: TencentMeetingConnectorTool,
    argumentsValue: Record<string, unknown>,
): string[] {
    const descriptor = TENCENT_MEETING_COMMANDS.find((item) => item.toolId === tool.toolId);
    if (!descriptor) throw new Error(`腾讯会议 CLI 工具不存在：${tool.toolId}`);
    const properties = isRecord(tool.parameters.properties) ? tool.parameters.properties : {};
    const required = Array.isArray(tool.parameters.required)
        ? tool.parameters.required.filter((value): value is string => typeof value === 'string')
        : [];
    for (const parameter of required) {
        if (!(parameter in argumentsValue)) throw new Error(`腾讯会议工具 ${tool.name} 缺少参数：${parameter}`);
    }
    const args = [...descriptor.command];
    for (const [key, value] of Object.entries(argumentsValue)) {
        const schema = properties[key];
        if (!isRecord(schema)) throw new Error(`腾讯会议工具 ${tool.name} 不支持参数：${key}`);
        const flag = `--${key.replace(/_/g, '-')}`;
        appendFlagArguments(args, flag, value, schema.type);
    }
    args.push('--format', 'json');
    if (tool.riskLevel === 'READ') args.push('--compact');
    return args;
}

export function assertTencentMeetingCallAllowed(
    tool: TencentMeetingConnectorTool,
    call: TencentMeetingConnectorPlannedCall,
): void {
    if (tool.toolId !== call.toolId) throw new Error('腾讯会议工具调用与定义不一致');
    if (tool.requiresConfirmation && call.confirmed !== true) {
        throw new Error(`腾讯会议操作 ${tool.name} 需要用户确认`);
    }
}

export function parseTencentMeetingAuthStatus(output: string): TencentMeetingAuthIdentity {
    if (/Not logged in/i.test(output)) return { authenticated: false, userName: null, openId: null };
    if (!/^Logged in/m.test(output)) throw new Error('腾讯会议 CLI 返回了未知授权状态');
    return {
        authenticated: true,
        userName: output.match(/^\s*UserName:\s*(.+)$/mi)?.[1]?.trim() || null,
        openId: output.match(/^\s*OpenId:\s*(.+)$/mi)?.[1]?.trim() || null,
    };
}

export function normalizeTencentMeetingCliResult(value: unknown): Record<string, unknown> {
    if (isRecord(value)) return sanitizeRecord(value);
    if (Array.isArray(value)) return sanitizeRecord({ items: value });
    return sanitizeRecord({ result: value });
}

export function extractTencentMeetingBinaryArchive(archive: Buffer, expectedEntry: string): Buffer {
    const tar = gunzipSync(archive, { maxOutputLength: MAX_BINARY_BYTES * 6 });
    let offset = 0;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;
        const name = tarString(header.subarray(0, 100));
        const prefix = tarString(header.subarray(345, 500));
        const entryPath = prefix ? `${prefix}/${name}` : name;
        const size = Number.parseInt(tarString(header.subarray(124, 136)).replace(/\0/g, '').trim() || '0', 8);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BINARY_BYTES) {
            throw new Error('腾讯会议 CLI 安装包条目无效');
        }
        const dataStart = offset + 512;
        const dataEnd = dataStart + size;
        if (dataEnd > tar.length) throw new Error('腾讯会议 CLI 安装包已损坏');
        if (entryPath === expectedEntry) return Buffer.from(tar.subarray(dataStart, dataEnd));
        offset = dataStart + Math.ceil(size / 512) * 512;
    }
    throw new Error('腾讯会议 CLI 安装包缺少当前平台可执行文件');
}

async function ensureTencentMeetingInstalled(): Promise<void> {
    const release = currentRelease();
    if (!release || !executablePath) throw new Error('当前操作系统或 CPU 架构暂不支持自动安装腾讯会议 CLI');
    if (await fileExists(executablePath)) return;
    if (!installPromise) {
        installPromise = installTencentMeetingRelease(release).finally(() => {
            installPromise = null;
        });
    }
    await installPromise;
}

async function installTencentMeetingRelease(release: TencentMeetingRelease): Promise<void> {
    const response = await fetch(release.url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`下载腾讯会议 CLI 失败（HTTP ${response.status}）`);
    const declaredLength = Number(response.headers.get('content-length') || '0');
    if (declaredLength > MAX_ARCHIVE_BYTES) throw new Error('腾讯会议 CLI 安装包超过大小限制');
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length === 0 || archive.length > MAX_ARCHIVE_BYTES) throw new Error('腾讯会议 CLI 安装包大小无效');
    const sha256 = createHash('sha256').update(archive).digest('hex');
    if (sha256 !== release.sha256) throw new Error('腾讯会议 CLI 安装包校验失败');
    const binary = extractTencentMeetingBinaryArchive(archive, release.archiveEntry);
    const target = requireExecutablePath();
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, binary, { mode: 0o700 });
    if (process.platform !== 'win32') await chmod(temporary, 0o700);
    await rename(temporary, target);
}

async function requireAuthorized(): Promise<void> {
    const status = await getTencentMeetingConnectorStatus();
    if (status.state === 'NOT_INSTALLED') throw new Error('请先安装腾讯会议连接器');
    if (status.state !== 'READY') throw new Error(status.error || '请先完成腾讯会议 OAuth 授权');
}

async function runTencentMeeting(args: string[], timeoutMs: number): Promise<string> {
    return transport.execute(args, {
        timeoutMs,
        envOverrides: connectorEnvironment(),
        outputLabel: '腾讯会议 CLI',
    });
}

async function runTencentMeetingJson(args: string[], timeoutMs: number): Promise<unknown> {
    return transport.executeJson(args, {
        timeoutMs,
        envOverrides: connectorEnvironment(),
        outputLabel: '腾讯会议 CLI',
    });
}

function connectorEnvironment(): NodeJS.ProcessEnv {
    return {
        TMEET_CLI_CONFIG_DIR: requireConfigDirectory(),
        TMEET_CLI_DATA_DIR: requireDataDirectory(),
    };
}

function currentRelease(): TencentMeetingRelease | undefined {
    return RELEASES[`${process.platform}-${process.arch}`];
}

function command(
    toolId: string,
    name: string,
    description: string,
): TencentMeetingCommandDescriptor {
    const [group, action] = toolId.split('.');
    if (!group || !action) throw new Error(`腾讯会议命令 ID 无效：${toolId}`);
    return { toolId, command: [group, action], name, description };
}

function schemaForFlagType(flagType?: string): Record<string, unknown> {
    if (flagType === 'strings') return { type: 'array', items: { type: 'string' } };
    if (flagType === 'int' || flagType === 'int32' || flagType === 'int64') return { type: 'integer' };
    if (flagType === 'float' || flagType === 'float64') return { type: 'number' };
    if (!flagType) return { type: 'boolean' };
    return { type: 'string' };
}

function appendFlagArguments(args: string[], flag: string, value: unknown, schemaType: unknown): void {
    if (schemaType === 'array') {
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
            throw new Error(`腾讯会议 CLI 参数 ${flag} 必须是非空字符串数组`);
        }
        value.forEach((item) => args.push(flag, item));
        return;
    }
    if (schemaType === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(`腾讯会议 CLI 参数 ${flag} 必须是布尔值`);
        args.push(`${flag}=${String(value)}`);
        return;
    }
    if (schemaType === 'integer' || schemaType === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value) || (schemaType === 'integer' && !Number.isInteger(value))) {
            throw new Error(`腾讯会议 CLI 参数 ${flag} 必须是${schemaType === 'integer' ? '整数' : '数字'}`);
        }
        args.push(flag, String(value));
        return;
    }
    if (typeof value !== 'string' || !value.trim()) throw new Error(`腾讯会议 CLI 参数 ${flag} 必须是非空字符串`);
    args.push(flag, value);
}

function normalizeTencentMeetingVersion(output: string): string {
    const match = output.match(/v?\d+\.\d+\.\d+/);
    if (!match) throw new Error('腾讯会议 CLI 未返回有效版本号');
    return match[0].startsWith('v') ? match[0].slice(1) : match[0];
}

function notInstalledStatus(checkedAt: string): TencentMeetingConnectorStatus {
    return {
        state: 'NOT_INSTALLED', installed: false, authenticated: false, version: null, checkedAt,
        issueCode: 'TMEET_NOT_INSTALLED', recoveryAction: 'INSTALL', error: null,
        source: null, installSupported: true, authorizationState: 'UNAUTHORIZED',
        authorizedUserName: null, authorizedOpenId: null, toolCount: 0,
    };
}

function unsupportedStatus(checkedAt: string): TencentMeetingConnectorStatus {
    return {
        ...notInstalledStatus(checkedAt),
        issueCode: 'TMEET_PLATFORM_UNSUPPORTED', recoveryAction: 'MANUAL_INSTALL', installSupported: false,
        error: '当前操作系统或 CPU 架构暂不支持腾讯会议 CLI',
    };
}

function authRequiredStatus(version: string, checkedAt: string): TencentMeetingConnectorStatus {
    return {
        state: 'AUTH_REQUIRED', installed: true, authenticated: false, version, checkedAt,
        issueCode: 'TMEET_AUTH_REQUIRED', recoveryAction: 'AUTHORIZE', error: null,
        source: 'MANAGED', installSupported: true, authorizationState: 'UNAUTHORIZED',
        authorizedUserName: null, authorizedOpenId: null, toolCount: 0,
    };
}

function readyStatus(
    version: string,
    checkedAt: string,
    identity: TencentMeetingAuthIdentity,
): TencentMeetingConnectorStatus {
    return {
        state: 'READY', installed: true, authenticated: true, version, checkedAt,
        issueCode: null, recoveryAction: 'NONE', error: null,
        source: 'MANAGED', installSupported: true, authorizationState: 'AUTHORIZED',
        authorizedUserName: identity.userName, authorizedOpenId: identity.openId,
        toolCount: TENCENT_MEETING_COMMANDS.length,
    };
}

function errorStatus(
    error: unknown,
    checkedAt: string,
    installed: boolean,
    version: string | null = null,
): TencentMeetingConnectorStatus {
    const timedOut = error instanceof LocalCliCommandError && error.timedOut;
    return {
        state: 'ERROR', installed, authenticated: false, version, checkedAt,
        issueCode: timedOut ? 'TMEET_AUTH_TIMEOUT' : 'TMEET_CLI_ERROR',
        recoveryAction: timedOut ? 'AUTHORIZE' : 'RETRY',
        error: timedOut ? '腾讯会议 OAuth 授权已超时，请重新连接' : safeError(error),
        source: installed ? 'MANAGED' : null, installSupported: true, authorizationState: 'UNAUTHORIZED',
        authorizedUserName: null, authorizedOpenId: null, toolCount: 0,
    };
}

function isAlreadyLoggedOut(error: unknown): boolean {
    if (!(error instanceof LocalCliCommandError)) return false;
    return /not logged in|user config is empty/i.test(`${error.stdout}\n${error.stderr}`);
}

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
    return sanitizeValue(value, 0) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, depth: number): unknown {
    if (depth > 12) return '[内容层级过深]';
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
    if (!isRecord(value)) return value;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) continue;
        next[key] = sanitizeValue(item, depth + 1);
    }
    return next;
}

function cloneTool(tool: TencentMeetingConnectorTool): TencentMeetingConnectorTool {
    return { ...tool, parameters: structuredClone(tool.parameters) };
}

async function mapWithConcurrency<T, R>(
    values: readonly T[],
    concurrency: number,
    mapper: (value: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(values.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (nextIndex < values.length) {
            const index = nextIndex++;
            results[index] = await mapper(values[index]!);
        }
    });
    await Promise.all(workers);
    return results;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        return (await stat(filePath)).isFile();
    } catch {
        return false;
    }
}

async function removeDirectoryWithinRoot(directory: string): Promise<void> {
    const root = requireConnectorRoot();
    const resolved = path.resolve(directory);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error('拒绝删除腾讯会议连接器目录之外的路径');
    }
    await rm(resolved, { recursive: true, force: true });
}

function tarString(value: Buffer): string {
    const end = value.indexOf(0);
    return value.subarray(0, end < 0 ? value.length : end).toString('utf8');
}

function safeError(error: unknown): string {
    if (error instanceof LocalCliCommandError) {
        const detail = (error.stderr || error.stdout || error.message).trim();
        return detail.slice(0, 1200) || '腾讯会议 CLI 执行失败';
    }
    return error instanceof Error ? error.message : '腾讯会议 CLI 执行失败';
}

function requireConnectorRoot(): string {
    if (!connectorRoot) throw new Error('腾讯会议连接器尚未初始化');
    return connectorRoot;
}

function requireExecutablePath(): string {
    if (!executablePath) throw new Error('腾讯会议连接器尚未初始化或当前平台不受支持');
    return executablePath;
}

function requireConfigDirectory(): string {
    if (!configDirectory) throw new Error('腾讯会议连接器尚未初始化');
    return configDirectory;
}

function requireDataDirectory(): string {
    if (!dataDirectory) throw new Error('腾讯会议连接器尚未初始化');
    return dataDirectory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
