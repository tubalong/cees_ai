const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type HttpApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpApiTransportOptions {
    baseUrl: string;
    allowedPathPrefixes: string[];
    resolveHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
    fetcher?: typeof fetch;
    maxResponseBytes?: number;
}

export interface HttpApiRequestOptions {
    method: HttpApiMethod;
    path: string;
    query?: Record<string, string | number | boolean | null | undefined>;
    body?: unknown;
    timeoutMs: number;
    outputLabel?: string;
}

export interface HttpApiErrorOptions {
    message: string;
    method: HttpApiMethod;
    url: string;
    status: number | null;
    responseBody: string;
    timedOut: boolean;
    retryable: boolean;
}

export class HttpApiError extends Error {
    readonly method: HttpApiMethod;
    readonly url: string;
    readonly status: number | null;
    readonly responseBody: string;
    readonly timedOut: boolean;
    readonly retryable: boolean;

    constructor(options: HttpApiErrorOptions) {
        super(options.message);
        this.name = 'HttpApiError';
        this.method = options.method;
        this.url = options.url;
        this.status = options.status;
        this.responseBody = options.responseBody;
        this.timedOut = options.timedOut;
        this.retryable = options.retryable;
    }
}

export class HttpApiTransport {
    private readonly baseUrl: URL;
    private readonly allowedPathPrefixes: string[];
    private readonly fetcher: typeof fetch;
    private readonly maxResponseBytes: number;

    constructor(private readonly options: HttpApiTransportOptions) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.allowedPathPrefixes = normalizeAllowedPathPrefixes(options.allowedPathPrefixes);
        this.fetcher = options.fetcher ?? fetch;
        this.maxResponseBytes = normalizeMaxResponseBytes(options.maxResponseBytes);
    }

    async requestJson<Result = unknown>(request: HttpApiRequestOptions): Promise<Result> {
        const url = this.createRequestUrl(request.path, request.query);
        const outputLabel = request.outputLabel ?? 'HTTP API';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), normalizeTimeout(request.timeoutMs));
        try {
            const headers = await this.resolveHeaders(request.body !== undefined);
            const response = await this.fetcher(url, {
                method: request.method,
                headers,
                body: request.body === undefined ? undefined : JSON.stringify(request.body),
                signal: controller.signal,
                redirect: 'error',
            });
            const responseBody = await readResponseText(
                response,
                this.maxResponseBytes,
                outputLabel,
                request.method,
                url.toString(),
            );
            if (!response.ok) {
                throw new HttpApiError({
                    message: `${outputLabel} 请求失败（HTTP ${response.status}）`,
                    method: request.method,
                    url: url.toString(),
                    status: response.status,
                    responseBody,
                    timedOut: false,
                    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
                });
            }
            if (!responseBody) return null as Result;
            try {
                return JSON.parse(responseBody) as Result;
            } catch {
                throw new HttpApiError({
                    message: `${outputLabel} 返回了无法解析的 JSON 数据`,
                    method: request.method,
                    url: url.toString(),
                    status: response.status,
                    responseBody,
                    timedOut: false,
                    retryable: false,
                });
            }
        } catch (error) {
            if (error instanceof HttpApiError) throw error;
            const timedOut = controller.signal.aborted || isAbortError(error);
            throw new HttpApiError({
                message: timedOut ? `${outputLabel} 请求超时（timeout）` : error instanceof Error ? error.message : `${outputLabel} 请求失败`,
                method: request.method,
                url: url.toString(),
                status: null,
                responseBody: '',
                timedOut,
                retryable: true,
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    private createRequestUrl(
        path: string,
        query?: Record<string, string | number | boolean | null | undefined>,
    ): URL {
        const normalizedPath = normalizeRequestPath(path);
        if (!this.allowedPathPrefixes.some((prefix) => pathMatchesPrefix(normalizedPath, prefix))) {
            throw new Error(`HTTP API 路径不在允许范围内：${normalizedPath}`);
        }
        const url = new URL(normalizedPath.slice(1), this.baseUrl);
        if (url.origin !== this.baseUrl.origin) throw new Error('HTTP API 请求不能跨越固定服务域名');
        for (const [key, value] of Object.entries(query ?? {})) {
            if (!key.trim() || key.includes('\0')) throw new Error('HTTP API 查询参数名称无效');
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }
        return url;
    }

    private async resolveHeaders(hasBody: boolean): Promise<Record<string, string>> {
        const resolved = await this.options.resolveHeaders?.() ?? {};
        const headers: Record<string, string> = { accept: 'application/json' };
        for (const [name, value] of Object.entries(resolved)) {
            const normalizedName = name.trim().toLowerCase();
            if (!normalizedName || normalizedName.includes('\0') || /[\r\n]/.test(value)) {
                throw new Error('HTTP API 请求头无效');
            }
            if (normalizedName === 'host' || normalizedName === 'content-length') {
                throw new Error(`HTTP API 不允许覆盖请求头：${normalizedName}`);
            }
            headers[normalizedName] = value;
        }
        if (hasBody) headers['content-type'] = 'application/json';
        return headers;
    }
}

async function readResponseText(
    response: Response,
    maxResponseBytes: number,
    outputLabel: string,
    method: HttpApiMethod,
    url: string,
): Promise<string> {
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
        throw responseTooLargeError(outputLabel, response, maxResponseBytes, method, url);
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > maxResponseBytes) {
            await reader.cancel();
            throw responseTooLargeError(outputLabel, response, maxResponseBytes, method, url);
        }
        chunks.push(value);
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
}

function responseTooLargeError(
    outputLabel: string,
    response: Response,
    maxResponseBytes: number,
    method: HttpApiMethod,
    url: string,
): HttpApiError {
    return new HttpApiError({
        message: `${outputLabel} 响应超过 ${maxResponseBytes} 字节限制`,
        method,
        url,
        status: response.status,
        responseBody: '',
        timedOut: false,
        retryable: false,
    });
}

function normalizeBaseUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('HTTP API Base URL 仅支持 HTTP 或 HTTPS');
    if (url.username || url.password || url.search || url.hash) throw new Error('HTTP API Base URL 不能包含凭据、查询参数或片段');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
}

function normalizeAllowedPathPrefixes(prefixes: string[]): string[] {
    if (!Array.isArray(prefixes) || prefixes.length === 0) throw new Error('HTTP API 必须配置允许的路径范围');
    return [...new Set(prefixes.map((prefix) => normalizeRequestPath(prefix).replace(/\/$/, '') || '/'))];
}

function normalizeRequestPath(value: string): string {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\0')) {
        throw new Error('HTTP API 路径必须是站内绝对路径');
    }
    const url = new URL(value, 'https://connector.invalid');
    if (url.origin !== 'https://connector.invalid' || url.search || url.hash) {
        throw new Error('HTTP API 路径不能包含域名、查询参数或片段');
    }
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.split('/').includes('..')) throw new Error('HTTP API 路径不能包含上级目录');
    return url.pathname;
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
    return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
}

function normalizeTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 120_000) throw new Error('HTTP API 超时时间无效');
    return value;
}

function normalizeMaxResponseBytes(value?: number): number {
    const normalized = value ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new Error('HTTP API 响应大小限制无效');
    return normalized;
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}
