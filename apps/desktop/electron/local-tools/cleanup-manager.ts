import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type CleanupJobStatus = 'PLANNED' | 'EXECUTING' | 'QUARANTINED' | 'RESTORING' | 'RESTORED' | 'CLEANING' | 'CLEANED' | 'PARTIAL' | 'RECOVERY_REQUIRED';
type CleanupItemStatus = 'PLANNED' | 'QUARANTINED' | 'RESTORED' | 'CLEANED' | 'SKIPPED' | 'FAILED';

interface CleanupItem {
    id: string;
    originalPath: string;
    quarantinePath: string;
    displayName: string;
    sizeBytes: number;
    modifiedAtMs: number;
    kind: 'FILE' | 'DIRECTORY';
    status: CleanupItemStatus;
    error: string | null;
}

interface CleanupJob {
    id: string;
    manifestHash: string;
    status: CleanupJobStatus;
    createdAt: string;
    updatedAt: string;
    items: CleanupItem[];
}

export interface PublicCleanupJob {
    id: string;
    manifestHash: string;
    status: CleanupJobStatus;
    createdAt: string;
    updatedAt: string;
    totalBytes: number;
    itemCount: number;
    items: Array<{ id: string; displayName: string; sizeBytes: number; kind: 'FILE' | 'DIRECTORY'; status: CleanupItemStatus; error: string | null }>;
}

export class CleanupManager {
    private readonly jobsDirectory: string;
    private readonly quarantineDirectory: string;
    private active = false;

    constructor(private readonly rootDirectory: string) {
        this.jobsDirectory = path.join(rootDirectory, 'jobs');
        this.quarantineDirectory = path.join(rootDirectory, 'quarantine');
    }

    async initialize(): Promise<void> {
        await mkdir(this.jobsDirectory, { recursive: true });
        await mkdir(this.quarantineDirectory, { recursive: true });
        for (const name of await readdir(this.jobsDirectory)) {
            if (!name.endsWith('.json')) continue;
            const job = await this.readJob(name.slice(0, -5)).catch(() => null);
            if (!job || !['EXECUTING', 'RESTORING', 'CLEANING'].includes(job.status)) continue;
            for (const item of job.items) {
                const originalExists = await exists(item.originalPath);
                const quarantineExists = await exists(item.quarantinePath);
                if (!originalExists && quarantineExists) item.status = 'QUARANTINED';
                else if (originalExists && !quarantineExists && item.status === 'QUARANTINED') item.status = 'RESTORED';
            }
            job.status = 'RECOVERY_REQUIRED';
            job.updatedAt = new Date().toISOString();
            await this.writeJob(job);
        }
    }

    async createPlan(selectedPaths: string[]): Promise<PublicCleanupJob> {
        if (selectedPaths.length === 0 || selectedPaths.length > 200) throw new Error('每次必须选择 1 到 200 个项目');
        const id = randomUUID();
        const items: CleanupItem[] = [];
        const resolvedPaths = [...new Set(selectedPaths.map((value) => path.resolve(value)))].sort();
        for (let index = 0; index < resolvedPaths.length; index += 1) {
            const selectedPath = resolvedPaths[index];
            assertAllowedPath(selectedPath);
            if (isPathInside(selectedPath, this.rootDirectory)) throw new Error('不能再次隔离 CEES 本地任务或隔离区目录');
            if (resolvedPaths.some((candidate, candidateIndex) => candidateIndex !== index && isPathInside(selectedPath, candidate))) {
                throw new Error('不能在同一清单中同时选择父目录和其子项');
            }
            const info = await lstat(selectedPath);
            if (info.isSymbolicLink()) throw new Error(`不允许隔离符号链接或 Junction：${path.basename(selectedPath)}`);
            if (!info.isFile() && !info.isDirectory()) throw new Error(`不支持该文件类型：${path.basename(selectedPath)}`);
            const itemId = randomUUID();
            items.push({
                id: itemId,
                originalPath: selectedPath,
                quarantinePath: path.join(this.quarantineDirectory, id, itemId),
                displayName: path.basename(selectedPath),
                sizeBytes: info.isFile() ? info.size : await boundedDirectorySize(selectedPath),
                modifiedAtMs: info.mtimeMs,
                kind: info.isFile() ? 'FILE' : 'DIRECTORY',
                status: 'PLANNED',
                error: null,
            });
        }
        const manifestHash = hashManifest(items);
        const now = new Date().toISOString();
        const job: CleanupJob = { id, manifestHash, status: 'PLANNED', createdAt: now, updatedAt: now, items };
        await this.writeJob(job);
        return toPublicJob(job);
    }

    async listJobs(): Promise<PublicCleanupJob[]> {
        const jobs: PublicCleanupJob[] = [];
        for (const name of await readdir(this.jobsDirectory)) {
            if (!name.endsWith('.json')) continue;
            const job = await this.readJob(name.slice(0, -5)).catch(() => null);
            if (job) jobs.push(toPublicJob(job));
        }
        return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }

    quarantine(jobId: string, manifestHash: string): Promise<PublicCleanupJob> {
        return this.exclusive(async () => {
            const job = await this.readJob(jobId);
            if (job.status !== 'PLANNED' && job.status !== 'RECOVERY_REQUIRED') throw new Error('该清单当前不能执行隔离');
            if (job.manifestHash !== manifestHash || hashManifest(job.items) !== manifestHash) throw new Error('清单已变化，请重新创建并确认');
            job.status = 'EXECUTING';
            await this.writeJob(job);
            await mkdir(path.join(this.quarantineDirectory, job.id), { recursive: true });
            for (const item of job.items) {
                if (item.status === 'QUARANTINED') continue;
                try {
                    const info = await lstat(item.originalPath);
                    if (info.isSymbolicLink() || info.mtimeMs !== item.modifiedAtMs || (info.isFile() && info.size !== item.sizeBytes)) {
                        item.status = 'SKIPPED';
                        item.error = '项目在确认后发生变化';
                        continue;
                    }
                    await rename(item.originalPath, item.quarantinePath);
                    item.status = 'QUARANTINED';
                    item.error = null;
                } catch (error) {
                    item.status = 'FAILED';
                    item.error = safeError(error);
                }
                await this.writeJob(job);
            }
            job.status = summarizeStatus(job.items, 'QUARANTINED');
            job.updatedAt = new Date().toISOString();
            await this.writeJob(job);
            return toPublicJob(job);
        });
    }

    restore(jobId: string): Promise<PublicCleanupJob> {
        return this.exclusive(async () => {
            const job = await this.readJob(jobId);
            if (!['QUARANTINED', 'PARTIAL', 'RECOVERY_REQUIRED'].includes(job.status)) throw new Error('该任务没有可恢复项目');
            job.status = 'RESTORING';
            await this.writeJob(job);
            for (const item of job.items.filter((candidate) => candidate.status === 'QUARANTINED')) {
                try {
                    if (await exists(item.originalPath)) {
                        item.status = 'SKIPPED';
                        item.error = '原路径已被占用，未覆盖现有内容';
                        continue;
                    }
                    await mkdir(path.dirname(item.originalPath), { recursive: true });
                    await rename(item.quarantinePath, item.originalPath);
                    item.status = 'RESTORED';
                    item.error = null;
                } catch (error) {
                    item.status = 'FAILED';
                    item.error = safeError(error);
                }
                await this.writeJob(job);
            }
            job.status = summarizeStatus(job.items, 'RESTORED');
            job.updatedAt = new Date().toISOString();
            await this.writeJob(job);
            return toPublicJob(job);
        });
    }

    cleanup(jobId: string): Promise<PublicCleanupJob> {
        return this.exclusive(async () => {
            const job = await this.readJob(jobId);
            if (!['QUARANTINED', 'PARTIAL', 'RECOVERY_REQUIRED'].includes(job.status)) throw new Error('该任务没有可永久清理项目');
            job.status = 'CLEANING';
            await this.writeJob(job);
            for (const item of job.items.filter((candidate) => candidate.status === 'QUARANTINED')) {
                try {
                    await rm(item.quarantinePath, { recursive: item.kind === 'DIRECTORY', force: false });
                    item.status = 'CLEANED';
                    item.error = null;
                } catch (error) {
                    item.status = 'FAILED';
                    item.error = safeError(error);
                }
                await this.writeJob(job);
            }
            job.status = summarizeStatus(job.items, 'CLEANED');
            job.updatedAt = new Date().toISOString();
            await this.writeJob(job);
            return toPublicJob(job);
        });
    }

    private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
        if (this.active) throw new Error('已有本地清理任务正在执行');
        this.active = true;
        try { return await operation(); } finally { this.active = false; }
    }

    private async readJob(id: string): Promise<CleanupJob> {
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('清理任务 ID 无效');
        return JSON.parse(await readFile(path.join(this.jobsDirectory, `${id}.json`), 'utf8')) as CleanupJob;
    }

    private async writeJob(job: CleanupJob): Promise<void> {
        job.updatedAt = new Date().toISOString();
        const target = path.join(this.jobsDirectory, `${job.id}.json`);
        const temporary = `${target}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(job), { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, target);
    }
}

function hashManifest(items: CleanupItem[]): string {
    const canonical = items.map((item) => ({
        id: item.id,
        originalPath: item.originalPath,
        quarantinePath: item.quarantinePath,
        sizeBytes: item.sizeBytes,
        modifiedAtMs: item.modifiedAtMs,
        kind: item.kind,
    }));
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function toPublicJob(job: CleanupJob): PublicCleanupJob {
    return {
        id: job.id,
        manifestHash: job.manifestHash,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        totalBytes: job.items.reduce((sum, item) => sum + item.sizeBytes, 0),
        itemCount: job.items.length,
        items: job.items.map(({ id, displayName, sizeBytes, kind, status, error }) => ({ id, displayName, sizeBytes, kind, status, error })),
    };
}

function summarizeStatus(items: CleanupItem[], completedStatus: CleanupItemStatus): CleanupJobStatus {
    const completed = items.filter((item) => item.status === completedStatus).length;
    if (completed === items.length) {
        if (completedStatus === 'QUARANTINED') return 'QUARANTINED';
        if (completedStatus === 'RESTORED') return 'RESTORED';
        return 'CLEANED';
    }
    return 'PARTIAL';
}

async function boundedDirectorySize(root: string): Promise<number> {
    let size = 0;
    let entries = 0;
    const queue = [root];
    while (queue.length) {
        const current = queue.shift()!;
        for (const entry of await readdir(current, { withFileTypes: true })) {
            entries += 1;
            if (entries > 100_000) throw new Error(`目录项目过多，不能安全隔离：${path.basename(root)}`);
            const entryPath = path.join(current, entry.name);
            if (entry.isSymbolicLink()) throw new Error(`目录包含符号链接或 Junction：${path.basename(root)}`);
            if (entry.isDirectory()) queue.push(entryPath);
            else if (entry.isFile()) size += (await stat(entryPath)).size;
        }
    }
    return size;
}

function assertAllowedPath(target: string): void {
    const resolved = path.resolve(target);
    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const roots = [path.parse(resolved).root, os.homedir(), process.env.SystemRoot, process.env.ProgramFiles, process.env.ProgramData]
        .filter((value): value is string => Boolean(value))
        .map((value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value));
    if (roots.includes(normalized)) throw new Error('不允许隔离磁盘根目录、用户主目录或系统目录');
    const segments = normalized.split(/[\\/]+/);
    if (segments.some((segment) => ['.ssh', '.gnupg', 'windows', 'program files', 'programdata'].includes(segment))) {
        throw new Error('所选路径属于受保护或凭据目录');
    }
}

async function exists(target: string): Promise<boolean> {
    try { await lstat(target); return true; } catch { return false; }
}

function safeError(error: unknown): string {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'LOCAL_OPERATION_FAILED';
    if (code === 'EXDEV') return '隔离区与目标不在同一磁盘，未执行复制后删除降级';
    if (code === 'EACCES' || code === 'EPERM') return '没有权限移动该项目';
    if (code === 'ENOENT') return '项目已不存在';
    return '本地操作失败';
}

function isPathInside(target: string, parent: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(target));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}