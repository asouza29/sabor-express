'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/app');
const { destinationNorth } = require('../server/domain/geo');

/** Ponto de referência dos testes (centro de São Paulo). O restaurante fica aqui. */
const ORIGIN = Object.freeze({ lat: -23.55052, lng: -46.633308 });
/** 2026-10-30 12:00 em São Paulo (sexta-feira). O horário padrão da loja (10h–22h) está aberto. */
const NOON = new Date('2026-10-30T15:00:00Z');
/** 2026-10-30 02:00 em São Paulo — loja fechada no horário padrão. */
const NIGHT = new Date('2026-10-30T05:00:00Z');

/**
 * Geocodificador falso e controlável.
 *  - `table`: { 'trecho do endereço': {lat,lng} | null }
 *  - trecho 'EXPLODE' => lança erro (serviço fora do ar)
 *  - endereço desconhecido => null (não encontrado)
 */
function fakeGeocoder() {
  const g = {
    enabled: true,
    table: {},
    down: false,
    calls: 0,
    async geocode(text) {
      g.calls += 1;
      if (g.down) throw new Error('serviço de localização indisponível');
      for (const [key, val] of Object.entries(g.table)) {
        if (text.includes(key)) {
          if (val === 'EXPLODE') throw new Error('falha simulada');
          return val;
        }
      }
      return null;
    },
    /** Registra uma rua que fica a `meters` metros ao norte da ORIGIN. */
    street(name, meters) {
      g.table[name] = destinationNorth(ORIGIN, meters);
    },
  };
  return g;
}

/** Cliente HTTP com jar de cookies e cabeçalho anti-CSRF. */
function makeClient(base) {
  let cookie = '';
  async function request(method, url, body, { headers = {}, raw = false, csrf = true } = {}) {
    const h = { ...headers };
    if (csrf) h['X-Requested-With'] = 'SaborExpress';
    if (cookie) h.Cookie = cookie;
    let payload;
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) payload = body;
      else { h['Content-Type'] = h['Content-Type'] || 'application/json'; payload = JSON.stringify(body); }
    }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) {
      const [pair, ...attrs] = c.split(';');
      if (/Max-Age=0/i.test(attrs.join(';'))) cookie = '';
      else cookie = pair.trim();
    }
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  return {
    get: (u, o) => request('GET', u, undefined, o),
    post: (u, b, o) => request('POST', u, b ?? {}, o),
    put: (u, b, o) => request('PUT', u, b ?? {}, o),
    patch: (u, b, o) => request('PATCH', u, b ?? {}, o),
    del: (u, o) => request('DELETE', u, undefined, o),
    request,
    clearCookies: () => { cookie = ''; },
    get cookie() { return cookie; },
  };
}

/** Sobe a aplicação real em porta efêmera com banco em memória. */
async function boot({ now = NOON, configOverrides = {}, geocoder = fakeGeocoder(), mailer } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saborexpress-test-'));
  const sent = [];
  const app = createApp({
    configOverrides: {
      dbFile: ':memory:', dataDir, jwtSecret: 'segredo-de-teste-1234567890', scryptN: 1024,
      rateLimitEnabled: false, cookieSecure: false, ...configOverrides,
    },
    geocoder,
    mailer: mailer || { enabled: true, async send(m) { sent.push(m); } },
    now: typeof now === 'function' ? now : () => now,
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const seq = { n: 0 };
  const uid = () => `${Date.now().toString(36)}${(seq.n++).toString(36)}`;

  const api = {
    app, base, geocoder, sent, dataDir,
    client: () => makeClient(base),
    async close() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
    async register(role, extra = {}) {
      const c = makeClient(base);
      const email = extra.email || `${role}-${uid()}@teste.com`;
      const r = await c.post('/api/auth/register', {
        role, name: extra.name || `Usuário ${role}`, email, phone: '11988887777', password: extra.password || 'senha-forte-123',
      });
      if (r.status !== 201) throw new Error(`register ${role} falhou: ${r.status} ${r.text}`);
      c.user = r.body.user; c.email = email;
      return c;
    },
    async makeAdmin() {
      const c = makeClient(base);
      app.ctx.db.run("INSERT INTO users (role, name, email, password_hash) VALUES ('admin','Admin','admin-teste@x.com','x')");
      // login real: grava hash válido
      const { hashPassword } = require('../server/lib/password');
      const hash = await hashPassword('admin-senha-123', { N: 1024 });
      app.ctx.db.run("UPDATE users SET password_hash = ? WHERE email = 'admin-teste@x.com'", hash);
      const r = await c.post('/api/auth/login', { email: 'admin-teste@x.com', password: 'admin-senha-123' });
      if (r.status !== 200) throw new Error(`login admin falhou: ${r.text}`);
      c.user = r.body.user;
      return c;
    },
    /** Loja pronta para receber pedidos: localizada na ORIGIN, com um produto. */
    async makeStore({ fee = 500, min = 0, price = 3000, name = 'Loja Teste' } = {}) {
      geocoder.table['Rua da Loja'] = { ...ORIGIN };
      const owner = await api.register('estabelecimento');
      const r = await owner.post('/api/store', {
        name, phone: '11977776666', street: 'Rua da Loja', number: '100', neighborhood: 'Centro', city: 'São Paulo', state: 'SP',
        delivery_fee_cents: fee, min_order_cents: min, prep_time_min: 25,
      });
      if (r.status !== 201) throw new Error(`createStore falhou: ${r.status} ${r.text}`);
      const p = await owner.post('/api/store/products', { name: 'Prato Teste', description: 'Delicioso', price_cents: price });
      if (p.status !== 201) throw new Error(`createProduct falhou: ${p.status} ${p.text}`);
      owner.store = r.body.store; owner.product = p.body.product;
      return owner;
    },
    /** Cliente com endereço a `meters` m ao norte da loja. */
    async makeCustomer(meters, { street } = {}) {
      const st = street || `Rua ${meters}m ${uid()}`;
      if (meters != null) geocoder.street(st, meters);
      const c = await api.register('cliente');
      const r = await c.post('/api/me/addresses', {
        label: 'Casa', street: st, number: '10', neighborhood: 'Bairro', city: 'São Paulo', state: 'SP',
      });
      if (r.status !== 201) throw new Error(`address falhou: ${r.status} ${r.text}`);
      c.address = r.body.address; c.street = st;
      return c;
    },
  };
  return api;
}

/** Monta um multipart/form-data. `files`: { campo: { name, type, data } } */
function multipart(fields = {}, files = {}) {
  const boundary = `----se${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const [k, val] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${val}\r\n`));
  }
  for (const [k, f] of Object.entries(files)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    parts.push(f.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

/** PNG 1x1 válido (bytes reais de PNG). */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64',
);

module.exports = { boot, fakeGeocoder, makeClient, multipart, PNG_1x1, ORIGIN, NOON, NIGHT };
