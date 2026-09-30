import { CosObjectKeyFactory } from './cos-object-key.factory';
import type { StorageSettings } from './storage.types';

describe('CosObjectKeyFactory', () => {
    it('builds the documented environment, tenant, month and file path', () => {
        const factory = new CosObjectKeyFactory(config('cees/staging'));

        expect(factory.buildSourceKey({
            tenantId: '11111111-1111-4111-8111-111111111111',
            fileId: '22222222-2222-4222-8222-222222222222',
            now: new Date('2026-09-08T01:02:03.000Z'),
        })).toBe(
            'cees/staging/tenants/11111111-1111-4111-8111-111111111111/files/2026/09/'
            + '22222222-2222-4222-8222-222222222222/source',
        );
    });

    it('rejects identifiers that could alter the object path', () => {
        const factory = new CosObjectKeyFactory(config('cees/production'));
        expect(() => factory.buildSourceKey({
            tenantId: '../other-tenant',
            fileId: '22222222-2222-4222-8222-222222222222',
        })).toThrow(TypeError);
    });

    it('builds the documented XLSX generated-document path', () => {
        const factory = new CosObjectKeyFactory(config('cees/local'));

        expect(factory.buildGeneratedDocumentKey({
            tenantId: '11111111-1111-4111-8111-111111111111',
            toolCallId: '22222222-2222-4222-8222-222222222222',
            format: 'xlsx',
        })).toBe(
            'cees/local/tenants/11111111-1111-4111-8111-111111111111/generated-documents/'
            + '22222222-2222-4222-8222-222222222222/xlsx',
        );
    });
});

function config(objectPrefix: StorageSettings['objectPrefix']): StorageSettings {
    return {
        provider: 'TENCENT_COS',
        region: 'ap-chengdu',
        bucket: 'cees-ai-1403013862',
        objectPrefix,
        signedUrlTtlSeconds: 600,
        maxUploadBytes: 104_857_600,
    };
}
