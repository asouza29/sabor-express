'use strict';
const { AppError } = require('../lib/errors');
const { isValidCoord, boundingBox } = require('../domain/geo');
const {
  evaluateDelivery, deliveryMessage, kmLabel, MAX_DELIVERY_METERS, MAX_DELIVERY_KM,
} = require('../domain/delivery');
const { effectivePrice, hasPromo } = require('../domain/pricing');
const { isOpenAt } = require('../domain/hours');
const { imageUrl, idParam } = require('./common');

const escLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function createCatalogService({ db, config, now }) {
  function locationFrom(query) {
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (query.lat === undefined || query.lng === undefined || !isValidCoord(lat, lng)) {
      throw new AppError(400, 'LOCATION_REQUIRED', 'Informe sua localização de entrega para ver os restaurantes disponíveis.');
    }
    return { lat, lng };
  }

  function loadHours(ids) {
    const map = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return map;
    const rows = db.all(`SELECT * FROM opening_hours WHERE restaurant_id IN (${ids.map(() => '?').join(',')})`, ...ids);
    rows.forEach((r) => map.get(r.restaurant_id).push(r));
    return map;
  }

  function scheduleState(r, hours) {
    const open = isOpenAt(hours, now(), config.timezone);
    const status = !r.accepting_orders ? 'paused' : open ? 'open' : 'closed';
    return { status, is_open: status === 'open' };
  }

  const card = (r, distanceMeters, hours) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category_id ? { id: r.category_id, name: r.category_name, slug: r.category_slug, emoji: r.category_emoji } : null,
    logo_url: imageUrl(r.logo_path),
    cover_url: imageUrl(r.cover_path),
    rating_avg: r.rating_avg,
    rating_count: r.rating_count,
    prep_time_min: r.prep_time_min,
    delivery_fee_cents: r.delivery_fee_cents,
    min_order_cents: r.min_order_cents,
    neighborhood: r.neighborhood,
    city: r.city,
    distance_m: distanceMeters,
    distance_km: kmLabel(distanceMeters),
    has_promo: r.promo_count > 0,
    ...scheduleState(r, hours),
  });

  const BASE_SELECT = `
    SELECT r.*, c.name AS category_name, c.slug AS category_slug, c.emoji AS category_emoji,
      (SELECT ROUND(AVG(rating), 1) FROM reviews rv WHERE rv.restaurant_id = r.id) AS rating_avg,
      (SELECT COUNT(*) FROM reviews rv WHERE rv.restaurant_id = r.id) AS rating_count,
      (SELECT COUNT(*) FROM products p WHERE p.restaurant_id = r.id AND p.available = 1) AS product_count,
      (SELECT COUNT(*) FROM products p WHERE p.restaurant_id = r.id AND p.available = 1
         AND p.promo_price_cents IS NOT NULL AND p.promo_price_cents < p.price_cents) AS promo_count
    FROM restaurants r
    JOIN users u ON u.id = r.owner_id
    LEFT JOIN food_categories c ON c.id = r.category_id
    WHERE r.active = 1 AND u.active = 1`;

  /** Restaurantes que atendem a localização (raio de 15 km) — filtro de exibição; o checkout revalida no backend. */
  function listRestaurants(query) {
    const { lat, lng } = locationFrom(query);
    const box = boundingBox(lat, lng, MAX_DELIVERY_METERS);
    const where = [' AND r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?'];
    const params = [box.minLat, box.maxLat, box.minLng, box.maxLng];

    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '';
    if (q) {
      where.push(` AND (r.name LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM products p WHERE p.restaurant_id = r.id AND p.available = 1 AND p.name LIKE ? ESCAPE '\\'))`);
      const like = `%${escLike(q)}%`;
      params.push(like, like, like);
    }
    if (typeof query.category === 'string' && query.category) {
      where.push(' AND c.slug = ?');
      params.push(query.category.slice(0, 40));
    }

    const rows = db.all(`${BASE_SELECT}${where.join('')}`, ...params);
    const hours = loadHours(rows.map((r) => r.id));
    let out = [];
    for (const r of rows) {
      if (r.product_count === 0) continue; // sem produto cadastrado não há pedido possível
      const ev = evaluateDelivery({ lat: r.lat, lng: r.lng }, { lat, lng });
      if (!ev.ok) continue;
      out.push(card(r, ev.distanceMeters, hours.get(r.id)));
    }
    if (query.open === '1' || query.open === 'true') out = out.filter((r) => r.is_open);

    const sorters = {
      distance: (a, b) => a.distance_m - b.distance_m,
      rating: (a, b) => (b.rating_avg ?? 0) - (a.rating_avg ?? 0) || a.distance_m - b.distance_m,
      time: (a, b) => a.prep_time_min - b.prep_time_min || a.distance_m - b.distance_m,
      fee: (a, b) => a.delivery_fee_cents - b.delivery_fee_cents || a.distance_m - b.distance_m,
      relevance: (a, b) => Number(b.is_open) - Number(a.is_open) || a.distance_m - b.distance_m,
    };
    out.sort(sorters[query.sort] || sorters.relevance);
    return { max_delivery_km: MAX_DELIVERY_KM, restaurants: out };
  }

  function listPromotions(query) {
    const { lat, lng } = locationFrom(query);
    const box = boundingBox(lat, lng, MAX_DELIVERY_METERS);
    const rows = db.all(
      `SELECT p.*, r.id AS rid, r.name AS rname, r.lat AS rlat, r.lng AS rlng, r.accepting_orders AS raccepting,
              r.logo_path AS rlogo
       FROM products p
       JOIN restaurants r ON r.id = p.restaurant_id
       JOIN users u ON u.id = r.owner_id
       WHERE r.active = 1 AND u.active = 1 AND p.available = 1
         AND p.promo_price_cents IS NOT NULL AND p.promo_price_cents < p.price_cents
         AND r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?`,
      box.minLat, box.maxLat, box.minLng, box.maxLng,
    );
    const hours = loadHours([...new Set(rows.map((r) => r.rid))]);
    const out = [];
    for (const p of rows) {
      const ev = evaluateDelivery({ lat: p.rlat, lng: p.rlng }, { lat, lng });
      if (!ev.ok) continue;
      const st = scheduleState({ accepting_orders: p.raccepting }, hours.get(p.rid));
      out.push({
        product_id: p.id, name: p.name, image_url: imageUrl(p.image_path),
        price_cents: p.price_cents, promo_price_cents: p.promo_price_cents,
        restaurant: { id: p.rid, name: p.rname, logo_url: imageUrl(p.rlogo), distance_km: kmLabel(ev.distanceMeters), status: st.status },
        _d: ev.distanceMeters, _open: st.is_open,
      });
    }
    out.sort((a, b) => Number(b._open) - Number(a._open) || a._d - b._d);
    return out.slice(0, 12).map(({ _d, _open, ...rest }) => rest);
  }

  function listCategories() {
    return db.all('SELECT id, name, slug, emoji FROM food_categories ORDER BY position, id');
  }

  function getRestaurant(idRaw, query) {
    const id = idParam(idRaw);
    const r = db.get(`${BASE_SELECT} AND r.id = ?`, id);
    if (!r) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurante não encontrado.');
    const hours = db.all('SELECT weekday, opens, closes FROM opening_hours WHERE restaurant_id = ? ORDER BY weekday', id);
    const sched = scheduleState(r, hours);

    const sections = db.all('SELECT id, name FROM menu_sections WHERE restaurant_id = ? ORDER BY position, id', id);
    const products = db.all('SELECT * FROM products WHERE restaurant_id = ? ORDER BY id', id);
    const options = db.all(
      `SELECT o.* FROM product_options o JOIN products p ON p.id = o.product_id WHERE p.restaurant_id = ? ORDER BY o.id`, id,
    );
    const optsByProduct = new Map();
    options.forEach((o) => {
      if (!optsByProduct.has(o.product_id)) optsByProduct.set(o.product_id, []);
      optsByProduct.get(o.product_id).push({ id: o.id, name: o.name, price_cents: o.price_cents, available: Boolean(o.available) });
    });
    const shape = (p) => ({
      id: p.id, name: p.name, description: p.description, image_url: imageUrl(p.image_path),
      price_cents: p.price_cents,
      promo_price_cents: hasPromo(p) ? p.promo_price_cents : null,
      final_price_cents: effectivePrice(p),
      available: Boolean(p.available),
      options: optsByProduct.get(p.id) || [],
    });
    const menu = sections.map((s) => ({ id: s.id, name: s.name, products: products.filter((p) => p.section_id === s.id).map(shape) }));
    const loose = products.filter((p) => !sections.some((s) => s.id === p.section_id)).map(shape);
    if (loose.length) menu.push({ id: null, name: menu.length ? 'Outros' : 'Cardápio', products: loose });

    let delivery = { checked: false, max_km: MAX_DELIVERY_KM };
    if (query && query.lat !== undefined && query.lng !== undefined) {
      const lat = Number(query.lat);
      const lng = Number(query.lng);
      const ev = evaluateDelivery({ lat: r.lat, lng: r.lng }, { lat, lng });
      delivery = {
        checked: true, max_km: MAX_DELIVERY_KM, ok: ev.ok, code: ev.code,
        distance_km: ev.distanceMeters == null ? null : kmLabel(ev.distanceMeters),
        message: ev.ok ? null : deliveryMessage(ev.code, ev.distanceMeters),
      };
    }

    return {
      restaurant: {
        id: r.id, name: r.name, description: r.description, phone: r.phone,
        category: r.category_id ? { id: r.category_id, name: r.category_name, slug: r.category_slug, emoji: r.category_emoji } : null,
        logo_url: imageUrl(r.logo_path), cover_url: imageUrl(r.cover_path),
        rating_avg: r.rating_avg, rating_count: r.rating_count,
        prep_time_min: r.prep_time_min, delivery_fee_cents: r.delivery_fee_cents, min_order_cents: r.min_order_cents,
        neighborhood: r.neighborhood, city: r.city, state: r.state,
        ...sched, hours,
      },
      menu,
      delivery,
    };
  }

  function listReviews(idRaw) {
    const id = idParam(idRaw);
    const rows = db.all(
      `SELECT rv.rating, rv.comment, rv.created_at, u.name FROM reviews rv JOIN users u ON u.id = rv.customer_id
       WHERE rv.restaurant_id = ? ORDER BY rv.id DESC LIMIT 30`, id,
    );
    return rows.map((r) => ({ rating: r.rating, comment: r.comment, created_at: r.created_at, author: r.name.split(' ')[0] }));
  }

  return { listRestaurants, listPromotions, listCategories, getRestaurant, listReviews, loadHours, scheduleState };
}

module.exports = { createCatalogService };
