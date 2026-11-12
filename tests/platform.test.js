'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { boot, multipart, PNG_1x1, NIGHT, ORIGIN } = require('./helpers');

const items = (store, qty = 1, extra = {}) => [{ product_id: store.product.id, quantity: qty, ...extra }];

describe('Autenticação e sessão', () => {
  let t;
  before(async () => { t = await boot(); });
  after(() => t.close());

  test('cadastro, /me, logout e login', async () => {
    const c = await t.register('cliente', { email: 'ana@teste.com' });
    assert.equal((await c.get('/api/auth/me')).body.user.email, 'ana@teste.com');
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/auth/me')).body.user, null);
    const l = await c.post('/api/auth/login', { email: 'ANA@teste.com', password: 'senha-forte-123' });
    assert.equal(l.status, 200);
    assert.equal(l.body.user.role, 'cliente');
    assert.equal(l.body.user.password_hash, undefined);
  });
  test('e-mail duplicado → 409; senha curta → 400; papel admin não pode ser autoatribuído', async () => {
    await t.register('cliente', { email: 'dup@teste.com' });
    const c = t.client();
    const base = { name: 'Fulano', phone: '11999990000', password: 'senha-forte-123' };
    assert.equal((await c.post('/api/auth/register', { ...base, role: 'cliente', email: 'dup@teste.com' })).status, 409);
    assert.equal((await c.post('/api/auth/register', { ...base, role: 'cliente', email: 'a@b.com', password: '123' })).status, 400);
    assert.equal((await c.post('/api/auth/register', { ...base, role: 'admin', email: 'a2@b.com' })).status, 400);
  });
  test('login com senha errada / e-mail inexistente → mesma resposta 401', async () => {
    const a = await t.client().post('/api/auth/login', { email: 'dup@teste.com', password: 'errada-errada' });
    const b = await t.client().post('/api/auth/login', { email: 'naoexiste@teste.com', password: 'errada-errada' });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.equal(a.body.error.message, b.body.error.message);
  });
  test('cookie de sessão é HttpOnly + SameSite=Strict', async () => {
    const r = await t.client().request('POST', '/api/auth/register', { role: 'cliente', name: 'Cookie', email: 'ck@teste.com', phone: '11999990000', password: 'senha-forte-123' }, { raw: true });
    const sc = r.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  });
  test('recuperação de senha: resposta genérica, token de uso único, invalida sessões antigas', async () => {
    const c = await t.register('cliente', { email: 'rec@teste.com' });
    const ghost = await t.client().post('/api/auth/forgot', { email: 'fantasma@teste.com' });
    const real = await t.client().post('/api/auth/forgot', { email: 'rec@teste.com' });
    assert.deepEqual(ghost.body, real.body);
    const mail = t.sent.find((m) => m.to === 'rec@teste.com');
    assert.ok(mail, 'e-mail enviado');
    const token = /token=([0-9a-f]+)/.exec(mail.text)[1];
    const bad = await t.client().post('/api/auth/reset', { token: 'x'.repeat(64), password: 'nova-senha-123' });
    assert.equal(bad.status, 400);
    const ok = await t.client().post('/api/auth/reset', { token, password: 'nova-senha-123' });
    assert.equal(ok.status, 200);
    assert.equal((await t.client().post('/api/auth/reset', { token, password: 'outra-senha-123' })).status, 400, 'token só vale uma vez');
    assert.equal((await c.get('/api/auth/me')).body.user, null, 'sessão antiga invalidada');
    assert.equal((await t.client().post('/api/auth/login', { email: 'rec@teste.com', password: 'nova-senha-123' })).status, 200);
  });
  test('conta desativada pelo admin não entra e perde a sessão', async () => {
    const admin = await t.makeAdmin();
    const c = await t.register('cliente');
    const off = await admin.patch(`/api/admin/users/${c.user.id}`, { active: false });
    assert.equal(off.status, 200);
    assert.equal((await c.get('/api/auth/me')).body.user, null);
    assert.equal((await t.client().post('/api/auth/login', { email: c.email, password: 'senha-forte-123' })).status, 403);
  });
  test('limitador de tentativas de login (429)', async () => {
    const t2 = await boot({ configOverrides: { rateLimitEnabled: true } });
    try {
      let last;
      for (let i = 0; i < 12; i++) last = await t2.client().post('/api/auth/login', { email: 'x@y.com', password: 'qualquer-coisa' });
      assert.equal(last.status, 429);
    } finally { await t2.close(); }
  });
});

describe('Autorização por perfil e proteções', () => {
  let t; let store; let customer; let courier; let admin;
  before(async () => {
    t = await boot();
    store = await t.makeStore(); customer = await t.makeCustomer(1000);
    courier = await t.register('entregador'); admin = await t.makeAdmin();
  });
  after(() => t.close());

  const matrix = [
    ['GET', '/api/store', 'estabelecimento'], ['GET', '/api/store/products', 'estabelecimento'],
    ['GET', '/api/store/orders', 'estabelecimento'], ['GET', '/api/me/addresses', 'cliente'],
    ['GET', '/api/orders', 'cliente'], ['GET', '/api/courier/profile', 'entregador'],
    ['GET', '/api/courier/deliveries/available', 'entregador'], ['GET', '/api/admin/stats', 'admin'],
    ['GET', '/api/admin/users', 'admin'], ['GET', '/api/admin/orders', 'admin'], ['GET', '/api/admin/settings', 'admin'],
  ];
  test('sem login → 401 em todas as rotas protegidas', async () => {
    for (const [m, u] of matrix) assert.equal((await t.client().request(m, u)).status, 401, u);
  });
  test('perfil errado → 403 (cada perfil só acessa o seu painel)', async () => {
    const who = { cliente: customer, estabelecimento: store, entregador: courier, admin };
    for (const [m, u, role] of matrix) {
      for (const [r, c] of Object.entries(who)) {
        const res = await c.request(m, u);
        if (r === role) assert.notEqual(res.status, 403, `${r} ${u}`);
        else assert.equal(res.status, 403, `${r} → ${u}`);
      }
    }
  });
  test('CSRF: requisição que altera dados sem o cabeçalho é rejeitada', async () => {
    const r = await customer.post('/api/auth/logout', {}, { csrf: false });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'CSRF');
  });
  test('cabeçalhos de segurança presentes', async () => {
    const r = await t.client().get('/api/config');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  });
  test('corpo não-JSON e JSON inválido são tratados', async () => {
    assert.equal((await customer.request('POST', '/api/orders/quote', Buffer.from('oi'), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await customer.request('POST', '/api/orders/quote', Buffer.from('{ruim'), { headers: { 'Content-Type': 'application/json' } })).status, 400);
  });
  test('travessia de diretório em arquivos estáticos e uploads é bloqueada', async () => {
    const c = t.client();
    for (const u of ['/uploads/../../package.json', '/..%2f..%2fpackage.json', '/uploads/%2e%2e/%2e%2e/package.json', '/%00']) {
      const r = await c.get(u);
      assert.ok([400, 404].includes(r.status), `${u} → ${r.status}`);
      assert.ok(!/sabor-express/.test(r.text) || r.status !== 200);
    }
  });
  test('injeção SQL em busca/ids não quebra nem vaza', async () => {
    const c = t.client();
    const r = await c.get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&q=${encodeURIComponent("' OR 1=1 --")}&category=${encodeURIComponent("x' OR '1'='1")}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.restaurants.length, 0);
    assert.equal((await c.get('/api/catalog/restaurants/1%20OR%201=1')).status, 404);
  });
  test('cliente não vê pedido de outro cliente; restaurante não vê pedido de outra loja', async () => {
    const o = await customer.post('/api/orders', { restaurant_id: store.store.id, address_id: customer.address.id, items: items(store), payment_method: 'pix_entrega' });
    assert.equal(o.status, 201);
    const other = await t.makeCustomer(1000);
    assert.equal((await other.get(`/api/orders/${o.body.order.id}`)).status, 404);
    const otherStore = await t.makeStore({ name: 'Outra Loja' });
    assert.equal((await otherStore.get(`/api/orders/${o.body.order.id}`)).status, 404);
    assert.equal((await otherStore.post(`/api/orders/${o.body.order.id}/status`, { status: 'preparando' })).status, 404);
  });
  test('dono de uma loja não altera produto de outra loja', async () => {
    const other = await t.makeStore({ name: 'Intrusa' });
    assert.equal((await other.put(`/api/store/products/${store.product.id}`, { name: 'Hack' })).status, 404);
    assert.equal((await other.del(`/api/store/products/${store.product.id}`)).status, 404);
    assert.equal((await other.patch(`/api/store/products/${store.product.id}/availability`, { available: false })).status, 404);
  });
  test('admin não pode desativar/rebaixar a si mesmo; não converte loja em cliente', async () => {
    assert.equal((await admin.patch(`/api/admin/users/${admin.user.id}`, { active: false })).status, 409);
    assert.equal((await admin.patch(`/api/admin/users/${store.user.id}`, { role: 'cliente' })).status, 409);
  });
  test('admin desativa restaurante → some do catálogo e não recebe pedidos', async () => {
    const s = await t.makeStore({ name: 'Vai Fechar' });
    assert.equal((await admin.patch(`/api/admin/restaurants/${s.store.id}`, { active: false })).status, 200);
    const list = await t.client().get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`);
    assert.ok(!list.body.restaurants.some((r) => r.id === s.store.id));
    const o = await customer.post('/api/orders', { restaurant_id: s.store.id, address_id: customer.address.id, items: items(s), payment_method: 'pix_entrega' });
    assert.equal(o.status, 404);
  });
});

describe('Preços, carrinho e validações de pedido (backend)', () => {
  let t; let store; let c;
  before(async () => { t = await boot(); store = await t.makeStore({ fee: 700, min: 2000, price: 3000 }); c = await t.makeCustomer(2000); });
  after(() => t.close());
  const base = () => ({ restaurant_id: store.store.id, address_id: c.address.id });

  test('total = subtotal + taxa; preço vem do banco (campos de preço enviados são ignorados)', async () => {
    const q = await c.post('/api/orders/quote', { ...base(), items: [{ product_id: store.product.id, quantity: 2, price_cents: 1, unit_price_cents: 1, total_cents: 1 }], total_cents: 1 });
    assert.equal(q.status, 200, q.text);
    assert.equal(q.body.subtotal_cents, 6000);
    assert.equal(q.body.delivery_fee_cents, 700);
    assert.equal(q.body.total_cents, 6700);
  });
  test('preço promocional e opções entram no cálculo', async () => {
    const p = await store.post('/api/store/products', { name: 'Promo', price_cents: 5000, promo_price_cents: 4000,
      options: [{ name: 'Queijo extra', price_cents: 300 }, { name: 'Bacon', price_cents: 500 }] });
    assert.equal(p.status, 201);
    const prod = p.body.product;
    assert.equal(prod.final_price_cents, 4000);
    const q = await c.post('/api/orders/quote', { ...base(), items: [{ product_id: prod.id, quantity: 2, option_ids: [prod.options[0].id, prod.options[1].id] }] });
    assert.equal(q.body.subtotal_cents, (4000 + 300 + 500) * 2);
  });
  test('promo >= preço normal é rejeitada', async () => {
    const r = await store.post('/api/store/products', { name: 'Ruim', price_cents: 1000, promo_price_cents: 1000 });
    assert.equal(r.status, 400);
  });
  test('quantidades/itens inválidos', async () => {
    for (const bad of [[], [{ product_id: store.product.id, quantity: 0 }], [{ product_id: store.product.id, quantity: -1 }],
      [{ product_id: store.product.id, quantity: 1.5 }], [{ product_id: store.product.id, quantity: 999 }],
      [{ product_id: 999999, quantity: 1 }], [null], 'x', [{ product_id: 'abc', quantity: 1 }]]) {
      const r = await c.post('/api/orders/quote', { ...base(), items: bad });
      assert.ok([400, 422].includes(r.status), JSON.stringify(bad) + ' → ' + r.status);
    }
  });
  test('produto de OUTRA loja no carrinho → 422', async () => {
    const other = await t.makeStore({ name: 'Outra' });
    const r = await c.post('/api/orders/quote', { ...base(), items: [{ product_id: other.product.id, quantity: 1 }] });
    assert.equal(r.status, 422); assert.equal(r.body.error.code, 'ITEM_NOT_FOUND');
  });
  test('opção de outro produto → 422', async () => {
    const a = await store.post('/api/store/products', { name: 'A', price_cents: 3000, options: [{ name: 'Op', price_cents: 100 }] });
    const r = await c.post('/api/orders/quote', { ...base(), items: [{ product_id: store.product.id, quantity: 1, option_ids: [a.body.product.options[0].id] }] });
    assert.equal(r.status, 422); assert.equal(r.body.error.code, 'OPTION_INVALID');
  });
  test('produto indisponível não pode ser pedido; pedido mínimo é aplicado', async () => {
    const p = await store.post('/api/store/products', { name: 'Barato', price_cents: 500 });
    const min = await c.post('/api/orders/quote', { ...base(), items: [{ product_id: p.body.product.id, quantity: 1 }] });
    assert.equal(min.status, 422); assert.equal(min.body.error.code, 'BELOW_MIN_ORDER');
    await store.patch(`/api/store/products/${p.body.product.id}/availability`, { available: false });
    const un = await c.post('/api/orders/quote', { ...base(), items: [{ product_id: p.body.product.id, quantity: 9 }] });
    assert.equal(un.body.error.code, 'ITEM_UNAVAILABLE');
  });
  test('total esperado desatualizado → 409 PRICE_CHANGED', async () => {
    const r = await c.post('/api/orders', { ...base(), items: items(store), payment_method: 'pix_entrega', expected_total_cents: 100 });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'PRICE_CHANGED');
    assert.equal(r.body.error.details.total_cents, 3700);
  });
  test('preço alterado pelo restaurante entre cotação e pedido é detectado', async () => {
    const q = await c.post('/api/orders/quote', { ...base(), items: items(store) });
    await store.put(`/api/store/products/${store.product.id}`, { price_cents: 4000 });
    const r = await c.post('/api/orders', { ...base(), items: items(store), payment_method: 'pix_entrega', expected_total_cents: q.body.total_cents });
    assert.equal(r.status, 409);
    await store.put(`/api/store/products/${store.product.id}`, { price_cents: 3000 });
  });
  test('forma de pagamento inválida / troco menor que o total', async () => {
    const a = await c.post('/api/orders', { ...base(), items: items(store), payment_method: 'bitcoin' });
    assert.equal(a.status, 422);
    const b = await c.post('/api/orders', { ...base(), items: items(store), payment_method: 'dinheiro', change_for_cents: 1000 });
    assert.equal(b.body.error.code, 'INVALID_CHANGE');
    const ok = await c.post('/api/orders', { ...base(), items: items(store), payment_method: 'dinheiro', change_for_cents: 5000 });
    assert.equal(ok.status, 201);
  });
  test('pagamento online indisponível quando o gateway não está configurado', async () => {
    const r = await c.post('/api/orders', { ...base(), items: items(store), payment_method: 'online' });
    assert.equal(r.status, 422); assert.equal(r.body.error.code, 'PAYMENT_METHOD_UNAVAILABLE');
    assert.equal((await t.client().post('/api/payments/webhook', { order_code: 'X' }, { csrf: false })).status, 503);
  });
  test('idempotência: a mesma chave não duplica o pedido (duplo clique / reenvio)', async () => {
    const body = { ...base(), items: items(store), payment_method: 'pix_entrega', idempotency_key: 'chave-123' };
    const [a, b] = await Promise.all([c.post('/api/orders', body), c.post('/api/orders', body)]);
    assert.equal(a.body.order.id, b.body.order.id);
    assert.equal(t.app.ctx.db.get("SELECT COUNT(*) AS n FROM orders WHERE idempotency_key = 'chave-123'").n, 1);
    assert.ok([a.body.duplicate, b.body.duplicate].includes(true));
  });
});

describe('Horário de funcionamento', () => {
  test('loja fechada (madrugada) → 422 RESTAURANT_CLOSED; pausada pelo dono também', async () => {
    const t = await boot({ now: NIGHT });
    try {
      const s = await t.makeStore(); const c = await t.makeCustomer(1000);
      const body = { restaurant_id: s.store.id, address_id: c.address.id, items: items(s), payment_method: 'pix_entrega' };
      assert.equal((await c.post('/api/orders', body)).body.error.code, 'RESTAURANT_CLOSED');
      const cat = await t.client().get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`);
      assert.equal(cat.body.restaurants[0].status, 'closed');
      await s.put('/api/store/hours', { hours: Array.from({ length: 7 }, (_, d) => ({ weekday: d, opens: '00:00', closes: '23:59' })) });
      assert.equal((await c.post('/api/orders', body)).status, 201);
      await s.patch('/api/store', { accepting_orders: false });
      assert.equal((await c.post('/api/orders', body)).body.error.code, 'RESTAURANT_CLOSED');
    } finally { await t.close(); }
  });
  test('horário que atravessa a meia-noite (18h–02h)', async () => {
    const { isOpenAt } = require('../server/domain/hours');
    const rows = [{ weekday: 5, opens: '18:00', closes: '02:00' }]; // sexta
    // sexta 23:00 local (02:00Z de sábado) e sábado 01:00 local (04:00Z) → aberto; sábado 03:00 local → fechado
    assert.equal(isOpenAt(rows, new Date('2026-10-31T02:00:00Z'), 'America/Sao_Paulo'), true);
    assert.equal(isOpenAt(rows, new Date('2026-10-31T04:00:00Z'), 'America/Sao_Paulo'), true);
    assert.equal(isOpenAt(rows, new Date('2026-10-31T06:00:00Z'), 'America/Sao_Paulo'), false);
  });
});

describe('Fluxo completo: cliente → restaurante → entregador → avaliação', () => {
  let t; let store; let c; let courier; let order;
  before(async () => {
    t = await boot(); store = await t.makeStore(); c = await t.makeCustomer(3000); courier = await t.register('entregador');
  });
  after(() => t.close());

  test('pedido nasce "novo" com pagamento pendente e chega ao restaurante', async () => {
    const r = await c.post('/api/orders', { restaurant_id: store.store.id, address_id: c.address.id, items: items(store, 2), payment_method: 'dinheiro', change_for_cents: 10000, notes: 'Sem cebola' });
    assert.equal(r.status, 201);
    order = r.body.order;
    assert.equal(order.status, 'novo');
    assert.equal(order.payment.status, 'pendente');
    assert.match(order.code, /^SE-[A-Z0-9]{6}$/);
    const inbox = await store.get('/api/store/orders');
    assert.ok(inbox.body.orders.some((o) => o.id === order.id));
    assert.equal(inbox.body.orders.find((o) => o.id === order.id).notes, 'Sem cebola');
  });
  test('entregador só vê o pedido depois que o restaurante começa a preparar', async () => {
    await courier.patch('/api/courier/profile', { available: true });
    assert.equal((await courier.get('/api/courier/deliveries/available')).body.orders.length, 0);
    assert.equal((await courier.post(`/api/orders/${order.id}/accept-delivery`)).status, 404);
  });
  test('transições inválidas são barradas', async () => {
    assert.equal((await store.post(`/api/orders/${order.id}/status`, { status: 'entregue' })).status, 409);
    assert.equal((await store.post(`/api/orders/${order.id}/status`, { status: 'pronto' })).status, 409);
    assert.equal((await c.post(`/api/orders/${order.id}/status`, { status: 'preparando' })).status, 409);
    assert.equal((await c.post(`/api/orders/${order.id}/status`, { status: 'entregue' })).status, 409);
    assert.equal((await store.post(`/api/orders/${order.id}/status`, { status: 'inexistente' })).status, 400);
  });
  test('restaurante: preparando → entregador aceita → pronto → a caminho → entregue', async () => {
    assert.equal((await store.post(`/api/orders/${order.id}/status`, { status: 'preparando' })).body.order.status, 'preparando');
    const avail = await courier.get('/api/courier/deliveries/available');
    assert.equal(avail.body.orders.length, 1);
    assert.equal(avail.body.orders[0].address.street, undefined, 'endereço completo não é exposto antes de aceitar');
    assert.equal((await courier.post(`/api/orders/${order.id}/accept-delivery`)).status, 200);
    assert.equal((await courier.post(`/api/orders/${order.id}/status`, { status: 'a_caminho' })).status, 409, 'ainda não está pronto');
    assert.equal((await store.post(`/api/orders/${order.id}/status`, { status: 'pronto' })).body.order.status, 'pronto');
    assert.equal((await courier.post(`/api/orders/${order.id}/status`, { status: 'a_caminho' })).body.order.status, 'a_caminho');
    const done = await courier.post(`/api/orders/${order.id}/status`, { status: 'entregue' });
    assert.equal(done.body.order.status, 'entregue');
    assert.equal(done.body.order.payment.status, 'pago', 'pagamento na entrega confirmado ao entregar');
    assert.ok(done.body.order.delivered_at);
  });
  test('o histórico registra cada etapa com o autor', async () => {
    const o = (await c.get(`/api/orders/${order.id}`)).body.order;
    assert.deepEqual(o.events.map((e) => e.status), ['novo', 'preparando', 'preparando', 'pronto', 'a_caminho', 'entregue']);
    assert.equal(o.courier.name, 'Usuário entregador');
    assert.equal(o.courier.phone, '11988887777');
  });
  test('pedido finalizado é imutável', async () => {
    assert.equal((await store.post(`/api/orders/${order.id}/status`, { status: 'cancelado', reason: 'x' })).status, 409);
    assert.equal((await t.makeAdmin().then((a) => a.post(`/api/orders/${order.id}/status`, { status: 'cancelado', reason: 'x' }))).status, 409);
  });
  test('avaliação: só cliente dono, só entregue, só uma vez; nota 1–5', async () => {
    assert.equal((await c.post(`/api/orders/${order.id}/review`, { rating: 6 })).status, 400);
    assert.equal((await c.post(`/api/orders/${order.id}/review`, { rating: 0 })).status, 400);
    assert.equal((await courier.post(`/api/orders/${order.id}/review`, { rating: 5 })).status, 403);
    const ok = await c.post(`/api/orders/${order.id}/review`, { rating: 5, comment: 'Ótimo!' });
    assert.equal(ok.status, 200);
    assert.equal((await c.post(`/api/orders/${order.id}/review`, { rating: 4 })).status, 409);
    const cat = await t.client().get(`/api/catalog/restaurants/${store.store.id}`);
    assert.equal(cat.body.restaurant.rating_avg, 5);
    assert.equal((await t.client().get(`/api/catalog/restaurants/${store.store.id}/reviews`)).body.reviews[0].comment, 'Ótimo!');
  });
  test('histórico do cliente, do restaurante e do entregador', async () => {
    assert.equal((await c.get('/api/orders')).body.orders[0].id, order.id);
    assert.equal((await store.get('/api/store/orders?scope=history')).body.orders[0].id, order.id);
    assert.equal((await courier.get('/api/courier/deliveries?scope=history')).body.orders[0].id, order.id);
    assert.equal((await courier.get('/api/courier/profile')).body.profile.delivered_count, 1);
  });
});

describe('Entregador: disponibilidade e concorrência', () => {
  test('sem disponibilidade não aceita; dois entregadores disputando o mesmo pedido → só um leva', async () => {
    const t = await boot();
    try {
      const s = await t.makeStore(); const c = await t.makeCustomer(1000);
      const a = await t.register('entregador'); const b = await t.register('entregador');
      const o = (await c.post('/api/orders', { restaurant_id: s.store.id, address_id: c.address.id, items: items(s), payment_method: 'pix_entrega' })).body.order;
      await s.post(`/api/orders/${o.id}/status`, { status: 'preparando' });
      assert.equal((await a.post(`/api/orders/${o.id}/accept-delivery`)).body.error.code, 'COURIER_UNAVAILABLE');
      assert.deepEqual((await a.get('/api/courier/deliveries/available')).body, { available: false, orders: [] });
      await a.patch('/api/courier/profile', { available: true, vehicle: 'bicicleta' });
      await b.patch('/api/courier/profile', { available: true });
      const [ra, rb] = await Promise.all([a.post(`/api/orders/${o.id}/accept-delivery`), b.post(`/api/orders/${o.id}/accept-delivery`)]);
      assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
      const loser = ra.status === 409 ? a : b; const winner = ra.status === 200 ? a : b;
      assert.equal((await loser.post(`/api/orders/${o.id}/status`, { status: 'a_caminho' })).status, 404);
      assert.equal((await winner.post(`/api/orders/${o.id}/release-delivery`)).status, 200);
      assert.equal((await loser.post(`/api/orders/${o.id}/accept-delivery`)).status, 200, 'devolvida volta ao mural');
    } finally { await t.close(); }
  });
  test('veículo inválido é rejeitado', async () => {
    const t = await boot();
    try {
      const a = await t.register('entregador');
      assert.equal((await a.patch('/api/courier/profile', { vehicle: 'foguete' })).status, 400);
    } finally { await t.close(); }
  });
});

describe('Cancelamentos', () => {
  test('cliente cancela só antes do preparo; restaurante exige motivo; pagamento é encerrado', async () => {
    const t = await boot();
    try {
      const s = await t.makeStore(); const c = await t.makeCustomer(1000);
      const mk = async () => (await c.post('/api/orders', { restaurant_id: s.store.id, address_id: c.address.id, items: items(s), payment_method: 'pix_entrega' })).body.order;
      const o1 = await mk();
      const x = await c.post(`/api/orders/${o1.id}/status`, { status: 'cancelado' });
      assert.equal(x.body.order.status, 'cancelado'); assert.equal(x.body.order.payment.status, 'cancelado');
      const o2 = await mk();
      await s.post(`/api/orders/${o2.id}/status`, { status: 'preparando' });
      assert.equal((await c.post(`/api/orders/${o2.id}/status`, { status: 'cancelado' })).status, 409, 'cliente não cancela em preparo');
      assert.equal((await s.post(`/api/orders/${o2.id}/status`, { status: 'cancelado' })).body.error.code, 'REASON_REQUIRED');
      const r = await s.post(`/api/orders/${o2.id}/status`, { status: 'cancelado', reason: 'Faltou ingrediente' });
      assert.equal(r.body.order.canceled_reason, 'Faltou ingrediente');
    } finally { await t.close(); }
  });
});

describe('Pagamento online (webhook assinado)', () => {
  const secret = 'segredo-webhook-de-teste';
  const sign = (raw) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const hook = (t, payload, sig) => {
    const raw = Buffer.from(JSON.stringify(payload));
    return t.client().request('POST', '/api/payments/webhook', raw, { csrf: false, headers: { 'Content-Type': 'application/json', 'X-Signature': sig ?? sign(raw) } });
  };
  test('pedido fica aguardando pagamento e só vira "novo" com webhook válido e valor correto', async () => {
    const t = await boot({ configOverrides: { paymentWebhookSecret: secret } });
    try {
      assert.ok((await t.client().get('/api/config')).body.payment_methods.some((m) => m.id === 'online'));
      const s = await t.makeStore(); const c = await t.makeCustomer(1000);
      const o = (await c.post('/api/orders', { restaurant_id: s.store.id, address_id: c.address.id, items: items(s), payment_method: 'online' })).body.order;
      assert.equal(o.status, 'aguardando_pagamento');
      assert.equal((await s.get('/api/store/orders')).body.orders.length, 0, 'restaurante não vê pedido não pago');
      assert.equal((await s.post(`/api/orders/${o.id}/status`, { status: 'preparando' })).status, 404);
      assert.equal((await c.post(`/api/orders/${o.id}/status`, { status: 'novo' })).status, 409, 'cliente não "se autopaga"');

      assert.equal((await hook(t, { order_code: o.code, status: 'paid', amount_cents: o.total_cents }, 'ab'.repeat(32))).status, 401, 'assinatura inválida');
      assert.equal((await hook(t, { order_code: o.code, status: 'paid', amount_cents: 1 })).status, 422, 'valor divergente');
      assert.equal((await c.get(`/api/orders/${o.id}`)).body.order.status, 'aguardando_pagamento');

      assert.equal((await hook(t, { order_code: o.code, status: 'paid', amount_cents: o.total_cents, provider_ref: 'tx1' })).status, 200);
      const after = (await c.get(`/api/orders/${o.id}`)).body.order;
      assert.equal(after.status, 'novo'); assert.equal(after.payment.status, 'pago');
      assert.equal((await hook(t, { order_code: o.code, status: 'paid', amount_cents: o.total_cents })).body.idempotent, true, 'webhook repetido é idempotente');
      assert.equal((await s.get('/api/store/orders')).body.orders.length, 1);
    } finally { await t.close(); }
  });
  test('pagamento recusado cancela o pedido; pagamento tardio de pedido cancelado vira reembolso pendente', async () => {
    const t = await boot({ configOverrides: { paymentWebhookSecret: secret } });
    try {
      const s = await t.makeStore(); const c = await t.makeCustomer(1000);
      const mk = async () => (await c.post('/api/orders', { restaurant_id: s.store.id, address_id: c.address.id, items: items(s), payment_method: 'online' })).body.order;
      const a = await mk();
      assert.equal((await hook(t, { order_code: a.code, status: 'failed' })).status, 200);
      const ra = (await c.get(`/api/orders/${a.id}`)).body.order;
      assert.equal(ra.status, 'cancelado'); assert.equal(ra.payment.status, 'falhou');
      const b = await mk();
      await c.post(`/api/orders/${b.id}/status`, { status: 'cancelado' });
      const late = await hook(t, { order_code: b.code, status: 'paid', amount_cents: b.total_cents });
      assert.equal(late.body.refund_pending, true);
      assert.equal((await c.get(`/api/orders/${b.id}`)).body.order.payment.status, 'reembolso_pendente');
    } finally { await t.close(); }
  });
  test('admin confirma pagamento manualmente pela mesma função', async () => {
    const t = await boot({ configOverrides: { paymentWebhookSecret: secret } });
    try {
      const s = await t.makeStore(); const c = await t.makeCustomer(1000); const admin = await t.makeAdmin();
      const o = (await c.post('/api/orders', { restaurant_id: s.store.id, address_id: c.address.id, items: items(s), payment_method: 'online' })).body.order;
      assert.equal((await c.post(`/api/admin/orders/${o.id}/confirm-payment`)).status, 403);
      assert.equal((await admin.post(`/api/admin/orders/${o.id}/confirm-payment`)).body.order.status, 'novo');
    } finally { await t.close(); }
  });
});

describe('Loja, cardápio e imagens de produtos', () => {
  let t; let owner;
  before(async () => { t = await boot(); owner = await t.makeStore(); });
  after(() => t.close());

  test('cadastro de produto com imagem (multipart) → imagem servida em /uploads', async () => {
    const m = multipart({ name: 'Pizza com foto', description: 'Linda', price_cents: '4500' }, { image: { name: 'foto.png', type: 'image/png', data: PNG_1x1 } });
    const r = await owner.request('POST', '/api/store/products', m.body, { headers: m.headers });
    assert.equal(r.status, 201, r.text);
    const url = r.body.product.image_url;
    assert.match(url, /^\/uploads\/[0-9a-f]{32}\.png$/);
    const img = await t.client().request('GET', url, undefined, { raw: true });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG_1x1);
  });
  test('arquivo que não é imagem (texto com extensão .png) é rejeitado', async () => {
    const m = multipart({ name: 'Falso', price_cents: '1000' }, { image: { name: 'x.png', type: 'image/png', data: Buffer.from('<script>alert(1)</script> isto não é uma imagem de verdade') } });
    const r = await owner.request('POST', '/api/store/products', m.body, { headers: m.headers });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'INVALID_IMAGE');
    assert.equal((await owner.get('/api/store/products')).body.products.some((p) => p.name === 'Falso'), false, 'nada é gravado');
  });
  test('imagem acima de 3 MB é rejeitada', async () => {
    const big = Buffer.concat([PNG_1x1, Buffer.alloc(3 * 1024 * 1024 + 10)]);
    const m = multipart({ name: 'Grande', price_cents: '1000' }, { image: { name: 'g.png', type: 'image/png', data: big } });
    const r = await owner.request('POST', '/api/store/products', m.body, { headers: m.headers });
    assert.equal(r.status, 413);
  });
  test('trocar e remover a imagem apaga o arquivo antigo', async () => {
    const fs = require('node:fs'); const path = require('node:path');
    const m1 = multipart({ name: 'Troca', price_cents: '1000' }, { image: { name: 'a.png', type: 'image/png', data: PNG_1x1 } });
    const p = (await owner.request('POST', '/api/store/products', m1.body, { headers: m1.headers })).body.product;
    const file1 = path.join(t.app.ctx.config.uploadsDir, path.basename(p.image_url));
    assert.ok(fs.existsSync(file1));
    const m2 = multipart({}, { image: { name: 'b.png', type: 'image/png', data: PNG_1x1 } });
    const p2 = (await owner.request('PUT', `/api/store/products/${p.id}`, m2.body, { headers: m2.headers })).body.product;
    assert.notEqual(p2.image_url, p.image_url);
    assert.ok(!fs.existsSync(file1), 'arquivo antigo removido');
    const p3 = (await owner.request('PUT', `/api/store/products/${p.id}`, multipart({ remove_image: 'true' }).body, { headers: multipart({ remove_image: 'true' }).headers })).body;
    // o multipart acima gera boundaries distintos nos dois usos; refaz de forma consistente:
    const mm = multipart({ remove_image: 'true' });
    const p4 = (await owner.request('PUT', `/api/store/products/${p.id}`, mm.body, { headers: mm.headers })).body.product;
    assert.equal(p4.image_url, null);
    void p3;
  });
  test('logo e capa da loja', async () => {
    const m = multipart({}, { logo: { name: 'l.png', type: 'image/png', data: PNG_1x1 }, cover: { name: 'c.png', type: 'image/png', data: PNG_1x1 } });
    const r = await owner.request('PUT', '/api/store/images', m.body, { headers: m.headers });
    assert.equal(r.status, 200);
    assert.ok(r.body.store.logo_url && r.body.store.cover_url);
  });
  test('seções organizam o cardápio público; produtos sem seção vão para "Outros"', async () => {
    const sec = (await owner.post('/api/store/sections', { name: 'Bebidas' })).body.section;
    await owner.post('/api/store/products', { name: 'Suco', price_cents: 800, section_id: sec.id });
    const menu = (await t.client().get(`/api/catalog/restaurants/${owner.store.id}`)).body.menu;
    assert.ok(menu.find((s) => s.name === 'Bebidas').products.some((p) => p.name === 'Suco'));
    assert.ok(menu.find((s) => s.name === 'Outros'));
    assert.equal((await owner.post('/api/store/products', { name: 'X', price_cents: 100, section_id: 99999 })).status, 400);
  });
  test('validações: preço ≤ 0, nome vazio, horário inválido, telefone inválido', async () => {
    assert.equal((await owner.post('/api/store/products', { name: 'Z', price_cents: 0 })).status, 400);
    assert.equal((await owner.post('/api/store/products', { name: '  ', price_cents: 100 })).status, 400);
    assert.equal((await owner.put('/api/store/hours', { hours: [{ weekday: 1, opens: '25:00', closes: '10:00' }] })).status, 400);
    assert.equal((await owner.put('/api/store/hours', { hours: [{ weekday: 1, opens: '10:00', closes: '10:00' }] })).status, 400);
    assert.equal((await owner.patch('/api/store', { phone: '123' })).status, 400);
  });
  test('excluir produto não apaga pedidos antigos (nome/preço ficam congelados no item)', async () => {
    const c = await t.makeCustomer(1000);
    const p = (await owner.post('/api/store/products', { name: 'Efêmero', price_cents: 2500 })).body.product;
    const o = (await c.post('/api/orders', { restaurant_id: owner.store.id, address_id: c.address.id, items: [{ product_id: p.id, quantity: 1 }], payment_method: 'pix_entrega' })).body.order;
    assert.equal((await owner.del(`/api/store/products/${p.id}`)).status, 200);
    const again = (await c.get(`/api/orders/${o.id}`)).body.order;
    assert.equal(again.items[0].name, 'Efêmero'); assert.equal(again.items[0].unit_price_cents, 2500);
  });
  test('loja sem produto não aparece no catálogo (pedido exige produto cadastrado)', async () => {
    const empty = await t.register('estabelecimento');
    t.geocoder.table['Rua Vazia'] = { ...ORIGIN };
    const r = await empty.post('/api/store', { name: 'Vazia', phone: '11977776666', street: 'Rua Vazia', number: '1', neighborhood: 'X', city: 'Y', state: 'SP' });
    assert.equal(r.status, 201);
    assert.equal(r.body.onboarding.has_products, false);
    const list = await t.client().get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`);
    assert.ok(!list.body.restaurants.some((x) => x.id === r.body.store.id));
  });
  test('só uma loja por conta', async () => {
    const r = await owner.post('/api/store', { name: 'Segunda', phone: '11977776666', street: 'Rua da Loja', number: '1', neighborhood: 'X', city: 'Y', state: 'SP' });
    assert.equal(r.status, 409);
  });
  test('busca por nome de produto e filtro por categoria', async () => {
    const cat = (await t.client().get('/api/catalog/categories')).body.categories.find((x) => x.slug === 'pizza');
    await owner.patch('/api/store', { category_id: cat.id });
    const q = await t.client().get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&q=Efêmero`);
    assert.equal(q.status, 200);
    const byCat = await t.client().get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&category=pizza`);
    assert.ok(byCat.body.restaurants.some((x) => x.id === owner.store.id));
    const other = await t.client().get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}&category=japonesa`);
    assert.ok(!other.body.restaurants.some((x) => x.id === owner.store.id));
  });
});

describe('Administração', () => {
  test('indicadores, listagens, filtros e confirmação refletem os dados reais', async () => {
    const t = await boot();
    try {
      const s = await t.makeStore(); const c = await t.makeCustomer(1000); const admin = await t.makeAdmin();
      const o = (await c.post('/api/orders', { restaurant_id: s.store.id, address_id: c.address.id, items: items(s), payment_method: 'pix_entrega' })).body.order;
      const st = (await admin.get('/api/admin/stats')).body;
      assert.equal(st.orders.by_status.novo, 1);
      assert.equal(st.restaurants.total, 1);
      assert.equal(st.restaurants.without_location, 0);
      assert.equal(st.daily.length, 7);
      assert.equal(st.users.find((u) => u.role === 'cliente').total, 1);
      assert.equal((await admin.get('/api/admin/users?role=estabelecimento')).body.users.length, 1);
      assert.equal((await admin.get('/api/admin/users?q=%25')).body.users.length, 0, 'curinga LIKE é escapado');
      assert.equal((await admin.get(`/api/admin/orders?q=${o.code}`)).body.orders.length, 1);
      assert.equal((await admin.get('/api/admin/orders?status=entregue')).body.orders.length, 0);
      assert.equal((await admin.get('/api/admin/restaurants')).body.restaurants[0].products, 1);
      const cancel = await admin.post(`/api/orders/${o.id}/status`, { status: 'cancelado', reason: 'Teste admin' });
      assert.equal(cancel.body.order.status, 'cancelado');
    } finally { await t.close(); }
  });
});

describe('Dados pessoais', () => {
  test('o entregador não recebe telefone do cliente nem endereço antes de aceitar; respostas nunca trazem hash de senha', async () => {
    const t = await boot();
    try {
      const s = await t.makeStore(); const c = await t.makeCustomer(1000); const k = await t.register('entregador');
      const o = (await c.post('/api/orders', { restaurant_id: s.store.id, address_id: c.address.id, items: items(s), payment_method: 'pix_entrega' })).body.order;
      await s.post(`/api/orders/${o.id}/status`, { status: 'preparando' });
      await k.patch('/api/courier/profile', { available: true });
      const listed = (await k.get('/api/courier/deliveries/available')).body.orders[0];
      assert.equal(listed.customer, null); assert.equal(listed.address.street, undefined); assert.equal(listed.address.number, undefined);
      await k.post(`/api/orders/${o.id}/accept-delivery`);
      const mine = (await k.get(`/api/orders/${o.id}`)).body.order;
      assert.ok(mine.address.street); assert.ok(mine.customer.phone);
      for (const c2 of [c, s, k]) {
        const txt = JSON.stringify((await c2.get('/api/auth/me')).body);
        assert.ok(!/password|hash|scrypt/i.test(txt));
      }
      const admin = await t.makeAdmin();
      assert.ok(!/password_hash|scrypt/.test((await admin.get('/api/admin/users')).text));
    } finally { await t.close(); }
  });
});
