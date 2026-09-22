const assert = require('node:assert/strict');
const test = require('node:test');

const {
    toTencentMeetingConnectorStatus,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting-status.js');

test('腾讯会议 READY 状态映射为已连接并保留账号摘要', () => {
    const status = toTencentMeetingConnectorStatus(connection({
        state: 'READY',
        authenticated: true,
        tokenStatus: 'VALID',
        account: {
            externalUserId: 'open-1',
            displayName: '张三',
            organizationId: 'corp-1',
            organizationName: '示例公司',
        },
        grantedScopes: ['VIEW_USER_INFO'],
    }));

    assert.equal(status.state, 'READY');
    assert.equal(status.authenticated, true);
    assert.equal(status.recoveryAction, 'NONE');
    assert.equal(status.account.displayName, '张三');
    assert.deepEqual(status.grantedScopes, ['VIEW_USER_INFO']);
});

test('腾讯会议授权中状态映射为等待系统浏览器授权', () => {
    const status = toTencentMeetingConnectorStatus(connection({ state: 'AUTHORIZING' }));

    assert.equal(status.state, 'AUTH_REQUIRED');
    assert.equal(status.issueCode, 'AUTHORIZING');
    assert.equal(status.recoveryAction, 'AUTHORIZE');
    assert.match(status.error, /系统浏览器/);
});

test('Token 刷新失败时提示重新授权', () => {
    const status = toTencentMeetingConnectorStatus(connection({
        state: 'ERROR',
        tokenStatus: 'REFRESH_FAILED',
        lastErrorCode: 'TOKEN_REFRESH_FAILED',
        lastErrorMessage: '授权已失效',
    }));

    assert.equal(status.state, 'ERROR');
    assert.equal(status.recoveryAction, 'AUTHORIZE');
    assert.equal(status.error, '授权已失效');
});

test('未连接状态映射为可发起授权', () => {
    const status = toTencentMeetingConnectorStatus(connection());

    assert.equal(status.state, 'AUTH_REQUIRED');
    assert.equal(status.authenticated, false);
    assert.equal(status.issueCode, 'AUTH_REQUIRED');
    assert.equal(status.installed, true);
});

function connection(overrides = {}) {
    return {
        state: 'NOT_CONNECTED',
        authenticated: false,
        account: null,
        grantedScopes: [],
        tokenStatus: 'MISSING',
        authorizedAt: null,
        tokenExpiresAt: null,
        lastVerifiedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: '2026-09-22T00:00:00.000Z',
        ...overrides,
    };
}
