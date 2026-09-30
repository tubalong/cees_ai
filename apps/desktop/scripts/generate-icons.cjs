const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public', 'assests', 'logo.webp');
const output = path.join(root, 'build', 'icons');

async function generateIcons() {
    fs.mkdirSync(output, { recursive: true });
    const png = await sharp(source).resize(256, 256, { fit: 'contain', background: '#00000000' }).png().toBuffer();
    fs.writeFileSync(path.join(output, 'cees.png'), png);
    fs.writeFileSync(path.join(root, 'public', 'assests', 'cees-tray.png'),
        await sharp(source).resize(32, 32, { fit: 'contain', background: '#00000000' }).png().toBuffer());

    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18);
    fs.writeFileSync(path.join(output, 'cees.ico'), Buffer.concat([header, png]));
}

generateIcons().catch((error) => { console.error(error); process.exitCode = 1; });