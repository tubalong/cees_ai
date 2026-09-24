const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { CleanupManager } = require('../dist-electron/local-tools/cleanup-manager.js');

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cees-cleanup-'));
    const source = path.join(root, 'cache.tmp');
    await writeFile(source, Buffer.alloc(32));
    const manager = new CleanupManager(path.join(root, 'state'));
    await manager.initialize();
    return { root, source, manager };
}

test('隔离后可恢复且不覆盖原路径', async () => {
    const { root, source, manager } = await fixture();
    try {
        const plan = await manager.createPlan([source]);
        const quarantined = await manager.quarantine(plan.id, plan.manifestHash);
        assert.equal(quarantined.status, 'QUARANTINED');
        assert.equal(quarantined.items[0].status, 'QUARANTINED');
        await assert.rejects(readFile(source));
        const restored = await manager.restore(plan.id);
        assert.equal(restored.status, 'RESTORED');
        assert.equal((await readFile(source)).length, 32);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('篡改清单 hash 时拒绝执行', async () => {
    const { root, source, manager } = await fixture();
    try {
        const plan = await manager.createPlan([source]);
        await assert.rejects(manager.quarantine(plan.id, '0'.repeat(64)), /清单已变化/);
        assert.equal((await readFile(source)).length, 32);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('永久清理只删除已隔离副本', async () => {
    const { root, source, manager } = await fixture();
    try {
        const plan = await manager.createPlan([source]);
        await manager.quarantine(plan.id, plan.manifestHash);
        const cleaned = await manager.cleanup(plan.id);
        assert.equal(cleaned.status, 'CLEANED');
        assert.equal(cleaned.items[0].status, 'CLEANED');
        await assert.rejects(readFile(source));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('公开任务不泄漏完整本地路径', async () => {
    const { root, source, manager } = await fixture();
    try {
        const plan = await manager.createPlan([source]);
        const serialized = JSON.stringify(plan);
        assert.equal(serialized.includes(root), false);
        assert.equal(plan.items[0].displayName, 'cache.tmp');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('重启时把执行中的任务标记为 RECOVERY_REQUIRED 而不自动重放', async () => {
    const { root, source, manager } = await fixture();
    try {
        const plan = await manager.createPlan([source]);
        const jobPath = path.join(root, 'state', 'jobs', `${plan.id}.json`);
        const raw = JSON.parse(await readFile(jobPath, 'utf8'));
        raw.status = 'EXECUTING';
        await writeFile(jobPath, JSON.stringify(raw));
        const restarted = new CleanupManager(path.join(root, 'state'));
        await restarted.initialize();
        const jobs = await restarted.listJobs();
        assert.equal(jobs[0].status, 'RECOVERY_REQUIRED');
        assert.equal((await readFile(source)).length, 32);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('拒绝在同一清单中同时选择父目录和子项', async () => {
    const { root, source, manager } = await fixture();
    try {
        await assert.rejects(manager.createPlan([path.dirname(source), source]), /父目录和其子项/);
        assert.equal((await readFile(source)).length, 32);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});