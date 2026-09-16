import type { ParsedBlock, ParsedDocument } from '@cees/ai-service-client';

// MinerU content_list.json 常见字段名；reader 只做宽松归一化，不追求
// 覆盖所有 MinerU 版本，未知类型统一回退为 paragraph。
// 语义与 ai-service 侧 mineru_artifact_reader.py 保持一致（两侧各自测试）。

const TYPE_MAPPING: Record<string, ParsedBlock['type']> = {
    text: 'paragraph',
    title: 'title',
    table: 'table',
    image: 'image',
    interline_equation: 'formula',
    inline_equation: 'formula',
    code: 'code_block',
    text_code: 'code_block',
    list: 'list_item',
    caption: 'caption',
};

const HTML_TAG_PATTERN = /<[^>]+>/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const CODE_FENCE_PATTERN = /^```/;
const TABLE_ROW_PATTERN = /^\s*\|.*\|\s*$/;

export interface MinerUReaderContext {
    documentId: string;
    documentVersionId: string;
    parserVersion: string;
}

type ContentListItem = Record<string, unknown>;

/** 把 MinerU content_list.json 宽松解析为 ParsedDocument。 */
export function fromContentListJson(
    payload: unknown,
    context: MinerUReaderContext,
): ParsedDocument {
    const items = extractItems(payload);
    const blocks: ParsedBlock[] = [];
    const headingStack: string[] = [];
    items.forEach((item, order) => {
        blocks.push(...itemToBlocks(item, order, headingStack));
    });
    // 同一 MinerU 项可能派生出多个块（如图片与图注），统一重排保证
    // block_id 唯一、source_order 严格递增，避免 chunk 身份冲突。
    blocks.forEach((block, index) => {
        block.source_order = index;
        block.block_id = `block-${String(index).padStart(5, '0')}`;
    });
    return {
        document_id: context.documentId,
        document_version_id: context.documentVersionId,
        parser_name: 'mineru',
        parser_version: context.parserVersion,
        blocks,
    };
}

/** 把 Markdown 作为 fallback 解析为 ParsedDocument（无 MinerU 产物时）。 */
export function fromMarkdown(markdown: string, context: MinerUReaderContext): ParsedDocument {
    const blocks: ParsedBlock[] = [];
    const headingStack: string[] = [];
    let order = 0;
    let codeLines: string[] = [];
    let tableLines: string[] = [];
    let paragraphLines: string[] = [];

    const flushPending = (): void => {
        if (tableLines.length > 0) {
            blocks.push(makeBlock(order, 'table', tableLines.join('\n'), headingStack));
            tableLines = [];
            order += 1;
        }
        if (codeLines.length > 0) {
            blocks.push(makeBlock(order, 'code_block', codeLines.join('\n'), headingStack));
            codeLines = [];
            order += 1;
        }
        if (paragraphLines.length > 0) {
            blocks.push(makeBlock(order, 'paragraph', paragraphLines.join('\n'), headingStack));
            paragraphLines = [];
            order += 1;
        }
    };

    let inFence = false;
    for (const rawLine of markdown.split(/\r?\n/)) {
        const line = rawLine.replace(/\s+$/, '');
        if (CODE_FENCE_PATTERN.test(line)) {
            // 围栏线切换代码块状态；fence 内的行（含空行）全部归入代码块。
            if (paragraphLines.length > 0) flushPending();
            inFence = !inFence;
            continue;
        }
        if (inFence) {
            codeLines.push(line);
            continue;
        }
        if (line.startsWith('    ')) {
            // 缩进四空格同样是代码块；先结束前面的段落保持阅读顺序。
            if (paragraphLines.length > 0) flushPending();
            codeLines.push(line);
            continue;
        }
        if (!line.trim()) {
            flushPending();
            continue;
        }
        if (TABLE_ROW_PATTERN.test(line)) {
            if (paragraphLines.length > 0) flushPending();
            tableLines.push(line.trim());
            continue;
        }
        const headingMatch = HEADING_PATTERN.exec(line);
        if (headingMatch) {
            flushPending();
            updateHeadingStack(headingStack, headingMatch[1].length, headingMatch[2].trim());
            blocks.push(makeBlock(order, 'title', headingMatch[2].trim(), headingStack));
            order += 1;
            continue;
        }
        paragraphLines.push(line.trim());
    }
    flushPending();

    return {
        document_id: context.documentId,
        document_version_id: context.documentVersionId,
        parser_name: 'markdown',
        parser_version: context.parserVersion,
        blocks,
    };
}

function extractItems(payload: unknown): ContentListItem[] {
    if (Array.isArray(payload)) {
        return payload.filter((entry): entry is ContentListItem => isRecord(entry));
    }
    if (!isRecord(payload)) {
        throw new Error('content_list payload must be a list or an object');
    }
    for (const key of ['pdf_info', 'content_list', 'blocks']) {
        const value = payload[key];
        if (Array.isArray(value)) {
            return value.filter((entry): entry is ContentListItem => isRecord(entry));
        }
    }
    throw new Error('content_list payload has no item list');
}

function itemToBlocks(
    item: ContentListItem,
    order: number,
    headingStack: string[],
): ParsedBlock[] {
    const rawType = String(item['type'] ?? 'text');
    const blockType = TYPE_MAPPING[rawType] ?? 'paragraph';
    const pageIndex = pageIndexOf(item);
    const bbox = bboxOf(item);

    if (blockType === 'title') {
        const title = plainText(item);
        // 空标题块直接跳过，不污染标题栈；契约要求 text 非空或为 null。
        if (!title) return [];
        updateHeadingStack(headingStack, titleLevel(item), title);
        return [makeBlock(order, 'title', title, headingStack, pageIndex, bbox)];
    }

    const blocks: ParsedBlock[] = [];
    if (blockType === 'image') {
        const assetRef = item['img_path'];
        if (typeof assetRef === 'string' && assetRef.trim()) {
            blocks.push({
                ...makeBlock(order, 'image', null, headingStack, pageIndex, bbox),
                asset_ref: assetRef.trim(),
            });
        }
        for (const caption of captionTexts(item)) {
            blocks.push(makeBlock(order, 'caption', caption, headingStack, pageIndex, bbox));
        }
        return blocks;
    }

    const text = plainText(item);
    if (!text) return [];
    return [makeBlock(order, blockType, text, headingStack, pageIndex, bbox)];
}

function makeBlock(
    order: number,
    type: ParsedBlock['type'],
    text: string | null,
    headingStack: string[],
    pageIndex?: number | null,
    bbox?: [number, number, number, number] | null,
): ParsedBlock {
    return {
        block_id: `block-${String(order).padStart(5, '0')}`,
        type,
        text,
        page_index: pageIndex,
        bbox,
        heading_path: [...headingStack],
        source_order: order,
    };
}

function updateHeadingStack(headingStack: string[], level: number, title: string): void {
    while (headingStack.length > 0 && headingStack.length >= level) {
        headingStack.pop();
    }
    headingStack.push(title);
}

function titleLevel(item: ContentListItem): number {
    for (const key of ['text_level', 'level']) {
        const value = item[key];
        if (typeof value === 'number') return Math.max(1, value);
    }
    return 1;
}

function pageIndexOf(item: ContentListItem): number | null {
    for (const key of ['page_idx', 'page_index', 'page']) {
        const value = item[key];
        if (typeof value === 'number') return Math.max(0, value);
    }
    return null;
}

function bboxOf(item: ContentListItem): [number, number, number, number] | null {
    const bbox = item['bbox'];
    if (isNumberTuple(bbox, 4)) {
        return [bbox[0], bbox[1], bbox[2], bbox[3]];
    }
    const poly = item['poly'];
    if (isNumberTuple(poly, 8)) {
        const xs = [poly[0], poly[2], poly[4], poly[6]];
        const ys = [poly[1], poly[3], poly[5], poly[7]];
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    return null;
}

function isNumberTuple(value: unknown, length: number): value is number[] {
    return Array.isArray(value) && value.length === length
        && value.every((entry) => typeof entry === 'number');
}

function captionTexts(item: ContentListItem): string[] {
    const captions: string[] = [];
    for (const key of ['img_caption', 'table_caption', 'caption']) {
        const value = item[key];
        if (typeof value === 'string' && value.trim()) {
            captions.push(value.trim());
        } else if (Array.isArray(value)) {
            for (const entry of value) {
                if (typeof entry === 'string' && entry.trim()) captions.push(entry.trim());
            }
        }
    }
    return captions;
}

function plainText(item: ContentListItem): string {
    const text = item['text'];
    if (typeof text === 'string' && text.trim()) {
        return text.trim();
    }
    const tableBody = item['table_body'];
    if (typeof tableBody === 'string') {
        // 相邻标签各产出一个空格，按任意空白分割后重新拼接，避免双空格；
        // 与 Python 版 str.split() 一致，分割时丢弃首尾空串。
        const stripped = tableBody
            .replace(HTML_TAG_PATTERN, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .join(' ');
        if (stripped) return stripped;
    }
    return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
