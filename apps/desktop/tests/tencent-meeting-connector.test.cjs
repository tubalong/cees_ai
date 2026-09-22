const test = require('node:test');
const assert = require('node:assert/strict');

const {
    TencentMeetingConnectorAdapter,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting.adapter.js');
const {
    discoverTencentMeetingReadTools,
    executeTencentMeetingReadCalls,
    getTencentMeetingConnectorStatus,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting.connector.js');
const {
    TENCENT_MEETING_CONNECTOR_MANIFEST,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting.manifest.js');

test('腾讯会议声明为服务端 OAuth 的 HTTP API 连接器', () => {
    assert.deepEqual(TENCENT_MEETING_CONNECTOR_MANIFEST, {
        id: 'tencent-meeting',
        name: '腾讯会议',
        description: '连接腾讯会议后查询当前用户、会议列表、会议详情、参会成员以及可访问的录制和纪要元数据。',
        icon: 'tencent-meeting',
        transportType: 'HTTP_API',
        executionLocation: 'API',
        authType: 'OAUTH',
        supportsInstall: false,
        supportsDisconnect: true,
        supportsProfiles: false,
        supportsDynamicTools: true,
        supportsVersionManagement: false,
    });
});

test('腾讯会议基础连接器公开五类只读工具', async () => {
    const tools = await discoverTencentMeetingReadTools();
    assert.deepEqual(tools.map((tool) => tool.toolId), [
        'tencent_meeting.profile.get',
        'tencent_meeting.meetings.list',
        'tencent_meeting.meetings.get',
        'tencent_meeting.participants.list',
        'tencent_meeting.recordings.list',
    ]);
    assert.equal(tools.every((tool) => tool.parameters.additionalProperties === false), true);
});

test('服务端 OAuth 未接入时不伪造腾讯会议授权或查询结果', async () => {
    const status = await getTencentMeetingConnectorStatus();
    assert.equal(status.state, 'AUTH_REQUIRED');
    assert.equal(status.authenticated, false);
    assert.equal(status.issueCode, 'SERVER_OAUTH_REQUIRED');
    assert.match(status.error, /CEES API 服务端/);

    await assert.rejects(
        executeTencentMeetingReadCalls([{ toolId: 'tencent_meeting.profile.get', arguments: {} }]),
        /CEES API 服务端/,
    );
    await assert.rejects(
        executeTencentMeetingReadCalls([{ toolId: 'tencent_meeting.unknown', arguments: {} }]),
        /只读工具不存在/,
    );
});

test('腾讯会议 Adapter 委托连接器生命周期和工具能力', async () => {
    const calls = [];
    const status = {
        state: 'READY', installed: true, authenticated: true, version: null,
        checkedAt: '2026-09-22T00:00:00.000Z', issueCode: null, recoveryAction: 'NONE', error: null,
    };
    const dependencies = {
        configure: (value) => calls.push(['configure', value]),
        status: async () => { calls.push(['status']); return status; },
        connect: async () => { calls.push(['connect']); return status; },
        disconnect: async () => { calls.push(['disconnect']); return status; },
        resetTools: () => calls.push(['resetTools']),
        discoverTools: async () => { calls.push(['discoverTools']); return []; },
        execute: async (value) => { calls.push(['execute', value]); return []; },
    };
    const adapter = new TencentMeetingConnectorAdapter(dependencies);

    adapter.configure('user-data');
    await adapter.status();
    await adapter.connect();
    await adapter.disconnect();
    adapter.resetTools();
    await adapter.discoverTools();
    await adapter.execute([]);

    assert.equal(adapter.manifest.id, 'tencent-meeting');
    assert.deepEqual(calls.map(([name]) => name), [
        'configure', 'status', 'connect', 'disconnect', 'resetTools', 'discoverTools', 'execute',
    ]);
});
