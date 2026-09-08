import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_SETTINGS } from './storage.tokens';
import type { StorageSettings } from './storage.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class CosObjectKeyFactory {
    constructor(@Inject(STORAGE_SETTINGS) private readonly config: StorageSettings) { }

    /**
     * 生成 CEES 文档约定的原文件对象键：
     * cees/{environment}/tenants/{tenantId}/files/{yyyy}/{mm}/{fileId}/source。
     * 原始文件名不会参与路径生成，避免用户输入改变对象目录。
     */
    buildSourceKey(input: { tenantId: string; fileId: string; now?: Date }): string {
        assertUuid(input.tenantId, 'tenantId');
        assertUuid(input.fileId, 'fileId');
        const now = input.now ?? new Date();
        if (Number.isNaN(now.getTime())) throw new TypeError('now must be a valid date');
        const year = String(now.getUTCFullYear()).padStart(4, '0');
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        return `${this.config.objectPrefix}/tenants/${input.tenantId}/files/${year}/${month}/${input.fileId}/source`;
    }
}

function assertUuid(value: string, name: string): void {
    if (!UUID_PATTERN.test(value)) throw new TypeError(`${name} must be a UUID`);
}
