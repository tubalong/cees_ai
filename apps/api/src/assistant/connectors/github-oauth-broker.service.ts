import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

export const GITHUB_OAUTH_AUTHORIZATION_ENDPOINT = 'https://github.com/login/oauth/authorize';
export const GITHUB_OAUTH_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
export const GITHUB_OAUTH_SCOPE = 'repo read:org read:user user:email notifications offline_access';
export const GITHUB_OAUTH_EXCHANGE_PATH = '/v1/assistant/connectors/github/oauth/exchange';

export interface GitHubOAuthConfig {
  clientId: string;
  authorizationEndpoint: string;
  scope: string;
  exchangePath: string;
}

export interface GitHubOAuthExchangeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface GitHubOAuthTokens {
  accessToken: string;
  tokenType: string;
  expiresIn: number | null;
  refreshToken: string | null;
  scope: string | null;
}

interface GitHubTokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const LOOPBACK_REDIRECT_PATTERN = /^http:\/\/127\.0\.0\.1:(?:[1-9][0-9]{0,4})\/oauth\/github\/callback$/;
const MAX_CODE_LENGTH = 512;
const MAX_VERIFIER_LENGTH = 256;
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class GitHubOAuthBrokerService {
  getConfig(): GitHubOAuthConfig {
    const clientId = this.readConfigValue('CEES_GITHUB_OAUTH_CLIENT_ID');
    this.readConfigValue('CEES_GITHUB_OAUTH_CLIENT_SECRET');
    return {
      clientId,
      authorizationEndpoint: GITHUB_OAUTH_AUTHORIZATION_ENDPOINT,
      scope: GITHUB_OAUTH_SCOPE,
      exchangePath: GITHUB_OAUTH_EXCHANGE_PATH,
    };
  }

  async exchange(input: GitHubOAuthExchangeInput): Promise<GitHubOAuthTokens> {
    const clientId = this.readConfigValue('CEES_GITHUB_OAUTH_CLIENT_ID');
    const clientSecret = this.readConfigValue('CEES_GITHUB_OAUTH_CLIENT_SECRET');
    validateExchangeInput(input);

    let response: Response;
    try {
      response = await fetch(GITHUB_OAUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new BadGatewayException({
        code: 'GITHUB_OAUTH_UPSTREAM_UNAVAILABLE',
        message: 'GitHub OAuth 服务暂时不可用，请稍后重试',
      });
    }

    let payload: GitHubTokenResponse;
    try {
      payload = await response.json() as GitHubTokenResponse;
    } catch {
      throw new BadGatewayException({
        code: 'GITHUB_OAUTH_INVALID_RESPONSE',
        message: 'GitHub OAuth 返回了无效响应',
      });
    }

    if (!response.ok || typeof payload.error === 'string') {
      throw new BadGatewayException({
        code: 'GITHUB_OAUTH_EXCHANGE_FAILED',
        message: typeof payload.error_description === 'string'
          ? payload.error_description
          : 'GitHub OAuth 授权码换取失败',
      });
    }

    if (typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
      throw new BadGatewayException({
        code: 'GITHUB_OAUTH_TOKEN_MISSING',
        message: 'GitHub OAuth 响应未包含访问令牌',
      });
    }

    return {
      accessToken: payload.access_token,
      tokenType: typeof payload.token_type === 'string' && payload.token_type.trim()
        ? payload.token_type
        : 'bearer',
      expiresIn: typeof payload.expires_in === 'number' && Number.isSafeInteger(payload.expires_in)
        ? payload.expires_in
        : null,
      refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token.trim()
        ? payload.refresh_token
        : null,
      scope: typeof payload.scope === 'string' ? payload.scope : null,
    };
  }

  private readConfigValue(name: string): string {
    const value = process.env[name]?.trim();
    if (!value || value === 'change_me') {
      throw new ServiceUnavailableException({
        code: 'GITHUB_OAUTH_NOT_CONFIGURED',
        message: 'GitHub OAuth 服务端配置未完成，请联系部署方配置 GitHub OAuth Client ID 和 Secret',
      });
    }
    return value;
  }
}

function validateExchangeInput(input: GitHubOAuthExchangeInput): void {
  if (!input || typeof input.code !== 'string' || !input.code.trim() || input.code.length > MAX_CODE_LENGTH) {
    throw new BadRequestException({ code: 'GITHUB_OAUTH_CODE_INVALID', message: 'GitHub OAuth 授权码无效' });
  }
  if (!input.codeVerifier || input.codeVerifier.length < 43 || input.codeVerifier.length > MAX_VERIFIER_LENGTH || !/^[A-Za-z0-9._~-]+$/.test(input.codeVerifier)) {
    throw new BadRequestException({ code: 'GITHUB_OAUTH_CODE_VERIFIER_INVALID', message: 'GitHub OAuth PKCE 校验器无效' });
  }
  if (typeof input.redirectUri !== 'string' || !LOOPBACK_REDIRECT_PATTERN.test(input.redirectUri)) {
    throw new BadRequestException({ code: 'GITHUB_OAUTH_REDIRECT_URI_INVALID', message: 'GitHub OAuth 回调地址必须是本机 loopback 地址' });
  }
}
