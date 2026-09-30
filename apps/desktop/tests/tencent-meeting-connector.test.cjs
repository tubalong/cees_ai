const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');

const {
    TencentMeetingConnectorAdapter,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting.adapter.js');
const {
    TENCENT_MEETING_CLI_VERSION,
    TENCENT_MEETING_COMMANDS,
    TENCENT_MEETING_PACKAGE_SHA256,
    TENCENT_MEETING_PACKAGE_URL,
    assertTencentMeetingCallAllowed,
    buildTencentMeetingCliArguments,
    classifyTencentMeetingToolRisk,
    extractTencentMeetingBinaryArchive,
    extractTencentMeetingNextPageToken,
    hasTencentMeetingMorePages,
    isTencentMeetingPaginatedTool,
    mergeTencentMeetingPages,
    normalizeTencentMeetingCliResult,
    parseTencentMeetingAuthStatus,
    parseTencentMeetingCommandHelp,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting.connector.js');
const {
    TENCENT_MEETING_CONNECTOR_MANIFEST,
} = require('../dist-electron/connectors/tencent-meeting/tencent-meeting.manifest.js');

test('腾讯会议声明为 Desktop 托管官方 CLI 的 OAuth 连接器', () => {
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.transportType, 'LOCAL_CLI');
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.executionLocation, 'DESKTOP');
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.authType, 'OAUTH');
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.supportsInstall, true);
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.supportsDynamicTools, false);
    assert.equal(TENCENT_MEETING_CONNECTOR_MANIFEST.supportsDisconnect, true);
    assert.equal(TENCENT_MEETING_CLI_VERSION, '1.0.18');
    assert.equal(TENCENT_MEETING_PACKAGE_URL, 'https://registry.npmjs.org/@tencentcloud/tmeet/-/tmeet-1.0.18.tgz');
    assert.match(TENCENT_MEETING_PACKAGE_SHA256, /^[a-f0-9]{64}$/);
    assert.ok(TENCENT_MEETING_COMMANDS.length >= 30);
});

test('腾讯会议 CLI 帮助解析为版本对齐的工具 Schema', () => {
    const descriptor = TENCENT_MEETING_COMMANDS.find((item) => item.toolId === 'meeting.create');
    const tool = parseTencentMeetingCommandHelp(descriptor, [
        'create meeting',
        '',
        'Usage:',
        '  tmeet meeting create [flags]',
        '',
        'Flags:',
        '      --end string         meeting end time (required)',
        '  -h, --help               help for create',
        '      --invitees strings   invited participants (required)',
        '      --subject string     meeting subject (required)',
        '      --waiting-room       enable waiting room',
        '',
        'Global Flags:',
        '      --format string      output format',
    ].join('\n'));

    assert.equal(tool.toolId, 'meeting.create');
    assert.equal(tool.riskLevel, 'WRITE');
    assert.equal(tool.requiresConfirmation, true);
    assert.deepEqual(tool.parameters.required, ['end', 'invitees', 'subject']);
    assert.deepEqual(tool.parameters.properties.invitees, {
        type: 'array', items: { type: 'string' }, description: 'invited participants (required)',
    });
    assert.equal(tool.parameters.properties.waiting_room.type, 'boolean');
});

test('腾讯会议命令按副作用分级且未知命令默认最高风险', () => {
    assert.equal(classifyTencentMeetingToolRisk('meeting.list'), 'READ');
    assert.equal(classifyTencentMeetingToolRisk('meeting.create'), 'WRITE');
    assert.equal(classifyTencentMeetingToolRisk('meeting.cancel'), 'DESTRUCTIVE');
    assert.equal(classifyTencentMeetingToolRisk('future.unknown'), 'DESTRUCTIVE');
});

test('腾讯会议工具参数只转换已声明字段并保留 false 布尔值', () => {
    const descriptor = TENCENT_MEETING_COMMANDS.find((item) => item.toolId === 'meeting.create');
    const tool = parseTencentMeetingCommandHelp(descriptor, [
        'create meeting', '', 'Flags:',
        '      --end string         meeting end time (required)',
        '      --invitees strings   invited participants',
        '      --subject string     meeting subject (required)',
        '      --waiting-room       enable waiting room',
        '', 'Global Flags:',
    ].join('\n'));
    assert.deepEqual(buildTencentMeetingCliArguments(tool, {
        end: '2026-09-24T11:00+08:00',
        invitees: ['openid-1', 'openid-2'],
        subject: '周会',
        waiting_room: false,
    }), [
        'meeting', 'create',
        '--end', '2026-09-24T11:00+08:00',
        '--invitees', 'openid-1',
        '--invitees', 'openid-2',
        '--subject', '周会',
        '--waiting-room=false',
        '--format', 'json',
    ]);
    assert.throws(() => buildTencentMeetingCliArguments(tool, {
        end: '2026-09-24T11:00+08:00', subject: '周会', shell: 'powershell',
    }), /不支持参数/);
});

test('腾讯会议写操作和破坏性操作必须确认', () => {
    const tool = {
        toolId: 'meeting.cancel', name: '取消会议', description: '取消会议',
        parameters: { type: 'object', properties: {} }, riskLevel: 'DESTRUCTIVE', requiresConfirmation: true,
    };
    assert.throws(() => assertTencentMeetingCallAllowed(tool, { toolId: 'meeting.cancel', arguments: {} }), /需要用户确认/);
    assert.doesNotThrow(() => assertTencentMeetingCallAllowed(tool, {
        toolId: 'meeting.cancel', arguments: {}, confirmed: true,
    }));
});

test('腾讯会议授权状态解析不会暴露 Token', () => {
    assert.deepEqual(parseTencentMeetingAuthStatus("Not logged in. Please use 'tmeet auth login' to authenticate."), {
        authenticated: false, userName: null, openId: null,
    });
    assert.deepEqual(parseTencentMeetingAuthStatus([
        'Logged in',
        '  OpenId:  open-id-1',
        '  UserName:  张三',
        '  AccessToken: valid (expires later)',
    ].join('\n')), {
        authenticated: true, userName: '张三', openId: 'open-id-1',
    });
});

test('腾讯会议 CLI 结果移除凭据字段', () => {
    assert.deepEqual(normalizeTencentMeetingCliResult({
        meeting_id: 'meeting-1', access_token: 'secret', nested: { password: 'hidden', pwd: 'hidden-too', title: '周会' },
    }), {
        meeting_id: 'meeting-1', nested: { title: '周会' },
    });
});

test('腾讯会议分页结果识别游标并合并列表数据', () => {
    assert.equal(isTencentMeetingPaginatedTool('meeting.list-ended'), true);
    assert.equal(isTencentMeetingPaginatedTool('meeting.get'), false);
    const first = {
        data: { meeting_info_list: [{ meeting_id: 'm-1' }] },
        next_page_token: 'token-2',
        has_more: true,
    };
    const second = {
        data: { meeting_info_list: [{ meeting_id: 'm-2' }] },
        next_page_token: '',
        has_more: false,
    };
    assert.equal(extractTencentMeetingNextPageToken(first), 'token-2');
    assert.equal(hasTencentMeetingMorePages(first), true);
    assert.deepEqual(mergeTencentMeetingPages([first, second]), {
        data: { meeting_info_list: [{ meeting_id: 'm-1' }, { meeting_id: 'm-2' }] },
        next_page_token: '',
        has_more: false,
    });
});

test('腾讯会议安装包只提取精确平台二进制', () => {
    const binary = Buffer.from('official-tmeet-binary');
    const archive = createTarGz('package/dist/tmeet-Windows-x86_64.exe', binary);
    assert.deepEqual(
        extractTencentMeetingBinaryArchive(archive, 'package/dist/tmeet-Windows-x86_64.exe'),
        binary,
    );
    assert.throws(
        () => extractTencentMeetingBinaryArchive(archive, 'package/dist/tmeet-Linux-x86_64'),
        /缺少当前平台可执行文件/,
    );
});

test('腾讯会议 Adapter 委托托管 CLI 生命周期和工具能力', async () => {
    const calls = [];
    const status = {
        state: 'READY', installed: true, authenticated: true, version: '1.0.18',
        checkedAt: '2026-09-23T00:00:00.000Z', issueCode: null, recoveryAction: 'NONE', error: null,
        source: 'MANAGED', installSupported: true, authorizationState: 'AUTHORIZED',
        authorizedUserName: '张三', authorizedOpenId: 'openid-1', toolCount: 31,
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

function createTarGz(entryPath, content) {
    const header = Buffer.alloc(512);
    writeTarString(header, 0, 100, entryPath);
    writeTarString(header, 100, 8, '0000700');
    writeTarString(header, 124, 12, content.length.toString(8).padStart(11, '0'));
    header[156] = '0'.charCodeAt(0);
    const padding = Buffer.alloc(Math.ceil(content.length / 512) * 512 - content.length);
    return gzipSync(Buffer.concat([header, content, padding, Buffer.alloc(1024)]));
}

function writeTarString(buffer, offset, length, value) {
    buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
}
