'use strict';
const crypto = require('node:crypto');
const { noCsrf } = require('../lib/http');
const { AppError } = require('../lib/errors');
const { createRateLimiter } = require('../lib/ratelimit');
const v = require('../lib/validate');
const { MAX_DELIVERY_KM } = require('../domain/delivery');

const COOKIE = 'se_session';

function registerRoutes(router, { config, svc }) {
  const { auth, addresses, catalog, store, orders, courier, admin } = svc;
  const enabled = config.rateLimitEnabled;

  /* ---------------------------------------------- Middlewares globais */
  router.use(createRateLimiter({ enabled, windowMs: 60_000, max: 600 }));
  router.use((ctx) => {
    const token = ctx.cookies[COOKIE];
    ctx.user = token ? auth.authenticate(token) : null;
  });

  const requireAuth = (...roles) => (ctx) => {
    if (!ctx.user) throw new AppError(401, 'UNAUTHENTICATED', 'Faça login para continuar.');
    if (roles.length && !roles.includes(ctx.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação.');
    }
  };
  const authLimiter = createRateLimiter({ enabled, windowMs: 15 * 60_000, max: 40 });
  const loginLimiter = createRateLimiter({
    enabled, windowMs: 15 * 60_000, max: 10,
    key: (ctx) => `${ctx.ip}|${String(ctx.body?.email || '').toLowerCase()}`,
  });

  const startSession = (ctx, user) => ctx.setCookie(COOKIE, auth.issueToken(user), { maxAge: auth.SESSION_SECONDS });

  /* ------------------------------------------------------- Público */
  router.get('/api/config', () => ({
    max_delivery_km: MAX_DELIVERY_KM,
    payment_methods: orders.paymentMethods(),
    timezone: config.timezone,
  }));
  router.get('/api/catalog/categories', () => ({ categories: catalog.listCategories() }));
  router.get('/api/catalog/restaurants', (ctx) => catalog.listRestaurants(ctx.query));
  router.get('/api/catalog/promotions', (ctx) => ({ promotions: catalog.listPromotions(ctx.query) }));
  router.get('/api/catalog/restaurants/:id', (ctx) => catalog.getRestaurant(ctx.params.id, ctx.query));
  router.get('/api/catalog/restaurants/:id/reviews', (ctx) => ({ reviews: catalog.listReviews(ctx.params.id) }));

  /* ---------------------------------------------------------- Auth */
  router.post('/api/auth/register', authLimiter, async (ctx) => {
    const u = await auth.register(ctx.body);
    startSession(ctx, u);
    ctx.status = 201;
    return { user: auth.publicUser(u) };
  });
  router.post('/api/auth/login', loginLimiter, async (ctx) => {
    const u = await auth.login(ctx.body);
    startSession(ctx, u);
    return { user: auth.publicUser(u) };
  });
  router.post('/api/auth/logout', (ctx) => {
    ctx.clearCookie(COOKIE);
    return { ok: true };
  });
  router.get('/api/auth/me', (ctx) => ({ user: ctx.user ? auth.publicUser(ctx.user) : null }));
  router.post('/api/auth/forgot', authLimiter, async (ctx) => {
    await auth.forgotPassword(ctx.body);
    return { ok: true, message: 'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.' };
  });
  router.post('/api/auth/reset', authLimiter, async (ctx) => {
    await auth.resetPassword(ctx.body);
    return { ok: true };
  });
  router.post('/api/auth/password', requireAuth(), async (ctx) => {
    const u = await auth.changePassword(ctx.user, ctx.body);
    startSession(ctx, u); // a troca de senha invalida as demais sessões
    return { ok: true };
  });
  router.patch('/api/me', requireAuth(), (ctx) => ({ user: auth.publicUser(auth.updateProfile(ctx.user, ctx.body)) }));

  /* ------------------------------------------------------ Endereços */
  router.get('/api/me/addresses', requireAuth('cliente'), (ctx) => ({ addresses: addresses.list(ctx.user) }));
  router.post('/api/me/addresses', requireAuth('cliente'), async (ctx) => {
    ctx.status = 201;
    return addresses.create(ctx.user, ctx.body);
  });
  router.put('/api/me/addresses/:id', requireAuth('cliente'), (ctx) => addresses.update(ctx.user, ctx.params.id, ctx.body));
  router.delete('/api/me/addresses/:id', requireAuth('cliente'), (ctx) => {
    addresses.remove(ctx.user, ctx.params.id);
    return { ok: true };
  });

  /* -------------------------------------------------------- Pedidos */
  router.post('/api/orders/quote', requireAuth('cliente'), (ctx) => orders.quote(ctx.user, ctx.body));
  router.post('/api/orders', requireAuth('cliente'), async (ctx) => {
    const r = await orders.createOrder(ctx.user, ctx.body);
    ctx.status = r.duplicate ? 200 : 201;
    return r;
  });
  router.get('/api/orders', requireAuth('cliente'), (ctx) => ({ orders: orders.listForCustomer(ctx.user) }));
  router.get('/api/orders/:id', requireAuth(), (ctx) => ({ order: orders.getOrder(ctx.user, ctx.params.id) }));
  router.post('/api/orders/:id/status', requireAuth(), (ctx) => ({ order: orders.changeStatus(ctx.user, ctx.params.id, ctx.body) }));
  router.post('/api/orders/:id/accept-delivery', requireAuth('entregador'), (ctx) => ({ order: orders.acceptDelivery(ctx.user, ctx.params.id) }));
  router.post('/api/orders/:id/release-delivery', requireAuth('entregador'), (ctx) => orders.releaseDelivery(ctx.user, ctx.params.id));
  router.post('/api/orders/:id/review', requireAuth('cliente'), (ctx) => ({ order: orders.review(ctx.user, ctx.params.id, ctx.body) }));

  /* ------------------------------------------------ Loja (restaurante) */
  const S = requireAuth('estabelecimento');
  router.get('/api/store', S, (ctx) => store.getStore(ctx.user));
  router.post('/api/store', S, async (ctx) => {
    ctx.status = 201;
    return store.createStore(ctx.user, ctx.body);
  });
  router.patch('/api/store', S, (ctx) => store.updateStore(ctx.user, ctx.body));
  router.put('/api/store/images', S, (ctx) => store.setImages(ctx.user, ctx.body, ctx.files));
  router.get('/api/store/hours', S, (ctx) => ({ hours: store.getHours(ctx.user) }));
  router.put('/api/store/hours', S, (ctx) => ({ hours: store.setHours(ctx.user, ctx.body) }));
  router.get('/api/store/sections', S, (ctx) => ({ sections: store.listSections(ctx.user) }));
  router.post('/api/store/sections', S, (ctx) => {
    ctx.status = 201;
    return { section: store.createSection(ctx.user, ctx.body) };
  });
  router.put('/api/store/sections/:id', S, (ctx) => ({ section: store.updateSection(ctx.user, ctx.params.id, ctx.body) }));
  router.delete('/api/store/sections/:id', S, (ctx) => {
    store.deleteSection(ctx.user, ctx.params.id);
    return { ok: true };
  });
  router.get('/api/store/products', S, (ctx) => ({ products: store.listProducts(ctx.user) }));
  router.post('/api/store/products', S, async (ctx) => {
    ctx.status = 201;
    return { product: await store.createProduct(ctx.user, ctx.body, ctx.files) };
  });
  router.put('/api/store/products/:id', S, async (ctx) => ({ product: await store.updateProduct(ctx.user, ctx.params.id, ctx.body, ctx.files) }));
  router.patch('/api/store/products/:id/availability', S, (ctx) => ({ product: store.setAvailability(ctx.user, ctx.params.id, ctx.body) }));
  router.delete('/api/store/products/:id', S, async (ctx) => {
    await store.deleteProduct(ctx.user, ctx.params.id);
    return { ok: true };
  });
  router.get('/api/store/orders', S, (ctx) => ({ orders: orders.listForRestaurant(ctx.user, ctx.query.scope === 'history' ? 'history' : 'active') }));
  router.get('/api/store/reviews', S, (ctx) => ({ reviews: store.listReviews(ctx.user) }));

  /* ------------------------------------------------------ Entregador */
  const C = requireAuth('entregador');
  router.get('/api/courier/profile', C, (ctx) => ({ profile: courier.getProfile(ctx.user) }));
  router.patch('/api/courier/profile', C, (ctx) => ({ profile: courier.updateProfile(ctx.user, ctx.body) }));
  router.get('/api/courier/deliveries/available', C, (ctx) => orders.listAvailableForCourier(ctx.user));
  router.get('/api/courier/deliveries', C, (ctx) => ({ orders: orders.listForCourier(ctx.user, ctx.query.scope === 'history' ? 'history' : 'active') }));

  /* --------------------------------------------------- Administração */
  const A = requireAuth('admin');
  router.get('/api/admin/stats', A, () => admin.stats());
  router.get('/api/admin/users', A, (ctx) => ({ users: admin.listUsers(ctx.query) }));
  router.patch('/api/admin/users/:id', A, (ctx) => ({ user: admin.updateUser(ctx.user, ctx.params.id, ctx.body) }));
  router.get('/api/admin/restaurants', A, (ctx) => ({ restaurants: admin.listRestaurants(ctx.query) }));
  router.patch('/api/admin/restaurants/:id', A, (ctx) => ({ restaurant: admin.updateRestaurant(ctx.params.id, ctx.body) }));
  router.get('/api/admin/orders', A, (ctx) => ({ orders: orders.listAll(ctx.user, ctx.query) }));
  router.post('/api/admin/orders/:id/confirm-payment', A, (ctx) => ({ order: orders.adminConfirmPayment(ctx.user, ctx.params.id) }));
  router.get('/api/admin/settings', A, () => admin.settings());

  /* --------------------------------- Webhook de pagamento (assinado) */
  router.post('/api/payments/webhook', noCsrf, (ctx) => {
    if (!config.paymentWebhookSecret) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Pagamento online não configurado.');
    const given = Buffer.from(String(ctx.req.headers['x-signature'] || ''), 'hex');
    const expected = crypto.createHmac('sha256', config.paymentWebhookSecret).update(ctx.rawBody).digest();
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Assinatura inválida.');
    }
    const orderCode = v.str(ctx.body, 'order_code', { label: 'Pedido', max: 20 });
    const status = v.oneOf(ctx.body, 'status', ['paid', 'failed'], { label: 'Status' });
    const amountCents = v.int(ctx.body, 'amount_cents', { label: 'Valor', min: 0, optional: status === 'failed' });
    const providerRef = v.str(ctx.body, 'provider_ref', { label: 'Referência', optional: true, max: 80 });
    return { ok: true, ...orders.applyPaymentResult({ orderCode, status, amountCents, providerRef }) };
  });
}

module.exports = { registerRoutes, COOKIE };
