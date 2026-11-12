'use strict';
const { AppError } = require('../lib/errors');
const v = require('../lib/validate');
const { isValidCoord } = require('../domain/geo');
const { MAX_DELIVERY_KM } = require('../domain/delivery');
const { isOpenAt } = require('../domain/hours');
const { imageUrl, nowIso, idParam } = require('./common');

const esc = (s) => String(s).slice(0, 40).replace(/[\\%_]/g, (m) => `\\${m}`);

function createAdminService({ db, config, now, geocoder, mailer }) {
  function localDay(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function stats() {
    const users = db.all('SELECT role, COUNT(*) AS c, SUM(active) AS a FROM users GROUP BY role');
    const byStatus = db.all('SELECT status, COUNT(*) AS c FROM orders GROUP BY status');
    const delivered = db.get("SELECT COUNT(*) AS c, COALESCE(SUM(total_cents),0) AS s FROM orders WHERE status = 'entregue'");
    const since24h = new Date(now().getTime() - 24 * 3600 * 1000).toISOString();
    const last24 = db.get('SELECT COUNT(*) AS c FROM orders WHERE created_at >= ?', since24h).c;
    const restaurants = db.get(
      `SELECT COUNT(*) AS total, SUM(active) AS active,
              SUM(CASE WHEN lat IS NULL OR lng IS NULL THEN 1 ELSE 0 END) AS no_location FROM restaurants`,
    );
    const rating = db.get('SELECT ROUND(AVG(rating),2) AS avg, COUNT(*) AS c FROM reviews');

    const days = Array.from({ length: 7 }, (_, i) => localDay(new Date(now().getTime() - (6 - i) * 24 * 3600 * 1000)));
    const series = new Map(days.map((d) => [d, { date: d, orders: 0, revenue_cents: 0 }]));
    const recent = db.all('SELECT created_at, total_cents, status FROM orders WHERE created_at >= ?',
      new Date(now().getTime() - 8 * 24 * 3600 * 1000).toISOString());
    for (const o of recent) {
      const bucket = series.get(localDay(new Date(o.created_at)));
      if (!bucket) continue;
      bucket.orders += 1;
      if (o.status === 'entregue') bucket.revenue_cents += o.total_cents;
    }
    const top = db.all(
      `SELECT r.id, r.name, COUNT(*) AS delivered, SUM(o.total_cents) AS revenue_cents
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id WHERE o.status = 'entregue'
       GROUP BY r.id ORDER BY delivered DESC, revenue_cents DESC LIMIT 5`,
    );
    return {
      users: users.map((u) => ({ role: u.role, total: u.c, active: u.a || 0 })),
      orders: {
        by_status: Object.fromEntries(byStatus.map((s) => [s.status, s.c])),
        delivered_count: delivered.c, delivered_revenue_cents: delivered.s, last_24h: last24,
      },
      restaurants: { total: restaurants.total, active: restaurants.active || 0, without_location: restaurants.no_location || 0 },
      rating: { average: rating.avg, count: rating.c },
      daily: [...series.values()],
      top_restaurants: top,
    };
  }

  function listUsers(query) {
    const where = [];
    const params = [];
    if (['cliente', 'estabelecimento', 'entregador', 'admin'].includes(query.role)) { where.push('u.role = ?'); params.push(query.role); }
    if (query.active === '0' || query.active === '1') { where.push('u.active = ?'); params.push(Number(query.active)); }
    if (query.q) {
      where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
      params.push(`%${esc(query.q)}%`, `%${esc(query.q)}%`);
    }
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 300);
    return db.all(
      `SELECT u.id, u.role, u.name, u.email, u.phone, u.active, u.created_at, r.name AS restaurant_name
       FROM users u LEFT JOIN restaurants r ON r.owner_id = u.id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY u.id DESC LIMIT ?`, ...params, limit,
    ).map((u) => ({ ...u, active: Boolean(u.active) }));
  }

  function updateUser(admin, idRaw, body) {
    const id = idParam(idRaw);
    const target = db.get('SELECT * FROM users WHERE id = ?', id);
    if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'Usuário não encontrado.');
    const active = v.bool(body, 'active', null);
    const role = v.oneOf(body, 'role', ['cliente', 'estabelecimento', 'entregador', 'admin'], { label: 'Perfil', optional: true });
    if (id === admin.id && ((active !== null && active !== Boolean(target.active)) || (role && role !== target.role))) {
      throw new AppError(409, 'SELF_CHANGE', 'Você não pode alterar a própria conta de administrador.');
    }
    if (role && role !== target.role) {
      const allowed = ['cliente', 'admin'];
      if (!allowed.includes(target.role) || !allowed.includes(role)) {
        throw new AppError(409, 'ROLE_CHANGE_NOT_ALLOWED', 'Só é possível alternar entre os perfis Cliente e Administrador.');
      }
    }
    db.run('UPDATE users SET active = ?, role = ?, updated_at = ? WHERE id = ?',
      active === null ? target.active : active, role ?? target.role, nowIso(), id);
    const u = db.get('SELECT id, role, name, email, phone, active FROM users WHERE id = ?', id);
    return { ...u, active: Boolean(u.active) };
  }

  function listRestaurants(query) {
    const where = [];
    const params = [];
    if (query.q) { where.push("r.name LIKE ? ESCAPE '\\'"); params.push(`%${esc(query.q)}%`); }
    if (query.active === '0' || query.active === '1') { where.push('r.active = ?'); params.push(Number(query.active)); }
    const hoursRows = db.all('SELECT restaurant_id, weekday, opens, closes FROM opening_hours');
    const hoursBy = new Map();
    for (const h of hoursRows) { if (!hoursBy.has(h.restaurant_id)) hoursBy.set(h.restaurant_id, []); hoursBy.get(h.restaurant_id).push(h); }
    return db.all(
      `SELECT r.id, r.name, r.city, r.neighborhood, r.active, r.accepting_orders, r.lat, r.lng, r.coords_source, r.logo_path,
              u.name AS owner_name, u.email AS owner_email, u.active AS owner_active,
              (SELECT COUNT(*) FROM products p WHERE p.restaurant_id = r.id) AS products,
              (SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id) AS orders,
              (SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id AND o.status NOT IN ('entregue','cancelado')) AS open_orders,
              (SELECT ROUND(AVG(rating),1) FROM reviews rv WHERE rv.restaurant_id = r.id) AS rating_avg
       FROM restaurants r JOIN users u ON u.id = r.owner_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT 300`, ...params,
    ).map((r) => ({
      id: r.id, name: r.name, city: r.city, neighborhood: r.neighborhood, active: Boolean(r.active),
      accepting_orders: Boolean(r.accepting_orders),
      // "aberto agora" = horário de funcionamento + pausa do próprio restaurante (conceito distinto de "ativo na plataforma")
      open_now: Boolean(r.accepting_orders) && isOpenAt(hoursBy.get(r.id) || [], now(), config.timezone),
      has_coords: isValidCoord(r.lat, r.lng), coords_source: r.coords_source,
      logo_url: imageUrl(r.logo_path), owner_name: r.owner_name, owner_email: r.owner_email, owner_active: Boolean(r.owner_active),
      products: r.products, orders: r.orders, open_orders: r.open_orders, rating_avg: r.rating_avg,
    }));
  }

  function updateRestaurant(idRaw, body) {
    const id = idParam(idRaw);
    if (!db.get('SELECT 1 AS x FROM restaurants WHERE id = ?', id)) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurante não encontrado.');
    const active = v.bool(body, 'active');
    if (active === null) v.fail('active', 'Informe o estado do restaurante.');
    db.run('UPDATE restaurants SET active = ?, updated_at = ? WHERE id = ?', active, nowIso(), id);
    return { id, active };
  }

  /** Parâmetros operacionais (somente leitura): a regra de 15 km é fixa no código. */
  function settings() {
    return {
      delivery: {
        max_km: MAX_DELIVERY_KM, inclusive: true, method: 'Linha reta (Haversine)',
        reference: 'Estabelecimento → endereço de entrega do cliente', rounding: 'metro mais próximo',
        validated_on: 'backend (cotação e checkout)',
      },
      timezone: config.timezone,
      geocoder: { provider: config.geocoderProvider, enabled: geocoder.enabled },
      device_coords_allowed: config.allowDeviceCoords,
      online_payment_enabled: config.onlinePaymentEnabled,
      mailer_enabled: mailer.enabled,
      environment: config.isProd ? 'produção' : 'desenvolvimento',
    };
  }

  return { stats, listUsers, updateUser, listRestaurants, updateRestaurant, settings };
}

module.exports = { createAdminService };
