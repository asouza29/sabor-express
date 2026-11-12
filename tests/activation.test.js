'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, ORIGIN, NIGHT } = require('./helpers');

const items = (store, qty = 1) => [{ product_id: store.product.id, quantity: qty }];
const nearby = (t) => t.client().get(`/api/catalog/restaurants?lat=${ORIGIN.lat}&lng=${ORIGIN.lng}`);
const setUser = (admin, id, active) => admin.patch(`/api/admin/users/${id}`, { active });
const setRest = (admin, id, active) => admin.patch(`/api/admin/restaurants/${id}`, { active });

describe('Ativar/desativar — permissões', () => {
  let t; let admin; let customer; let store; let courier;
  before(async () => {
    t = await boot();
    admin = await t.makeAdmin(); store = await t.makeStore(); customer = await t.makeCustomer(2000); courier = await t.register('entregador');
  });
  after(() => t.close());

  test('visitante recebe 401 e não-admins recebem 403 nas rotas de ativação', async () => {
    const anon = t.client();
    for (const [method, url] of [['patch', `/api/admin/users/${customer.user.id}`], ['patch', `/api/admin/restaurants/${store.store.id}`]]) {
      assert.equal((await anon[method](url, { active: false })).status, 401, `${url} anônimo`);
      for (const who of [customer, store, courier]) assert.equal((await who[method](url, { active: false })).status, 403, `${url} ${who.user.role}`);
    }
    // nada foi alterado pelas tentativas barradas
    const u = (await admin.get('/api/admin/users')).body.users;
    assert.ok(u.every((x) => x.active), 'todas as contas continuam ativas');
    assert.equal((await admin.get('/api/admin/restaurants')).body.restaurants[0].active, true);
  });
  test('listagens administrativas também são restritas ao admin', async () => {
    for (const who of [customer, store, courier]) {
      assert.equal((await who.get('/api/admin/users')).status, 403);
      assert.equal((await who.get('/api/admin/restaurants')).status, 403);
    }
    assert.equal((await t.client().get('/api/admin/restaurants')).status, 401);
  });
  test('o administrador não consegue desativar a própria conta (nem por engano) e continua logado', async () => {
    const r = await setUser(admin, admin.user.id, false);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'SELF_CHANGE');
    assert.equal((await admin.get('/api/auth/me')).body.user.id, admin.user.id);
    assert.equal((await admin.get('/api/admin/stats')).status, 200);
  });
  test('validação: corpo sem "active", valor inválido, id inexistente e id malformado', async () => {
    assert.equal((await admin.patch(`/api/admin/restaurants/${store.store.id}`, {})).status, 400);
    assert.equal((await admin.patch(`/api/admin/restaurants/${store.store.id}`, { active: 'talvez' })).status, 400);
    assert.equal((await setRest(admin, 999999, false)).status, 404);
    assert.equal((await setUser(admin, 999999, false)).status, 404);
    assert.equal((await setUser(admin, 'abc', false)).status, 404, 'id malformado → 404 (convenção do projeto)');
    assert.equal((await admin.get('/api/admin/restaurants')).body.restaurants[0].active, true, 'estado intacto');
  });
});

describe('Conta de cliente desativada', () => {
  let t; let admin; let store; let c; let order;
  before(async () => {
    t = await boot(); admin = await t.makeAdmin(); store = await t.makeStore(); c = await t.makeCustomer(2000);
    const r = await c.post('/api/orders', { restaurant_id: store.store.id, address_id: c.address.id, items: items(store), payment_method: 'dinheiro' });
    assert.equal(r.status, 201); order = r.body.order;
  });
  after(() => t.close());

  test('perde a sessão, não faz login e não usa nenhuma função autenticada', async () => {
    assert.equal((await setUser(admin, c.user.id, false)).body.user.active, false);
    assert.equal((await c.get('/api/auth/me')).body.user, null, 'sessão existente deixa de valer');
    for (const [m, u] of [['get', '/api/orders'], ['get', '/api/me/addresses'], ['post', '/api/orders/quote'], ['post', '/api/orders']]) {
      assert.equal((await c[m](u, m === 'post' ? { restaurant_id: store.store.id, address_id: c.address.id, items: items(store) } : undefined)).status, 401, u);
    }
    const login = await t.client().post('/api/auth/login', { email: c.email, password: 'senha-forte-123' });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, 'ACCOUNT_DISABLED');
  });
  test('nada é apagado: pedido e histórico permanecem; o restaurante ainda vê o pedido', async () => {
    const inbox = (await store.get('/api/store/orders')).body.orders;
    assert.ok(inbox.some((o) => o.id === order.id && o.status === 'novo'));
    const all = (await admin.get('/api/admin/orders')).body.orders;
    assert.ok(all.some((o) => o.id === order.id));
    assert.ok(t.app.ctx.db.get('SELECT 1 AS x FROM addresses WHERE user_id = ?', c.user.id), 'endereços preservados');
  });
  test('reativar devolve o acesso com o histórico intacto', async () => {
    assert.equal((await setUser(admin, c.user.id, true)).body.user.active, true);
    const again = t.client();
    assert.equal((await again.post('/api/auth/login', { email: c.email, password: 'senha-forte-123' })).status, 200);
    assert.ok((await again.get('/api/orders')).body.orders.some((o) => o.id === order.id));
  });
  test('desativar e reativar é idempotente', async () => {
    assert.equal((await setUser(admin, c.user.id, true)).status, 200);
    assert.equal((await setUser(admin, c.user.id, false)).status, 200);
    assert.equal((await setUser(admin, c.user.id, false)).status, 200);
    assert.equal((await setUser(admin, c.user.id, true)).status, 200);
  });
});

describe('Conta de responsável por restaurante desativada', () => {
  let t; let admin; let store; let c;
  before(async () => { t = await boot(); admin = await t.makeAdmin(); store = await t.makeStore({ name: 'Casa do Dono' }); c = await t.makeCustomer(2000); });
  after(() => t.close());

  test('o responsável perde o painel e a loja some da vitrine e das compras, sem apagar dados', async () => {
    assert.ok((await nearby(t)).body.restaurants.some((r) => r.id === store.store.id), 'visível antes');
    assert.equal((await setUser(admin, store.user.id, false)).status, 200);
    for (const u of ['/api/store/orders', '/api/store/products']) assert.equal((await store.get(u)).status, 401, u);
    assert.equal((await t.client().post('/api/auth/login', { email: store.email, password: 'senha-forte-123' })).status, 403);
    assert.ok(!(await nearby(t)).body.restaurants.some((r) => r.id === store.store.id), 'fora da vitrine');
    assert.equal((await t.client().get(`/api/catalog/restaurants/${store.store.id}`)).status, 404);
    const o = await c.post('/api/orders', { restaurant_id: store.store.id, address_id: c.address.id, items: items(store), payment_method: 'dinheiro' });
    assert.equal(o.status, 404);
    // o registro e o produto continuam no banco
    assert.ok(t.app.ctx.db.get('SELECT 1 AS x FROM restaurants WHERE id = ?', store.store.id));
    assert.ok(t.app.ctx.db.get('SELECT 1 AS x FROM products WHERE restaurant_id = ?', store.store.id));
  });
  test('a tela do admin diferencia: restaurante ativo, mas conta do responsável inativa', async () => {
    const r = (await admin.get('/api/admin/restaurants')).body.restaurants.find((x) => x.id === store.store.id);
    assert.equal(r.active, true, 'o restaurante em si continua "ativo"');
    assert.equal(r.owner_active, false, 'a conta do responsável está inativa');
  });
  test('reativar a conta restaura painel e vitrine', async () => {
    assert.equal((await setUser(admin, store.user.id, true)).status, 200);
    assert.equal((await t.client().post('/api/auth/login', { email: store.email, password: 'senha-forte-123' })).status, 200);
    assert.ok((await nearby(t)).body.restaurants.some((r) => r.id === store.store.id));
  });
});

describe('Restaurante desativado individualmente', () => {
  let t; let admin; let store; let c; let order;
  before(async () => {
    t = await boot(); admin = await t.makeAdmin(); store = await t.makeStore({ name: 'Loja Alvo' }); c = await t.makeCustomer(2000);
    const r = await c.post('/api/orders', { restaurant_id: store.store.id, address_id: c.address.id, items: items(store), payment_method: 'dinheiro' });
    assert.equal(r.status, 201); order = r.body.order;
  });
  after(() => t.close());

  test('não aparece na vitrine, não abre, não cota e não recebe novos pedidos', async () => {
    assert.equal((await setRest(admin, store.store.id, false)).body.restaurant.active, false);
    assert.ok(!(await nearby(t)).body.restaurants.some((r) => r.id === store.store.id));
    assert.equal((await t.client().get(`/api/catalog/restaurants/${store.store.id}`)).status, 404);
    const body = { restaurant_id: store.store.id, address_id: c.address.id, items: items(store), payment_method: 'dinheiro' };
    assert.equal((await c.post('/api/orders/quote', body)).status, 404);
    assert.equal((await c.post('/api/orders', body)).status, 404);
  });
  test('pedidos em andamento NÃO são cancelados nem apagados e seguem visíveis ao restaurante, ao cliente e ao admin', async () => {
    const mine = (await c.get(`/api/orders/${order.id}`)).body.order;
    assert.equal(mine.status, 'novo');
    assert.ok((await store.get('/api/store/orders')).body.orders.some((o) => o.id === order.id && o.status === 'novo'));
    const adm = (await admin.get('/api/admin/restaurants')).body.restaurants.find((r) => r.id === store.store.id);
    assert.equal(adm.open_orders, 1, 'o admin vê quantos pedidos em andamento existem');
    assert.ok((await admin.get('/api/admin/orders')).body.orders.some((o) => o.id === order.id && o.status === 'novo'));
  });
  test('o administrador ainda pode tratar o pedido em andamento (cancelamento administrativo)', async () => {
    const r = await admin.post(`/api/orders/${order.id}/status`, { status: 'cancelado', reason: 'Restaurante desativado' });
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, 'cancelado');
  });
  test('o painel do responsável continua acessível (a conta do dono segue ativa) e o histórico é preservado', async () => {
    assert.equal((await store.get('/api/auth/me')).body.user.id, store.user.id);
    assert.equal((await store.get('/api/store/orders?scope=history')).status, 200);
    assert.ok(t.app.ctx.db.get('SELECT 1 AS x FROM orders WHERE id = ?', order.id), 'pedido permanece no banco');
    assert.ok(t.app.ctx.db.get('SELECT 1 AS x FROM products WHERE restaurant_id = ?', store.store.id), 'produtos preservados');
  });
  test('os três estados são independentes: ativo na plataforma × conta do dono × aberto agora', async () => {
    const row = () => admin.get('/api/admin/restaurants').then((r) => r.body.restaurants.find((x) => x.id === store.store.id));
    let r = await row();
    assert.equal(r.active, false); assert.equal(r.owner_active, true); assert.equal(r.open_now, true, 'inativo na plataforma ≠ fechado: horário 10h–22h, meio-dia');
    await store.patch('/api/store', { accepting_orders: false });
    r = await row();
    assert.equal(r.active, false); assert.equal(r.open_now, false, 'pausa do próprio restaurante muda só "aberto agora"');
    await store.patch('/api/store', { accepting_orders: true });
  });
  test('reativar devolve o restaurante à vitrine e aos pedidos', async () => {
    assert.equal((await setRest(admin, store.store.id, true)).body.restaurant.active, true);
    assert.ok((await nearby(t)).body.restaurants.some((r) => r.id === store.store.id));
    const o = await c.post('/api/orders', { restaurant_id: store.store.id, address_id: c.address.id, items: items(store), payment_method: 'dinheiro' });
    assert.equal(o.status, 201);
  });
  test('filtro de situação na listagem de usuários e de restaurantes', async () => {
    await setRest(admin, store.store.id, false);
    assert.equal((await admin.get('/api/admin/restaurants?active=0')).body.restaurants.length, 1);
    assert.equal((await admin.get('/api/admin/restaurants?active=1')).body.restaurants.length, 0);
    await setUser(admin, c.user.id, false);
    assert.deepEqual((await admin.get('/api/admin/users?active=0')).body.users.map((u) => u.id), [c.user.id]);
    await setRest(admin, store.store.id, true); await setUser(admin, c.user.id, true);
  });
});

describe('Restaurante fechado pelo horário ≠ restaurante inativo', () => {
  let t; let admin; let store;
  before(async () => { t = await boot({ now: NIGHT }); admin = await t.makeAdmin(); store = await t.makeStore(); });
  after(() => t.close());

  test('fora do horário o restaurante está ativo e "fechado agora"; continua listado', async () => {
    const r = (await admin.get('/api/admin/restaurants')).body.restaurants[0];
    assert.equal(r.active, true); assert.equal(r.open_now, false);
    assert.ok((await nearby(t)).body.restaurants.some((x) => x.id === store.store.id), 'fechado, mas visível na vitrine');
  });
});

describe('Regra de 15 km preservada após a atualização', () => {
  let t; let store;
  before(async () => { t = await boot(); store = await t.makeStore(); });
  after(() => t.close());

  test('exatamente 15,00 km é aceito; 15,1 km é recusado', async () => {
    const ok = await t.makeCustomer(15000); const far = await t.makeCustomer(15100);
    const body = (c) => ({ restaurant_id: store.store.id, address_id: c.address.id, items: items(store), payment_method: 'dinheiro' });
    assert.equal((await ok.post('/api/orders', body(ok))).status, 201);
    assert.notEqual((await far.post('/api/orders', body(far))).status, 201);
  });
});
