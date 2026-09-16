import { MinerUDocumentParser } from './knowledge-document-parser';
import type { StorageProvider } from '../storage/storage.types';

const input = {
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    fileObjectId: 'file-1',
    name: 'demo.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024n,
    objectKey: 'cees/staging/demo.pdf',
};

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function makeStorage(downloadUrl = 'https://cos.example.com/signed'): StorageProvider {
    return {
        createDownloadUrl: jest.fn().mockResolvedValue(downloadUrl),
        createUploadUrl: jest.fn(),
        headObject: jest.fn(),
        putObject: jest.fn(),
        deleteObject: jest.fn(),
    };
}

function downloadResponse(): Partial<Response> {
    return {
        ok: true,
        status: 200,
        arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes').buffer),
    };
}

/** 第一次 fetch（COS 下载）成功，第二次 fetch（MinerU /file_parse）按给定状态返回。 */
function mockFetchSequence(mineruStatus: number, mineruBody: unknown): void {
    global.fetch = jest.fn()
        .mockResolvedValueOnce(downloadResponse())
        .mockResolvedValueOnce({
            ok: mineruStatus >= 200 && mineruStatus < 300,
            status: mineruStatus,
            json: jest.fn().mockResolvedValue(mineruBody),
        }) as unknown as typeof fetch;
}

/** 第一次 fetch（COS 下载）成功后第二次（MinerU）网络异常。 */
function mockFetchMineruRejected(error: Error): void {
    global.fetch = jest.fn()
        .mockResolvedValueOnce(downloadResponse())
        .mockRejectedValueOnce(error) as unknown as typeof fetch;
}

afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe('MinerUDocumentParser', () => {
    it('未配置 MINERU_API_URL 时抛非重试错误', async () => {
        delete process.env.MINERU_API_URL;
        const parser = new MinerUDocumentParser(makeStorage());
        await expect(parser.parse(input)).rejects.toMatchObject({
            code: 'MINERU_NOT_CONFIGURED',
            retryable: false,
        });
    });

    it('解析成功时从 content_list 构造 ParsedDocument', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        const storage = makeStorage();
        mockFetchSequence(200, {
            version: '3.4.5',
            content_list: [{ type: 'text', text: '第一段' }],
        });
        const parser = new MinerUDocumentParser(storage);
        const parsed = await parser.parse(input);
        expect(parsed).toMatchObject({
            document_id: 'doc-1',
            document_version_id: 'ver-1',
            parser_name: 'mineru',
            parser_version: '3.4.5',
        });
        expect(parsed.blocks).toHaveLength(1);
        expect(parsed.blocks[0].text).toBe('第一段');
        expect(storage.createDownloadUrl).toHaveBeenCalledWith('cees/staging/demo.pdf');
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('兼容 MinerU 3.4.5 服务模式响应（results 按文件名索引 + content_list JSON 字符串）', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        mockFetchSequence(200, {
            task_id: 'task-1',
            status: 'completed',
            version: '3.4.5',
            results: {
                'smoke-test': {
                    content_list: JSON.stringify([
                        { type: 'text', text: 'MinerU pipeline smoke test', bbox: [0, 0, 100, 20], page_idx: 0 },
                    ]),
                },
            },
        });
        const parser = new MinerUDocumentParser(makeStorage());
        const parsed = await parser.parse(input);
        expect(parsed.parser_name).toBe('mineru');
        expect(parsed.parser_version).toBe('3.4.5');
        expect(parsed.blocks).toHaveLength(1);
        expect(parsed.blocks[0].text).toBe('MinerU pipeline smoke test');
        expect(parsed.blocks[0].page_index).toBe(0);
        expect(parsed.blocks[0].bbox).toEqual([0, 0, 100, 20]);
    });

    it('status=failed 且带 error 时抛非重试解析失败', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        mockFetchSequence(200, { status: 'failed', error: 'backend crashed' });
        const parser = new MinerUDocumentParser(makeStorage());
        await expect(parser.parse(input)).rejects.toMatchObject({
            code: 'MINERU_PARSE_FAILED',
            retryable: false,
        });
    });

    it('无 content_list 时回退 md_content 走 Markdown 解析', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        mockFetchSequence(200, { md_content: '# 标题\n\n正文' });
        const parser = new MinerUDocumentParser(makeStorage());
        const parsed = await parser.parse(input);
        expect(parsed.parser_name).toBe('markdown');
        expect(parsed.blocks).toHaveLength(2);
    });

    it('PARSE_RC 非零时抛非重试解析失败', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        mockFetchSequence(200, { PARSE_RC: 1, content_list: [] });
        const parser = new MinerUDocumentParser(makeStorage());
        await expect(parser.parse(input)).rejects.toMatchObject({
            code: 'MINERU_PARSE_FAILED',
            retryable: false,
        });
    });

    it('HTTP 5xx 抛可重试错误', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        mockFetchSequence(503, {});
        const parser = new MinerUDocumentParser(makeStorage());
        await expect(parser.parse(input)).rejects.toMatchObject({
            code: 'MINERU_HTTP_ERROR',
            retryable: true,
        });
    });

    it('HTTP 4xx 抛非重试错误', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        mockFetchSequence(400, {});
        const parser = new MinerUDocumentParser(makeStorage());
        await expect(parser.parse(input)).rejects.toMatchObject({
            code: 'MINERU_HTTP_ERROR',
            retryable: false,
        });
    });

    it('网络错误抛可重试服务不可用', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        mockFetchMineruRejected(new Error('ECONNREFUSED'));
        const parser = new MinerUDocumentParser(makeStorage());
        await expect(parser.parse(input)).rejects.toMatchObject({
            code: 'MINERU_TIMEOUT',
            retryable: true,
        });
    });

    it('响应无任何可用产物时抛非重试空结果', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        mockFetchSequence(200, { version: '3.4.5' });
        const parser = new MinerUDocumentParser(makeStorage());
        await expect(parser.parse(input)).rejects.toMatchObject({
            code: 'MINERU_EMPTY_RESULT',
            retryable: false,
        });
    });

    it('COS 下载 URL 生成失败时抛可重试下载错误', async () => {
        process.env.MINERU_API_URL = 'http://192.168.5.29:8002';
        const storage = makeStorage();
        (storage.createDownloadUrl as jest.Mock).mockRejectedValue(new Error('cos down'));
        const parser = new MinerUDocumentParser(storage);
        await expect(parser.parse(input)).rejects.toMatchObject({
            code: 'MINERU_DOWNLOAD_FAILED',
            retryable: true,
        });
    });
});
