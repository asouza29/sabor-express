'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('../lib/errors');
const { sniffImage } = require('../lib/multipart');

const imageUrl = (p) => (p ? (p.startsWith('demo/') ? `/assets/${p}` : `/uploads/${p}`) : null);
const nowIso = () => new Date().toISOString();
const bool = (x) => Boolean(x);

/** Converte parâmetro de rota em inteiro positivo ou responde 404. */
function idParam(value) {
  if (!/^\d{1,12}$/.test(String(value))) throw new AppError(404, 'NOT_FOUND', 'Recurso não encontrado.');
  return Number(value);
}

/** Armazenamento de imagens enviadas (validadas pelos bytes, nome aleatório). */
function createUploads(config) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  return {
    async save(file) {
      const type = sniffImage(file.data);
      if (!type) throw new AppError(400, 'INVALID_IMAGE', 'Envie uma imagem JPG, PNG ou WebP.');
      const name = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`;
      await fs.promises.writeFile(path.join(config.uploadsDir, name), file.data, { flag: 'wx' });
      return name;
    },
    async remove(p) {
      if (!p || p.startsWith('demo/')) return;
      await fs.promises.rm(path.join(config.uploadsDir, path.basename(p)), { force: true });
    },
  };
}

module.exports = { imageUrl, nowIso, bool, idParam, createUploads };
