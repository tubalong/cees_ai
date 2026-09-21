const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DINGTALK_CONNECTOR_MANIFEST,
    buildPersonalAttendanceRecordArguments,
    buildDwsArguments,
    buildDingTalkReadToolCatalog,
    buildVisibleOrganizationContextData,
    compareDwsVersions,
    normalizeDingTalkAttendanceContext,
    normalizeDwsVersion,
    parseDingTalkUpgradeCheck,
    parseDingTalkReadTools,
    sanitizeConnectorData,
} = require('../dist-electron/dingtalk-connector.js');

test('钉钉以本地 CLI 连接器 Manifest 声明运行能力', () => {
    assert.deepEqual(DINGTALK_CONNECTOR_MANIFEST, {
        id: 'dingtalk',
        name: '钉钉',
        description: '通过命令行管理钉钉全产品能力',
        icon: 'dingtalk',
        transportType: 'LOCAL_CLI',
        executionLocation: 'DESKTOP',
        authType: 'OAUTH',
        supportsInstall: true,
        supportsDisconnect: true,
        supportsProfiles: true,
        supportsDynamicTools: true,
        supportsVersionManagement: true,
    });
});

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
            {
                canonical_path: 'attendance.shortcut_my_attendance',
                cli_path: 'attendance +my-attendance',
                agent_summary: '查询我的考勤',
                effect: 'read',
                confirmation: 'not_required',
                availability: 'available',
                parameters: {},
            },
            { canonical_path: 'todo.create', primary_cli_path: 'todo create', effect: 'write', confirmation: 'user_required', availability: 'available', parameters: {} },
            { canonical_path: 'drive.list', primary_cli_path: 'drive list', effect: 'read', confirmation: 'user_required', availability: 'available', parameters: {} },
            { canonical_path: 'mail.list', primary_cli_path: 'mail list', effect: 'read', confirmation: 'not_required', availability: 'unavailable', parameters: {} },
            { canonical_path: 'dev.secret.get', primary_cli_path: 'dev secret get', effect: 'read', confirmation: 'not_required', availability: 'available', parameters: { appSecret: { type: 'string', required: true } } },
        ] }],
    });
    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, 'calendar.event.list');
    assert.equal(tools[0].parameters.type, 'object');
    assert.deepEqual(tools[0].parameters.required, ['start']);
    assert.equal(tools[1].cliPath, 'attendance +my-attendance');
});

test('工具目录包含完整可见组织、本人考勤和本人审批复合只读工具', () => {
    const tools = buildDingTalkReadToolCatalog({ products: [] });
    assert.deepEqual(tools.map((tool) => tool.name), [
        'cees.visible_organization',
        'cees.my_attendance_records',
        'cees.my_attendance_approvals',
    ]);
    assert.equal(tools[0].parameters.additionalProperties, false);
    assert.equal(tools[1].parameters.properties.start.format, 'date');
    assert.equal(tools[2].parameters.properties.types.type, 'array');
});

test('本人考勤复合工具默认按本机时区查询今天且限制一个月', () => {
    assert.deepEqual(buildPersonalAttendanceRecordArguments(
        'user-1',
        {},
        new Date('2026-09-20T16:30:00.000Z'),
        'Asia/Shanghai',
    ), [
        'attendance', '+check-record', '--users', 'user-1',
        '--start', '2026-09-21', '--end', '2026-09-21', '--format', 'json',
    ]);
    assert.throws(() => buildPersonalAttendanceRecordArguments(
        'user-1',
        { start: '2026-01-31', end: '2026-03-01' },
        new Date('2026-09-21T00:00:00.000Z'),
        'Asia/Shanghai',
    ), /不能超过一个月/);
    assert.deepEqual(buildPersonalAttendanceRecordArguments(
        'user-1',
        { end: '2026-09-01' },
        new Date('2026-09-21T00:00:00.000Z'),
        'Asia/Shanghai',
    ).slice(4, 8), ['--start', '2026-09-01', '--end', '2026-09-01']);
});

test('考勤时间戳按指定时区确定性换算并保留字段语义', () => {
    const normalized = normalizeDingTalkAttendanceContext({
        count: 2,
        records: [
            {
                id: 1,
                userId: 'user-1',
                workDate: 1788192000000,
                userCheckTime: 1788223089000,
                baseCheckTime: 1788224400000,
                checkType: 'OnDuty',
                timeResult: 'Normal',
            },
            {
                id: 2,
                userId: 'user-1',
                workDate: '2026-09-01',
                userCheckTime: '1788256800',
                checkType: 'OffDuty',
            },
        ],
    }, 'Asia/Shanghai');

    assert.equal(normalized.schemaVersion, 'cees.dingtalk.attendance.v1');
    assert.equal(normalized.timezone, 'Asia/Shanghai');
    assert.equal(normalized.complete, true);
    assert.deepEqual(normalized.records[0], {
        id: '1',
        userId: 'user-1',
        workDate: '2026-09-01',
        checkType: 'ON_DUTY',
        actualCheckTime: '2026-09-01T08:38:09+08:00',
        actualCheckTimeLocal: '2026-09-01 08:38:09',
        baseCheckTime: '2026-09-01T09:00:00+08:00',
        baseCheckTimeLocal: '2026-09-01 09:00:00',
        status: 'Normal',
        sourceFields: {
            workDate: 'workDate',
            actualCheckTime: 'userCheckTime',
            baseCheckTime: 'baseCheckTime',
            checkType: 'checkType',
            status: 'timeResult',
        },
    });
    assert.equal(normalized.records[1].actualCheckTimeLocal, '2026-09-01 18:00:00');
    assert.equal(normalized.records[1].checkType, 'OFF_DUTY');
});

test('考勤记录存在但实际打卡时间无效时拒绝生成上下文', () => {
    assert.throws(() => normalizeDingTalkAttendanceContext({
        count: 1,
        records: [{ id: 1, workDate: '2026-09-01', userCheckTime: 178822308900 }],
    }, 'Asia/Shanghai'), /实际打卡时间无效/);
    assert.throws(() => normalizeDingTalkAttendanceContext({ success: true }, 'Asia/Shanghai'), /缺少 records 数组/);
});

test('完整组织上下文按字节预算截断并标记不完整', () => {
    const data = buildVisibleOrganizationContextData({
        corpId: 'corp-1',
        externalUserId: 'user-1',
        externalUserName: '张三',
        profile: 'corp-1:user-1',
        fetchedAt: '2026-09-21T00:00:00.000Z',
        capabilities: ['contact.organization.visible.read'],
        departments: Array.from({ length: 200 }, (_, index) => ({
            externalDepartmentId: String(index + 1),
            parentExternalDepartmentId: null,
            name: `部门-${index}-${'长'.repeat(100)}`,
            displayOrder: index,
        })),
        users: Array.from({ length: 500 }, (_, index) => ({
            externalUserId: `user-${index}`,
            unionId: null,
            name: `员工-${index}-${'长'.repeat(100)}`,
            title: null,
            jobNumber: null,
            departmentExternalIds: ['1'],
            active: true,
            admin: false,
            boss: false,
        })),
    });
    assert.equal(data.complete, false);
    assert.equal(data.departmentCount, 200);
    assert.equal(data.userCount, 500);
    assert.ok(data.returnedDepartmentCount < 200 || data.returnedUserCount < 500);
    assert.match(data.warnings[0], /已截断/);
    assert.ok(Buffer.byteLength(JSON.stringify(data), 'utf8') <= 40 * 1024);
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
