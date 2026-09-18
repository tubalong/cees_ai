import { fromExtractionText } from './text-artifact-reader';

const context = {
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    engine: 'python-docx',
};

describe('fromExtractionText', () => {
    it('按空行把提取文本切成段落 block', () => {
        const parsed = fromExtractionText('第一段\n\n第二段\n\n第三段', context);
        expect(parsed.blocks).toHaveLength(3);
        expect(parsed.blocks.map((block) => block.text)).toEqual(['第一段', '第二段', '第三段']);
    });

    it('跳过空白段落并保持 block_id 与 source_order 严格递增', () => {
        const parsed = fromExtractionText('甲\n\n\n\n乙\n\n   \n\n丙', context);
        expect(parsed.blocks).toHaveLength(3);
        expect(parsed.blocks.map((block) => block.block_id)).toEqual([
            'block-00000',
            'block-00001',
            'block-00002',
        ]);
        expect(parsed.blocks.map((block) => block.source_order)).toEqual([0, 1, 2]);
    });

    it('段落块 page_index/bbox 为 null，与 MinerU 产物同构', () => {
        const parsed = fromExtractionText('内容', context);
        expect(parsed.blocks).toHaveLength(1);
        expect(parsed.blocks[0]).toMatchObject({
            type: 'paragraph',
            page_index: null,
            bbox: null,
            heading_path: [],
        });
    });

    it('携带 extraction 解析器身份与引擎版本', () => {
        const parsed = fromExtractionText('内容', context);
        expect(parsed).toMatchObject({
            document_id: 'doc-1',
            document_version_id: 'ver-1',
            parser_name: 'extraction',
            parser_version: 'python-docx',
        });
    });

    it('容忍 CRLF 换行', () => {
        const parsed = fromExtractionText('甲\r\n\r\n乙', context);
        expect(parsed.blocks.map((block) => block.text)).toEqual(['甲', '乙']);
    });

    it('空文本产生空 blocks（由调用方判定空结果语义）', () => {
        const parsed = fromExtractionText('', context);
        expect(parsed.blocks).toHaveLength(0);
    });
});
