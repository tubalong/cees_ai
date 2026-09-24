const test = require('node:test');
const assert = require('node:assert/strict');

const {
    RemoteMcpError,
    RemoteMcpTransport,
} = require('../dist-electron/connectors/transports/remote-mcp.transport.js');

test('RemoteMcpTransport 使用固定 HTTPS 地址发送 JSON-RPC 并注入安全请求头', async () => {
    let invocation;
    const transport = new RemoteMcpTransport({
        endpoint: 'https://mcp.example.com/v1',
        resolveHeaders: () => ({ 'X-Connector-Token': 'secret-token', 'X-Skill-Version': 'v1' }),
        fetcher: async (input, init) => {
            invocation = { input: input.toString(), init };
            return jsonResponse({ jsonrpc: '2.0', id: 'response-1', result: { tools: [] } });
        },
    });

    assert.deepEqual(await transport.request('tools/list'), { tools: [] });
    assert.equal(invocation.input, 'https://mcp.example.com/v1');
    assert.equal(invocation.init.method, 'POST');
    assert.equal(invocation.init.redirect, 'error');
    assert.equal(invocation.init.headers['X-Connector-Token'], 'secret-token');
    assert.equal(invocation.init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(invocation.init.body);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.method, 'tools/list');
    assert.deepEqual(body.params, {});
    assert.equal(typeof body.id, 'string');
});

test('RemoteMcpTransport 保留 JSON-RPC 与 HTTP 错误语义', async () => {
    const businessError = new RemoteMcpTransport({
        endpoint: 'https://mcp.example.com/v1',
        resolveHeaders: () => ({}),
        fetcher: async () => jsonResponse({ jsonrpc: '2.0', id: '1', error: { code: -32001, message: 'Token invalid' } }),
    });
    await assert.rejects(
        businessError.request('tools/list'),
        (error) => error instanceof RemoteMcpError && error.code === -32001 && error.retryable === false,
    );

    const unavailable = new RemoteMcpTransport({
        endpoint: 'https://mcp.example.com/v1',
        resolveHeaders: () => ({}),
        fetcher: async () => new Response('temporarily unavailable', { status: 503 }),
    });
    await assert.rejects(
        unavailable.request('tools/list'),
        (error) => error instanceof RemoteMcpError && error.status === 503 && error.retryable === true,
    );
});

test('RemoteMcpTransport 拒绝非法响应、超限响应和超时', async () => {
    const invalidJson = new RemoteMcpTransport({
        endpoint: 'https://mcp.example.com/v1',
        resolveHeaders: () => ({}),
        fetcher: async () => new Response('not-json', { status: 200 }),
    });
    await assert.rejects(invalidJson.request('tools/list'), /无法解析的 JSON/);

    const oversized = new RemoteMcpTransport({
        endpoint: 'https://mcp.example.com/v1',
        resolveHeaders: () => ({}),
        maxResponseBytes: 8,
        fetcher: async () => jsonResponse({ result: { value: 'too-long' } }),
    });
    await assert.rejects(
        oversized.request('tools/list'),
        (error) => error instanceof RemoteMcpError && error.method === 'tools/list' && /超过 8 字节/.test(error.message),
    );

    const timedOut = new RemoteMcpTransport({
        endpoint: 'https://mcp.example.com/v1',
        resolveHeaders: () => ({}),
        timeoutMs: 5,
        fetcher: async (_input, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
    });
    await assert.rejects(
        timedOut.request('tools/list'),
        (error) => error instanceof RemoteMcpError && error.timedOut === true && error.retryable === true,
    );
});

test('RemoteMcpTransport 拒绝不安全地址、方法和请求头', async () => {
    assert.throws(
        () => new RemoteMcpTransport({ endpoint: 'http://mcp.example.com/v1', resolveHeaders: () => ({}) }),
        /HTTPS URL/,
    );
    assert.throws(
        () => new RemoteMcpTransport({ endpoint: 'https://user:pass@mcp.example.com/v1', resolveHeaders: () => ({}) }),
        /HTTPS URL/,
    );

    const unsafeHeader = new RemoteMcpTransport({
        endpoint: 'https://mcp.example.com/v1',
        resolveHeaders: () => ({ Host: 'attacker.example.com' }),
        fetcher: async () => jsonResponse({ result: {} }),
    });
    await assert.rejects(unsafeHeader.request('tools/list'), /请求头无效/);
    await assert.rejects(unsafeHeader.request('invalid-method'), /方法无效/);
});

function jsonResponse(value) {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
