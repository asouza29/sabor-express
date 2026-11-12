'use strict';
/**
 * Gera os arquivos derivados da logo oficial (brand/sabor-logo-original.png) em public/assets/brand/.
 * Uso: node tools/gen-brand-assets.js   (requer o pacote `sharp`, usado SOMENTE nesta ferramenta de build;
 * o servidor continua sem dependências. Os arquivos gerados já estão versionados.)
 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'brand', 'sabor-logo-original.png');
const OUT = path.join(__dirname, '..', 'public', 'assets', 'brand');
fs.mkdirSync(OUT, { recursive: true });

async function squareLogo(size, padRatio, bg) {
  const trimmed = await sharp(SRC).trim({ threshold: 1 }).toBuffer();
  const inner = Math.round(size * (1 - padRatio * 2));
  const fit = await sharp(trimmed).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg || { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fit, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer();
}
function tileSvg(size, radius) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
}
async function tileLogo(size) {
  const logo = await squareLogo(size, 0.14);
  return sharp(tileSvg(size, Math.round(size * 0.22))).composite([{ input: logo }]).png({ compressionLevel: 9 }).toBuffer();
}
/** ICO com PNGs embutidos (aceito por todos os navegadores atuais). */
function buildIco(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length; const dir = []; const data = [];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16); e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12); offset += buf.length; dir.push(e); data.push(buf);
  }
  return Buffer.concat([head, ...dir, ...data]);
}

(async () => {
  const w = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log('✓', name, buf.length, 'bytes'); };
  w('logo.png', await squareLogo(512, 0.02));            // símbolo, fundo transparente (fundos claros)
  w('logo-192.png', await squareLogo(192, 0.02));
  w('logo-tile.png', await tileLogo(256));                // símbolo sobre ladrilho branco (fundos escuros/coloridos)
  w('favicon-16.png', await tileLogo(16));
  const f32 = await tileLogo(32); w('favicon-32.png', f32);
  w('apple-touch-icon.png', await tileLogo(180));
  w('icon-192.png', await tileLogo(192));
  w('icon-512.png', await tileLogo(512));
  w('favicon.ico', buildIco([{ size: 16, buf: await tileLogo(16) }, { size: 32, buf: f32 }, { size: 48, buf: await tileLogo(48) }]));
})().catch((e) => { console.error(e); process.exit(1); });
