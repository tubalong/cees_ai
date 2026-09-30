const test = require('node:test');
const assert = require('node:assert/strict');

const {
    LocalCliCommandError,
    LocalCliTransport,
    parseLocalCliJsonOutput,
} = require('../dist-electron/connectors/transports/local-cli.transport.js');

test('LocalCliTransport 使用固定命令和参数数组且禁用 shell', async () => {
    let invocation;
    const transport = new LocalCliTransport({
        resolveExecutable: () => ({ command: 'vendor-cli', prefixArgs: ['fixed'] }),
        executeFile: async (command, args, options) => {
            invocation = { command, args, options };
            return { stdout: 'ok', stderr: '' };
        },
    });

    const output = await transport.execute(['query', 'value & whoami', '$(unsafe)'], {
        timeoutMs: 1234,
        envOverrides: { CONNECTOR_TEST: 'enabled' },
    });

    assert.equal(output, 'ok');
    assert.equal(invocation.command, 'vendor-cli');
    assert.deepEqual(invocation.args, ['fixed', 'query', 'value & whoami', '$(unsafe)']);
    assert.equal(invocation.options.shell, false);
    assert.equal(invocation.options.timeout, 1234);
    assert.equal(invocation.options.env.CONNECTOR_TEST, 'enabled');
});

test('LocalCliTransport 解析标准 JSON 和带前置日志的 JSON', async () => {
    const outputs = ['{"ready":true}', 'loading...\n{"ready":true}', '{"ready":true}\ndone', 'loading...\n{"ready":true}\ndone'];
    const transport = new LocalCliTransport({
        resolveExecutable: () => ({ command: 'vendor-cli' }),
        executeFile: async () => ({ stdout: outputs.shift(), stderr: '' }),
    });

    assert.deepEqual(await transport.executeJson([], { timeoutMs: 1000, outputLabel: '测试 CLI' }), { ready: true });
    assert.deepEqual(await transport.executeJson([], { timeoutMs: 1000, outputLabel: '测试 CLI' }), { ready: true });
    assert.deepEqual(await transport.executeJson([], { timeoutMs: 1000, outputLabel: '测试 CLI' }), { ready: true });
    assert.deepEqual(await transport.executeJson([], { timeoutMs: 1000, outputLabel: '测试 CLI' }), { ready: true });
    assert.throws(() => parseLocalCliJsonOutput('not-json', '测试 CLI'), /测试 CLI 返回了无法解析的 JSON 数据/);
    assert.deepEqual(parseLocalCliJsonOutput('日志 {"message":"括号 [] 不应截断"} 完成', '测试 CLI'), {
        message: '括号 [] 不应截断',
    });
    assert.deepEqual(parseLocalCliJsonOutput('日志 [1,{"ok":true}] 完成', '测试 CLI'), [1, { ok: true }]);
});

test('LocalCliTransport 将非零退出和 stderr 转换为结构化错误', async () => {
    const transport = new LocalCliTransport({
        resolveExecutable: () => ({ command: 'vendor-cli' }),
        executeFile: async () => {
            throw Object.assign(new Error('command failed'), {
                code: 2,
                stdout: 'partial output',
                stderr: '{"error":{"reason":"denied"}}',
            });
        },
    });

    await assert.rejects(
        transport.execute(['query'], { timeoutMs: 1000, outputLabel: '测试 CLI' }),
        (error) => error instanceof LocalCliCommandError
            && error.exitCode === 2
            && error.stdout === 'partial output'
            && error.stderr.includes('denied'),
    );
});

test('LocalCliTransport 统一标记超时错误', async () => {
    const transport = new LocalCliTransport({
        resolveExecutable: () => ({ command: 'vendor-cli' }),
        executeFile: async () => {
            throw Object.assign(new Error('operation stopped'), {
                code: 'ETIMEDOUT',
                signal: 'SIGTERM',
            });
        },
    });

    await assert.rejects(
        transport.execute(['query'], { timeoutMs: 20, outputLabel: '测试 CLI' }),
        (error) => error instanceof LocalCliCommandError
            && error.timedOut === true
            && /测试 CLI 执行超时/.test(error.message),
    );
});

test('LocalCliTransport 传递输出上限并保留超限错误', async () => {
    let configuredMaxBuffer;
    const transport = new LocalCliTransport({
        resolveExecutable: () => ({ command: 'vendor-cli' }),
        maxBufferBytes: 64,
        executeFile: async (_command, _args, options) => {
            configuredMaxBuffer = options.maxBuffer;
            throw Object.assign(new Error('stdout maxBuffer length exceeded'), {
                code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
            });
        },
    });

    await assert.rejects(
        transport.execute(['query'], { timeoutMs: 1000 }),
        (error) => error instanceof LocalCliCommandError
            && error.exitCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    );
    assert.equal(configuredMaxBuffer, 64);
});

test('LocalCliTransport 拒绝非法参数并提供健康检查', async () => {
    const healthy = new LocalCliTransport({
        resolveExecutable: () => ({ command: 'vendor-cli' }),
        executeFile: async () => ({ stdout: 'vendor-cli 1.2.3', stderr: '' }),
    });

    await assert.rejects(
        healthy.execute(['bad\0argument'], { timeoutMs: 1000 }),
        /包含非法控制字符/,
    );
    assert.deepEqual(await healthy.healthCheck({ timeoutMs: 1000 }), {
        healthy: true,
        version: 'vendor-cli 1.2.3',
        error: null,
    });
});
