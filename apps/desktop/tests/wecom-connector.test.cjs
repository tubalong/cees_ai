const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');

const {
    WeComConnectorAdapter,
} = require('../dist-electron/connectors/wecom/wecom.adapter.js');
const {
    WECOM_CLI_VERSION,
    assertWeComCallAllowed,
    classifyWeComToolRisk,
    extractWeComBinaryArchive,
    normalizeWeComToolDefinition,
} = require('../dist-electron/connectors/wecom/wecom.connector.js');
const {
    WECOM_CONNECTOR_MANIFEST,
} = require('../dist-electron/connectors/wecom/wecom.manifest.js');

test('企业微信声明为 Desktop 托管安装和二维码授权的本地 CLI 连接器', () => {
    assert.equal(WECOM_CONNECTOR_MANIFEST.transportType, 'LOCAL_CLI');
    assert.equal(WECOM_CONNECTOR_MANIFEST.executionLocation, 'DESKTOP');
    assert.equal(WECOM_CONNECTOR_MANIFEST.authType, 'QR_CODE');
    assert.equal(WECOM_CONNECTOR_MANIFEST.supportsInstall, true);
    assert.equal(WECOM_CONNECTOR_MANIFEST.supportsDynamicTools, true);
    assert.equal(WECOM_CLI_VERSION, '1.3.2');
});

test('企业微信动态工具按动作名称标记风险', () => {
    assert.equal(classifyWeComToolRisk('calendar.schedules.list'), 'READ');
    assert.equal(classifyWeComToolRisk('todo.tasks.create'), 'WRITE');
    assert.equal(classifyWeComToolRisk('calendar.schedules.delete'), 'DESTRUCTIVE');
    assert.equal(classifyWeComToolRisk('future.capability.execute'), 'DESTRUCTIVE');
});

test('企业微信工具解析 Schema 引用并压缩为安全对象参数', () => {
    const tool = normalizeWeComToolDefinition({
        method: 'calendar.schedules.list',
        description: '查询日程列表',
        request: { $ref: 'ListSchedulesRequest' },
        schemas: {
            ListSchedulesRequest: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    begin_time: { type: 'string', description: '开始时间' },
                    paging: { $ref: 'PagingRequest' },
                },
                required: ['begin_time'],
            },
            PagingRequest: {
                type: 'object',
                properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
            },
        },
    });

    assert.equal(tool.toolId, 'calendar.schedules.list');
    assert.equal(tool.riskLevel, 'READ');
    assert.equal(tool.requiresConfirmation, false);
    assert.deepEqual(tool.parameters, {
        type: 'object',
        additionalProperties: false,
        properties: {
            begin_time: { type: 'string', description: '开始时间' },
            paging: {
                type: 'object',
                properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
            },
        },
        required: ['begin_time'],
    });
});

test('企业微信过滤本地路径和凭据参数', () => {
    assert.throws(() => normalizeWeComToolDefinition({
        method: 'media.files.upload',
        description: '上传文件',
        request: {
            type: 'object',
            properties: { file_path: { type: 'string' } },
        },
    }), /本地路径或凭据参数/);
    assert.throws(() => normalizeWeComToolDefinition({
        method: 'identity.tokens.set',
        description: '设置 Token',
        request: {
            type: 'object',
            properties: { access_token: { type: 'string' } },
        },
    }), /本地路径或凭据参数/);
});

test('企业微信写入和破坏性调用必须经过明确确认', () => {
    const writeTool = {
        toolId: 'todo.tasks.create',
        name: '创建待办',
        description: '创建待办',
        parameters: { type: 'object', properties: {} },
        riskLevel: 'WRITE',
        requiresConfirmation: true,
    };
    assert.throws(() => assertWeComCallAllowed(writeTool, {
        toolId: writeTool.toolId,
        arguments: {},
    }), /需要用户确认/);
    assert.doesNotThrow(() => assertWeComCallAllowed(writeTool, {
        toolId: writeTool.toolId,
        arguments: {},
        confirmed: true,
    }));
});

test('企业微信只从受管安装包提取目标二进制', () => {
    const binary = Buffer.from('wecom-binary');
    const archive = buildTgz([{ name: 'package/bin/wecom-cli.exe', content: binary }]);
    assert.deepEqual(extractWeComBinaryArchive(archive, 'wecom-cli.exe'), binary);
    assert.throws(
        () => extractWeComBinaryArchive(buildTgz([{ name: 'package/README.md', content: Buffer.from('readme') }]), 'wecom-cli.exe'),
        /缺少平台可执行文件/,
    );
});

test('企业微信 Adapter 委托安装授权、解绑、动态工具和执行能力', async () => {
    const calls = [];
    const status = {
        state: 'READY', installed: true, authenticated: true, version: WECOM_CLI_VERSION,
        checkedAt: '2026-09-23T00:00:00.000Z', issueCode: null, recoveryAction: 'NONE', error: null,
        source: 'MANAGED', installSupported: true, authorizationState: 'AUTHORIZED',
        qrCodeDataUrl: null, authorizationExpiresAt: null, toolCount: 1,
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
    const adapter = new WeComConnectorAdapter(dependencies);

    adapter.configure('user-data');
    await adapter.status();
    await adapter.connect();
    await adapter.disconnect();
    adapter.resetTools();
    await adapter.discoverTools();
    await adapter.execute([{ toolId: 'calendar.schedules.list', arguments: {} }]);

    assert.equal(adapter.manifest.id, 'wecom');
    assert.deepEqual(calls.map(([name]) => name), [
        'configure', 'status', 'connect', 'disconnect', 'resetTools', 'discoverTools', 'execute',
    ]);
});

function buildTgz(entries) {
    const chunks = [];
    for (const entry of entries) {
        const header = Buffer.alloc(512);
        header.write(entry.name, 0, Math.min(Buffer.byteLength(entry.name), 100), 'utf8');
        header.write('0000777\0', 100, 8, 'ascii');
        header.write('0000000\0', 108, 8, 'ascii');
        header.write('0000000\0', 116, 8, 'ascii');
        header.write(`${entry.content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
        header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 12, 'ascii');
        header.fill(0x20, 148, 156);
        header.write('0', 156, 1, 'ascii');
        header.write('ustar\0', 257, 6, 'ascii');
        let checksum = 0;
        for (const byte of header) checksum += byte;
        header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
        chunks.push(header, entry.content, Buffer.alloc((512 - (entry.content.length % 512)) % 512));
    }
    chunks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(chunks));
}
