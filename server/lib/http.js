'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('./errors');
const { parseMultipart } = require('./multipart');

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'SaborExpress';

/** Marcador de middleware: rota isenta da checagem de cabeçalho CSRF (ex.: webhook assinado). */
const noCsrf = Object.assign(() => {}, { skipCsrf: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/* ------------------------------------------------------------------ Router */

function compile(pattern) {
  const keys = [];
  const re = pattern.replace(/\/:([A-Za-z_]+)/g, (_, k) => {
    keys.push(k);
    return '/([^/]+)';
  });
  return { regex: new RegExp(`^${re}/?$`), keys };
}

class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  use(fn) {
    this.middlewares.push(fn);
    return this;
  }

  add(method, pattern, fns) {
    const { regex, keys } = compile(pattern);
    this.routes.push({ method, regex, keys, fns, skipCsrf: fns.some((f) => f.skipCsrf) });
    return this;
  }

  get(p, ...f) { return this.add('GET', p, f); }
  post(p, ...f) { return this.add('POST', p, f); }
  put(p, ...f) { return this.add('PUT', p, f); }
  patch(p, ...f) { return this.add('PATCH', p, f); }
  delete(p, ...f) { return this.add('DELETE', p, f); }

  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const params = {};
      r.keys.forEach((k, i) => {
        try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; }
      });
      return { route: r, params, pathMatched };
    }
    return { route: null, params: {}, pathMatched };
  }
}

/* ----------------------------------------------------------------- Helpers */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      reject(new AppError(413, 'PAYLOAD_TOO_LARGE', 'O conteúdo enviado é grande demais.'));
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        reject(new AppError(413, 'PAYLOAD_TOO_LARGE', 'O conteúdo enviado é grande demais.'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

function securityHeaders(config) {
  const h = {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (config.isProd) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/* ------------------------------------------------------------ Static files */

function resolveSafe(root, rel) {
  if (rel.includes('\0')) return null;
  const full = path.normalize(path.join(root, rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

async function serveFile(req, res, filePath, { cache }) {
  let stat;
  try { stat = await fs.promises.stat(filePath); } catch { return false; }
  if (!stat.isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
  return true;
}

/* ------------------------------------------------------------------ Server */

function createHttpServer({ router, config, onError }) {
  const secHeaders = securityHeaders(config);

  async function handle(req, res) {
    for (const [k, v] of Object.entries(secHeaders)) res.setHeader(k, v);

    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { throw new AppError(400, 'BAD_URL', 'URL inválida.'); }
    const pathname = url.pathname;
    const method = req.method;

    /* ---- API ---- */
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const { route, params, pathMatched } = router.match(method, pathname);
      if (!route) {
        if (pathMatched) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
        throw new AppError(404, 'NOT_FOUND', 'Recurso não encontrado.');
      }
      const ip = config.trustProxy
        ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
        : req.socket.remoteAddress;
      const ctx = {
        req, res, method, pathname, params, ip,
        query: Object.fromEntries(url.searchParams),
        cookies: parseCookies(req.headers.cookie),
        body: {}, files: {}, rawBody: Buffer.alloc(0),
        status: 200, user: null,
        setCookie(name, value, { maxAge, httpOnly = true, sameSite = 'Strict' } = {}) {
          let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=${sameSite}`;
          if (httpOnly) c += '; HttpOnly';
          if (config.cookieSecure) c += '; Secure';
          if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
          res.appendHeader('Set-Cookie', c);
        },
        clearCookie(name) { this.setCookie(name, '', { maxAge: 0 }); },
      };

      if (UNSAFE.has(method)) {
        if (!route.skipCsrf && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
          throw new AppError(403, 'CSRF', 'Requisição não autorizada.');
        }
        const ct = String(req.headers['content-type'] || '').toLowerCase();
        const isMultipart = ct.startsWith('multipart/form-data');
        const raw = await readBody(req, isMultipart ? 7 * 1024 * 1024 : 200 * 1024);
        ctx.rawBody = raw;
        if (raw.length) {
          if (ct.startsWith('application/json')) {
            let parsed;
            try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw new AppError(400, 'INVALID_JSON', 'JSON inválido.'); }
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new AppError(400, 'INVALID_JSON', 'O corpo da requisição deve ser um objeto JSON.');
            }
            ctx.body = parsed;
          } else if (isMultipart) {
            const { fields, files } = parseMultipart(raw, req.headers['content-type']);
            ctx.body = fields;
            ctx.files = files;
          } else {
            throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Tipo de conteúdo não suportado.');
          }
        }
      }

      const chain = [...router.middlewares, ...route.fns];
      let result;
      for (let i = 0; i < chain.length; i++) {
        result = await chain[i](ctx);
        if (res.writableEnded) return;
      }
      if (result === undefined) result = { ok: true };
      sendJson(res, ctx.status, result);
      return;
    }

    /* ---- Arquivos estáticos ---- */
    if (method !== 'GET' && method !== 'HEAD') throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { throw new AppError(400, 'BAD_URL', 'URL inválida.'); }

    if (rel.startsWith('/uploads/')) {
      const full = resolveSafe(config.uploadsDir, rel.slice('/uploads/'.length));
      if (full && (await serveFile(req, res, full, { cache: 'public, max-age=604800, immutable' }))) return;
      throw new AppError(404, 'NOT_FOUND', 'Arquivo não encontrado.');
    }
    if (rel === '/') rel = '/index.html';
    const full = resolveSafe(config.publicDir, rel.slice(1));
    const cache = rel.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache';
    if (full && (await serveFile(req, res, full, { cache }))) return;
    throw new AppError(404, 'NOT_FOUND', 'Página não encontrada.');
  }

  const server = http.createServer((req, res) => {
    const started = Date.now();
    if (config.logRequests) {
      res.on('finish', () => console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`));
    }
    handle(req, res).catch((err) => {
      if (res.headersSent) { res.destroy(); return; }
      const out = onError(err);
      const headers = {};
      if (err && err.status === 413) {
        headers.Connection = 'close';
        res.once('finish', () => req.destroy());
      }
      sendJson(res, out.status, out.body, headers);
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

module.exports = { Router, createHttpServer, noCsrf, sendJson, CSRF_HEADER, CSRF_VALUE };
