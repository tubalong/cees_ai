import { randomUUID } from 'node:crypto';
import { lstat, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 生成产物「另存为」：把 AI 已生成、已落云端的文件写到用户在本机选择的位置。
 *
 * 安全边界（与 `docs/architecture/local-tools-and-excel-io-plan.md` §8 一致）：
 *   1. **路径只能来自系统保存对话框**。渲染层与模型都不能传目标路径；本模块不接受任何
 *      路径入参，`suggestedName` 仅作为对话框默认文件名，且经过清洗后不允许包含目录分隔符。
 *   2. **扩展名白名单**。只允许可交付的文档/图片/文本类型，绝不写出 `.exe/.bat/.ps1/.lnk`
 *      等可执行或脚本类型——否则一个标题为 `报表.exe` 的文档就变成了本地可执行文件。
 *   3. **大小上限**。超过上限直接拒绝，不做静默截断（截断会让用户以为文件完整）。
 *   4. **不写穿符号链接**。目标已存在且是符号链接/Junction 时拒绝：写穿链接等于把内容写到
 *      用户没选过的位置。目标若是目录也拒绝。
 *   5. **原子写**。先写同目录临时文件再 `rename` 覆盖，避免中途失败留下半截文件。
 *
 * 覆盖语义：目标已存在时由系统保存对话框承担覆盖确认（这是原生、显式、用户可见的同意），
 * 本模块不重复弹窗；但此时仍会拒绝符号链接与目录两类危险目标。
 */

/** 允许另存的文件类型。刻意不含可执行、脚本、快捷方式与压缩包。 */
const ALLOWED_EXTENSIONS = new Set([
    'docx', 'pdf', 'pptx', 'xlsx', 'csv',
    'md', 'txt', 'json',
    'png', 'jpg', 'jpeg', 'webp', 'gif',
]);

const MAX_SAVE_BYTES = 64 * 1024 * 1024;
const MAX_NAME_LENGTH = 120;

/** Windows 保留设备名：即使带扩展名也不能作为文件名写出。 */
const RESERVED_WINDOWS_NAMES = new Set([
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export interface SaveGeneratedFileRequest {
    /** 建议文件名（不含目录）；仅用于对话框默认名，不能指定写入位置。 */
    suggestedName: string;
    /** 期望扩展名（小写、不含点）；必须在白名单内。 */
    extension: string;
    /** 文件字节；由渲染层从已授权的文档/图片接口取得。 */
    bytes: Uint8Array;
}

export interface SaveGeneratedFileResult {
    /** 是否真的写入了文件；用户取消时为 false。 */
    saved: boolean;
    /** 是否由用户在保存对话框中取消。 */
    canceled: boolean;
    /** 可回显的文件名（不含目录，避免把用户目录结构带到界面上报）。 */
    displayName: string;
    sizeBytes: number;
}

export function assertSavableExtension(extension: unknown): string {
    if (typeof extension !== 'string') throw new Error('保存类型无效');
    const normalized = extension.trim().toLowerCase().replace(/^\./, '');
    if (!ALLOWED_EXTENSIONS.has(normalized)) {
        throw new Error(`不支持另存为该类型（${normalized || '空'}）`);
    }
    return normalized;
}

export function buildSuggestedFileName(suggestedName: unknown, extension: string): string {
    return `${sanitizeBaseName(suggestedName)}.${extension}`;
}

/**
 * 清洗建议文件名：去掉目录分隔符与控制字符，规避保留设备名，限制长度。
 * 这里是纵深防御——即使上游把服务端返回的标题直接透传进来，也不可能借此跳出所选目录。
 */
export function sanitizeBaseName(value: unknown): string {
    const raw = typeof value === 'string' ? value : '';
    const withoutSeparators = raw
        // 目录分隔、Windows 非法字符、Unicode 控制字符一律替换为下划线。
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
        // 结尾的点和空格在 Windows 上会被静默截断，导致实际文件名与预期不符。
        .replace(/[. ]+$/, '')
        .trim();
    const collapsed = withoutSeparators.replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH).replace(/[. ]+$/, '');
    if (!collapsed) return '生成文件';
    if (RESERVED_WINDOWS_NAMES.has(collapsed.split('.')[0].toLowerCase())) return `_${collapsed}`;
    return collapsed;
}

/**
 * 把字节写入用户选择的位置。目标路径只能由调用方传入的系统对话框产生。
 * 任何一步失败都抛错，由 IPC 层转为界面提示——不吞错、不假装成功。
 */
export async function writeSelectedFile(targetPath: string, bytes: Uint8Array): Promise<SaveGeneratedFileResult> {
    if (typeof targetPath !== 'string' || targetPath.length === 0) throw new Error('保存路径无效');
    if (!ArrayBuffer.isView(bytes) || bytes.byteLength === 0) throw new Error('没有可保存的内容');
    if (bytes.byteLength > MAX_SAVE_BYTES) {
        throw new Error(`文件超过 ${Math.floor(MAX_SAVE_BYTES / (1024 * 1024))} MB，暂不支持另存到本地`);
    }
    const extension = assertSavableExtension(path.extname(targetPath));

    const existing = await lstat(targetPath).catch(() => null);
    if (existing) {
        if (existing.isSymbolicLink()) throw new Error('目标路径是符号链接，已拒绝写入');
        if (existing.isDirectory()) throw new Error('目标路径是目录，请选择文件名');
    }

    // 原子写：临时文件与目标同目录，确保 rename 是同卷操作。
    const temporaryPath = path.join(
        path.dirname(targetPath),
        `.cees-save-${randomUUID()}.tmp`,
    );
    try {
        await writeFile(temporaryPath, bytes, { flag: 'wx' });
        await rename(temporaryPath, targetPath);
    } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }

    return {
        saved: true,
        canceled: false,
        displayName: path.basename(targetPath),
        sizeBytes: bytes.byteLength,
    };
}
