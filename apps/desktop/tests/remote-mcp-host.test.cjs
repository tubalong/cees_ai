const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    loadRemoteMcpDefinition,
    normalizeRemoteMcpUrl,
} = require('../dist-electron/connectors/mcp/mcp.config.js');
const {
    createLoopbackOAuthCallback,
    RemoteMcpOAuthProvider,
} = require('../dist-electron/connectors/mcp/remote-mcp-oauth.js');

const GITHUB_ENDPOINT = 'https://api.githubcopilot.com/mcp/';

test('通用 MCP 配置读取 GitHub 固定地址、超时和手动连接标志', () => {
    const definition = loadRemoteMcpDefinition(path.resolve(__dirname, '../mcp.json'), 'connector:github', GITHUB_ENDPOINT);
    assert.deepEqual(definition, { url: GITHUB_ENDPOINT, timeout: 600000, disabled: true });
});

test('通用 MCP 配置拒绝非 HTTPS 和非固定端点', () => {
    assert.throws(() => normalizeRemoteMcpUrl('http://api.githubcopilot.com/mcp/'), /HTTPS/);
    assert.throws(() => loadRemoteMcpDefinition(
        path.resolve(__dirname, '../mcp.json'),
        'connector:github',
        'https://example.com/mcp/',
    ), /固定端点/);
});

test('通用 OAuth Provider 使用预置 Client ID 和 Client Secret', async () => {
    const provider = new RemoteMcpOAuthProvider({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUrl: 'http://127.0.0.1:12345/oauth/callback',
        expectedState: 'expected-state',
        clientName: 'CEES AI Desktop',
        scope: 'repo',
        interactive: false,
        isAuthorizationUrlAllowed: () => true,
        allowedResource: () => new URL(GITHUB_ENDPOINT),
        readTokens: async () => undefined,
        saveTokens: async () => undefined,
        invalidateTokens: async () => undefined,
    });

    assert.equal(provider.clientInformation().client_id, 'client-id');
    assert.equal(provider.clientInformation().client_secret, 'client-secret');
    assert.equal(provider.clientMetadata.token_endpoint_auth_method, 'client_secret_basic');
    assert.equal(provider.state(), 'expected-state');
    assert.deepEqual(await provider.validateResourceURL(GITHUB_ENDPOINT, GITHUB_ENDPOINT), new URL(GITHUB_ENDPOINT));
});

test('loopback OAuth 回调校验 state 并返回授权码', async () => {
    const callback = await createLoopbackOAuthCallback('/oauth/callback', 5000);
    try {
        const callbackUrl = new URL(callback.redirectUrl);
        callbackUrl.searchParams.set('code', 'authorization-code');
        callbackUrl.searchParams.set('state', callback.state);
        const response = await fetch(callbackUrl);
        assert.equal(response.status, 200);
        assert.equal(await callback.code, 'authorization-code');
    } finally {
        await callback.close();
    }
});
