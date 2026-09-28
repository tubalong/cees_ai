import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface RemoteMcpConnectorDefinition {
    url: string;
    timeout: number;
    disabled: boolean;
}

interface McpConfigFile {
    connectors?: Record<string, Partial<RemoteMcpConnectorDefinition>>;
}

const DEFAULT_TIMEOUT_MS = 600_000;

export function loadRemoteMcpDefinition(
    configFile: string,
    connectorKey: string,
    expectedUrl: string,
): RemoteMcpConnectorDefinition {
    const parsed = readJsonConfig(configFile);
    const raw = parsed.connectors?.[connectorKey];
    if (!raw || typeof raw.url !== 'string') throw new Error(`MCP 连接器配置不存在：${connectorKey}`);
    const url = normalizeRemoteMcpUrl(raw.url);
    if (url !== expectedUrl) throw new Error(`MCP 连接器地址不符合 ${connectorKey} 的固定端点`);
    const timeout = normalizePositiveInteger(raw.timeout, DEFAULT_TIMEOUT_MS);
    return {
        url,
        timeout,
        disabled: raw.disabled === true,
    };
}

export function normalizeRemoteMcpUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('远程 MCP 地址必须是无凭据的 HTTPS 地址');
    return url.toString();
}

export function defaultMcpConfigPath(moduleDirectory: string): string {
    return path.resolve(moduleDirectory, '../../../mcp.json');
}

function readJsonConfig(configFile: string): McpConfigFile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(configFile, 'utf8')) as unknown;
    } catch (error) {
        throw new Error(`MCP 配置文件不可读取：${error instanceof Error ? error.message : '未知错误'}`);
    }
    if (!isRecord(parsed)) throw new Error('MCP 配置文件格式无效');
    return parsed as McpConfigFile;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
