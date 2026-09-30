const test = require('node:test');
const assert = require('node:assert/strict');

const { GitHubConnectorAdapter } = require('../dist-electron/connectors/github/github.adapter.js');
const {
    GITHUB_MCP_ENDPOINT,
    GITHUB_MCP_TOOLSETS,
    assertGitHubCallAllowed,
    classifyGitHubToolRisk,
    normalizeGitHubTool,
    sanitizeGitHubResult,
    hasRequiredGitHubOAuthScope,
    parseGitHubToolFailure,
    buildGitHubFailureContext,
} = require('../dist-electron/connectors/github/github.connector.js');
const { GITHUB_CONNECTOR_MANIFEST } = require('../dist-electron/connectors/github/github.manifest.js');

test('GitHub 使用官方远程 MCP 和 OAuth，由 Desktop 执行', () => {
    assert.equal(GITHUB_CONNECTOR_MANIFEST.transportType, 'REMOTE_MCP');
    assert.equal(GITHUB_CONNECTOR_MANIFEST.executionLocation, 'DESKTOP');
    assert.equal(GITHUB_CONNECTOR_MANIFEST.authType, 'OAUTH');
    assert.equal(GITHUB_CONNECTOR_MANIFEST.supportsInstall, false);
    assert.equal(GITHUB_CONNECTOR_MANIFEST.supportsDynamicTools, true);
    assert.equal(GITHUB_MCP_ENDPOINT, 'https://api.githubcopilot.com/mcp/');
    assert.ok(GITHUB_MCP_TOOLSETS.includes('repos'));
});

test('GitHub OAuth 必须包含私有仓库所需的 repo scope', () => {
    assert.equal(hasRequiredGitHubOAuthScope('repo,read:org,read:user'), true);
    assert.equal(hasRequiredGitHubOAuthScope('public_repo read:user'), false);
    assert.equal(hasRequiredGitHubOAuthScope(null), false);
});

test('GitHub 动态工具按 annotations 和名称分类风险', () => {
    assert.equal(classifyGitHubToolRisk('list_issues', { readOnlyHint: true }), 'READ');
    assert.equal(classifyGitHubToolRisk('create_issue'), 'WRITE');
    assert.equal(classifyGitHubToolRisk('delete_issue'), 'DESTRUCTIVE');
    assert.equal(classifyGitHubToolRisk('future_execute'), 'DESTRUCTIVE');
});

test('GitHub 仅允许目录内调用，写操作必须确认', () => {
    const read = normalizeGitHubTool({ name: 'list_issues', description: 'List issues', inputSchema: { type: 'object', properties: {} } });
    assert.doesNotThrow(() => assertGitHubCallAllowed(read, { toolId: read.toolId, arguments: {} }));
    const write = normalizeGitHubTool({ name: 'create_issue', description: 'Create issue', inputSchema: { type: 'object', properties: {} } });
    assert.throws(() => assertGitHubCallAllowed(write, { toolId: write.toolId, arguments: {} }), /确认/);
    assert.doesNotThrow(() => assertGitHubCallAllowed(write, { toolId: write.toolId, arguments: {}, confirmed: true }));
});

test('GitHub 结果移除敏感字段和二进制内容', () => {
    const result = sanitizeGitHubResult({ token: 'secret', authorization: 'Bearer secret', data: 'base64', content: 'safe' });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('secret'), false);
    assert.equal(serialized.includes('base64'), false);
    assert.equal(result.content, 'safe');
});

test('GitHub MCP 权限错误不会被当成空数据', () => {
    const failure = parseGitHubToolFailure({
        isError: true,
        content: [{ type: 'text', text: 'Resource not accessible by integration: private repository' }],
    });
    assert.deepEqual(failure, {
        message: 'Resource not accessible by integration: private repository',
        permissionRequired: true,
    });
    assert.deepEqual(buildGitHubFailureContext(failure), {
        complete: false,
        permissionRequired: true,
        dataAvailable: false,
        error: {
            category: 'permission',
            message: 'Resource not accessible by integration: private repository',
            hint: '请确认 GitHub OAuth 已包含 repo 权限，且当前账号对目标私有仓库具有访问权限；不要把本结果解释为仓库为空',
        },
        warnings: ['GitHub MCP 查询失败，结果不是空数据'],
    });
    assert.equal(parseGitHubToolFailure({
        isError: false,
        content: [{ type: 'text', text: 'repository has 3 issues' }],
    }), null);
});

test('GitHub Adapter 委托标准生命周期', async () => {
    const calls = [];
    const adapter = new GitHubConnectorAdapter({
        configure: (path) => calls.push(['configure', path]),
        status: async () => ({ state: 'READY' }),
        connect: async () => ({ state: 'READY' }),
        disconnect: async () => ({ state: 'AUTH_REQUIRED' }),
        resetTools: () => calls.push(['reset']),
        discoverTools: async () => [],
        execute: async (items) => { calls.push(['execute', items]); return []; },
    });
    adapter.configure('user-data');
    adapter.resetTools();
    await adapter.execute([{ toolId: 'list_issues', arguments: {} }]);
    assert.deepEqual(calls, [['configure', 'user-data'], ['reset'], ['execute', [{ toolId: 'list_issues', arguments: {} }]]]);
});
