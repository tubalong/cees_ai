import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;

export interface RemoteMcpTransportOptions {
    endpoint: string;
    resolveHeaders: () => Promise<Record<string, string>> | Record<string, string>;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    maxResponseBytes?: number;
}

export interface RemoteMcpErrorOptions {
    message: string;
    method: string;
    status: number | null;
    responseBody: string;
    code: string | number | null;
    retryable: boolean;
    timedOut: boolean;
}

export class RemoteMcpError extends Error {
    readonly method: string;
    readonly status: number | null;
    readonly responseBody: string;
    readonly code: string | number | null;
    readonly retryable: boolean;
    readonly timedOut: boolean;

    constructor(options: RemoteMcpErrorOptions) {
        super(options.message);
        this.name = 'RemoteMcpError';
        this.method = options.method;
        this.status = options.status;
        this.responseBody = options.responseBody;
        this.code = options.code;
        this.retryable = options.retryable;
        this.timedOut = options.timedOut;
    }
}

interface JsonRpcResponse<Result> {
    jsonrpc?: string;
    id?: string | number | null;
    result?: Result;
    error?: {
        code?: string | number;
        message?: string;
        data?: unknown;
    };
}

export class RemoteMcpTransport {
    private readonly endpoint: URL;
    private readonly fetcher: typeof fetch;
    private readonly timeoutMs: number;
    private readonly maxResponseBytes: number;

    constructor(private readonly options: RemoteMcpTransportOptions) {
        this.endpoint = normalizeEndpoint(options.endpoint);
        this.fetcher = options.fetcher ?? fetch;
        this.timeoutMs = normalizePositiveInteger(options.timeoutMs, 15_000);
        this.maxResponseBytes = normalizePositiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
    }

    async request<Result>(method: string, params: Record<string, unknown> = {}): Promise<Result> {
        const normalizedMethod = normalizeMethod(method);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers = await this.resolveHeaders();
            const response = await this.fetcher(this.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: randomUUID(),
                    method: normalizedMethod,
                    params,
                }),
                signal: controller.signal,
                redirect: 'error',
            });
            const responseBody = await readLimitedText(response, this.maxResponseBytes, normalizedMethod);
            if (!response.ok) {
                throw new RemoteMcpError({
                    message: `远程 MCP 请求失败（HTTP ${response.status}）`,
                    method: normalizedMethod,
                    status: response.status,
                    responseBody,
                    code: null,
                    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
                    timedOut: false,
                });
            }
            let payload: JsonRpcResponse<Result>;
            try {
                payload = JSON.parse(responseBody) as JsonRpcResponse<Result>;
            } catch {
                throw new RemoteMcpError({
                    message: '远程 MCP 返回了无法解析的 JSON 数据',
                    method: normalizedMethod,
                    status: response.status,
                    responseBody,
                    code: null,
                    retryable: false,
                    timedOut: false,
                });
            }
            if (payload.error) {
                throw new RemoteMcpError({
                    message: payload.error.message?.trim() || '远程 MCP 返回业务错误',
                    method: normalizedMethod,
                    status: response.status,
                    responseBody,
                    code: payload.error.code ?? null,
                    retryable: false,
                    timedOut: false,
                });
            }
            if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
                throw new RemoteMcpError({
                    message: '远程 MCP 响应缺少 result',
                    method: normalizedMethod,
                    status: response.status,
                    responseBody,
                    code: null,
                    retryable: false,
                    timedOut: false,
                });
            }
            return payload.result as Result;
        } catch (error) {
            if (error instanceof RemoteMcpError) throw error;
            const timedOut = controller.signal.aborted || isAbortError(error);
            throw new RemoteMcpError({
                message: timedOut
                    ? '远程 MCP 请求超时'
                    : error instanceof Error ? error.message : '远程 MCP 请求失败',
                method: normalizedMethod,
                status: null,
                responseBody: '',
                code: null,
                retryable: true,
                timedOut,
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    private async resolveHeaders(): Promise<Record<string, string>> {
        const custom = await this.options.resolveHeaders();
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
        for (const [key, value] of Object.entries(custom)) {
            if (!isSafeHeaderName(key) || typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
                throw new Error('远程 MCP 请求头无效');
            }
            headers[key] = value;
        }
        return headers;
    }
}

function normalizeEndpoint(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
        throw new Error('远程 MCP 地址必须是无凭据的 HTTPS URL');
    }
    return url;
}

function normalizeMethod(value: string): string {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*$/i.test(value)) {
        throw new Error('远程 MCP 方法无效');
    }
    return value;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
    return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

function isSafeHeaderName(value: string): boolean {
    return /^[A-Za-z0-9-]+$/.test(value)
        && !/^(?:host|content-length|cookie|set-cookie|origin|referer)$/i.test(value);
}

async function readLimitedText(response: Response, maxBytes: number, method: string): Promise<string> {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
        throw new RemoteMcpError({
            message: `远程 MCP 响应超过 ${maxBytes} 字节限制`,
            method,
            status: response.status,
            responseBody: '',
            code: null,
            retryable: false,
            timedOut: false,
        });
    }
    return new TextDecoder().decode(bytes);
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}
