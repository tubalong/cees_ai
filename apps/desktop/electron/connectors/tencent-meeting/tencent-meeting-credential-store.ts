import { safeStorage } from 'electron';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_TOKEN_LENGTH = 8192;

export class TencentMeetingCredentialStore {
    private file: string | undefined;

    configure(userDataPath: string): void {
        this.file = path.join(userDataPath, 'connectors', 'tencent-meeting', 'credential.secure');
    }

    async readToken(): Promise<string | null> {
        const file = this.requireFile();
        try {
            const encrypted = await readFile(file);
            if (!safeStorage.isEncryptionAvailable()) {
                throw new Error('系统安全凭据存储不可用，无法读取腾讯会议 Token');
            }
            return validateToken(safeStorage.decryptString(encrypted));
        } catch (error) {
            if (isMissingFile(error)) return null;
            throw error;
        }
    }

    async writeToken(token: string): Promise<void> {
        const file = this.requireFile();
        const normalized = validateToken(token);
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('系统安全凭据存储不可用，无法保存腾讯会议 Token');
        }
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, safeStorage.encryptString(normalized), { mode: 0o600 });
    }

    async removeToken(): Promise<void> {
        await rm(this.requireFile(), { force: true });
    }

    private requireFile(): string {
        if (!this.file) throw new Error('腾讯会议连接器尚未初始化');
        return this.file;
    }
}

export function validateTencentMeetingToken(token: string): string {
    return validateToken(token);
}

function validateToken(token: string): string {
    const normalized = token.trim();
    if (normalized.length < 16 || normalized.length > MAX_TOKEN_LENGTH || /[\u0000-\u001f\u007f]/.test(normalized)) {
        throw new Error('腾讯会议 Token 格式无效');
    }
    return normalized;
}

function isMissingFile(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
