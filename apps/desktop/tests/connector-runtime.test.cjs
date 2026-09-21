const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ConnectorRegistry,
    ConnectorRegistryError,
} = require('../dist-electron/connectors/core/connector-registry.js');
const {
    ConnectorHost,
} = require('../dist-electron/connectors/core/connector-host.js');
const {
    DingTalkConnectorAdapter,
} = require('../dist-electron/connectors/dingtalk/dingtalk.adapter.js');

function createFakeAdapter(id = 'fake') {
    return {
        manifest: {
            id,
            name: id,
            description: `${id} connector`,
            icon: id,
            transportType: 'LOCAL_CLI',
            executionLocation: 'DESKTOP',
            authType: 'NONE',
            supportsInstall: false,
            supportsDisconnect: true,
            supportsProfiles: false,
            supportsDynamicTools: false,
            supportsVersionManagement: false,
        },
        configure() {},
        status: async () => ({
            state: 'READY',
            installed: true,
            authenticated: true,
            version: '1.0.0',
            checkedAt: '2026-09-21T00:00:00.000Z',
            issueCode: null,
            recoveryAction: 'NONE',
            error: null,
        }),
        connect: async () => ({}),
        disconnect: async () => ({}),
        resetTools() {},
        discoverTools: async () => [],
        execute: async () => [],
    };
}

test('Registry 注册、查询和列出连接器 Manifest', () => {
    const registry = new ConnectorRegistry();
    const adapter = createFakeAdapter();

    registry.register(adapter);

    assert.equal(registry.has('fake'), true);
    assert.equal(registry.get('fake'), adapter);
    assert.deepEqual(registry.list(), [adapter.manifest]);
});

test('Registry 拒绝重复注册和未知连接器', () => {
    const registry = new ConnectorRegistry();
    registry.register(createFakeAdapter());

    assert.throws(
        () => registry.register(createFakeAdapter()),
        (error) => error instanceof ConnectorRegistryError
            && error.code === 'CONNECTOR_ALREADY_REGISTERED',
    );
    assert.throws(
        () => registry.get('missing'),
        (error) => error instanceof ConnectorRegistryError
            && error.code === 'CONNECTOR_NOT_FOUND',
    );
});

test('钉钉 Adapter 委托现有连接器能力并保留扩展能力', async () => {
    const calls = [];
    const status = {
        state: 'READY',
        installed: true,
        authenticated: true,
        version: 'v1.0.62',
        checkedAt: '2026-09-21T00:00:00.000Z',
        issueCode: null,
        recoveryAction: 'NONE',
        error: null,
        source: 'MANAGED',
        installSupported: true,
        profile: 'corp:user',
        corpId: 'corp',
        corpName: '企业',
        externalUserId: 'user',
        externalUserName: '用户',
        profiles: [],
    };
    const dependencies = {
        configure: (value) => calls.push(['configure', value]),
        status: async () => { calls.push(['status']); return status; },
        login: async () => { calls.push(['login']); return status; },
        connect: async () => { calls.push(['connect']); return status; },
        disconnect: async () => { calls.push(['disconnect']); return status; },
        selectProfile: async (value) => { calls.push(['selectProfile', value]); return status; },
        fetchOrganization: async () => { calls.push(['fetchOrganization']); return { users: [] }; },
        resetTools: () => calls.push(['resetTools']),
        discoverTools: async () => { calls.push(['discoverTools']); return []; },
        execute: async (value) => { calls.push(['execute', value]); return []; },
        getRelease: async () => { calls.push(['getRelease']); return {}; },
        checkForUpdates: async () => { calls.push(['checkForUpdates']); return {}; },
        upgrade: async (value) => { calls.push(['upgrade', value]); return { release: {}, status }; },
        rollback: async () => { calls.push(['rollback']); return { release: {}, status }; },
    };
    const adapter = new DingTalkConnectorAdapter(dependencies);

    adapter.configure('user-data');
    await adapter.status();
    await adapter.login();
    await adapter.connect();
    await adapter.disconnect();
    await adapter.selectProfile('corp:user');
    await adapter.fetchOrganization();
    adapter.resetTools();
    await adapter.discoverTools();
    await adapter.execute([]);
    await adapter.getRelease();
    await adapter.checkForUpdates();
    await adapter.upgrade('v1.0.63');
    await adapter.rollback();

    assert.equal(adapter.manifest.id, 'dingtalk');
    assert.deepEqual(calls.map(([name]) => name), [
        'configure', 'status', 'login', 'connect', 'disconnect',
        'selectProfile', 'fetchOrganization', 'resetTools', 'discoverTools',
        'execute', 'getRelease', 'checkForUpdates', 'upgrade', 'rollback',
    ]);
});

test('ConnectorHost 统一委托生命周期、工具和调用，并发布带 ID 的状态事件', async () => {
    const calls = [];
    const events = [];
    const tools = [{ toolId: 'tool-1', name: '查询', description: '查询', parameters: {} }];
    const readyStatus = {
        state: 'READY',
        installed: true,
        authenticated: true,
        version: '1.0.0',
        checkedAt: '2026-09-21T00:00:00.000Z',
        issueCode: null,
        recoveryAction: 'NONE',
        error: null,
    };
    const adapter = {
        ...createFakeAdapter('fake'),
        status: async () => { calls.push('status'); return readyStatus; },
        connect: async () => { calls.push('connect'); return readyStatus; },
        disconnect: async () => { calls.push('disconnect'); return readyStatus; },
        discoverTools: async () => { calls.push('tools'); return tools; },
        execute: async (input) => { calls.push(['execute', input]); return [{ provider: 'FAKE', toolId: 'tool-1', toolName: '查询', fetchedAt: '2026-09-21T00:00:00.000Z', data: {} }]; },
    };
    const registry = new ConnectorRegistry();
    registry.register(adapter);
    const host = new ConnectorHost(registry, (event) => events.push(event));

    assert.deepEqual(host.list(), [adapter.manifest]);
    assert.deepEqual(await host.status('fake'), readyStatus);
    assert.deepEqual(await host.connect('fake'), readyStatus);
    assert.deepEqual(await host.disconnect('fake'), readyStatus);
    assert.deepEqual(await host.tools('fake'), tools);
    assert.deepEqual(await host.execute('fake', [{ toolId: 'tool-1', arguments: {} }]), [{
        provider: 'FAKE', toolId: 'tool-1', toolName: '查询', fetchedAt: '2026-09-21T00:00:00.000Z', data: {},
    }]);
    assert.deepEqual(calls, ['status', 'connect', 'disconnect', 'tools', ['execute', [{ toolId: 'tool-1', arguments: {} }]]]);
    assert.equal(events.length, 3);
    assert.equal(events.every((event) => event.connectorId === 'fake'), true);
    assert.equal(events.every((event) => event.status === readyStatus), true);
});

test('ConnectorHost 在非 READY 时清理工具缓存，执行失败时刷新状态并保留原错误', async () => {
    const calls = [];
    const status = {
        state: 'AUTH_REQUIRED',
        installed: true,
        authenticated: false,
        version: '1.0.0',
        checkedAt: '2026-09-21T00:00:00.000Z',
        issueCode: 'AUTH_REQUIRED',
        recoveryAction: 'AUTHORIZE',
        error: '需要授权',
    };
    const adapter = {
        ...createFakeAdapter('fake'),
        status: async () => { calls.push('status'); return status; },
        resetTools: () => calls.push('resetTools'),
        execute: async () => {
            calls.push('execute');
            throw new Error('执行失败');
        },
    };
    const registry = new ConnectorRegistry();
    registry.register(adapter);
    const host = new ConnectorHost(registry);

    await host.status('fake');
    assert.deepEqual(calls, ['status', 'resetTools']);
    await assert.rejects(host.execute('fake', []), /执行失败/);
    assert.deepEqual(calls, ['status', 'resetTools', 'execute', 'resetTools', 'status', 'resetTools']);
});

test('ConnectorHost 拒绝非法连接器 ID 和调用计划', async () => {
    const registry = new ConnectorRegistry();
    registry.register(createFakeAdapter('fake'));
    const host = new ConnectorHost(registry);

    await assert.rejects(host.status(' fake'), /连接器 ID 无效/);
    await assert.rejects(host.status('missing'), /连接器未注册/);
    await assert.rejects(host.execute('fake', 'not-an-array'), /连接器调用计划无效/);
    await assert.rejects(host.execute('fake', [{ toolId: '', arguments: {} }]), /连接器调用计划无效/);
    await assert.rejects(host.execute('fake', [{ toolId: 'tool', arguments: [] }]), /连接器调用计划无效/);
});
