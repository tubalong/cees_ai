const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { scanDirectorySize, scanVolumes } = require('../dist-electron/local-tools/disk-scanner.js');

test('目录扫描只返回聚合信息并按一级目录排序', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cees-disk-scan-'));
    try {
        await mkdir(path.join(root, 'large'));
        await mkdir(path.join(root, 'small'));
        await writeFile(path.join(root, 'large', 'a.bin'), Buffer.alloc(128));
        await writeFile(path.join(root, 'small', 'b.bin'), Buffer.alloc(16));
        const result = await scanDirectorySize(root, { timeoutMs: 5000, maxEntries: 100 });
        assert.equal(result.totalBytes, 144);
        assert.equal(result.fileCount, 2);
        assert.equal(result.topDirectories[0].name, 'large');
        assert.equal(JSON.stringify(result).includes(root), false);
        assert.equal(JSON.stringify(result).includes('a.bin'), false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('目录扫描达到条目上限时明确标记 truncated', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cees-disk-limit-'));
    try {
        for (let index = 0; index < 5; index += 1) await writeFile(path.join(root, `${index}.txt`), 'x');
        const result = await scanDirectorySize(root, { timeoutMs: 5000, maxEntries: 2 });
        assert.equal(result.truncated, true);
        assert.ok(result.fileCount <= 2);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('卷扫描返回非负容量聚合', async () => {
    const volumes = await scanVolumes();
    assert.ok(volumes.length >= 1);
    assert.ok(volumes.every((volume) => volume.totalBytes >= volume.freeBytes && volume.freeBytes >= 0));
});