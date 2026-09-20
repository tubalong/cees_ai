const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isAuthenticatedPayload,
    parseJsonOutput,
    selectCurrentProfile,
} = require('../dist-electron/dingtalk-dws.js');

test('解析标准 JSON 和带前置日志的多行 JSON', () => {
    assert.deepEqual(parseJsonOutput('{"authenticated":true}'), { authenticated: true });
    assert.deepEqual(
        parseJsonOutput('正在检查更新...\n{\n  "authenticated": true,\n  "profile": "corp:user"\n}'),
        { authenticated: true, profile: 'corp:user' },
    );
});

test('非法 JSON 返回稳定错误', () => {
    assert.throws(() => parseJsonOutput('not-json'), /无法解析/);
});

test('多组织时只选择明确的全局当前 profile', () => {
    const selected = selectCurrentProfile({
        data: [
            { profile: 'corp-a:user-a', corpId: 'corp-a', userId: 'user-a' },
            { profile: 'corp-b:user-b', corpId: 'corp-b', userId: 'user-b', isCurrent: true },
        ],
    });
    assert.equal(selected.profile, 'corp-b:user-b');
});

test('多组织只有组织内默认账号时拒绝猜测', () => {
    assert.throws(() => selectCurrentProfile([
        { profile: 'corp-a:user-a', corpId: 'corp-a', isOrgCurrent: true },
        { profile: 'corp-b:user-b', corpId: 'corp-b', isOrgCurrent: true },
    ]), /多个组织/);
});

test('同一组织多账号时可以选择组织内默认账号', () => {
    const selected = selectCurrentProfile([
        { profile: 'corp-a:user-a', corpId: 'corp-a' },
        { profile: 'corp-a:user-b', corpId: 'corp-a', isOrgCurrent: true },
    ]);
    assert.equal(selected.profile, 'corp-a:user-b');
});

test('授权状态显式失败时不视为已登录', () => {
    assert.equal(isAuthenticatedPayload({ data: { authenticated: false } }), false);
    assert.equal(isAuthenticatedPayload({ status: 'expired' }), false);
    assert.equal(isAuthenticatedPayload({ data: { authenticated: true } }), true);
});
