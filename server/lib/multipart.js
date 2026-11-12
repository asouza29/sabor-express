'use strict';
const { AppError } = require('./errors');

const bad = (msg = 'Formulário inválido.') => new AppError(400, 'BAD_MULTIPART', msg);

/**
 * Parser mínimo de multipart/form-data (campos de texto e arquivos).
 * Limites: 3 arquivos, 3 MB por arquivo, 40 campos.
 */
function parseMultipart(buf, contentType, { maxFiles = 3, maxFileBytes = 3 * 1024 * 1024, maxFields = 40 } = {}) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  if (!m) throw bad();
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const delimiter = Buffer.concat([Buffer.from('\r\n'), boundary]);
  const fields = {};
  const files = {};
  let fileCount = 0;
  let fieldCount = 0;

  let pos = buf.indexOf(boundary);
  if (pos < 0) throw bad();

  for (;;) {
    pos += boundary.length;
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break; // boundary final
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;
    else throw bad();

    const headerEnd = buf.indexOf('\r\n\r\n', pos);
    if (headerEnd < 0) throw bad();
    const headerText = buf.subarray(pos, headerEnd).toString('utf8');
    const next = buf.indexOf(delimiter, headerEnd + 4);
    if (next < 0) throw bad();
    const content = buf.subarray(headerEnd + 4, next);

    const disp = /^content-disposition:\s*(.+)$/im.exec(headerText);
    const ctype = /^content-type:\s*(.+)$/im.exec(headerText);
    if (!disp) throw bad();
    const name = /(?:^|;\s*)name="([^"]*)"/i.exec(disp[1]);
    const filename = /(?:^|;\s*)filename="([^"]*)"/i.exec(disp[1]);
    if (!name) throw bad();

    if (filename) {
      if (filename[1] !== '' || content.length > 0) {
        if (++fileCount > maxFiles) throw bad('Arquivos demais no envio.');
        if (content.length > maxFileBytes) {
          throw new AppError(413, 'FILE_TOO_LARGE', 'A imagem deve ter no máximo 3 MB.');
        }
        files[name[1]] = { filename: filename[1], contentType: ctype ? ctype[1].trim() : '', data: Buffer.from(content) };
      }
    } else {
      if (++fieldCount > maxFields) throw bad();
      if (content.length > 20000) throw bad('Campo grande demais.');
      fields[name[1]] = content.toString('utf8');
    }
    pos = next + 2; // posiciona no início do próximo boundary
  }
  return { fields, files };
}

/** Identifica o tipo real da imagem pelos bytes iniciais (não confia no nome/Content-Type). */
function sniffImage(data) {
  if (data.length > 12) {
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
    if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { ext: 'png', mime: 'image/png' };
    }
    if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
      return { ext: 'webp', mime: 'image/webp' };
    }
  }
  return null;
}

module.exports = { parseMultipart, sniffImage };
