import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { shell } from 'electron';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
    OAuthClientInformationMixed,
    OAuthClientMetadata,
    OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export interface RemoteMcpOAuthCallback {
    redirectUrl: string;
    state: string;
    code: Promise<string>;
    close(): Promise<void>;
}

export interface RemoteMcpOAuthProviderOptions {
    clientId: string;
    clientSecret?: string;
    redirectUrl: string;
    expectedState: string;
    clientName: string;
    scope?: string;
    interactive: boolean;
    isAuthorizationUrlAllowed: (url: URL) => boolean;
    allowedResource: (resource: string | URL) => URL;
    readTokens: () => Promise<OAuthTokens | undefined>;
    saveTokens: (tokens: OAuthTokens) => Promise<void>;
    invalidateTokens: () => Promise<void>;
}

export class RemoteMcpOAuthProvider implements OAuthClientProvider {
    readonly clientMetadata: OAuthClientMetadata;
    private codeVerifierValue = '';

    constructor(private readonly options: RemoteMcpOAuthProviderOptions) {
        this.clientMetadata = {
            client_name: options.clientName,
            redirect_uris: [options.redirectUrl],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: options.clientSecret ? 'client_secret_basic' : 'none',
            scope: options.scope,
        };
    }

    get redirectUrl(): string { return this.options.redirectUrl; }
    state(): string { return this.options.expectedState; }
    clientInformation(): OAuthClientInformationMixed {
        return {
            client_id: this.options.clientId,
            ...(this.options.clientSecret ? { client_secret: this.options.clientSecret } : {}),
        };
    }
    async tokens(): Promise<OAuthTokens | undefined> { return this.options.readTokens(); }
    async saveTokens(tokens: OAuthTokens): Promise<void> { await this.options.saveTokens(tokens); }
    async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
        if (!this.options.interactive) throw new UnauthorizedError('远程 MCP 授权已失效，请重新连接');
        if (!this.options.isAuthorizationUrlAllowed(authorizationUrl)) {
            throw new Error('远程 MCP OAuth 授权地址无效');
        }
        await shell.openExternal(authorizationUrl.toString());
    }
    saveCodeVerifier(codeVerifier: string): void { this.codeVerifierValue = codeVerifier; }
    codeVerifier(): string {
        if (!this.codeVerifierValue) throw new Error('远程 MCP OAuth PKCE 校验器不存在');
        return this.codeVerifierValue;
    }
    async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
        if (scope === 'all' || scope === 'tokens') await this.options.invalidateTokens();
        if (scope === 'all' || scope === 'verifier') this.codeVerifierValue = '';
    }
    async validateResourceURL(_serverUrl: string | URL, resource?: string): Promise<URL> {
        return this.options.allowedResource(resource ?? '');
    }
}

export async function createLoopbackOAuthCallback(
    callbackPath: string,
    timeoutMs = DEFAULT_CALLBACK_TIMEOUT_MS,
): Promise<RemoteMcpOAuthCallback> {
    const state = randomBytes(24).toString('base64url');
    let server: Server | undefined;
    let settled = false;
    let resolveCode!: (code: string) => void;
    let rejectCode!: (error: Error) => void;
    const code = new Promise<string>((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });
    server = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== callbackPath) {
            response.writeHead(404).end();
            return;
        }
        const error = requestUrl.searchParams.get('error');
        const authorizationCode = requestUrl.searchParams.get('code');
        const returnedState = requestUrl.searchParams.get('state');
        if (error || !authorizationCode || returnedState !== state) {
            response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(oauthResultHtml(false));
            if (!settled) {
                settled = true;
                rejectCode(new Error(error ? `OAuth 授权失败：${error}` : 'OAuth 回调校验失败'));
            }
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(oauthResultHtml(true));
        if (!settled) {
            settled = true;
            resolveCode(authorizationCode);
        }
    });
    await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('无法启动 OAuth 回调服务');
    const timeout = setTimeout(() => {
        if (!settled) {
            settled = true;
            rejectCode(new Error('OAuth 授权已超时'));
        }
    }, timeoutMs);
    return {
        redirectUrl: `http://127.0.0.1:${address.port}${callbackPath}`,
        state,
        code,
        close: async () => {
            clearTimeout(timeout);
            await new Promise<void>((resolve) => server!.close(() => resolve()));
        },
    };
}

export function buildLoopbackRedirectUrl(callbackPath: string): string {
    return `http://127.0.0.1${callbackPath}`;
}

function oauthResultHtml(success: boolean): string {
    const title = success ? '授权成功' : '授权失败';
    const message = success ? '可以关闭此页面并返回 CEES。' : '请返回 CEES 后重新连接。';
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`;
}
