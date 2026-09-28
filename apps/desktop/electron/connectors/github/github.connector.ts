import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type {
    ConnectorContext,
    ConnectorPlannedCall,
    ConnectorStatus,
    ConnectorTool,
} from '../core/connector.types';
import { SecureTokenStore } from '../../secure-store';
import {
    defaultMcpConfigPath,
    loadRemoteMcpDefinition,
    type RemoteMcpConnectorDefinition,
} from '../mcp/mcp.config';
import { createRemoteMcpClient } from '../mcp/remote-mcp-client';
import {
    buildLoopbackRedirectUrl,
    createLoopbackOAuthCallback,
    RemoteMcpOAuthProvider,
} from '../mcp/remote-mcp-oauth';

export const GITHUB_MCP_ENDPOINT = 'https://api.githubcopilot.com/mcp/';
export const GITHUB_MCP_TOOLSETS = 'context,issues,pull_requests,repos,users,actions,notifications';
const GITHUB_OAUTH_CALLBACK_PATH = '/oauth/github/callback';
const MAX_TOOLS = 256;
const MAX_CALLS = 3;
const MAX_CONTEXT_BYTES = 56 * 1024;
const MAX_TOOL_SCHEMA_BYTES = 32 * 1024;
const CONNECT_TIMEOUT_MS = 30_000;
const TOOL_TIMEOUT_MS = 120_000;
const TOKEN_STORE_FILE = 'connectors/github/oauth.secure';
const TOKEN_STORE_KEY = 'github.oauth.tokens';
const IDENTITY_STORE_KEY = 'github.oauth.identity';
const SENSITIVE_KEY_PATTERN = /(?:token|secret|cookie|authorization|credential|password|private[_-]?key)/i;
const BINARY_KEY_PATTERN = /^(?:data|blob|content_base64|base64)$/i;
const TOOL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,119}$/;

export type GitHubConnectorContext = ConnectorContext<'GITHUB'>;
export type GitHubConnectorPlannedCall = ConnectorPlannedCall;
export type GitHubConnectorTool = ConnectorTool & {
    riskLevel: 'READ' | 'WRITE' | 'DESTRUCTIVE';
    requiresConfirmation: boolean;
};

export interface GitHubConnectorStatus extends ConnectorStatus {
    source: 'REMOTE_MCP' | null;
    authorizationState: 'UNAUTHORIZED' | 'AUTHORIZING' | 'AUTHORIZED';
    authorizedLogin: string | null;
    toolCount: number;
    enabledToolsets: string[];
}

interface StoredGitHubIdentity {
    login: string | null;
}

let tokenStore: SecureTokenStore | undefined;
let toolCache: GitHubConnectorTool[] | undefined;
let authorizationInProgress = false;
let mcpDefinition: RemoteMcpConnectorDefinition | undefined;

export function configureGitHubConnector(userDataPath: string): void {
    tokenStore = new SecureTokenStore(userDataPath, TOKEN_STORE_FILE, true);
    mcpDefinition = loadRemoteMcpDefinition(defaultMcpConfigPath(__dirname), 'connector:github', GITHUB_MCP_ENDPOINT);
}

export async function getGitHubConnectorStatus(): Promise<GitHubConnectorStatus> {
    const checkedAt = new Date().toISOString();
    if (!githubClientId()) return configurationErrorStatus(checkedAt, 'GITHUB_OAUTH_CLIENT_ID_MISSING', 'GitHub OAuth Client ID 未配置，请由 CEES 部署方设置 CEES_GITHUB_OAUTH_CLIENT_ID');
    if (!githubClientSecret()) return configurationErrorStatus(checkedAt, 'GITHUB_OAUTH_CLIENT_SECRET_MISSING', 'GitHub OAuth Client Secret 未配置，请由 CEES 部署方设置 CEES_GITHUB_OAUTH_CLIENT_SECRET');
    if (authorizationInProgress) return authRequiredStatus(checkedAt, 'AUTHORIZING');
    if (!await hasStoredTokens()) return authRequiredStatus(checkedAt, 'UNAUTHORIZED');
    try {
        const tools = await discoverGitHubTools();
        const identity = await readStoredIdentity();
        return readyStatus(checkedAt, tools.length, identity.login);
    } catch (error) {
        if (isUnauthorizedError(error)) {
            await clearStoredCredentials();
            return authRequiredStatus(checkedAt, 'UNAUTHORIZED');
        }
        return errorStatus(checkedAt, error);
    }
}

export async function connectGitHubConnector(): Promise<GitHubConnectorStatus> {
    const clientId = githubClientId();
    if (!clientId) throw new Error('GitHub OAuth Client ID 未配置，请设置 CEES_GITHUB_OAUTH_CLIENT_ID');
    const clientSecret = githubClientSecret();
    if (!clientSecret) throw new Error('GitHub OAuth Client Secret 未配置，请设置 CEES_GITHUB_OAUTH_CLIENT_SECRET');
    if (authorizationInProgress) return authRequiredStatus(new Date().toISOString(), 'AUTHORIZING');
    authorizationInProgress = true;
    toolCache = undefined;
    const callback = await createLoopbackOAuthCallback(GITHUB_OAUTH_CALLBACK_PATH, getMcpTimeout());
    const provider = new RemoteMcpOAuthProvider({
        clientId,
        clientSecret,
        redirectUrl: callback.redirectUrl,
        expectedState: callback.state,
        clientName: 'CEES AI Desktop',
        scope: 'repo read:org read:user user:email notifications offline_access',
        interactive: true,
        isAuthorizationUrlAllowed: isAllowedGitHubAuthorizationUrl,
        allowedResource: allowGitHubResourceUrl,
        readTokens: readStoredTokens,
        saveTokens: saveStoredTokens,
        invalidateTokens: clearStoredCredentials,
    });
    try {
        const initial = createGitHubMcpClient(provider);
        try {
            await initial.client.connect(initial.transport, { timeout: getMcpTimeout() });
        } catch (error) {
            if (!isUnauthorizedError(error)) throw error;
            const authorizationCode = await callback.code;
            await initial.transport.finishAuth(authorizationCode);
        } finally {
            await initial.close();
        }
        const connected = await openAuthenticatedClient();
        try {
            const tools = await listAndNormalizeTools(connected.client);
            toolCache = tools;
            await cacheGitHubIdentity(connected.client, tools);
        } finally {
            await connected.close();
        }
        const identity = await readStoredIdentity();
        return readyStatus(new Date().toISOString(), toolCache.length, identity.login);
    } finally {
        authorizationInProgress = false;
        await callback.close();
    }
}

export async function disconnectGitHubConnector(): Promise<GitHubConnectorStatus> {
    authorizationInProgress = false;
    toolCache = undefined;
    await clearStoredCredentials();
    return authRequiredStatus(new Date().toISOString(), 'UNAUTHORIZED');
}

export function resetGitHubTools(): void {
    toolCache = undefined;
}

export async function discoverGitHubTools(): Promise<GitHubConnectorTool[]> {
    if (toolCache) return toolCache.map(cloneTool);
    const connected = await openAuthenticatedClient();
    try {
        toolCache = await listAndNormalizeTools(connected.client);
        return toolCache.map(cloneTool);
    } finally {
        await connected.close();
    }
}

export async function executeGitHubCalls(calls: GitHubConnectorPlannedCall[]): Promise<GitHubConnectorContext[]> {
    if (!Array.isArray(calls) || calls.length === 0 || calls.length > MAX_CALLS) {
        throw new Error('GitHub 连接器每次必须执行一至三个工具调用');
    }
    const tools = await discoverGitHubTools();
    const toolMap = new Map(tools.map((tool) => [tool.toolId, tool]));
    const connected = await openAuthenticatedClient();
    try {
        const contexts: GitHubConnectorContext[] = [];
        for (const call of calls) {
            const tool = toolMap.get(call.toolId);
            if (!tool) throw new Error(`GitHub MCP 工具不存在：${call.toolId}`);
            assertGitHubCallAllowed(tool, call);
            validateArguments(call.arguments);
            const result = await connected.client.callTool({
                name: call.toolId,
                arguments: call.arguments,
            }, undefined, { timeout: TOOL_TIMEOUT_MS, maxTotalTimeout: TOOL_TIMEOUT_MS });
            if ('isError' in result && result.isError === true) {
                throw new Error(extractGitHubToolError(result));
            }
            contexts.push({
                provider: 'GITHUB',
                toolId: tool.toolId,
                toolName: tool.name,
                fetchedAt: new Date().toISOString(),
                data: limitContext(sanitizeValue(result, 0)),
            });
        }
        return contexts;
    } finally {
        await connected.close();
    }
}

export function normalizeGitHubTool(value: {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    annotations?: Record<string, unknown>;
}): GitHubConnectorTool {
    if (!TOOL_ID_PATTERN.test(value.name)) throw new Error('GitHub MCP 工具名称无效');
    const description = value.description?.trim();
    if (!description) throw new Error('GitHub MCP 工具描述无效');
    if (!isRecord(value.inputSchema) || value.inputSchema.type !== 'object') throw new Error('GitHub MCP 工具参数 Schema 无效');
    if (Buffer.byteLength(JSON.stringify(value.inputSchema), 'utf8') > MAX_TOOL_SCHEMA_BYTES) {
        throw new Error('GitHub MCP 工具参数 Schema 过大');
    }
    const riskLevel = classifyGitHubToolRisk(value.name, value.annotations);
    return {
        toolId: value.name,
        name: value.name,
        description,
        parameters: structuredClone(value.inputSchema),
        riskLevel,
        requiresConfirmation: riskLevel !== 'READ',
    };
}

export function classifyGitHubToolRisk(
    toolName: string,
    annotations: Record<string, unknown> | undefined,
): 'READ' | 'WRITE' | 'DESTRUCTIVE' {
    if (annotations?.readOnlyHint === true) return 'READ';
    if (annotations?.destructiveHint === true) return 'DESTRUCTIVE';
    if (/^(?:get|list|search|read|fetch|download|view|show|check)_/i.test(toolName)) return 'READ';
    if (/(?:delete|remove|cancel|close|merge|dismiss|rerun|run_workflow)/i.test(toolName)) return 'DESTRUCTIVE';
    if (/(?:create|update|add|edit|write|submit|reply|assign|label|mark|request)/i.test(toolName)) return 'WRITE';
    return 'DESTRUCTIVE';
}

export function assertGitHubCallAllowed(tool: GitHubConnectorTool, call: GitHubConnectorPlannedCall): void {
    if (tool.toolId !== call.toolId) throw new Error('GitHub MCP 工具调用与定义不一致');
    if (tool.requiresConfirmation && call.confirmed !== true) {
        throw new Error(`GitHub 操作 ${tool.name} 需要用户确认`);
    }
}

export function sanitizeGitHubResult(value: unknown): Record<string, unknown> {
    return limitContext(sanitizeValue(value, 0));
}

async function openAuthenticatedClient(): Promise<ConnectedGitHubClient> {
    if (!githubClientId()) throw new Error('GitHub OAuth Client ID 未配置，请设置 CEES_GITHUB_OAUTH_CLIENT_ID');
    if (!githubClientSecret()) throw new Error('GitHub OAuth Client Secret 未配置，请设置 CEES_GITHUB_OAUTH_CLIENT_SECRET');
    if (!await hasStoredTokens()) throw new UnauthorizedError('GitHub 尚未授权');
    const provider = new RemoteMcpOAuthProvider({
        clientId: githubClientId()!,
        clientSecret: githubClientSecret()!,
        redirectUrl: buildLoopbackRedirectUrl(GITHUB_OAUTH_CALLBACK_PATH),
        expectedState: '',
        clientName: 'CEES AI Desktop',
        scope: 'repo read:org read:user user:email notifications offline_access',
        interactive: false,
        isAuthorizationUrlAllowed: isAllowedGitHubAuthorizationUrl,
        allowedResource: allowGitHubResourceUrl,
        readTokens: readStoredTokens,
        saveTokens: saveStoredTokens,
        invalidateTokens: clearStoredCredentials,
    });
    const { client, transport } = createGitHubMcpClient(provider);
    await client.connect(transport, { timeout: getMcpTimeout() });
    return { client, close: () => client.close() };
}

interface ConnectedGitHubClient {
    client: Client;
    close(): Promise<void>;
}

function createGitHubMcpClient(provider: RemoteMcpOAuthProvider): {
    client: Client;
    transport: ReturnType<typeof createRemoteMcpClient>['transport'];
    close(): Promise<void>;
} {
    const definition = requireMcpDefinition();
    const { client, transport } = createRemoteMcpClient({
        definition,
        authProvider: provider,
        requestHeaders: { 'X-MCP-Toolsets': GITHUB_MCP_TOOLSETS },
        clientName: 'cees-ai-desktop',
        clientVersion: '0.1.2',
    });
    return { client, transport, close: () => client.close() };
}

async function listAndNormalizeTools(client: Client): Promise<GitHubConnectorTool[]> {
    const result = await client.listTools(undefined, { timeout: CONNECT_TIMEOUT_MS });
    const tools: GitHubConnectorTool[] = [];
    for (const value of result.tools.slice(0, MAX_TOOLS)) {
        try {
            tools.push(normalizeGitHubTool({
                name: value.name,
                description: value.description,
                inputSchema: value.inputSchema,
                annotations: value.annotations,
            }));
        } catch {
        }
    }
    if (tools.length === 0) throw new Error('GitHub MCP 未返回可用工具');
    return tools;
}

async function cacheGitHubIdentity(client: Client, tools: GitHubConnectorTool[]): Promise<void> {
    const getMe = tools.find((tool) => tool.toolId === 'get_me' && tool.riskLevel === 'READ');
    if (!getMe) return;
    try {
        const result = await client.callTool({ name: getMe.toolId, arguments: {} }, undefined, { timeout: 30_000 });
        const text = extractTextContent(result);
        const login = text.match(/(?:login|username|用户名)["'：:\s]+([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/i)?.[1] ?? null;
        await requireTokenStore().set(IDENTITY_STORE_KEY, JSON.stringify({ login } satisfies StoredGitHubIdentity));
    } catch {
    }
}

function githubClientId(): string | null {
    const value = process.env.CEES_GITHUB_OAUTH_CLIENT_ID?.trim();
    return value && value !== 'change_me' ? value : null;
}

function githubClientSecret(): string | null {
    const value = process.env.CEES_GITHUB_OAUTH_CLIENT_SECRET?.trim();
    return value && value !== 'change_me' ? value : null;
}

function requireMcpDefinition(): RemoteMcpConnectorDefinition {
    if (!mcpDefinition) throw new Error('GitHub MCP 连接器尚未配置');
    return mcpDefinition;
}

function getMcpTimeout(): number {
    return Math.max(CONNECT_TIMEOUT_MS, requireMcpDefinition().timeout);
}

async function saveStoredTokens(tokens: OAuthTokens): Promise<void> {
    await requireTokenStore().set(TOKEN_STORE_KEY, JSON.stringify(tokens));
}

function isAllowedGitHubAuthorizationUrl(url: URL): boolean {
    return url.protocol === 'https:'
        && url.hostname === 'github.com'
        && url.pathname === '/login/oauth/authorize';
}

function allowGitHubResourceUrl(resource: string | URL): URL {
    const url = new URL(resource || GITHUB_MCP_ENDPOINT);
    if (url.origin !== 'https://api.githubcopilot.com' || !url.pathname.startsWith('/mcp/')) {
        throw new Error('GitHub MCP OAuth 资源地址无效');
    }
    return new URL(GITHUB_MCP_ENDPOINT);
}

async function hasStoredTokens(): Promise<boolean> {
    return Boolean((await readStoredTokens())?.access_token);
}

async function readStoredTokens(): Promise<OAuthTokens | undefined> {
    const raw = (await requireTokenStore().getAll())[TOKEN_STORE_KEY];
    if (!raw) return undefined;
    try {
        const value = JSON.parse(raw) as unknown;
        return isRecord(value) && typeof value.access_token === 'string' ? value as OAuthTokens : undefined;
    } catch {
        return undefined;
    }
}

async function readStoredIdentity(): Promise<StoredGitHubIdentity> {
    const raw = (await requireTokenStore().getAll())[IDENTITY_STORE_KEY];
    if (!raw) return { login: null };
    try {
        const value = JSON.parse(raw) as unknown;
        return isRecord(value) && (typeof value.login === 'string' || value.login === null)
            ? { login: value.login as string | null }
            : { login: null };
    } catch {
        return { login: null };
    }
}

async function clearStoredCredentials(): Promise<void> {
    const store = requireTokenStore();
    await Promise.all([store.remove(TOKEN_STORE_KEY), store.remove(IDENTITY_STORE_KEY)]);
}

function requireTokenStore(): SecureTokenStore {
    if (!tokenStore) throw new Error('GitHub 连接器尚未配置');
    return tokenStore;
}

function readyStatus(checkedAt: string, toolCount: number, authorizedLogin: string | null): GitHubConnectorStatus {
    return {
        state: 'READY', installed: true, authenticated: true, version: 'remote', checkedAt,
        issueCode: null, recoveryAction: 'NONE', error: null,
        source: 'REMOTE_MCP', authorizationState: 'AUTHORIZED', authorizedLogin, toolCount,
        enabledToolsets: GITHUB_MCP_TOOLSETS.split(','),
    };
}

function authRequiredStatus(checkedAt: string, authorizationState: 'UNAUTHORIZED' | 'AUTHORIZING'): GitHubConnectorStatus {
    return {
        state: 'AUTH_REQUIRED', installed: true, authenticated: false, version: 'remote', checkedAt,
        issueCode: authorizationState === 'AUTHORIZING' ? 'GITHUB_AUTHORIZING' : 'GITHUB_AUTH_REQUIRED',
        recoveryAction: 'AUTHORIZE', error: null,
        source: 'REMOTE_MCP', authorizationState, authorizedLogin: null, toolCount: 0,
        enabledToolsets: GITHUB_MCP_TOOLSETS.split(','),
    };
}

function configurationErrorStatus(
    checkedAt: string,
    issueCode: 'GITHUB_OAUTH_CLIENT_ID_MISSING' | 'GITHUB_OAUTH_CLIENT_SECRET_MISSING',
    error: string,
): GitHubConnectorStatus {
    return {
        state: 'ERROR', installed: true, authenticated: false, version: 'remote', checkedAt,
        issueCode, recoveryAction: 'NONE', error,
        source: 'REMOTE_MCP', authorizationState: 'UNAUTHORIZED', authorizedLogin: null, toolCount: 0,
        enabledToolsets: GITHUB_MCP_TOOLSETS.split(','),
    };
}

function errorStatus(checkedAt: string, error: unknown): GitHubConnectorStatus {
    return {
        state: 'ERROR', installed: true, authenticated: true, version: 'remote', checkedAt,
        issueCode: 'GITHUB_MCP_ERROR', recoveryAction: 'RETRY', error: safeError(error),
        source: 'REMOTE_MCP', authorizationState: 'AUTHORIZED', authorizedLogin: null, toolCount: 0,
        enabledToolsets: GITHUB_MCP_TOOLSETS.split(','),
    };
}

function validateArguments(value: Record<string, unknown>): void {
    if (!isRecord(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 64 * 1024) {
        throw new Error('GitHub MCP 工具参数无效或过大');
    }
    const visit = (item: unknown): void => {
        if (Array.isArray(item)) return item.forEach(visit);
        if (!isRecord(item)) return;
        for (const [key, nested] of Object.entries(item)) {
            if (SENSITIVE_KEY_PATTERN.test(key)) throw new Error('GitHub MCP 工具参数包含不允许的凭据字段');
            visit(nested);
        }
    };
    visit(value);
}

function sanitizeValue(value: unknown, depth: number): unknown {
    if (depth > 12) return '[内容层级过深]';
    if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeValue(item, depth + 1));
    if (!isRecord(value)) return typeof value === 'string' && value.length > 20_000 ? `${value.slice(0, 20_000)}…` : value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key) || BINARY_KEY_PATTERN.test(key)) continue;
        result[key] = sanitizeValue(item, depth + 1);
    }
    return result;
}

function limitContext(value: unknown): Record<string, unknown> {
    const record = isRecord(value) ? value : { result: value };
    const serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_CONTEXT_BYTES) return record;
    return {
        truncated: true,
        summary: serialized.slice(0, MAX_CONTEXT_BYTES - 512),
        notice: 'GitHub MCP 返回内容超过单轮上下文限制，已截断',
    };
}

function extractGitHubToolError(result: Record<string, unknown>): string {
    const text = extractTextContent(result);
    return text ? `GitHub MCP 操作失败：${text.slice(0, 500)}` : 'GitHub MCP 操作失败';
}

function extractTextContent(result: unknown): string {
    if (!isRecord(result) || !Array.isArray(result.content)) return '';
    return result.content
        .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text as string)
        .join('\n');
}

function safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'GitHub 连接器执行失败';
    return message.replace(/(?:gh[oprsu]_[A-Za-z0-9_]+|Bearer\s+\S+)/gi, '[REDACTED]').slice(0, 500);
}

function isUnauthorizedError(error: unknown): boolean {
    return error instanceof UnauthorizedError || (error instanceof Error && /unauthorized|401|授权.*失效|尚未授权/i.test(error.message));
}

function cloneTool(tool: GitHubConnectorTool): GitHubConnectorTool {
    return { ...tool, parameters: structuredClone(tool.parameters) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
