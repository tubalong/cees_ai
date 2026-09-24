const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, stat, symlink, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
    writeSelectedFile,
    assertSavableExtension,
    buildSuggestedFileName,
    sanitizeBaseName,
} = require('../dist-electron/local-tools/file-saver.js');

async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cees-save-'));
    return { root };
}

test('写出字节并在结果里只回显文件名', async () => {
    const { root } = await fixture();
    try {
        const target = path.join(root, '季度总结.docx');
        const result = await writeSelectedFile(target, new Uint8Array([1, 2, 3, 4]));
        assert.equal(result.saved, true);
        assert.equal(result.canceled, false);
        // 只回显文件名，避免把用户目录结构带到界面上报。
        assert.equal(result.displayName, '季度总结.docx');
        assert.ok(!result.displayName.includes(root));
        assert.equal(result.sizeBytes, 4);
        assert.equal((await readFile(target)).length, 4);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('覆盖已存在文件时使用原子替换且内容完整', async () => {
    const { root } = await fixture();
    try {
        const target = path.join(root, 'report.pdf');
        await writeFile(target, Buffer.from('old-content'));
        // 覆盖确认由系统保存对话框承担，writer 只负责不写穿链接与目录。
        await writeSelectedFile(target, new Uint8Array([9, 9]));
        assert.equal((await readFile(target)).length, 2);
        const leftover = (await require('node:fs/promises').readdir(root)).filter((name) => name.includes('.cees-save-'));
        assert.deepEqual(leftover, []);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('拒绝写入符号链接目标，避免写穿到用户没选过的位置', async (t) => {
    const { root } = await fixture();
    try {
        const realTarget = path.join(root, 'real.txt');
        const link = path.join(root, 'link.txt');
        await writeFile(realTarget, Buffer.from('original'));
        try {
            await symlink(realTarget, link);
        } catch (error) {
            // Windows 未开启开发者模式/未提权时无法创建符号链接；
            // 这里显式跳过而不是伪装通过，避免绿色结果掩盖未验证的路径。
            if (error.code === 'EPERM' || error.code === 'EACCES') {
                t.skip(`当前环境无法创建符号链接（${error.code}），跳过该用例`);
                return;
            }
            throw error;
        }
        await assert.rejects(
            writeSelectedFile(link, new Uint8Array([1])),
            /符号链接/,
        );
        assert.equal((await readFile(realTarget)).toString(), 'original');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('拒绝把目录当作保存目标', async () => {
    const { root } = await fixture();
    try {
        const directory = path.join(root, 'folder.txt');
        await require('node:fs/promises').mkdir(directory);
        await assert.rejects(writeSelectedFile(directory, new Uint8Array([1])), /目录/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('扩展名白名单拒绝可执行与脚本类型', () => {
    assert.equal(assertSavableExtension('DOCX'), 'docx');
    assert.equal(assertSavableExtension('.xlsx'), 'xlsx');
    for (const extension of ['exe', 'bat', 'cmd', 'ps1', 'sh', 'dll', 'lnk', 'scr', 'js', 'vbs', 'zip', '']) {
        assert.throws(() => assertSavableExtension(extension), /不支持另存为该类型/);
    }
    assert.throws(() => assertSavableExtension(undefined), /保存类型无效/);
});

test('清洗建议文件名以阻止跳出所选目录', () => {
    assert.equal(sanitizeBaseName('../../etc/passwd'), '.._.._etc_passwd');
    assert.equal(sanitizeBaseName('C:\\Windows\\System32\\evil'), 'C__Windows_System32_evil');
    assert.equal(sanitizeBaseName('report'), 'report');
    // Windows 会静默截断结尾的点与空格，导致实际文件名与预期不符。
    assert.equal(sanitizeBaseName('report...'), 'report');
    // 保留设备名不能作为文件名写出。
    assert.equal(sanitizeBaseName('CON'), '_CON');
    assert.equal(buildSuggestedFileName('季度/o..', 'docx'), '季度_o.docx');
    assert.equal(sanitizeBaseName('   '), '生成文件');
    assert.equal(sanitizeBaseName('a'.repeat(400)).length, 120);
});

test('拒绝超限与空内容', async () => {
    const { root } = await fixture();
    try {
        await assert.rejects(
            writeSelectedFile(path.join(root, 'big.xlsx'), new Uint8Array(65 * 1024 * 1024)),
            /超过/,
        );
        await assert.rejects(writeSelectedFile(path.join(root, 'empty.txt'), new Uint8Array(0)), /没有可保存的内容/);
        await assert.rejects(writeSelectedFile(path.join(root, 'bad.txt'), 'not-bytes'), /没有可保存的内容/);
        // 超限与空内容都不应该留下文件。
        await assert.rejects(stat(path.join(root, 'big.xlsx')));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
