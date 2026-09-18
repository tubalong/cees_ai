import { DocumentController } from './document.controller';
import type { DocumentService } from './document.service';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

/** 用户真实场景：生成的文档标题就是「按主题命名」的下载名。 */
const THEME_TITLE = '铭记九一八 · 勿忘国耻 吾辈自强';

describe('DocumentController export filenames', () => {
    it('carries the document title in Content-Disposition for DOCX export', async () => {
        const harness = createHarness({ filename: THEME_TITLE, bytes: Buffer.from('docx') });

        const file = await harness.controller.exportDocumentDocx(DOCUMENT_ID);

        const disposition = file.getHeaders().disposition;
        expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent(`${THEME_TITLE}.docx`)}`);
        expect(disposition).toContain('filename="document.docx"');
        expect(decodeRfc5987(disposition)).toBe(`${THEME_TITLE}.docx`);
    });

    it('carries the document title in Content-Disposition for PDF export', async () => {
        const harness = createHarness({ filename: THEME_TITLE, bytes: Buffer.from('%PDF') });

        const file = await harness.controller.exportDocumentPdf(DOCUMENT_ID);

        const disposition = file.getHeaders().disposition;
        expect(disposition).toContain('filename="document.pdf"');
        expect(decodeRfc5987(disposition)).toBe(`${THEME_TITLE}.pdf`);
    });

    it('carries the document title in Content-Disposition for PPTX export', async () => {
        const harness = createHarness({ filename: THEME_TITLE, bytes: Buffer.from('PK') });

        const file = await harness.controller.exportDocumentPptx(DOCUMENT_ID);

        const disposition = file.getHeaders().disposition;
        expect(disposition).toContain('filename="document.pptx"');
        expect(decodeRfc5987(disposition)).toBe(`${THEME_TITLE}.pptx`);
    });

    it('percent-encodes RFC 5987 reserved characters that encodeURIComponent leaves alone', async () => {
        // `!`, `*`, `'`, `(`, `)` 不属于 RFC 5987 的 attr-char，必须被编码，
        // 否则响应头在严格解析器下是非法值。
        const harness = createHarness({ filename: "Q3!plan*'v2'(final)", bytes: Buffer.from('docx') });

        const file = await harness.controller.exportDocumentDocx(DOCUMENT_ID);
        const encoded = extractExtendedFilename(file.getHeaders().disposition);

        expect(encoded).not.toMatch(/[!'()*]/);
        expect(decodeURIComponent(encoded)).toBe("Q3!plan*'v2'(final).docx");
    });

    it('falls back to the neutral document.* name when the service has no usable title', async () => {
        const harness = createHarness({ filename: 'document', bytes: Buffer.from('docx') });

        const file = await harness.controller.exportDocumentDocx(DOCUMENT_ID);
        const disposition = file.getHeaders().disposition;

        expect(disposition).toContain('filename="document.docx"');
        expect(decodeRfc5987(disposition)).toBe('document.docx');
    });

    it('streams the rendered bytes with the expected media type', async () => {
        const bytes = Buffer.from('%PDF-1.7');
        const harness = createHarness({ filename: THEME_TITLE, bytes });

        const file = await harness.controller.exportDocumentPdf(DOCUMENT_ID);

        expect(file.getHeaders().type).toBe('application/pdf');
        expect(file.getHeaders().length).toBe(bytes.length);
    });

    it('redirects to the signed URL when the document has a persisted generated file', async () => {
        const harness = createHarness({ filename: THEME_TITLE, bytes: Buffer.from('docx') });
        harness.service.getDocumentFileDownload.mockResolvedValue({ filename: `${THEME_TITLE}.pdf`, url: 'https://cos.example/signed' });

        await expect(harness.controller.downloadDocumentFile(DOCUMENT_ID)).resolves.toEqual({ url: 'https://cos.example/signed' });
    });
});

function createHarness(exportResult: { filename: string; bytes: Buffer }) {
    const service = {
        exportDocumentDocx: jest.fn().mockResolvedValue(exportResult),
        exportDocumentPdf: jest.fn().mockResolvedValue(exportResult),
        exportDocumentPptx: jest.fn().mockResolvedValue(exportResult),
        getDocumentFileDownload: jest.fn().mockResolvedValue({ filename: `${exportResult.filename}.pdf`, url: 'https://cos.example/signed' }),
    };
    return {
        service,
        controller: new DocumentController(service as unknown as DocumentService),
    };
}

/** 取出 `filename*=UTF-8''<pct-encoded>` 中的编码片段。 */
function extractExtendedFilename(disposition: string): string {
    const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (!match) throw new Error(`Content-Disposition 缺少 RFC 5987 文件名: ${disposition}`);
    return match[1];
}

function decodeRfc5987(disposition: string): string {
    return decodeURIComponent(extractExtendedFilename(disposition));
}
