import type COS = require('cos-nodejs-sdk-v5');
import { CosObjectKeyFactory } from './cos-object-key.factory';
import { TencentCosStorageProvider } from './tencent-cos-storage.provider';
import { StorageObjectNotFoundError, StorageProviderError, type StorageSettings } from './storage.types';

const sourceKey = 'cees/staging/tenants/11111111-1111-4111-8111-111111111111/files/2026/09/'
    + '22222222-2222-4222-8222-222222222222/source';

describe('TencentCosStorageProvider', () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-08T00:00:00.000Z')));
    afterEach(() => jest.useRealTimers());

    it('signs one exact PUT key and returns required upload headers', async () => {
        const cos = createCos({ getObjectUrl: jest.fn().mockReturnValue('https://signed.example/upload') });
        const provider = new TencentCosStorageProvider(config(), cos);

        await expect(provider.createUploadUrl({
            objectKey: sourceKey,
            contentType: 'Application/PDF',
        })).resolves.toEqual({
            method: 'PUT',
            url: 'https://signed.example/upload',
            headers: { 'Content-Type': 'application/pdf' },
            expiresAt: new Date('2026-09-08T00:10:00.000Z'),
        });
        expect(cos.getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({
            Bucket: 'cees-ai-1403013862',
            Region: 'ap-chengdu',
            Method: 'PUT',
            Sign: true,
            Expires: 600,
            Headers: { 'Content-Type': 'application/pdf' },
        }));
    });

    it('returns trusted HEAD metadata and maps COS 404 errors', async () => {
        const cos = createCos({
            headObject: jest.fn()
                .mockResolvedValueOnce({ ETag: '"etag"', headers: { 'content-length': '42', 'content-type': 'application/pdf' } })
                .mockRejectedValueOnce({ statusCode: 404, code: 'NoSuchKey' }),
        });
        const provider = new TencentCosStorageProvider(config(), cos);

        await expect(provider.headObject(sourceKey)).resolves.toEqual({
            sizeBytes: 42,
            contentType: 'application/pdf',
            etag: '"etag"',
        });
        await expect(provider.headObject(sourceKey)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    });

    it('reads object bytes and content type for internal rendering', async () => {
        const cos = createCos({
            getObject: jest.fn().mockImplementation((_input, callback) => callback(null, {
                Body: Buffer.from('image-bytes'),
                headers: { 'content-type': 'image/png' },
            })),
        });
        const provider = new TencentCosStorageProvider(config(), cos);

        await expect(provider.readObject(sourceKey)).resolves.toEqual({
            body: Buffer.from('image-bytes'),
            contentType: 'image/png',
        });
        expect(cos.getObject).toHaveBeenCalledWith(expect.objectContaining({
            Bucket: 'cees-ai-1403013862',
            Region: 'ap-chengdu',
            Key: sourceKey,
        }), expect.any(Function));
    });

    it('rejects invalid metadata returned by COS', async () => {
        const cos = createCos({
            headObject: jest.fn().mockResolvedValue({ ETag: '"etag"', headers: { 'content-length': 'invalid' } }),
        });
        const provider = new TencentCosStorageProvider(config(), cos);
        await expect(provider.headObject(sourceKey)).rejects.toBeInstanceOf(StorageProviderError);
    });

    it('rejects signing upload keys that do not match the documented source-file path', async () => {
        const cos = createCos({ getObjectUrl: jest.fn().mockReturnValue('https://signed.example/upload') });
        const provider = new TencentCosStorageProvider(config(), cos);

        await expect(provider.createUploadUrl({
            objectKey: 'cees/staging/tenants/not-a-uuid/files/2026/09/file/source',
            contentType: 'application/pdf',
        })).rejects.toBeInstanceOf(TypeError);
        expect(cos.getObjectUrl).not.toHaveBeenCalled();
    });

    it.each(['docx', 'pdf', 'pptx', 'xlsx'])('allows generated %s document object keys for server upload', async (format) => {
        const cos = createCos({
            putObject: jest.fn().mockResolvedValue({ ETag: '"etag"' }),
        });
        const provider = new TencentCosStorageProvider(config(), cos);
        const objectKey = `cees/staging/tenants/11111111-1111-4111-8111-111111111111/generated-documents/`
            + `22222222-2222-4222-8222-222222222222/${format}`;

        await expect(provider.putObject({
            objectKey,
            body: Buffer.from('generated-document'),
            contentType: 'application/octet-stream',
        })).resolves.toEqual({
            sizeBytes: Buffer.byteLength('generated-document'),
            contentType: 'application/octet-stream',
            etag: '"etag"',
        });
    });

    it('accepts the XLSX key built for a generated spreadsheet', async () => {
        const cos = createCos({ putObject: jest.fn().mockResolvedValue({ ETag: '"etag"' }) });
        const objectKey = new CosObjectKeyFactory(config()).buildGeneratedDocumentKey({
            tenantId: '11111111-1111-4111-8111-111111111111',
            toolCallId: '22222222-2222-4222-8222-222222222222',
            format: 'xlsx',
        });
        const provider = new TencentCosStorageProvider(config(), cos);

        await expect(provider.putObject({
            objectKey,
            body: Buffer.from('xlsx-bytes'),
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })).resolves.toMatchObject({ sizeBytes: 10 });
        expect(cos.putObject).toHaveBeenCalledWith(expect.objectContaining({ Key: objectKey }));
    });

    it('rejects reads and deletes outside the configured environment prefix', async () => {
        const cos = createCos({
            headObject: jest.fn(),
            deleteObject: jest.fn(),
        });
        const provider = new TencentCosStorageProvider(config(), cos);

        await expect(provider.headObject(sourceKey.replace('cees/staging', 'cees/production')))
            .rejects.toBeInstanceOf(TypeError);
        await expect(provider.deleteObject('cees/staging/../production/secret'))
            .rejects.toBeInstanceOf(TypeError);
        expect(cos.headObject).not.toHaveBeenCalled();
        expect(cos.deleteObject).not.toHaveBeenCalled();
    });
});

function createCos(overrides: Record<string, jest.Mock>): COS {
    return {
        getObjectUrl: jest.fn(),
        getObject: jest.fn(),
        headObject: jest.fn(),
        deleteObject: jest.fn(),
        ...overrides,
    } as unknown as COS;
}

function config(): StorageSettings {
    return {
        provider: 'TENCENT_COS',
        region: 'ap-chengdu',
        bucket: 'cees-ai-1403013862',
        objectPrefix: 'cees/staging',
        signedUrlTtlSeconds: 600,
        maxUploadBytes: 104_857_600,
    };
}
