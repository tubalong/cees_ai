import { FilePurpose } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { STORAGE_PROVIDER, STORAGE_SETTINGS } from '../../storage/storage.tokens';
import { AssistantMessageContentService } from './message-content.service';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '20000000-0000-4000-8000-000000000002';
const FILE_ID = '30000000-0000-4000-8000-000000000003';

interface Harness {
    service: AssistantMessageContentService;
    findMany: jest.Mock;
    conversationMessageFindMany: jest.Mock;
    managedImageFindMany: jest.Mock;
    extractFile: jest.Mock;
}

function createHarness(): Harness {
    const findMany = jest.fn();
    const conversationMessageFindMany = jest.fn();
    const managedImageFindMany = jest.fn();
    const prisma = {
        fileObject: { findMany },
        conversationMessage: { findMany: conversationMessageFindMany },
        managedImage: { findMany: managedImageFindMany },
    } as unknown as PrismaService;
    const storage = { createDownloadUrl: jest.fn(async () => 'https://example.test/file') };
    const extractFile = jest.fn(async () => ({ parts: [{ type: 'text', text: '手册正文' }] }));
    const service = new AssistantMessageContentService(
        prisma,
        storage as never,
        { maxUploadBytes: 1024 } as never,
        { extractFile } as never,
    );
    // 该模块通过 STORAGE_* 令牌注入，构造器参数顺序与令牌无关，这里只做类型占位说明。
    void STORAGE_PROVIDER;
    void STORAGE_SETTINGS;
    return { service, findMany, conversationMessageFindMany, managedImageFindMany, extractFile };
}

const identity = { tenantId: TENANT_ID, userId: USER_ID, membershipId: 'm-1', requestId: 'r-1' };

describe('AssistantMessageContentService.describeDocumentReferences', () => {
    it('gives the model the file id and name so it can reference instead of inlining content', async () => {
        // 附件正文是以提取文本进上下文的。缺 file_id 时模型无法构造
        // save_to_knowledge 的 FILE_OBJECT 引用路径，只能内联长文档并被输出上限截断。
        const harness = createHarness();
        harness.findMany.mockResolvedValue([{ id: FILE_ID, originalName: '员工手册.pdf' }]);

        const part = await harness.service.describeDocumentReferences([FILE_ID], identity);

        expect(part).toEqual(expect.objectContaining({ type: 'text' }));
        const text = (part as { text: string }).text;
        expect(text).toContain(`file_id=${FILE_ID}`);
        expect(text).toContain('文件名=员工手册.pdf');
        expect(text).toContain('sourceType=FILE_OBJECT');
        // 内部 ID 只能用于工具调用，不能在回答里转述给用户。
        expect(text).toContain('不要把这些 file_id 展示给用户');
    });

    it('only considers attachments owned by the requesting user', async () => {
        const harness = createHarness();
        harness.findMany.mockResolvedValue([]);

        await expect(harness.service.describeDocumentReferences([FILE_ID], identity)).resolves.toBeUndefined();
        expect(harness.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: TENANT_ID,
                createdBy: USER_ID,
                purpose: FilePurpose.ATTACHMENT,
            }),
        }));
    });

    it('returns nothing when the message has no attachments', async () => {
        const harness = createHarness();

        await expect(harness.service.describeDocumentReferences([], identity)).resolves.toBeUndefined();
        expect(harness.findMany).not.toHaveBeenCalled();
    });
});

describe('AssistantMessageContentService.toModelParts', () => {
    it('appends extracted text and the reference list for attachments', async () => {
        const harness = createHarness();
        harness.findMany.mockResolvedValue([{
            id: FILE_ID,
            originalName: '员工手册.pdf',
            mimeType: 'application/pdf',
            objectKey: 'key/employee-handbook.pdf',
            createdBy: USER_ID,
        }]);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn(async () => ({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(8),
        })) as unknown as typeof fetch;

        try {
            const parts = await harness.service.toModelParts('保存这份文件', [], [FILE_ID], identity);

            expect(harness.extractFile).toHaveBeenCalledWith(expect.objectContaining({
                filename: '员工手册.pdf',
                tenant_id: TENANT_ID,
            }));
            const texts = parts.filter((part) => part.type === 'text').map((part) => (part as { text: string }).text);
            expect(texts[0]).toBe('保存这份文件');
            expect(texts).toContain('手册正文');
            expect(texts.some((text) => text.includes(`file_id=${FILE_ID}`))).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe('AssistantMessageContentService.resolveConversationImageReferences', () => {
    it('combines historical uploads and generated images for the same conversation', async () => {
        const harness = createHarness();
        const uploadCreatedAt = new Date('2026-09-29T01:00:00Z');
        const generatedCreatedAt = new Date('2026-09-29T02:00:00Z');
        harness.conversationMessageFindMany.mockResolvedValue([{
            imageFileIds: [FILE_ID],
            createdAt: uploadCreatedAt,
        }]);
        harness.findMany.mockResolvedValue([{
            id: FILE_ID,
            mimeType: 'image/png',
            sizeBytes: 8,
            objectKey: 'uploads/team.png',
            originalName: '团队协作.png',
            createdBy: USER_ID,
            managedImages: [],
        }]);
        harness.managedImageFindMany.mockResolvedValue([{
            fileObjectId: '40000000-0000-4000-8000-000000000004',
            objectKey: 'generated/team.png',
            contentType: 'image/png',
            prompt: '清晨的团队协作插画',
            createdAt: generatedCreatedAt,
        }]);

        const references = await harness.service.resolveConversationImageReferences('conversation-1', identity);

        expect(references.map((reference) => reference.fileId)).toEqual([
            FILE_ID,
            '40000000-0000-4000-8000-000000000004',
        ]);
        expect(references[0]).toEqual(expect.objectContaining({ source: 'UPLOAD', label: '团队协作.png' }));
        expect(references[1]).toEqual(expect.objectContaining({ source: 'GENERATED', label: '清晨的团队协作插画' }));
        expect(harness.managedImageFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                tenantId: TENANT_ID,
                resource: { is: { ownerMembershipId: identity.membershipId, deletedAt: null } },
                toolCall: { is: { tenantId: TENANT_ID, conversationId: 'conversation-1' } },
            }),
        }));
    });

    it('returns a model-safe image directory without exposing signed URLs', async () => {
        const harness = createHarness();
        harness.conversationMessageFindMany.mockResolvedValue([{
            imageFileIds: [FILE_ID],
            createdAt: new Date('2026-09-29T01:00:00Z'),
        }]);
        harness.findMany.mockResolvedValue([{
            id: FILE_ID,
            mimeType: 'image/png',
            sizeBytes: 8,
            objectKey: 'uploads/team.png',
            originalName: '团队协作.png',
            createdBy: USER_ID,
            managedImages: [],
        }]);
        harness.managedImageFindMany.mockResolvedValue([]);

        const description = await harness.service.describeConversationImageReferences('conversation-1', identity);

        expect(description).toContain(`image_file_id=${FILE_ID}`);
        expect(description).toContain('image_index=1');
        expect(description).toContain('绝不能展示给用户');
        expect(description).not.toContain('https://');
        expect(description).not.toContain('uploads/team.png');
    });
});
