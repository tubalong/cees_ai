const test = require('node:test');
const assert = require('node:assert/strict');

const {
    decodeDwsOutput,
    dingTalkLogoutArguments,
    dwsRetryDelayMilliseconds,
    isAuthenticatedPayload,
    listDingTalkDwsProfiles,
    parseDwsFailureDetails,
    parseDingTalkUserRecords,
    parseJsonOutput,
    parseJsonOutputOrText,
    selectCurrentProfile,
} = require('../dist-electron/dingtalk-dws.js');

test('DWS 输出优先按 UTF-8 解码并在 Windows 回退系统中文编码', () => {
    assert.equal(decodeDwsOutput(Buffer.from('钉钉授权失败', 'utf8')), '钉钉授权失败');
    if (process.platform === 'win32') {
        assert.equal(decodeDwsOutput(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])), '中文');
    }
});

test('解绑只清除 DWS 本地登录态且不触发卸载', () => {
    assert.deepEqual(dingTalkLogoutArguments(), ['auth', 'logout', '-y']);
});

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
    assert.equal(isAuthenticatedPayload({ error: { category: 'auth', reason: 'auth_refresh_failed' } }), false);
    assert.equal(isAuthenticatedPayload({ data: { authenticated: true } }), true);
});

test('Profile 列表保留稳定选择器并去重', () => {
    const profiles = listDingTalkDwsProfiles({
        data: [
            { profile: 'corp-a:user-a', corpId: 'corp-a', corpName: '甲公司', userId: 'user-a', userName: '张三', isCurrent: true },
            { profile: 'corp-a:user-a', corpId: 'corp-a', userId: 'user-a' },
            { profile: 'corp-b:user-b', corpId: 'corp-b', corpName: '乙公司', userId: 'user-b', userName: '李四', isOrgCurrent: true },
        ],
    });
    assert.deepEqual(profiles, [
        { profile: 'corp-a:user-a', corpId: 'corp-a', corpName: '甲公司', externalUserId: 'user-a', externalUserName: '张三', current: true, organizationCurrent: false },
        { profile: 'corp-b:user-b', corpId: 'corp-b', corpName: '乙公司', externalUserId: 'user-b', externalUserName: '李四', current: false, organizationCurrent: true },
    ]);
});

test('结构化 DWS 错误只按显式 retryable 和等待时间恢复', () => {
    assert.deepEqual(parseDwsFailureDetails({
        stderr: JSON.stringify({ error: { category: 'api', reason: 'rate_limited', retryable: true, retry_after_seconds: 2, hint: '稍后重试' } }),
    }), {
        category: 'api',
        reason: 'rate_limited',
        retryable: true,
        retryAfterSeconds: 2,
        hint: '稍后重试',
    });
    assert.equal(parseDwsFailureDetails(new Error('network failed')).retryable, null);
    assert.equal(dwsRetryDelayMilliseconds({ stderr: JSON.stringify({ error: { retryable: true, retry_after_seconds: 2 } }) }), 2000);
    assert.equal(dwsRetryDelayMilliseconds({ stderr: JSON.stringify({ error: { retryable: true, retry_after_seconds: 6 } }) }), null);
    assert.equal(dwsRetryDelayMilliseconds(new Error('network failed')), null);
});

test('兼容 DWS orgEmployeeModel 的 orgUserId 和 orgUserName', () => {
    assert.deepEqual(parseDingTalkUserRecords({
        success: true,
        result: [{
            isAdmin: true,
            orgEmployeeModel: {
                orgUserId: 'user-1',
                orgUserName: '张三',
                orgTitle: '管理员',
                depts: [{ deptId: 100, deptName: '总裁办' }],
            },
        }],
    }), [{
        externalUserId: 'user-1',
        unionId: null,
        name: '张三',
        title: '管理员',
        jobNumber: null,
        departmentExternalIds: ['100'],
        active: true,
        admin: true,
        boss: false,
    }]);
});

test('只读查询在 DWS 返回纯文本时保留原文而不是整轮解析失败', () => {
    // `dws dev connect list` 在没有 --json 时返回纯文本 `no connectors found`。
    assert.deepEqual(parseJsonOutputOrText('no connectors found'), {
        unparsedText: 'no connectors found',
        note: 'DWS 未返回 JSON，以上为原始文本输出；请如实转述，不要臆造字段',
    });
    // JSON 正常时仍按 JSON 解析，兜底不影响正常路径。
    assert.deepEqual(parseJsonOutputOrText('[{"id":"c1"}]'), [{ id: 'c1' }]);
    // 空白输出是明确的空结果，不抛错。
    assert.equal(parseJsonOutputOrText('   ').unparsedText, '');
    // 超长文本按上限收敛，避免撑爆连接器上下文。
    assert.equal(parseJsonOutputOrText('x'.repeat(9000)).unparsedText.length, 4000);
});