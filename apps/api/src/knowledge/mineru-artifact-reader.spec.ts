import { fromContentListJson, fromMarkdown } from './mineru-artifact-reader';

const context = {
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    parserVersion: '3.4.5',
};

describe('mineru-artifact-reader', () => {
    describe('fromContentListJson', () => {
        it('把顶层数组解析为有序块并重排 source_order/block_id', () => {
            const parsed = fromContentListJson(
                [
                    { type: 'text', text: '第一段' },
                    { type: 'text', text: '第二段' },
                ],
                context,
            );
            expect(parsed.document_id).toBe('doc-1');
            expect(parsed.document_version_id).toBe('ver-1');
            expect(parsed.parser_name).toBe('mineru');
            expect(parsed.parser_version).toBe('3.4.5');
            expect(parsed.blocks).toHaveLength(2);
            expect(parsed.blocks[0]).toMatchObject({
                block_id: 'block-00000',
                type: 'paragraph',
                text: '第一段',
                source_order: 0,
            });
            expect(parsed.blocks[1].block_id).toBe('block-00001');
        });

        it('兼容 content_list 键包装的 dict 形态并映射类型', () => {
            const parsed = fromContentListJson(
                { content_list: [{ type: 'interline_equation', text: 'E=mc^2' }] },
                context,
            );
            expect(parsed.blocks[0].type).toBe('formula');
        });

        it('标题更新 heading_stack 并影响后续块的 heading_path', () => {
            const parsed = fromContentListJson(
                [
                    { type: 'title', text: '第一章', text_level: 1 },
                    { type: 'text', text: '正文内容' },
                ],
                context,
            );
            expect(parsed.blocks[0].type).toBe('title');
            expect(parsed.blocks[1].heading_path).toEqual(['第一章']);
        });

        it('图片块携带 asset_ref 并派生图注 caption 块', () => {
            const parsed = fromContentListJson(
                [{ type: 'image', img_path: 'images/a.png', img_caption: ['图 1 说明'] }],
                context,
            );
            expect(parsed.blocks).toHaveLength(2);
            expect(parsed.blocks[0]).toMatchObject({
                type: 'image',
                text: null,
                asset_ref: 'images/a.png',
            });
            expect(parsed.blocks[1]).toMatchObject({ type: 'caption', text: '图 1 说明' });
        });

        it('poly 八边形坐标收敛为 bbox 四点', () => {
            const parsed = fromContentListJson(
                [{ type: 'text', text: 'x', poly: [0, 10, 100, 10, 100, 60, 0, 60] }],
                context,
            );
            expect(parsed.blocks[0].bbox).toEqual([0, 10, 100, 60]);
        });

        it('table_body HTML 剥离为纯文本', () => {
            const parsed = fromContentListJson(
                [{ type: 'table', table_body: '<table><tr><td>a</td></tr></table>' }],
                context,
            );
            expect(parsed.blocks[0]).toMatchObject({ type: 'table', text: 'a' });
        });

        it('空文本与空标题块被跳过', () => {
            const parsed = fromContentListJson(
                [
                    { type: 'title', text: '' },
                    { type: 'text', text: '   ' },
                    { type: 'text', text: '有效内容' },
                ],
                context,
            );
            expect(parsed.blocks).toHaveLength(1);
            expect(parsed.blocks[0].text).toBe('有效内容');
            expect(parsed.blocks[0].source_order).toBe(0);
        });

        it('未知类型回退为 paragraph', () => {
            const parsed = fromContentListJson([{ type: 'footer', text: '页脚' }], context);
            expect(parsed.blocks[0].type).toBe('paragraph');
        });

        it('非法 payload 抛错', () => {
            expect(() => fromContentListJson({ foo: 1 }, context)).toThrow();
        });
    });

    describe('fromMarkdown', () => {
        it('识别标题、段落与标题路径', () => {
            const parsed = fromMarkdown('# 标题\n\n正文段落', context);
            expect(parsed.parser_name).toBe('markdown');
            expect(parsed.blocks).toHaveLength(2);
            expect(parsed.blocks[0]).toMatchObject({ type: 'title', text: '标题' });
            expect(parsed.blocks[1]).toMatchObject({
                type: 'paragraph',
                text: '正文段落',
                heading_path: ['标题'],
            });
        });

        it('围栏代码块整体成块', () => {
            const parsed = fromMarkdown('```ts\nconst a = 1;\n```', context);
            expect(parsed.blocks).toHaveLength(1);
            expect(parsed.blocks[0].type).toBe('code_block');
            expect(parsed.blocks[0].text).toBe('const a = 1;');
        });

        it('表格行聚合为 table 块', () => {
            const parsed = fromMarkdown('| a | b |\n| 1 | 2 |', context);
            expect(parsed.blocks).toHaveLength(1);
            expect(parsed.blocks[0].type).toBe('table');
        });
    });
});
