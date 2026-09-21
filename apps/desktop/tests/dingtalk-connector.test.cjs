const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildDwsArguments,
    compareDwsVersions,
    normalizeDwsVersion,
    parseDingTalkUpgradeCheck,
    parseDingTalkReadTools,
    sanitizeConnectorData,
} = require('../dist-electron/dingtalk-connector.js');

test('规范化并比较 DWS 语义版本', () => {
    assert.equal(normalizeDwsVersion('dws version v1.0.62'), 'v1.0.62');
    assert.equal(normalizeDwsVersion('1.2.3-beta.2'), 'v1.2.3-beta.2');
    assert.equal(normalizeDwsVersion('not-a-version'), null);
    assert.equal(compareDwsVersions('v1.0.62', 'v1.0.63'), -1);
    assert.equal(compareDwsVersions('v1.0.63', 'v1.0.62'), 1);
    assert.equal(compareDwsVersions('v1.0.63', 'v1.0.63-beta.1'), 1);
});

test('只接受官方升级检查返回的正式稳定版本', () => {
    const parsed = parseDingTalkUpgradeCheck({
        current_version: 'v1.0.62',
        latest_version: 'v1.0.63',
        needs_upgrade: true,
        track: 'release',
        prerelease: false,
        release_date: '2026-09-20',
        release_url: 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/tag/v1.0.63',
        changelog: ['修复升级流程', 1, ''],
    });
    assert.deepEqual(parsed, {
        currentVersion: 'v1.0.62',
        latestVersion: 'v1.0.63',
        needsUpgrade: true,
        releaseDate: '2026-09-20',
        releaseUrl: 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/tag/v1.0.63',
        changelog: ['修复升级流程'],
    });

    assert.throws(() => parseDingTalkUpgradeCheck({
        current_version: 'v1.0.62', latest_version: 'v1.0.63', track: 'beta', prerelease: false,
    }), /只允许使用 DWS 正式稳定版本/);
    assert.throws(() => parseDingTalkUpgradeCheck({
        current_version: 'v1.0.62', latest_version: 'v1.0.63', track: 'release', prerelease: true,
    }), /只允许使用 DWS 正式稳定版本/);
    assert.throws(() => parseDingTalkUpgradeCheck({
        current_version: 'v1.0.62', latest_version: 'v1.0', track: 'release', prerelease: false,
    }), /未返回有效的正式版本/);
    assert.throws(() => parseDingTalkUpgradeCheck({
        current_version: 'v1.0.62', latest_version: 'v1.0.63-beta.1', track: 'release', prerelease: false,
    }), /未返回有效的正式版本/);
});

test('从 DWS Schema 动态发现所有明确安全的只读工具', () => {
    const tools = parseDingTalkReadTools({
        products: [{ tools: [
            {
                canonical_path: 'calendar.event.list',
                primary_cli_path: 'calendar event list',
                agent_summary: '查询日程',
                effect: 'read',
                confirmation: 'not_required',
                availability: 'available',
                parameters: {
                    start: { type: 'string', required: true },
                    limit: { type: 'integer' },
                    format: { type: 'string' },
                },
            },
            { canonical_path: 'todo.create', primary_cli_path: 'todo create', effect: 'write', confirmation: 'user_required', availability: 'available', parameters: {} },
            { canonical_path: 'drive.list', primary_cli_path: 'drive list', effect: 'read', confirmation: 'user_required', availability: 'available', parameters: {} },
            { canonical_path: 'mail.list', primary_cli_path: 'mail list', effect: 'read', confirmation: 'not_required', availability: 'unavailable', parameters: {} },
            { canonical_path: 'dev.secret.get', primary_cli_path: 'dev secret get', effect: 'read', confirmation: 'not_required', availability: 'available', parameters: { appSecret: { type: 'string', required: true } } },
        ] }],
    });
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'calendar.event.list');
    assert.equal(tools[0].parameters.type, 'object');
    assert.deepEqual(tools[0].parameters.required, ['start']);
});

test('执行参数仅来自 Schema，固定使用 JSON 输出且不拼接 shell', () => {
    const [tool] = parseDingTalkReadTools({
        canonical_path: 'contact.user.search',
        primary_cli_path: 'contact user search',
        effect: 'read',
        confirmation: 'not_required',
        availability: 'available',
        parameters: {
            query: { type: 'string', required: true },
            limit: { type: 'integer' },
            format: { type: 'string' },
        },
    });
    assert.deepEqual(buildDwsArguments(tool, { query: 'Alice & calc.exe', limit: 5 }), [
        'contact', 'user', 'search', '--query', 'Alice & calc.exe', '--limit', '5', '--format', 'json',
    ]);
    assert.throws(() => buildDwsArguments(tool, { query: 'Alice', shell: 'calc.exe' }), /未在 Schema 中声明/);
    assert.throws(() => buildDwsArguments(tool, { query: 'Alice', format: 'yaml' }), /未在 Schema 中声明/);
});

test('连接器上下文会移除凭据字段并截断过长文本', () => {
    const sanitized = sanitizeConnectorData({
        name: '张三',
        accessToken: 'do-not-forward',
        nested: { cookie: 'do-not-forward', title: 'a'.repeat(5000) },
    });
    assert.deepEqual(sanitized, {
        name: '张三',
        nested: { title: 'a'.repeat(4000) },
    });
});
