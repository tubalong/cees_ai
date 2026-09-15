import { Injectable } from '@nestjs/common';
import type { ParsedDocument } from '@cees/ai-service-client';

export const KNOWLEDGE_DOCUMENT_PARSER = Symbol('KNOWLEDGE_DOCUMENT_PARSER');

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
 * MinerU 占位实现：MinerU 服务尚未部署，调用即失败。
 * 错误不可重试，worker 会直接把文档置为 FAILED 并记录原因；块 6 真机联调时替换。
 */
@Injectable()
export class MinerUDocumentParser implements KnowledgeDocumentParser {
    async parse(_input: KnowledgeDocumentFileInput): Promise<ParsedDocument> {
        throw new KnowledgeDocumentParserError(
            'MINERU_NOT_CONFIGURED',
            'MinerU 文档解析服务尚未配置或未部署',
            false,
        );
    }
}
