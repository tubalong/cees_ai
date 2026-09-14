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

    /**
     * AI 生成图片使用与工具调用绑定的确定性对象键。相同 toolCallId 的恢复或重试
     * 始终覆盖同一精确对象，不会因月份或随机 fileId 变化产生无限孤儿对象。
     */
    buildGeneratedImageKey(input: { tenantId: string; toolCallId: string }): string {
        assertUuid(input.tenantId, 'tenantId');
        assertUuid(input.toolCallId, 'toolCallId');
        return `${this.config.objectPrefix}/tenants/${input.tenantId}/generated-images/${input.toolCallId}/source`;
    }
}

function assertUuid(value: string, name: string): void {
    if (!UUID_PATTERN.test(value)) throw new TypeError(`${name} must be a UUID`);
}
