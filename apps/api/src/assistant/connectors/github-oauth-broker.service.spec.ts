import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GitHubOAuthBrokerService } from './github-oauth-broker.service';

describe('GitHubOAuthBrokerService', () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.CEES_GITHUB_OAUTH_CLIENT_ID;
  const originalClientSecret = process.env.CEES_GITHUB_OAUTH_CLIENT_SECRET;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.CEES_GITHUB_OAUTH_CLIENT_ID;
    else process.env.CEES_GITHUB_OAUTH_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.CEES_GITHUB_OAUTH_CLIENT_SECRET;
    else process.env.CEES_GITHUB_OAUTH_CLIENT_SECRET = originalClientSecret;
  });

  it('只返回公开 OAuth 配置，不返回 Secret', () => {
    process.env.CEES_GITHUB_OAUTH_CLIENT_ID = 'client-id';
    process.env.CEES_GITHUB_OAUTH_CLIENT_SECRET = 'client-secret';
    const config = new GitHubOAuthBrokerService().getConfig();
    expect(config).toEqual(expect.objectContaining({ clientId: 'client-id', scope: expect.stringContaining('repo') }));
    expect(config).not.toHaveProperty('clientSecret');
  });

  it('缺少服务端配置时返回稳定的 503', () => {
    delete process.env.CEES_GITHUB_OAUTH_CLIENT_ID;
    process.env.CEES_GITHUB_OAUTH_CLIENT_SECRET = 'client-secret';
    expect(() => new GitHubOAuthBrokerService().getConfig()).toThrow(ServiceUnavailableException);
  });

  it('拒绝非 loopback 回调地址', async () => {
    process.env.CEES_GITHUB_OAUTH_CLIENT_ID = 'client-id';
    process.env.CEES_GITHUB_OAUTH_CLIENT_SECRET = 'client-secret';
    await expect(new GitHubOAuthBrokerService().exchange({
      code: 'code',
      codeVerifier: 'a'.repeat(43),
      redirectUri: 'https://cees.top/oauth/github/callback',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('通过服务端 Secret 换码且不向调用方返回 Secret', async () => {
    process.env.CEES_GITHUB_OAUTH_CLIENT_ID = 'client-id';
    process.env.CEES_GITHUB_OAUTH_CLIENT_SECRET = 'client-secret';
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token',
      token_type: 'bearer',
      scope: 'repo',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await new GitHubOAuthBrokerService().exchange({
      code: 'code',
      codeVerifier: 'a'.repeat(43),
      redirectUri: 'http://127.0.0.1:43210/oauth/github/callback',
    });
    expect(result).toEqual({ accessToken: 'access-token', tokenType: 'bearer', expiresIn: null, refreshToken: null, scope: 'repo' });
    expect(result).not.toHaveProperty('clientSecret');
    expect(globalThis.fetch).toHaveBeenCalledWith('https://github.com/login/oauth/access_token', expect.objectContaining({
      body: expect.stringContaining('client_secret'),
    }));
  });

  it('将 GitHub 换码错误转换为网关错误', async () => {
    process.env.CEES_GITHUB_OAUTH_CLIENT_ID = 'client-id';
    process.env.CEES_GITHUB_OAUTH_CLIENT_SECRET = 'client-secret';
    globalThis.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200 }));
    await expect(new GitHubOAuthBrokerService().exchange({
      code: 'code',
      codeVerifier: 'a'.repeat(43),
      redirectUri: 'http://127.0.0.1:43210/oauth/github/callback',
    })).rejects.toBeInstanceOf(BadGatewayException);
  });
});
