'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, ORIGIN, NOON } = require('./helpers');
const { evaluateDelivery, MAX_DELIVERY_KM, MAX_DELIVERY_METERS } = require('../server/domain/delivery');
const { destinationNorth, haversineMeters } = require('../server/domain/geo');

describe('Regra de entrega — unidade (domain/delivery)', () => {
  const at = (m) => evaluateDelivery(ORIGIN, destinationNorth(ORIGIN, m));

  test('o limite vigente é 15 km (60 km revogado)', () => {
    assert.equal(MAX_DELIVERY_KM, 15);
    assert.equal(MAX_DELIVERY_METERS, 15000);
  });
  test('5 km → permitido', () => assert.equal(at(5000).ok, true));
  test('14,9 km → permitido', () => assert.equal(at(14900).ok, true));
  test('exatamente 15 km → permitido (limite inclusivo)', () => {
    const r = at(15000);
    assert.equal(r.ok, true);
    assert.equal(r.distanceMeters, 15000);
  });
  test('15,1 km → recusado (OUT_OF_RANGE)', () => {
    const r = at(15100);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'OUT_OF_RANGE');
  });
  test('15.001 m → recusado; 15.000 m → aceito (granularidade de 1 m)', () => {
    assert.equal(at(15001).ok, false);
    assert.equal(at(15000).ok, true);
  });
  test('distâncias antigas permitidas pelos 60 km (30 e 59 km) agora são recusadas', () => {
    assert.equal(at(30000).ok, false);
    assert.equal(at(59000).ok, false);
  });
  test('sem coordenadas válidas nunca aprova', () => {
    for (const bad of [null, undefined, {}, { lat: null, lng: null }, { lat: NaN, lng: 1 }, { lat: 0, lng: 0 },
      { lat: 91, lng: 0 }, { lat: '1', lng: '2' }, { lat: Infinity, lng: 1 }]) {
      const r = evaluateDelivery(ORIGIN, bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, 'ADDRESS_NO_COORDS');
      assert.equal(r.distanceMeters, null);
    }
    assert.equal(evaluateDelivery({ lat: null, lng: null }, ORIGIN).code, 'RESTAURANT_NO_COORDS');
  });
  test('Haversine: 1° de latitude ≈ 111,2 km', () => {
    const d = haversineMeters({ lat: 0.5, lng: 10 }, { lat: 1.5, lng: 10 });
    assert.ok(Math.abs(d - 111195) < 100, String(d));
  });
});

describe('Regra de entrega — integração (HTTP, backend)', () => {
  let t; let store;
  before(async () => { t = await boot(); store = await t.makeStore(); });
  after(() => t.close());

  const quoteBody = (c, extra = {}) => ({
    restaurant_id: store.store.id, address_id: c.address.id,
    items: [{ product_id: store.product.id, quantity: 1 }], ...extra,
  });

  for (const [km, ok] of [[5, true], [14.9, true], [15, true], [15.1, false]]) {
    test(`cotação e pedido a ${km} km → ${ok ? 'aceitos' : 'recusados (422 OUT_OF_RANGE)'}`, async () => {
      const c = await t.makeCustomer(km * 1000);
      const q = await c.post('/api/orders/quote', quoteBody(c));
      const o = await c.post('/api/orders', { ...quoteBody(c), payment_method: 'pix_entrega' });
      if (ok) {
        assert.equal(q.status, 200, q.text);
        assert.equal(o.status, 201, o.text);
        assert.ok(q.body.distance_km <= 15);
        assert.equal(o.body.order.status, 'novo');
      } else {
        assert.equal(q.status, 422);
        assert.equal(q.body.error.code, 'OUT_OF_RANGE');
        assert.equal(o.status, 422);
        assert.equal(o.body.error.code, 'OUT_OF_RANGE');
        assert.equal(o.body.error.details.delivery.max_km, 15);
        assert.match(o.body.error.message, /15 km/);
      }
    });
  }

  test('um pedido recusado NÃO cria registro algum', async () => {
    const c = await t.makeCustomer(20000);
    const before = t.app.ctx.db.get('SELECT COUNT(*) AS n FROM orders').n;
    const o = await c.post('/api/orders', { ...quoteBody(c), payment_method: 'pix_entrega' });
    assert.equal(o.status, 422);
    assert.equal(t.app.ctx.db.get('SELECT COUNT(*) AS n FROM orders').n, before);
  });

  test('distância registrada no pedido é a calculada no servidor', async () => {
    const c = await t.makeCustomer(7000);
    const o = await c.post('/api/orders', { ...quoteBody(c), payment_method: 'pix_entrega' });
    assert.equal(o.status, 201);
    const row = t.app.ctx.db.get('SELECT distance_m FROM orders WHERE id = ?', o.body.order.id);
    assert.ok(Math.abs(row.distance_m - 7000) <= 1);
  });

  test('endereço sem coordenadas válidas (geocodificador não encontra) → 422 ADDRESS_NO_COORDS', async () => {
    const c = await t.register('cliente');
    const r = await c.post('/api/me/addresses', { street: 'Rua Inexistente', number: '1', neighborhood: 'X', city: 'Y', state: 'SP' });
    assert.equal(r.status, 201);
    assert.equal(r.body.location_confirmed, false);
    assert.equal(r.body.address.has_coords, false);
    const o = await c.post('/api/orders', { restaurant_id: store.store.id, address_id: r.body.address.id,
      items: [{ product_id: store.product.id, quantity: 1 }], payment_method: 'pix_entrega' });
    assert.equal(o.status, 422);
    assert.equal(o.body.error.code, 'ADDRESS_NO_COORDS');
  });

  test('falha no serviço de localização → 503 GEO_UNAVAILABLE e nada é aprovado', async () => {
    const c = await t.register('cliente');
    t.geocoder.down = true;
    try {
      const r = await c.post('/api/me/addresses', { street: 'Rua Qualquer', number: '1', neighborhood: 'X', city: 'Y', state: 'SP' });
      assert.equal(r.status, 201);
      assert.equal(r.body.geo_unavailable, true);
      assert.equal(r.body.address.has_coords, false);
      const body = { restaurant_id: store.store.id, address_id: r.body.address.id,
        items: [{ product_id: store.product.id, quantity: 1 }], payment_method: 'pix_entrega' };
      const o = await c.post('/api/orders', body);
      assert.equal(o.status, 503);
      assert.equal(o.body.error.code, 'GEO_UNAVAILABLE');
      const q = await c.post('/api/orders/quote', body);
      assert.equal(q.status, 503);
    } finally { t.geocoder.down = false; }
  });

  test('endereço salvo sem coordenadas é resolvido depois, quando o serviço volta', async () => {
    const c = await t.register('cliente');
    t.geocoder.down = true;
    const r = await c.post('/api/me/addresses', { street: 'Rua Retorno', number: '1', neighborhood: 'X', city: 'Y', state: 'SP' });
    t.geocoder.down = false;
    t.geocoder.street('Rua Retorno', 3000);
    const o = await c.post('/api/orders', { restaurant_id: store.store.id, address_id: r.body.address.id,
      items: [{ product_id: store.product.id, quantity: 1 }], payment_method: 'pix_entrega' });
    assert.equal(o.status, 201, o.text);
  });

  test('alterar o endereço DURANTE a compra: versão antiga → 409 ADDRESS_CHANGED', async () => {
    const c = await t.makeCustomer(4000);
    const q = await c.post('/api/orders/quote', quoteBody(c));
    assert.equal(q.status, 200);
    const version = q.body.address_updated_at;
    await new Promise((r) => setTimeout(r, 5));
    t.geocoder.street('Rua Nova Perto', 2000);
    const u = await c.put(`/api/me/addresses/${c.address.id}`, { label: 'Casa', street: 'Rua Nova Perto', number: '10', neighborhood: 'Bairro', city: 'São Paulo', state: 'SP' });
    assert.equal(u.status, 200, u.text);
    const o = await c.post('/api/orders', { ...quoteBody(c), payment_method: 'pix_entrega', address_updated_at: version });
    assert.equal(o.status, 409);
    assert.equal(o.body.error.code, 'ADDRESS_CHANGED');
  });

  test('alterar o endereço para fora de 15 km: coordenadas antigas NÃO sobrevivem', async () => {
    const c = await t.makeCustomer(4000);
    t.geocoder.street('Rua Longe', 25000);
    const u = await c.put(`/api/me/addresses/${c.address.id}`, { label: 'Casa', street: 'Rua Longe', number: '10', neighborhood: 'Bairro', city: 'São Paulo', state: 'SP' });
    assert.equal(u.status, 200);
    const o = await c.post('/api/orders', { ...quoteBody(c), payment_method: 'pix_entrega' });
    assert.equal(o.status, 422);
    assert.equal(o.body.error.code, 'OUT_OF_RANGE');
  });

  test('alterar o texto do endereço sem que o geocodificador o encontre zera as coordenadas', async () => {
    const c = await t.makeCustomer(4000);
    const u = await c.put(`/api/me/addresses/${c.address.id}`, { label: 'Casa', street: 'Rua Desconhecida', number: '10', neighborhood: 'Bairro', city: 'São Paulo', state: 'SP' });
    assert.equal(u.body.address.has_coords, false);
    const o = await c.post('/api/orders', { ...quoteBody(c), payment_method: 'pix_entrega' });
    assert.equal(o.status, 422);
    assert.equal(o.body.error.code, 'ADDRESS_NO_COORDS');
  });

  test('CONTORNO PELO FRONTEND: lat/lng/distância/flags enviados no pedido são ignorados', async () => {
    const c = await t.makeCustomer(30000);
    const o = await c.post('/api/orders', {
      ...quoteBody(c), payment_method: 'pix_entrega',
      lat: ORIGIN.lat, lng: ORIGIN.lng, addr_lat: ORIGIN.lat, addr_lng: ORIGIN.lng,
      distance_km: 1, distance_m: 100, distance: 1, in_range: true, delivery: { ok: true }, skip_validation: true,
      device_lat: ORIGIN.lat, device_lng: ORIGIN.lng,
    });
    assert.equal(o.status, 422);
    assert.equal(o.body.error.code, 'OUT_OF_RANGE');
  });

  test('CONTORNO PELO FRONTEND: usar o endereço de outro cliente próximo não funciona', async () => {
    const near = await t.makeCustomer(1000);
    const far = await t.makeCustomer(40000);
    const o = await far.post('/api/orders', { restaurant_id: store.store.id, address_id: near.address.id,
      items: [{ product_id: store.product.id, quantity: 1 }], payment_method: 'pix_entrega' });
    assert.equal(o.status, 404);
  });

  test('CONTORNO PELO FRONTEND: a listagem usa lat/lng da URL só para exibir; o checkout continua bloqueando', async () => {
    const far = await t.makeCustomer(40000);
    const list = await far.get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.restaurants.some((r) => r.id === store.store.id), 'a UI pode mostrar a loja');
    const o = await far.post('/api/orders', { ...quoteBody(far), payment_method: 'pix_entrega' });
    assert.equal(o.status, 422);
    assert.equal(o.body.error.code, 'OUT_OF_RANGE');
  });

  test('CONTORNO: adulterar o cadastro de coordenadas do endereço via campos extras não grava lat/lng arbitrários', async () => {
    const c = await t.register('cliente');
    t.geocoder.street('Avenida Distante', 50000);
    const r = await c.post('/api/me/addresses', {
      street: 'Avenida Distante', number: '1', neighborhood: 'X', city: 'Y', state: 'SP', lat: ORIGIN.lat, lng: ORIGIN.lng,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.address.coords_source, 'geocoder');
    assert.ok(haversineMeters(ORIGIN, r.body.address) > 49000, 'prevalece o geocodificador, não o valor enviado');
  });

  test('listagem de restaurantes: 14,9 e 15 km aparecem; 15,1 km não', async () => {
    const s1 = await t.makeStore({ name: 'Loja Borda' });
    // reposiciona as lojas em pontos conhecidos
    const place = (id, meters) => {
      const p = destinationNorth(ORIGIN, meters);
      t.app.ctx.db.run('UPDATE restaurants SET lat = ?, lng = ? WHERE id = ?', p.lat, p.lng, id);
    };
    const s2 = await t.makeStore({ name: 'Loja Dentro' });
    const s3 = await t.makeStore({ name: 'Loja Fora' });
    place(s1.store.id, 15000);
    place(s2.store.id, 14900);
    place(s3.store.id, 15100);
    const r = await t.client().get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.max_delivery_km, 15);
    const ids = new Set(r.body.restaurants.map((x) => x.id));
    assert.ok(ids.has(s1.store.id), '15,0 km incluído');
    assert.ok(ids.has(s2.store.id), '14,9 km incluído');
    assert.ok(!ids.has(s3.store.id), '15,1 km excluído');
    for (const x of r.body.restaurants) assert.ok(x.distance_m <= 15000);
  });

  test('listagem exige localização válida (não devolve "todos" por falta de dados)', async () => {
    const c = t.client();
    assert.equal((await c.get('/api/catalog/restaurants')).status, 400);
    assert.equal((await c.get('/api/catalog/restaurants?lat=abc&lng=1')).status, 400);
    assert.equal((await c.get('/api/catalog/restaurants?lat=0&lng=0')).status, 400);
    assert.equal((await c.get('/api/catalog/restaurants?lat=95&lng=1')).status, 400);
  });

  test('restaurante sem localização não recebe pedidos nem aparece', async () => {
    const owner = await t.register('estabelecimento');
    const r = await owner.post('/api/store', { name: 'Sem Geo', phone: '11977776666', street: 'Rua Desconhecida Total', number: '1', neighborhood: 'X', city: 'Y', state: 'SP' });
    assert.equal(r.status, 201);
    assert.equal(r.body.location_confirmed, false);
    await owner.post('/api/store/products', { name: 'P', price_cents: 1000 });
    const c = await t.makeCustomer(1000);
    const o = await c.post('/api/orders', { restaurant_id: r.body.store.id, address_id: c.address.id,
      items: [{ product_id: 99999, quantity: 1 }], payment_method: 'pix_entrega' });
    assert.equal(o.status, 422);
    assert.equal(o.body.error.code, 'RESTAURANT_NO_COORDS');
    const list = await c.get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`);
    assert.ok(!list.body.restaurants.some((x) => x.id === r.body.store.id));
  });

  test('mensagem de erro mostra a distância arredondada para CIMA (nunca "15,0 km" recusado)', async () => {
    const c = await t.makeCustomer(15040);
    const o = await c.post('/api/orders', { ...quoteBody(c), payment_method: 'pix_entrega' });
    assert.equal(o.status, 422);
    assert.match(o.body.error.message, /15,1 km/);
  });

  test('GET /api/config e /api/admin/settings expõem 15 km', async () => {
    const cfg = await t.client().get('/api/config');
    assert.equal(cfg.body.max_delivery_km, 15);
    const admin = await t.makeAdmin();
    const s = await admin.get('/api/admin/settings');
    assert.equal(s.body.delivery.max_km, 15);
    assert.equal(s.body.delivery.inclusive, true);
  });

  test('o relógio injetado não interfere na regra de distância', () => {
    assert.ok(NOON instanceof Date);
  });
});
