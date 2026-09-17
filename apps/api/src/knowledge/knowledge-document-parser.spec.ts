import {
    AiServiceGateway,
    AiServiceInvocationError,
} from '../ai-orchestration/ai-service-gateway.service';
import {
    MinerUDocumentParser,
    RoutedKnowledgeDocumentParser,
} from './knowledge-document-parser';
import type { StorageProvider } from '../storage/storage.types';

const input = {
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    fileObjectId: 'file-1',
    name: 'demo.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024n,
    objectKey: 'cees/staging/demo.pdf',
    tenantId: 'tenant-1',
    userId: 'user-1',
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

describe('RoutedKnowledgeDocumentParser', () => {
    const mineruParse = jest.fn();
    const gatewayExtractFile = jest.fn();

    function makeParser(storage = makeStorage()) {
        return new RoutedKnowledgeDocumentParser(
            { parse: mineruParse } as unknown as MinerUDocumentParser,
            { extractFile: gatewayExtractFile } as unknown as AiServiceGateway,
            storage,
        );
    }

    beforeEach(() => {
        mineruParse.mockReset();
        gatewayExtractFile.mockReset();
        // 用精确长度的 ArrayBuffer（池化 Buffer 的 .buffer 会带入相邻内存垃圾字节）。
        global.fetch = jest.fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                arrayBuffer: jest.fn().mockResolvedValue(
                    Uint8Array.from(Buffer.from('file-bytes')).buffer,
                ),
            }) as unknown as typeof fetch;
    });

    const docxInput = { ...input, name: 'demo.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

    it('docx 走本地提取路径，不调用 MinerU', async () => {
        gatewayExtractFile.mockResolvedValue({
            request_id: 'request-id',
            parts: [{ type: 'text', text: '第一段\n\n第二段' }],
            metadata: { content_type: docxInput.mimeType, engine: 'python-docx', text_length: 7 },
        });
        const parser = makeParser();
        const parsed = await parser.parse(docxInput);

        expect(mineruParse).not.toHaveBeenCalled();
        expect(gatewayExtractFile).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: 'tenant-1',
            user_id: 'user-1',
            filename: 'demo.docx',
            content_type: docxInput.mimeType,
            data_base64: Buffer.from('file-bytes').toString('base64'),
        }));
        expect(parsed).toMatchObject({
            parser_name: 'extraction',
            parser_version: 'python-docx',
        });
        expect(parsed.blocks).toHaveLength(2);
        expect(parsed.blocks[0].page_index).toBeNull();
        expect(parsed.blocks[0].bbox).toBeNull();
    });

    it('pdf 走 MinerU 路径，不调用本地提取', async () => {
        mineruParse.mockResolvedValue({ document_id: 'doc-1', parser_name: 'mineru', blocks: [] });
        const parser = makeParser();
        await parser.parse(input);

        expect(mineruParse).toHaveBeenCalledWith(input);
        expect(gatewayExtractFile).not.toHaveBeenCalled();
    });

    it('ai-service 非重试错误（422 文件不支持）映射为不可重试提取失败', async () => {
        gatewayExtractFile.mockRejectedValue(
            new AiServiceInvocationError('UNSUPPORTED_FILE_TYPE', 'Unsupported file type', false, 422),
        );
        const parser = makeParser();
        await expect(parser.parse(docxInput)).rejects.toMatchObject({
            code: 'EXTRACTION_FAILED',
            retryable: false,
        });
    });

    it('ai-service 可重试错误（5xx/网络）映射为可重试服务错误', async () => {
        gatewayExtractFile.mockRejectedValue(
            new AiServiceInvocationError('AI_SERVICE_UNAVAILABLE', 'AI service request failed', true, 503),
        );
        const parser = makeParser();
        await expect(parser.parse(docxInput)).rejects.toMatchObject({
            code: 'EXTRACTION_SERVICE_ERROR',
            retryable: true,
        });
    });

    it('提取结果无文本时抛非重试空结果', async () => {
        gatewayExtractFile.mockResolvedValue({
            request_id: 'request-id',
            parts: [],
            metadata: { content_type: docxInput.mimeType, engine: 'python-docx', text_length: 0 },
        });
        const parser = makeParser();
        await expect(parser.parse(docxInput)).rejects.toMatchObject({
            code: 'EXTRACTION_EMPTY_RESULT',
            retryable: false,
        });
    });

    it('COS 下载失败时抛可重试下载错误', async () => {
        const storage = makeStorage();
        (storage.createDownloadUrl as jest.Mock).mockRejectedValue(new Error('cos down'));
        const parser = makeParser(storage);
        await expect(parser.parse(docxInput)).rejects.toMatchObject({
            code: 'EXTRACTION_DOWNLOAD_FAILED',
            retryable: true,
        });
        expect(gatewayExtractFile).not.toHaveBeenCalled();
    });
});
