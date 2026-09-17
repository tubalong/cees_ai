import type { ParsedBlock, ParsedDocument } from '@cees/ai-service-client';

// ai-service 本地提取返回纯文本（txt/md/csv/json/docx/pptx/xlsx），
// 无页码与坐标信息。包装为 ParsedDocument 时按空行切段落，每个段落
// 一个 paragraph block，page_index/bbox 为 null，与 MinerU 产物同构
// （citation 的定位信息缺失时前端不展示）。

export interface ExtractionReaderContext {
    documentId: string;
    documentVersionId: string;
    /** 提取引擎标识（utf-8 / python-docx / stdlib-zip-xml），来自 ai-service 元数据。 */
    engine: string;
}

/** 把本地提取文本按段落包装为 ParsedDocument。 */
export function fromExtractionText(text: string, context: ExtractionReaderContext): ParsedDocument {
    const blocks: ParsedBlock[] = [];
    let order = 0;
    for (const rawParagraph of text.split(/\r?\n\s*\r?\n/)) {
        const paragraph = rawParagraph.trim();
        if (!paragraph) continue;
        blocks.push({
            block_id: `block-${String(order).padStart(5, '0')}`,
            type: 'paragraph',
            text: paragraph,
            page_index: null,
            bbox: null,
            heading_path: [],
            source_order: order,
        });
        order += 1;
    }
    return {
        document_id: context.documentId,
        document_version_id: context.documentVersionId,
        parser_name: 'extraction',
        parser_version: context.engine,
        blocks,
    };
}
