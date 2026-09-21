const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ConnectorRegistry,
    ConnectorRegistryError,
} = require('../dist-electron/connectors/core/connector-registry.js');
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
