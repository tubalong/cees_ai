const test = require('node:test');
const assert = require('node:assert/strict');

const {
    HttpApiError,
    HttpApiTransport,
} = require('../dist-electron/connectors/transports/http-api.transport.js');

test('HttpApiTransport 只请求固定服务和允许路径并解析 JSON', async () => {
    let invocation;
    const transport = new HttpApiTransport({
        baseUrl: 'https://api.example.com/connectors/',
        allowedPathPrefixes: ['/v1/tencent-meeting'],
        resolveHeaders: () => ({ authorization: 'Bearer server-session' }),
        fetcher: async (url, options) => {
            invocation = { url: url.toString(), options };
            return new Response(JSON.stringify({ meetings: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    });

    const result = await transport.requestJson({
        method: 'GET',
        path: '/v1/tencent-meeting/meetings',
        query: { page: 1, active: true, ignored: undefined },
        timeoutMs: 1000,
        outputLabel: '腾讯会议服务',
    });

    assert.deepEqual(result, { meetings: [] });
    assert.equal(invocation.url, 'https://api.example.com/connectors/v1/tencent-meeting/meetings?page=1&active=true');
    assert.equal(invocation.options.method, 'GET');
    assert.equal(invocation.options.headers.authorization, 'Bearer server-session');
    assert.equal(invocation.options.redirect, 'error');
});

test('HttpApiTransport 拒绝跨域、未授权路径和请求头注入', async () => {
    const transport = new HttpApiTransport({
        baseUrl: 'https://api.example.com/',
        allowedPathPrefixes: ['/v1/tencent-meeting'],
        fetcher: async () => new Response('{}'),
    });

    await assert.rejects(
        transport.requestJson({ method: 'GET', path: 'https://evil.example.com/data', timeoutMs: 1000 }),
        /站内绝对路径/,
    );
    await assert.rejects(
        transport.requestJson({ method: 'GET', path: '/v1/admin', timeoutMs: 1000 }),
        /不在允许范围内/,
    );

    const invalidHeaders = new HttpApiTransport({
        baseUrl: 'https://api.example.com/',
        allowedPathPrefixes: ['/v1/tencent-meeting'],
        resolveHeaders: () => ({ host: 'evil.example.com' }),
        fetcher: async () => new Response('{}'),
    });
    await assert.rejects(
        invalidHeaders.requestJson({ method: 'GET', path: '/v1/tencent-meeting/profile', timeoutMs: 1000 }),
        /不允许覆盖请求头/,
    );
});

test('HttpApiTransport 将 HTTP 错误转换为结构化错误', async () => {
    const transport = new HttpApiTransport({
        baseUrl: 'https://api.example.com/',
        allowedPathPrefixes: ['/v1/tencent-meeting'],
        fetcher: async () => new Response('{"message":"busy"}', { status: 503 }),
    });

    await assert.rejects(
        transport.requestJson({
            method: 'POST',
            path: '/v1/tencent-meeting/meetings/query',
            body: { page: 1 },
            timeoutMs: 1000,
            outputLabel: '腾讯会议服务',
        }),
        (error) => error instanceof HttpApiError
            && error.status === 503
            && error.method === 'POST'
            && error.retryable === true
            && error.responseBody.includes('busy'),
    );
});

test('HttpApiTransport 限制响应大小并统一标记超时', async () => {
    const oversized = new HttpApiTransport({
        baseUrl: 'https://api.example.com/',
        allowedPathPrefixes: ['/v1/tencent-meeting'],
        maxResponseBytes: 8,
        fetcher: async () => new Response('{"message":"too large"}'),
    });
    await assert.rejects(
        oversized.requestJson({ method: 'GET', path: '/v1/tencent-meeting/profile', timeoutMs: 1000 }),
        (error) => error instanceof HttpApiError && /响应超过 8 字节限制/.test(error.message),
    );

    const timeout = new HttpApiTransport({
        baseUrl: 'https://api.example.com/',
        allowedPathPrefixes: ['/v1/tencent-meeting'],
        fetcher: async (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    });
    await assert.rejects(
        timeout.requestJson({ method: 'GET', path: '/v1/tencent-meeting/profile', timeoutMs: 10 }),
        (error) => error instanceof HttpApiError && error.timedOut === true && error.retryable === true,
    );
});
