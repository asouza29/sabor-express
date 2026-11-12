'use strict';
const { AppError } = require('../lib/errors');
const v = require('../lib/validate');
const { isValidCoord } = require('../domain/geo');
const { effectivePrice, hasPromo } = require('../domain/pricing');
const { imageUrl, nowIso, idParam } = require('./common');

const ADDRESS_KEYS = ['street', 'number', 'neighborhood', 'city', 'state', 'zip'];

function createRestaurantService({ db, geo, uploads, catalog }) {
  const own = (user) => db.get('SELECT * FROM restaurants WHERE owner_id = ?', user.id);
  function requireStore(user) {
    const r = own(user);
    if (!r) throw new AppError(404, 'STORE_NOT_FOUND', 'Cadastre sua loja para continuar.');
    return r;
  }

  const storePub = (r) => ({
    id: r.id, name: r.name, description: r.description, category_id: r.category_id, phone: r.phone,
    street: r.street, number: r.number, complement: r.complement, neighborhood: r.neighborhood,
    city: r.city, state: r.state, zip: r.zip,
    lat: r.lat, lng: r.lng, coords_source: r.coords_source, has_coords: isValidCoord(r.lat, r.lng),
    delivery_fee_cents: r.delivery_fee_cents, min_order_cents: r.min_order_cents, prep_time_min: r.prep_time_min,
    logo_url: imageUrl(r.logo_path), cover_url: imageUrl(r.cover_path),
    accepting_orders: Boolean(r.accepting_orders), active: Boolean(r.active),
  });

  /* ------------------------------------------------------------- Loja */

  const STORE_FIELDS = [
    ['name', (b) => v.str(b, 'name', { label: 'Nome da loja', min: 2, max: 80 }), true],
    ['description', (b) => v.str(b, 'description', { label: 'Descrição', optional: true, max: 300 }), false],
    ['category_id', (b) => {
      const id = v.int(b, 'category_id', { label: 'Categoria', optional: true, min: 1 });
      if (id != null && !db.get('SELECT 1 AS x FROM food_categories WHERE id = ?', id)) v.fail('category_id', 'Categoria inválida.');
      return id;
    }, false],
    ['phone', (b) => v.phone(b, 'phone'), true],
    ['street', (b) => v.str(b, 'street', { label: 'Rua', max: 120 }), true],
    ['number', (b) => v.str(b, 'number', { label: 'Número', max: 20 }), true],
    ['complement', (b) => v.str(b, 'complement', { label: 'Complemento', optional: true, max: 60 }), false],
    ['neighborhood', (b) => v.str(b, 'neighborhood', { label: 'Bairro', max: 80 }), true],
    ['city', (b) => v.str(b, 'city', { label: 'Cidade', max: 80 }), true],
    ['state', (b) => v.uf(b, 'state'), true],
    ['zip', (b) => v.zip(b, 'zip'), false],
    ['delivery_fee_cents', (b) => v.int(b, 'delivery_fee_cents', { label: 'Taxa de entrega', min: 0, max: 50000 }), false],
    ['min_order_cents', (b) => v.int(b, 'min_order_cents', { label: 'Pedido mínimo', min: 0, max: 500000 }), false],
    ['prep_time_min', (b) => v.int(b, 'prep_time_min', { label: 'Tempo de preparo', min: 5, max: 240 }), false],
    ['accepting_orders', (b) => v.bool(b, 'accepting_orders', true), false],
  ];

  function checklist(r) {
    const hasHours = db.get('SELECT COUNT(*) AS c FROM opening_hours WHERE restaurant_id = ?', r.id).c > 0;
    const hasProducts = db.get('SELECT COUNT(*) AS c FROM products WHERE restaurant_id = ? AND available = 1', r.id).c > 0;
    const hasLocation = isValidCoord(r.lat, r.lng);
    return {
      has_store: true, has_location: hasLocation, has_hours: hasHours, has_products: hasProducts,
      ready: hasLocation && hasHours && hasProducts,
    };
  }

  function getStore(user) {
    const r = own(user);
    if (!r) return { store: null, onboarding: { has_store: false, has_location: false, has_hours: false, has_products: false, ready: false } };
    return { store: storePub(r), onboarding: checklist(r) };
  }

  async function createStore(user, body) {
    if (own(user)) throw new AppError(409, 'STORE_EXISTS', 'Você já possui uma loja cadastrada.');
    const f = {};
    for (const [key, parse, required] of STORE_FIELDS) {
      if (required || key in body) f[key] = parse(body);
    }
    f.category_id ??= null;
    f.delivery_fee_cents ??= 0;
    f.min_order_cents ??= 0;
    f.prep_time_min ??= 30;
    f.accepting_orders ??= true;
    const deviceLat = v.num(body, 'device_lat', { label: 'Latitude', min: -90, max: 90, optional: true });
    const deviceLng = v.num(body, 'device_lng', { label: 'Longitude', min: -180, max: 180, optional: true });
    const { coords, geoError } = await geo.resolveCoordinates(geo.addressText(f), deviceLat, deviceLng);

    const id = db.tx(() => {
      if (own(user)) throw new AppError(409, 'STORE_EXISTS', 'Você já possui uma loja cadastrada.');
      const r = db.run(
        `INSERT INTO restaurants (owner_id, name, description, category_id, phone, street, number, complement, neighborhood,
           city, state, zip, lat, lng, coords_source, delivery_fee_cents, min_order_cents, prep_time_min, accepting_orders, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        user.id, f.name, f.description ?? null, f.category_id, f.phone, f.street, f.number, f.complement ?? null, f.neighborhood,
        f.city, f.state, f.zip ?? null, coords?.lat, coords?.lng, coords?.source, f.delivery_fee_cents, f.min_order_cents,
        f.prep_time_min, f.accepting_orders, nowIso(),
      );
      // Horário padrão (seg–dom, 10:00–22:00) para o dono ajustar.
      for (let d = 0; d < 7; d++) db.run('INSERT INTO opening_hours (restaurant_id, weekday, opens, closes) VALUES (?,?,?,?)', r.id, d, '10:00', '22:00');
      return r.id;
    });
    const row = db.get('SELECT * FROM restaurants WHERE id = ?', id);
    return { store: storePub(row), onboarding: checklist(row), location_confirmed: Boolean(coords), geo_unavailable: !coords && geoError };
  }

  async function updateStore(user, body) {
    const current = requireStore(user);
    const changes = {};
    for (const [key, parse] of STORE_FIELDS) {
      if (key in body) changes[key] = parse(body);
    }
    const deviceLat = v.num(body, 'device_lat', { label: 'Latitude', min: -90, max: 90, optional: true });
    const deviceLng = v.num(body, 'device_lng', { label: 'Longitude', min: -180, max: 180, optional: true });
    const deviceProvided = deviceLat != null && deviceLng != null;
    const addressChanged = ADDRESS_KEYS.some((k) => k in changes && (changes[k] ?? null) !== (current[k] ?? null));

    let confirmed = isValidCoord(current.lat, current.lng);
    let geoError = false;
    if (addressChanged || deviceProvided) {
      const merged = { ...current, ...changes };
      const r = await geo.resolveCoordinates(geo.addressText(merged), deviceLat, deviceLng);
      changes.lat = r.coords?.lat ?? null; // coordenadas antigas nunca sobrevivem a uma troca de endereço
      changes.lng = r.coords?.lng ?? null;
      changes.coords_source = r.coords?.source ?? null;
      confirmed = Boolean(r.coords);
      geoError = r.geoError;
    }
    const keys = Object.keys(changes);
    if (keys.length) {
      db.run(
        `UPDATE restaurants SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...keys.map((k) => changes[k]), nowIso(), current.id,
      );
    }
    const row = db.get('SELECT * FROM restaurants WHERE id = ?', current.id);
    return { store: storePub(row), onboarding: checklist(row), location_confirmed: confirmed, geo_unavailable: !confirmed && geoError };
  }

  async function setImages(user, body, files) {
    const r = requireStore(user);
    const updates = {};
    const toDelete = [];
    for (const [field, col] of [['logo', 'logo_path'], ['cover', 'cover_path']]) {
      if (files[field]) {
        updates[col] = await uploads.save(files[field]);
        toDelete.push(r[col]);
      } else if (v.bool(body, `remove_${field}`, false)) {
        updates[col] = null;
        toDelete.push(r[col]);
      }
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      db.run(`UPDATE restaurants SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => updates[k]), nowIso(), r.id);
      await Promise.all(toDelete.map((p) => uploads.remove(p)));
    }
    return getStore(user);
  }

  /* --------------------------------------------------------- Horários */

  function getHours(user) {
    const r = requireStore(user);
    const rows = db.all('SELECT weekday, opens, closes FROM opening_hours WHERE restaurant_id = ?', r.id);
    return Array.from({ length: 7 }, (_, d) => {
      const row = rows.find((x) => x.weekday === d);
      return { weekday: d, closed: !row, opens: row?.opens ?? '10:00', closes: row?.closes ?? '22:00' };
    });
  }

  function setHours(user, body) {
    const r = requireStore(user);
    if (!Array.isArray(body.hours) || body.hours.length > 7) v.fail('hours', 'Horários inválidos.');
    const seen = new Set();
    const rows = [];
    for (const h of body.hours) {
      const weekday = v.int(h, 'weekday', { label: 'Dia da semana', min: 0, max: 6 });
      if (seen.has(weekday)) v.fail('hours', 'Dia da semana repetido.');
      seen.add(weekday);
      if (v.bool(h, 'closed', false)) continue;
      const opens = v.hhmm(h, 'opens', 'Abertura');
      const closes = v.hhmm(h, 'closes', 'Fechamento');
      if (opens === closes) v.fail('hours', 'Abertura e fechamento não podem ser iguais.');
      rows.push([weekday, opens, closes]);
    }
    db.tx(() => {
      db.run('DELETE FROM opening_hours WHERE restaurant_id = ?', r.id);
      rows.forEach(([d, o, c]) => db.run('INSERT INTO opening_hours (restaurant_id, weekday, opens, closes) VALUES (?,?,?,?)', r.id, d, o, c));
    });
    return getHours(user);
  }

  /* ----------------------------------------------------------- Seções */

  function listSections(user) {
    const r = requireStore(user);
    return db.all('SELECT id, name, position FROM menu_sections WHERE restaurant_id = ? ORDER BY position, id', r.id);
  }

  function createSection(user, body) {
    const r = requireStore(user);
    const name = v.str(body, 'name', { label: 'Nome da seção', max: 60 });
    const pos = db.get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM menu_sections WHERE restaurant_id = ?', r.id).p;
    const res = db.run('INSERT INTO menu_sections (restaurant_id, name, position) VALUES (?,?,?)', r.id, name, pos);
    return db.get('SELECT id, name, position FROM menu_sections WHERE id = ?', res.id);
  }

  function ownSection(user, idRaw) {
    const r = requireStore(user);
    const s = db.get('SELECT * FROM menu_sections WHERE id = ? AND restaurant_id = ?', idParam(idRaw), r.id);
    if (!s) throw new AppError(404, 'SECTION_NOT_FOUND', 'Seção não encontrada.');
    return s;
  }

  function updateSection(user, idRaw, body) {
    const s = ownSection(user, idRaw);
    const name = v.str(body, 'name', { label: 'Nome da seção', max: 60 });
    const pos = v.int(body, 'position', { label: 'Posição', optional: true, min: 0, max: 1000 }) ?? s.position;
    db.run('UPDATE menu_sections SET name = ?, position = ? WHERE id = ?', name, pos, s.id);
    return db.get('SELECT id, name, position FROM menu_sections WHERE id = ?', s.id);
  }

  function deleteSection(user, idRaw) {
    const s = ownSection(user, idRaw);
    db.run('DELETE FROM menu_sections WHERE id = ?', s.id); // produtos ficam sem seção
  }

  /* --------------------------------------------------------- Produtos */

  const productPub = (p, options) => ({
    id: p.id, section_id: p.section_id, name: p.name, description: p.description,
    price_cents: p.price_cents, promo_price_cents: hasPromo(p) ? p.promo_price_cents : null,
    final_price_cents: effectivePrice(p),
    image_url: imageUrl(p.image_path), available: Boolean(p.available),
    options: options.map((o) => ({ id: o.id, name: o.name, price_cents: o.price_cents, available: Boolean(o.available) })),
  });

  function listProducts(user) {
    const r = requireStore(user);
    const products = db.all('SELECT * FROM products WHERE restaurant_id = ? ORDER BY id', r.id);
    const options = db.all('SELECT o.* FROM product_options o JOIN products p ON p.id = o.product_id WHERE p.restaurant_id = ? ORDER BY o.id', r.id);
    return products.map((p) => productPub(p, options.filter((o) => o.product_id === p.id)));
  }

  function ownProduct(user, idRaw) {
    const r = requireStore(user);
    const p = db.get('SELECT * FROM products WHERE id = ? AND restaurant_id = ?', idParam(idRaw), r.id);
    if (!p) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
    return p;
  }

  function parseOptions(raw) {
    if (raw === undefined) return undefined;
    let arr = raw;
    if (typeof raw === 'string') {
      try { arr = JSON.parse(raw); } catch { v.fail('options', 'Opções inválidas.'); }
    }
    if (!Array.isArray(arr) || arr.length > 20) v.fail('options', 'Opções inválidas (máximo de 20).');
    return arr.map((o) => {
      if (o === null || typeof o !== 'object') v.fail('options', 'Opções inválidas.');
      return {
        id: o.id == null || o.id === '' ? null : v.int(o, 'id'),
        name: v.str(o, 'name', { label: 'Nome da opção', max: 60 }),
        price_cents: v.int(o, 'price_cents', { label: 'Preço da opção', min: 0, max: 100000, optional: true }) ?? 0,
        available: v.bool(o, 'available', true),
      };
    });
  }

  function syncOptions(productId, opts) {
    const existing = new Set(db.all('SELECT id FROM product_options WHERE product_id = ?', productId).map((o) => o.id));
    const keep = new Set();
    for (const o of opts) {
      if (o.id != null && existing.has(o.id)) {
        db.run('UPDATE product_options SET name = ?, price_cents = ?, available = ? WHERE id = ? AND product_id = ?', o.name, o.price_cents, o.available, o.id, productId);
        keep.add(o.id);
      } else {
        const res = db.run('INSERT INTO product_options (product_id, name, price_cents, available) VALUES (?,?,?,?)', productId, o.name, o.price_cents, o.available);
        keep.add(res.id);
      }
    }
    for (const id of existing) if (!keep.has(id)) db.run('DELETE FROM product_options WHERE id = ?', id);
  }

  function parseProductFields(user, r, body, { partial }) {
    const out = {};
    const has = (k) => !partial || k in body;
    if (has('name')) out.name = v.str(body, 'name', { label: 'Nome do produto', max: 80 });
    if (has('description')) out.description = v.str(body, 'description', { label: 'Descrição', optional: true, max: 400 });
    if (has('price_cents')) out.price_cents = v.int(body, 'price_cents', { label: 'Preço', min: 1, max: 1_000_000 });
    if (has('promo_price_cents')) out.promo_price_cents = v.int(body, 'promo_price_cents', { label: 'Preço promocional', optional: true, min: 1, max: 1_000_000 });
    if (has('section_id')) {
      const sid = v.int(body, 'section_id', { label: 'Seção', optional: true, min: 1 });
      if (sid != null && !db.get('SELECT 1 AS x FROM menu_sections WHERE id = ? AND restaurant_id = ?', sid, r.id)) v.fail('section_id', 'Seção inválida.');
      out.section_id = sid;
    }
    if (has('available')) out.available = v.bool(body, 'available', true);
    return out;
  }

  async function createProduct(user, body, files) {
    const r = requireStore(user);
    const f = parseProductFields(user, r, body, { partial: false });
    if (f.promo_price_cents != null && f.promo_price_cents >= f.price_cents) v.fail('promo_price_cents', 'O preço promocional deve ser menor que o preço normal.');
    const opts = parseOptions(body.options) ?? [];
    const image = files.image ? await uploads.save(files.image) : null;
    try {
      const id = db.tx(() => {
        const res = db.run(
          `INSERT INTO products (restaurant_id, section_id, name, description, price_cents, promo_price_cents, image_path, available, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          r.id, f.section_id ?? null, f.name, f.description ?? null, f.price_cents, f.promo_price_cents ?? null, image, f.available ?? true, nowIso(),
        );
        syncOptions(res.id, opts);
        return res.id;
      });
      return getProduct(user, id);
    } catch (e) {
      await uploads.remove(image);
      throw e;
    }
  }

  function getProduct(user, idRaw) {
    const p = ownProduct(user, idRaw);
    return productPub(p, db.all('SELECT * FROM product_options WHERE product_id = ? ORDER BY id', p.id));
  }

  async function updateProduct(user, idRaw, body, files) {
    const r = requireStore(user);
    const p = ownProduct(user, idRaw);
    const f = parseProductFields(user, r, body, { partial: true });
    const price = f.price_cents ?? p.price_cents;
    const promo = 'promo_price_cents' in f ? f.promo_price_cents : p.promo_price_cents;
    if (promo != null && promo >= price) v.fail('promo_price_cents', 'O preço promocional deve ser menor que o preço normal.');
    const opts = parseOptions(body.options);

    let newImage;
    let oldImage;
    if (files.image) {
      newImage = await uploads.save(files.image);
      oldImage = p.image_path;
      f.image_path = newImage;
    } else if (v.bool(body, 'remove_image', false)) {
      oldImage = p.image_path;
      f.image_path = null;
    }
    try {
      db.tx(() => {
        const keys = Object.keys(f);
        if (keys.length) {
          db.run(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => f[k]), nowIso(), p.id);
        }
        if (opts !== undefined) syncOptions(p.id, opts);
      });
    } catch (e) {
      await uploads.remove(newImage);
      throw e;
    }
    await uploads.remove(oldImage);
    return getProduct(user, p.id);
  }

  function setAvailability(user, idRaw, body) {
    const p = ownProduct(user, idRaw);
    const available = v.bool(body, 'available');
    if (available === null) v.fail('available', 'Informe a disponibilidade.');
    db.run('UPDATE products SET available = ?, updated_at = ? WHERE id = ?', available, nowIso(), p.id);
    return getProduct(user, p.id);
  }

  async function deleteProduct(user, idRaw) {
    const p = ownProduct(user, idRaw);
    db.run('DELETE FROM products WHERE id = ?', p.id);
    await uploads.remove(p.image_path);
  }

  function listReviews(user) {
    const r = requireStore(user);
    return catalog.listReviews(r.id);
  }

  return {
    own, requireStore, getStore, createStore, updateStore, setImages, getHours, setHours,
    listSections, createSection, updateSection, deleteSection,
    listProducts, getProduct, createProduct, updateProduct, setAvailability, deleteProduct, listReviews,
  };
}

module.exports = { createRestaurantService };
