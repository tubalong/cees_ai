import { lstat, opendir, readdir, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';

export interface VolumeSummary {
    label: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
}

export interface DirectorySizeSummary {
    rootLabel: string;
    totalBytes: number;
    fileCount: number;
    directoryCount: number;
    skippedCount: number;
    truncated: boolean;
    elapsedMs: number;
    topDirectories: Array<{ name: string; sizeBytes: number; fileCount: number }>;
}

interface ScanLimits {
    maxDepth: number;
    maxEntries: number;
    timeoutMs: number;
    topDirectoryLimit: number;
}

const DEFAULT_LIMITS: ScanLimits = {
    maxDepth: 4,
    maxEntries: 100_000,
    timeoutMs: 15_000,
    topDirectoryLimit: 12,
};

export async function scanVolumes(platform = process.platform): Promise<VolumeSummary[]> {
    const roots = await volumeRoots(platform);
    const volumes: VolumeSummary[] = [];
    for (const root of roots) {
        try {
            const stats = await statfs(root, { bigint: true });
            const totalBytes = safeNumber(stats.blocks * stats.bsize);
            const freeBytes = safeNumber(stats.bavail * stats.bsize);
            volumes.push({
                label: platform === 'win32' ? root.slice(0, 2) : path.basename(root) || '/',
                totalBytes,
                freeBytes,
                usedBytes: Math.max(0, totalBytes - freeBytes),
            });
        } catch {
            // Removable and protected volumes may disappear between enumeration and statfs.
        }
    }
    return volumes;
}

export async function scanDirectorySize(
    selectedRoot: string,
    overrides: Partial<ScanLimits> = {},
): Promise<DirectorySizeSummary> {
    const limits = { ...DEFAULT_LIMITS, ...overrides };
    assertLimits(limits);
    const startedAt = Date.now();
    const root = await realpath(selectedRoot);
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('只能扫描真实目录');
    const state = { entries: 0, skipped: 0, truncated: false, deadline: startedAt + limits.timeoutMs };
    const rootEntries = await readdir(root, { withFileTypes: true });
    const topDirectories: DirectorySizeSummary['topDirectories'] = [];
    let totalBytes = 0;
    let fileCount = 0;
    let directoryCount = 1;

    for (const entry of rootEntries) {
        if (shouldStop(state, limits)) break;
        state.entries += 1;
        const entryPath = path.join(root, entry.name);
        if (entry.isSymbolicLink()) { state.skipped += 1; continue; }
        if (entry.isDirectory()) {
            const result = await scanTree(entryPath, 1, limits, state);
            totalBytes += result.sizeBytes;
            fileCount += result.fileCount;
            directoryCount += result.directoryCount;
            topDirectories.push({ name: entry.name, sizeBytes: result.sizeBytes, fileCount: result.fileCount });
        } else if (entry.isFile()) {
            try {
                const stats = await lstat(entryPath);
                totalBytes += stats.size;
                fileCount += 1;
            } catch { state.skipped += 1; }
        } else {
            state.skipped += 1;
        }
    }

    return {
        rootLabel: path.basename(root) || path.parse(root).root,
        totalBytes,
        fileCount,
        directoryCount,
        skippedCount: state.skipped,
        truncated: state.truncated,
        elapsedMs: Date.now() - startedAt,
        topDirectories: topDirectories
            .sort((left, right) => right.sizeBytes - left.sizeBytes)
            .slice(0, limits.topDirectoryLimit),
    };
}

async function scanTree(
    directory: string,
    depth: number,
    limits: ScanLimits,
    state: { entries: number; skipped: number; truncated: boolean; deadline: number },
): Promise<{ sizeBytes: number; fileCount: number; directoryCount: number }> {
    if (depth > limits.maxDepth || shouldStop(state, limits)) {
        state.truncated = true;
        return { sizeBytes: 0, fileCount: 0, directoryCount: 0 };
    }
    let sizeBytes = 0;
    let fileCount = 0;
    let directoryCount = 1;
    let handle;
    try {
        handle = await opendir(directory);
        for await (const entry of handle) {
            if (shouldStop(state, limits)) break;
            state.entries += 1;
            const entryPath = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) { state.skipped += 1; continue; }
            if (entry.isDirectory()) {
                const child = await scanTree(entryPath, depth + 1, limits, state);
                sizeBytes += child.sizeBytes;
                fileCount += child.fileCount;
                directoryCount += child.directoryCount;
            } else if (entry.isFile()) {
                try {
                    const stats = await lstat(entryPath);
                    if (stats.isSymbolicLink()) { state.skipped += 1; continue; }
                    sizeBytes += stats.size;
                    fileCount += 1;
                } catch { state.skipped += 1; }
            } else {
                state.skipped += 1;
            }
        }
    } catch {
        state.skipped += 1;
    } finally {
        await handle?.close().catch(() => undefined);
    }
    return { sizeBytes, fileCount, directoryCount };
}

function shouldStop(
    state: { entries: number; truncated: boolean; deadline: number },
    limits: ScanLimits,
): boolean {
    if (state.entries >= limits.maxEntries || Date.now() >= state.deadline) {
        state.truncated = true;
        return true;
    }
    return false;
}

async function volumeRoots(platform: NodeJS.Platform): Promise<string[]> {
    if (platform === 'win32') {
        const roots: string[] = [];
        for (let code = 65; code <= 90; code += 1) {
            const root = `${String.fromCharCode(code)}:\\`;
            try { await statfs(root); roots.push(root); } catch { /* unavailable drive */ }
        }
        return roots;
    }
    if (platform === 'darwin') {
        const roots = ['/'];
        try {
            const volumes = await readdir('/Volumes', { withFileTypes: true });
            roots.push(...volumes.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => path.join('/Volumes', entry.name)));
        } catch { /* root remains available */ }
        return roots;
    }
    return ['/'];
}

function safeNumber(value: bigint): number {
    return Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value);
}

function assertLimits(limits: ScanLimits): void {
    if (!Number.isInteger(limits.maxDepth) || limits.maxDepth < 1 || limits.maxDepth > 8) throw new Error('扫描深度无效');
    if (!Number.isInteger(limits.maxEntries) || limits.maxEntries < 1 || limits.maxEntries > 250_000) throw new Error('扫描条目上限无效');
    if (!Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 100 || limits.timeoutMs > 60_000) throw new Error('扫描超时无效');
    if (!Number.isInteger(limits.topDirectoryLimit) || limits.topDirectoryLimit < 1 || limits.topDirectoryLimit > 50) throw new Error('目录聚合上限无效');
}