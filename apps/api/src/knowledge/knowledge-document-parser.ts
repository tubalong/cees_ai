import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ParsedDocument } from '@cees/ai-service-client';
import { STORAGE_PROVIDER } from '../storage/storage.tokens';
import { StorageProvider } from '../storage/storage.types';
import { fromContentListJson, fromMarkdown } from './mineru-artifact-reader';

export const KNOWLEDGE_DOCUMENT_PARSER = Symbol('KNOWLEDGE_DOCUMENT_PARSER');

const MINERU_NOT_CONFIGURED = 'MINERU_NOT_CONFIGURED';
const MINERU_DOWNLOAD_FAILED = 'MINERU_DOWNLOAD_FAILED';
const MINERU_HTTP_ERROR = 'MINERU_HTTP_ERROR';
const MINERU_TIMEOUT = 'MINERU_TIMEOUT';
const MINERU_PARSE_FAILED = 'MINERU_PARSE_FAILED';
const MINERU_EMPTY_RESULT = 'MINERU_EMPTY_RESULT';
const MINERU_NOT_CONFIGURED_MESSAGE = 'MinerU 文档解析服务尚未配置或未部署';

/** 解析失败且重试也无法恢复（配置缺失、文件损坏等）时抛出，直接置 FAILED。 */
export class KnowledgeDocumentParserError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly retryable: boolean,
    ) {
        super(message);
        this.name = 'KnowledgeDocumentParserError';
    }
}

export interface KnowledgeDocumentFileInput {
    documentId: string;
    documentVersionId: string;
    fileObjectId: string;
    name: string;
    mimeType: string;
    sizeBytes: bigint;
    objectKey: string;
}

/**
 * 文档解析器抽象：把 COS 中的原始文件解析为内部契约的 ParsedDocument 中间格式。
 * 块 3 只定义接口并提供 MinerU 占位实现；块 6 接入 MinerU 真机后替换实现。
 */
export interface KnowledgeDocumentParser {
    parse(input: KnowledgeDocumentFileInput): Promise<ParsedDocument>;
}

/**
 * MinerU 真机实现：从 COS 下载原始文件，调用 MinerU FastAPI 服务（同步 /file_parse），
 * 把返回的 content_list（或 Markdown 回退）转换为 ParsedDocument。
 * 网络与超时错误可重试；配置缺失、文件问题与 MinerU 报告的解析失败直接置 FAILED。
 */
@Injectable()
export class MinerUDocumentParser implements KnowledgeDocumentParser {
    private readonly logger = new Logger(MinerUDocumentParser.name);
    private readonly apiUrl = process.env.MINERU_API_URL?.replace(/\/+$/, '') ?? '';
    private readonly timeoutMs = readPositiveInteger(
        process.env.MINERU_API_TIMEOUT_MS,
        30 * 60 * 1000,
    );
    private readonly langList = process.env.MINERU_API_LANG_LIST?.trim() || 'ch';

    constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) { }

    async parse(input: KnowledgeDocumentFileInput): Promise<ParsedDocument> {
        if (!this.apiUrl) {
            throw new KnowledgeDocumentParserError(MINERU_NOT_CONFIGURED, MINERU_NOT_CONFIGURED_MESSAGE, false);
        }
        const fileBytes = await this.downloadObject(input);
        const payload = await this.invokeMinerU(input, fileBytes);
        return this.buildParsedDocument(input, payload);
    }

    private async downloadObject(input: KnowledgeDocumentFileInput): Promise<Buffer> {
        let url: string;
        try {
            url = await this.storage.createDownloadUrl(input.objectKey);
        } catch (error) {
            this.logger.warn(`COS 下载 URL 生成失败 objectKey=${input.objectKey}`, error);
            throw new KnowledgeDocumentParserError(MINERU_DOWNLOAD_FAILED, '生成对象下载地址失败', true);
        }
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
            if (!response.ok) {
                throw new Error(`object download HTTP ${response.status}`);
            }
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            this.logger.warn(`COS 对象下载失败 objectKey=${input.objectKey}`, error);
            throw new KnowledgeDocumentParserError(MINERU_DOWNLOAD_FAILED, '下载原始文件失败', true);
        }
    }

    private async invokeMinerU(input: KnowledgeDocumentFileInput, fileBytes: Buffer): Promise<unknown> {
        const form = new FormData();
        form.append('files', new Blob([new Uint8Array(fileBytes)], { type: input.mimeType }), input.name);
        form.append('return_md', 'true');
        form.append('return_content_list', 'true');
        form.append('backend', 'pipeline');
        form.append('lang_list', this.langList);
        let response: Response;
        try {
            response = await fetch(`${this.apiUrl}/file_parse`, {
                method: 'POST',
                body: form,
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error) {
            const timedOut = isTimeoutError(error);
            this.logger.warn(`MinerU 调用失败 documentId=${input.documentId} ${timedOut ? '(timeout)' : ''}`, error);
            throw new KnowledgeDocumentParserError(
                MINERU_TIMEOUT,
                timedOut ? 'MinerU 解析超时' : 'MinerU 服务不可用',
                true,
            );
        }
        if (!response.ok) {
            // 4xx 通常是文件本身问题（不支持/损坏/过大），重试无意义；5xx 视为服务端瞬时故障。
            const retryable = response.status >= 500;
            this.logger.warn(`MinerU HTTP ${response.status} documentId=${input.documentId}`);
            throw new KnowledgeDocumentParserError(
                MINERU_HTTP_ERROR,
                `MinerU 解析请求失败（HTTP ${response.status}）`,
                retryable,
            );
        }
        return await response.json();
    }

    private buildParsedDocument(input: KnowledgeDocumentFileInput, payload: unknown): ParsedDocument {
        // MinerU 3.4.5 服务模式：顶层 status 标记任务状态（completed/failed），
        // 失败时 error 携带原因；部分部署仍返回 PARSE_RC 兼容字段，一并容忍。
        const parseRc = findNumericField(payload, 'parse_rc') ?? findNumericField(payload, 'PARSE_RC');
        const status = findStringField(payload, ['status']);
        if ((parseRc !== null && parseRc !== undefined && parseRc !== 0)
            || (parseRc === null && status && status !== 'completed' && status !== 'success')) {
            const detail = findStringField(payload, ['error']) ?? '';
            throw new KnowledgeDocumentParserError(
                MINERU_PARSE_FAILED,
                `MinerU 解析失败（${detail || `status=${status}`}）`,
                false,
            );
        }
        const parserVersion = findStringField(payload, ['version', 'parser_version']) ?? 'mineru-api';
        const context = {
            documentId: input.documentId,
            documentVersionId: input.documentVersionId,
            parserVersion,
        };
        const contentList = findContentList(payload);
        if (contentList !== null) {
            return fromContentListJson(contentList, context);
        }
        const markdown = findStringField(payload, ['md_content', 'markdown', 'content']);
        if (markdown) {
            return fromMarkdown(markdown, context);
        }
        throw new KnowledgeDocumentParserError(
            MINERU_EMPTY_RESULT,
            'MinerU 未返回可用的解析产物',
            false,
        );
    }
}

function readPositiveInteger(raw: string | undefined, fallback: number): number {
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function isTimeoutError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 宽松读取响应中的数值字段（如 PARSE_RC），容忍 results 包装。 */
function findNumericField(payload: unknown, key: string): number | null {
    for (const candidate of responseCandidates(payload)) {
        if (isRecord(candidate) && typeof candidate[key] === 'number') {
            return candidate[key] as number;
        }
    }
    return null;
}

/** 宽松读取响应中的字符串字段，按候选键顺序。 */
function findStringField(payload: unknown, keys: string[]): string | null {
    for (const candidate of responseCandidates(payload)) {
        if (!isRecord(candidate)) continue;
        for (const key of keys) {
            const value = candidate[key];
            if (typeof value === 'string' && value.trim()) return value;
        }
    }
    return null;
}

/**
 * 展开 MinerU 响应的候选容器：顶层、顶层数组、results（数组或按文件名索引的
 * 对象）、result 对象。3.4.5 服务模式下 results 为 {文件名: {...}} 形态。
 */
function responseCandidates(payload: unknown): unknown[] {
    const candidates: unknown[] = [payload];
    if (Array.isArray(payload)) candidates.push(...payload);
    if (isRecord(payload)) {
        const results = payload['results'];
        if (Array.isArray(results)) {
            candidates.push(...results);
        } else if (isRecord(results)) {
            candidates.push(...Object.values(results));
        }
        if (isRecord(payload['result'])) candidates.push(payload['result']);
    }
    return candidates;
}

/**
 * 宽松定位 content_list：优先从 results 各候选的 content_list 提取，容忍
 * results 数组、按文件名索引的对象与 pdf_info.content_list 包装；
 * content_list 可能是数组，也可能是 JSON 字符串（3.4.5 服务模式）。
 */
function findContentList(payload: unknown): unknown | null {
    for (const candidate of responseCandidates(payload)) {
        if (!isRecord(candidate)) continue;
        for (const key of ['content_list', 'pdf_info']) {
            let value = candidate[key];
            if (isRecord(value) && Array.isArray(value['content_list'])) value = value['content_list'];
            if (typeof value === 'string') {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed)) return parsed;
                } catch {
                    // 非 JSON 字符串，继续尝试下一候选
                }
            }
            if (Array.isArray(value)) return value;
        }
    }
    return null;
}
