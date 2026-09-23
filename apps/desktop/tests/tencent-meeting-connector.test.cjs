const test = require('node:test');
const assert = require('node:assert/strict');

const {
    TencentMeetingConnectorAdapter,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting.adapter.js');
const {
    classifyTencentMeetingToolRisk,
    normalizeTencentMeetingToolDefinition,
    normalizeTencentMeetingToolResult,
    TENCENT_MEETING_MCP_ENDPOINT,
    TENCENT_MEETING_SKILL_VERSION,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting.connector.js');
const {
    TENCENT_MEETING_CONNECTOR_MANIFEST,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting.manifest.js');

test('腾讯会议声明为 Desktop 本地凭据驱动的远程 MCP 连接器', () => {
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.transportType, 'REMOTE_MCP');
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.executionLocation, 'DESKTOP');
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.authType, 'LOCAL_CREDENTIAL');
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.supportsDynamicTools, true);
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.supportsDisconnect, true);
    assert.equal(TENCENT_MEETING_MCP_ENDPOINT, 'https://mcp.meeting.tencent.com/mcp/wemeet-open/v1');
    assert.equal(TENCENT_MEETING_SKILL_VERSION, 'v1.0.11');
});

test('腾讯会议动态工具按注解和名称标记风险', () => {
    assert.equal(classifyTencentMeetingToolRisk('get_meeting'), 'READ');
    assert.equal(classifyTencentMeetingToolRisk('schedule_meeting'), 'WRITE');
    assert.equal(classifyTencentMeetingToolRisk('cancel_meeting'), 'DESTRUCTIVE');
    assert.equal(classifyTencentMeetingToolRisk('future_unknown_tool'), 'DESTRUCTIVE');
    assert.equal(classifyTencentMeetingToolRisk('schedule_meeting', { readOnlyHint: true }), 'READ');
    assert.equal(classifyTencentMeetingToolRisk('get_meeting', { destructiveHint: true }), 'DESTRUCTIVE');
});

test('腾讯会议工具定义保留动态 Schema 并要求写操作确认', () => {
    const tool = normalizeTencentMeetingToolDefinition({
        name: 'schedule_meeting',
        title: '创建会议',
        description: '创建一场腾讯会议',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { subject: { type: 'string' } },
            required: ['subject'],
        },
    });

    assert.deepEqual(tool, {
        toolId: 'schedule_meeting',
        name: '创建会议',
        description: '创建一场腾讯会议',
        parameters: {
            type: 'object',
            additionalProperties: false,
            properties: { subject: { type: 'string' } },
            required: ['subject'],
        },
        riskLevel: 'WRITE',
        requiresConfirmation: true,
    });
    assert.throws(
        () => normalizeTencentMeetingToolDefinition({ name: 'bad/tool', description: 'invalid', inputSchema: { type: 'object', properties: {} } }),
        /工具名称或描述无效/,
    );
});

test('腾讯会议工具结果移除凭据字段并解析文本 JSON', () => {
    assert.deepEqual(normalizeTencentMeetingToolResult({
        content: [{
            type: 'text',
            text: JSON.stringify({ meetingId: 'meeting-1', accessToken: 'secret', nested: { password: 'hidden', title: '周会' } }),
        }],
    }), {
        meetingId: 'meeting-1',
        nested: { title: '周会' },
    });
    assert.throws(
        () => normalizeTencentMeetingToolResult({ isError: true, content: [{ type: 'text', text: '权限不足' }] }),
        /权限不足/,
    );
});

test('腾讯会议 Adapter 委托本地 Token 生命周期和动态工具能力', async () => {
    const calls = [];
    const status = {
        state: 'READY', installed: true, authenticated: true, version: 'v1.0.11',
        checkedAt: '2026-09-23T00:00:00.000Z', issueCode: null, recoveryAction: 'NONE', error: null,
        tokenConfigured: true, toolCount: 1, verifiedAt: '2026-09-23T00:00:00.000Z',
    };
    const dependencies = {
        configure: (value) => calls.push(['configure', value]),
        status: async () => { calls.push(['status']); return status; },
        connect: async () => { calls.push(['connect']); return status; },
        connectWithToken: async (token) => { calls.push(['connectWithToken', token]); return status; },
        disconnect: async () => { calls.push(['disconnect']); return status; },
        resetTools: () => calls.push(['resetTools']),
        discoverTools: async () => { calls.push(['discoverTools']); return []; },
        execute: async (value) => { calls.push(['execute', value]); return []; },
    };
    const adapter = new TencentMeetingConnectorAdapter(dependencies);

    adapter.configure('user-data');
    await adapter.status();
    await adapter.connect();
    await adapter.connectWithToken('personal-token-value');
    await adapter.disconnect();
    adapter.resetTools();
    await adapter.discoverTools();
    await adapter.execute([]);

    assert.equal(adapter.manifest.id, 'tencent-meeting');
    assert.deepEqual(calls.map(([name]) => name), [
        'configure', 'status', 'connect', 'connectWithToken', 'disconnect', 'resetTools', 'discoverTools', 'execute',
    ]);
});
