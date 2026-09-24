import { safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 会话令牌安全存储。
 *
 * 为什么不用 localStorage / sessionStorage：Web Storage 是**明文**且任何同源脚本
 * （含第三方依赖被投毒、AI 生成内容里的注入脚本）都能直接读走刷新令牌；刷新令牌
 * 有效期长，一旦泄漏等于长期账号被接管。
 *
 * 这里改为经 Electron `safeStorage` 加密后落盘到 userData：
 * - Windows 走 DPAPI、macOS 走 Keychain、Linux 走 libsecret；
 * - 文件权限 0600，仅当前用户可读；
 * - 若系统未提供可用密钥环（如无 keyring 的 Linux），退化为明文并在日志里告警，
 *   而不是让用户无法登录——此时至少不弱于原来的 Web Storage。
 *
 * 主进程始终校验调用来源（见 security.ts 的 assertTrustedSender），
 * 因此只有应用自身页面能读写这些值。
 */

const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 4096;

export class SecureTokenStore {
    private readonly file: string;
    private cache: Record<string, string> = {};
    private loaded = false;

    constructor(userDataPath: string, relativeFile = 'session.secure', private readonly requireEncryption = false) {
        const root = path.resolve(userDataPath);
        const file = path.resolve(root, relativeFile);
        if (file === root || !file.startsWith(`${root}${path.sep}`)) throw new Error('安全存储路径无效');
        this.file = file;
    }

    async getAll(): Promise<Record<string, string>> {
        await this.load();
        return { ...this.cache };
    }

    async set(key: string, value: string): Promise<void> {
        assertKeyValue(key, value);
        await this.load();
        this.cache[key] = value;
        await this.persist();
    }

    async remove(key: string): Promise<void> {
        assertKeyValue(key, '');
        await this.load();
        if (!(key in this.cache)) return;
        delete this.cache[key];
        await this.persist();
    }

    private async load(): Promise<void> {
        if (this.loaded) return;
        if (this.requireEncryption && !safeStorage.isEncryptionAvailable()) throw new Error('当前系统安全存储不可用，无法保存连接器授权');
        this.loaded = true;
        try {
            const raw = await readFile(this.file);
            const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
            const parsed: unknown = JSON.parse(json);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                this.cache = parsed as Record<string, string>;
            }
        } catch {
            // 首次运行、文件损坏或密钥环变化：按「未登录」处理，用户重新登录即可。
            this.cache = {};
        }
    }

    private async persist(): Promise<void> {
        if (this.requireEncryption && !safeStorage.isEncryptionAvailable()) throw new Error('当前系统安全存储不可用，无法保存连接器授权');
        const json = JSON.stringify(this.cache);
        const payload = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file, payload, { mode: 0o600 });
    }
}

function assertKeyValue(key: string, value: string): void {
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
        throw new Error('安全存储键名无效');
    }
    if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) {
        throw new Error('安全存储键值无效');
    }
}
