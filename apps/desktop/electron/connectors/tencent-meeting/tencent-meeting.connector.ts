import os from 'node:os';
import type {
    ConnectorContext,
    ConnectorPlannedCall,
    ConnectorStatus,
    ConnectorTool,
} from '../core/connector.types';
import { RemoteMcpError, RemoteMcpTransport } from '../transports/remote-mcp.transport';
import {
    TencentMeetingCredentialStore,
    validateTencentMeetingToken,
} from './tencent-meeting-credential-store';

export type TencentMeetingConnectorContext = ConnectorContext<'TENCENT_MEETING'>;
export type TencentMeetingConnectorPlannedCall = ConnectorPlannedCall;
export type TencentMeetingConnectorTool = ConnectorTool;

export interface TencentMeetingConnectorStatus extends ConnectorStatus {
    tokenConfigured: boolean;
    toolCount: number;
    verifiedAt: string | null;
}

interface McpToolDefinition {
    name?: unknown;
    title?: unknown;
    description?: unknown;
    inputSchema?: unknown;
    annotations?: {
        readOnlyHint?: unknown;
        destructiveHint?: unknown;
    };
}

interface McpToolListResult {
    tools?: unknown;
}

interface McpToolCallResult {
    content?: unknown;
    structuredContent?: unknown;
    isError?: unknown;
    error?: unknown;
}

export const TENCENT_MEETING_MCP_ENDPOINT = 'https://mcp.meeting.tencent.com/mcp/wemeet-open/v1';
export const TENCENT_MEETING_SKILL_VERSION = 'v1.0.11';
export const TENCENT_MEETING_TOKEN_URL = 'https://meeting.tencent.com/ai-skill.html';
const MAX_CONTEXT_BYTES = 56 * 1024;
const credentialStore = new TencentMeetingCredentialStore();
let toolCache: TencentMeetingConnectorTool[] | undefined;
let lastVerifiedAt: string | null = null;

export function configureTencentMeetingConnector(userDataPath: string): void {
    credentialStore.configure(userDataPath);
}

export async function getTencentMeetingConnectorStatus(): Promise<TencentMeetingConnectorStatus> {
    const token = await credentialStore.readToken();
    if (!token) return authRequiredStatus();
    try {
        const tools = await discoverToolsWithToken(token);
        toolCache = tools;
        lastVerifiedAt = new Date().toISOString();
        return readyStatus(tools.length, lastVerifiedAt);
    } catch (error) {
        toolCache = undefined;
        return errorStatus(error, true);
    }
}

export function requestTencentMeetingConnection(): Promise<TencentMeetingConnectorStatus> {
    return Promise.resolve(authRequiredStatus());
}

export async function connectTencentMeetingWithToken(token: string): Promise<TencentMeetingConnectorStatus> {
    const normalized = validateTencentMeetingToken(token);
    const tools = await discoverToolsWithToken(normalized);
    await credentialStore.writeToken(normalized);
    toolCache = tools;
    lastVerifiedAt = new Date().toISOString();
    return readyStatus(tools.length, lastVerifiedAt);
}

export async function disconnectTencentMeetingConnector(): Promise<TencentMeetingConnectorStatus> {
    await credentialStore.removeToken();
    resetTencentMeetingConnectorTools();
    lastVerifiedAt = null;
    return authRequiredStatus();
}

export function resetTencentMeetingConnectorTools(): void {
    toolCache = undefined;
}

export async function discoverTencentMeetingTools(): Promise<TencentMeetingConnectorTool[]> {
    if (toolCache) return toolCache.map(cloneTool);
    const token = await requireToken();
    const tools = await discoverToolsWithToken(token);
    toolCache = tools;
    lastVerifiedAt = new Date().toISOString();
    return tools.map(cloneTool);
}

export async function executeTencentMeetingCalls(
    calls: TencentMeetingConnectorPlannedCall[],
): Promise<TencentMeetingConnectorContext[]> {
    if (!Array.isArray(calls) || calls.length === 0 || calls.length > 3) {
        throw new Error('腾讯会议 MCP 每次必须执行一至三个工具调用');
    }
    const token = await requireToken();
    const tools = await discoverTencentMeetingTools();
    const toolMap = new Map(tools.map((tool) => [tool.toolId, tool]));
    const transport = createTransport(token);
    const contexts: TencentMeetingConnectorContext[] = [];
    for (const call of calls) {
        const tool = toolMap.get(call.toolId);
        if (!tool) throw new Error(`腾讯会议 MCP 工具不存在：${call.toolId}`);
        const result = await transport.request<McpToolCallResult>('tools/call', {
            name: tool.toolId,
            arguments: withClientInfo(call.arguments, tool.parameters),
        });
        const data = normalizeTencentMeetingToolResult(result);
        if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_CONTEXT_BYTES) {
            throw new Error(`腾讯会议工具 ${tool.name} 返回内容过大，请缩小查询范围`);
        }
        contexts.push({
            provider: 'TENCENT_MEETING',
            toolId: tool.toolId,
            toolName: tool.name,
            fetchedAt: new Date().toISOString(),
            data,
        });
    }
    return contexts;
}

async function discoverToolsWithToken(token: string): Promise<TencentMeetingConnectorTool[]> {
    const result = await createTransport(token).request<McpToolListResult>('tools/list');
    if (!Array.isArray(result.tools) || result.tools.length === 0) {
        throw new Error('腾讯会议 MCP 未返回可用工具');
    }
    const tools = result.tools.map(normalizeTencentMeetingToolDefinition);
    const names = new Set<string>();
    for (const tool of tools) {
        if (names.has(tool.toolId)) throw new Error(`腾讯会议 MCP 返回重复工具：${tool.toolId}`);
        names.add(tool.toolId);
    }
    return tools;
}

function createTransport(token: string): RemoteMcpTransport {
    return new RemoteMcpTransport({
        endpoint: TENCENT_MEETING_MCP_ENDPOINT,
        resolveHeaders: () => ({
            'X-Tencent-Meeting-Token': token,
            'X-Skill-Version': TENCENT_MEETING_SKILL_VERSION,
        }),
        timeoutMs: 20_000,
        maxResponseBytes: 512 * 1024,
    });
}

export function normalizeTencentMeetingToolDefinition(value: unknown): TencentMeetingConnectorTool {
    if (!isRecord(value)) throw new Error('腾讯会议 MCP 工具定义无效');
    const tool = value as McpToolDefinition;
    const name = typeof tool.name === 'string' ? tool.name.trim() : '';
    const description = typeof tool.description === 'string' ? tool.description.trim() : '';
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,119}$/.test(name) || !description) {
        throw new Error('腾讯会议 MCP 工具名称或描述无效');
    }
    const parameters = normalizeSchema(tool.inputSchema);
    const riskLevel = classifyTencentMeetingToolRisk(name, tool.annotations);
    return {
        toolId: name,
        name: typeof tool.title === 'string' && tool.title.trim() ? tool.title.trim() : name,
        description,
        parameters,
        riskLevel,
        requiresConfirmation: riskLevel !== 'READ',
    };
}

function normalizeSchema(value: unknown): Record<string, unknown> {
    if (!isRecord(value) || value.type !== 'object') throw new Error('腾讯会议 MCP 工具参数 Schema 无效');
    return structuredClone(value);
}

export function classifyTencentMeetingToolRisk(
    name: string,
    annotations?: McpToolDefinition['annotations'],
): 'READ' | 'WRITE' | 'DESTRUCTIVE' {
    if (annotations?.destructiveHint === true) return 'DESTRUCTIVE';
    if (annotations?.readOnlyHint === true) return 'READ';
    if (name === 'cancel_meeting' || name === 'update_meeting' || name === 'apply_record_permission_commit' || name === 'submit_feedback') {
        return 'DESTRUCTIVE';
    }
    if (name === 'schedule_meeting') return 'WRITE';
    if (/^(?:get|search|list|convert|check)_/.test(name) || name === 'apply_record_permission_prepare') return 'READ';
    return 'DESTRUCTIVE';
}

function withClientInfo(argumentsValue: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> {
    const next = structuredClone(argumentsValue);
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Object.prototype.hasOwnProperty.call(properties, '_client_info')) {
        next._client_info = {
            os: `${process.platform}-${os.release()}`,
            agent: 'cees-desktop',
            model: 'cees-assistant',
        };
    }
    return next;
}

export function normalizeTencentMeetingToolResult(result: McpToolCallResult): Record<string, unknown> {
    if (result.isError === true || isRecord(result.error)) {
        throw new Error(toolErrorMessage(result));
    }
    if (isRecord(result.structuredContent)) return sanitizeRecord(result.structuredContent);
    if (!Array.isArray(result.content)) return sanitizeRecord({ result });
    const items = result.content.map((item) => normalizeContentItem(item));
    if (items.length === 1 && typeof items[0] === 'string') {
        const parsed = parseJsonObject(items[0]);
        if (parsed) return sanitizeRecord(parsed);
    }
    return sanitizeRecord({ content: items });
}

function normalizeContentItem(value: unknown): unknown {
    if (!isRecord(value)) return value;
    if (value.type === 'text' && typeof value.text === 'string') return value.text;
    return value;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(value);
        return isRecord(parsed) ? parsed : { value: parsed };
    } catch {
        return null;
    }
}

function toolErrorMessage(result: McpToolCallResult): string {
    if (isRecord(result.error) && typeof result.error.message === 'string') return result.error.message;
    if (Array.isArray(result.content)) {
        const text = result.content.find((item) => isRecord(item) && item.type === 'text' && typeof item.text === 'string');
        if (isRecord(text) && typeof text.text === 'string') return text.text;
    }
    return '腾讯会议 MCP 工具执行失败';
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
        if (/(?:token|secret|cookie|authorization|credential|password)/i.test(key)) continue;
        next[key] = sanitizeValue(item, depth + 1);
    }
    return next;
}

async function requireToken(): Promise<string> {
    const token = await credentialStore.readToken();
    if (!token) throw new Error('请先在连接器页面配置腾讯会议个人 Token');
    return token;
}

function authRequiredStatus(): TencentMeetingConnectorStatus {
    return {
        state: 'AUTH_REQUIRED',
        installed: true,
        authenticated: false,
        version: TENCENT_MEETING_SKILL_VERSION,
        checkedAt: new Date().toISOString(),
        issueCode: 'TOKEN_REQUIRED',
        recoveryAction: 'AUTHORIZE',
        error: null,
        tokenConfigured: false,
        toolCount: 0,
        verifiedAt: null,
    };
}

function readyStatus(toolCount: number, verifiedAt: string): TencentMeetingConnectorStatus {
    return {
        state: 'READY',
        installed: true,
        authenticated: true,
        version: TENCENT_MEETING_SKILL_VERSION,
        checkedAt: verifiedAt,
        issueCode: null,
        recoveryAction: 'NONE',
        error: null,
        tokenConfigured: true,
        toolCount,
        verifiedAt,
    };
}

function errorStatus(error: unknown, tokenConfigured: boolean): TencentMeetingConnectorStatus {
    const retryable = error instanceof RemoteMcpError ? error.retryable : false;
    return {
        state: 'ERROR',
        installed: true,
        authenticated: false,
        version: TENCENT_MEETING_SKILL_VERSION,
        checkedAt: new Date().toISOString(),
        issueCode: retryable ? 'REMOTE_MCP_UNAVAILABLE' : 'TOKEN_INVALID',
        recoveryAction: retryable ? 'RETRY' : 'AUTHORIZE',
        error: retryable ? '腾讯会议远程 MCP 暂时不可用，请稍后重试' : '腾讯会议 Token 无效或已失效，请重新获取',
        tokenConfigured,
        toolCount: 0,
        verifiedAt: lastVerifiedAt,
    };
}

function cloneTool(tool: TencentMeetingConnectorTool): TencentMeetingConnectorTool {
    return { ...tool, parameters: structuredClone(tool.parameters) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
