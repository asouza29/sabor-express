'use strict';
const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const v = require('../lib/validate');
const { isValidCoord } = require('../domain/geo');
const {
  evaluateDelivery, deliveryMessage, kmLabel, DELIVERY_ERROR_STATUS, MAX_DELIVERY_KM,
} = require('../domain/delivery');
const { effectivePrice } = require('../domain/pricing');
const { isOpenAt } = require('../domain/hours');
const {
  STATUS, FINAL, RESTAURANT_ACTIVE, canTransition, nextStatuses,
} = require('../domain/orderState');
const { imageUrl, nowIso, idParam } = require('./common');

const ON_DELIVERY = ['dinheiro', 'cartao_entrega', 'pix_entrega'];
const brl = (cents) => (cents / 100).toFixed(2).replace('.', ',');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createOrderService({ db, config, now, geo }) {
  /* ------------------------------------------------------ Pagamento */

  function paymentMethods() {
    const list = [
      { id: 'dinheiro', label: 'Dinheiro na entrega', online: false },
      { id: 'cartao_entrega', label: 'Cartão na entrega (maquininha)', online: false },
      { id: 'pix_entrega', label: 'PIX na entrega', online: false },
    ];
    if (config.onlinePaymentEnabled) list.push({ id: 'online', label: 'Pagamento online', online: true });
    return list;
  }

  /* ------------------------------------------------- Regras de entrega */

  function deliveryError(code, distanceMeters) {
    return new AppError(DELIVERY_ERROR_STATUS[code] || 422, code, deliveryMessage(code, distanceMeters), {
      delivery: {
        ok: false, code, max_km: MAX_DELIVERY_KM,
        distance_km: distanceMeters == null ? null : kmLabel(distanceMeters),
      },
    });
  }

  /** Fonte única da verdade da elegibilidade: usada por cotação e checkout, sempre no backend. */
  function assertDeliverable(restaurant, address, geoUnavailable) {
    const ev = evaluateDelivery(
      { lat: restaurant.lat, lng: restaurant.lng },
      { lat: address.lat, lng: address.lng },
    );
    if (ev.ok) return ev;
    if (ev.code === 'ADDRESS_NO_COORDS' && geoUnavailable) throw deliveryError('GEO_UNAVAILABLE', null);
    throw deliveryError(ev.code, ev.distanceMeters);
  }

  function loadActiveRestaurant(id) {
    const r = db.get(
      'SELECT r.* FROM restaurants r JOIN users u ON u.id = r.owner_id WHERE r.id = ? AND r.active = 1 AND u.active = 1', id,
    );
    if (!r) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurante não encontrado ou indisponível.');
    return r;
  }

  function assertOpen(r) {
    if (!r.accepting_orders) throw new AppError(422, 'RESTAURANT_CLOSED', 'O restaurante pausou o recebimento de pedidos no momento.');
    const hours = db.all('SELECT weekday, opens, closes FROM opening_hours WHERE restaurant_id = ?', r.id);
    if (!isOpenAt(hours, now(), config.timezone)) throw new AppError(422, 'RESTAURANT_CLOSED', 'O restaurante está fechado no momento.');
  }

  /** Preços SEMPRE vêm do banco; o cliente envia apenas ids, quantidades e opções. */
  function priceItems(restaurantId, rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) throw new AppError(400, 'EMPTY_CART', 'O carrinho está vazio.');
    if (rawItems.length > 40) throw new AppError(400, 'TOO_MANY_ITEMS', 'O carrinho tem itens demais.');
    const lines = [];
    let subtotal = 0;
    for (const raw of rawItems) {
      if (raw === null || typeof raw !== 'object') throw new AppError(400, 'VALIDATION_ERROR', 'Item inválido.');
      const productId = v.int(raw, 'product_id', { label: 'Produto', min: 1 });
      const qty = v.int(raw, 'quantity', { label: 'Quantidade', min: 1, max: 50 });
      const note = v.str(raw, 'note', { label: 'Observação do item', optional: true, max: 200 });
      const optionIds = Array.isArray(raw.option_ids) ? [...new Set(raw.option_ids)] : [];
      if (optionIds.length > 20 || optionIds.some((x) => !Number.isInteger(x) || x < 1)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Opções inválidas.');
      }
      const p = db.get('SELECT * FROM products WHERE id = ? AND restaurant_id = ?', productId, restaurantId);
      if (!p) throw new AppError(422, 'ITEM_NOT_FOUND', 'Um dos itens não existe mais neste restaurante.', { product_id: productId });
      if (!p.available) throw new AppError(422, 'ITEM_UNAVAILABLE', `"${p.name}" está indisponível no momento.`, { product_id: productId });
      const opts = optionIds.map((id) => {
        const o = db.get('SELECT * FROM product_options WHERE id = ? AND product_id = ?', id, p.id);
        if (!o) throw new AppError(422, 'OPTION_INVALID', `Opção inválida para "${p.name}".`, { product_id: productId });
        if (!o.available) throw new AppError(422, 'OPTION_UNAVAILABLE', `A opção "${o.name}" está indisponível.`, { product_id: productId });
        return o;
      });
      const unit = effectivePrice(p);
      const optTotal = opts.reduce((s, o) => s + o.price_cents, 0);
      const lineTotal = (unit + optTotal) * qty;
      lines.push({
        product_id: p.id, name: p.name, unit_price_cents: unit, quantity: qty, note,
        options: opts.map((o) => ({ id: o.id, name: o.name, price_cents: o.price_cents })),
        options_total_cents: optTotal, line_total_cents: lineTotal,
      });
      subtotal += lineTotal;
    }
    return { lines, subtotal };
  }

  function buildQuote(restaurantId, address, rawItems, geoUnavailable) {
    const restaurant = loadActiveRestaurant(restaurantId);
    const ev = assertDeliverable(restaurant, address, geoUnavailable);
    assertOpen(restaurant);
    const { lines, subtotal } = priceItems(restaurant.id, rawItems);
    if (subtotal < restaurant.min_order_cents) {
      throw new AppError(422, 'BELOW_MIN_ORDER', `O pedido mínimo deste restaurante é R$ ${brl(restaurant.min_order_cents)}.`, {
        min_order_cents: restaurant.min_order_cents,
      });
    }
    return {
      restaurant, ev, lines, subtotal,
      fee: restaurant.delivery_fee_cents, total: subtotal + restaurant.delivery_fee_cents,
    };
  }

  function ownAddress(userId, id) {
    const a = db.get('SELECT * FROM addresses WHERE id = ? AND user_id = ?', id, userId);
    if (!a) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Endereço não encontrado.');
    return a;
  }

  async function prepareAddress(user, addressId) {
    const a = ownAddress(user.id, addressId);
    let geoUnavailable = false;
    if (!isValidCoord(a.lat, a.lng)) geoUnavailable = (await geo.fillMissingCoords('addresses', a)).geoError;
    return geoUnavailable;
  }

  /** Cotação: mesmos cálculos e validações do checkout, sem criar pedido. */
  async function quote(user, body) {
    const restaurantId = v.int(body, 'restaurant_id', { label: 'Restaurante', min: 1 });
    const addressId = v.int(body, 'address_id', { label: 'Endereço', min: 1 });
    const geoUnavailable = await prepareAddress(user, addressId);
    const address = ownAddress(user.id, addressId);
    const q = buildQuote(restaurantId, address, body.items, geoUnavailable);
    return {
      restaurant: { id: q.restaurant.id, name: q.restaurant.name, prep_time_min: q.restaurant.prep_time_min },
      items: q.lines,
      subtotal_cents: q.subtotal, delivery_fee_cents: q.fee, total_cents: q.total,
      distance_km: kmLabel(q.ev.distanceMeters), max_delivery_km: MAX_DELIVERY_KM,
      address_updated_at: address.updated_at,
      payment_methods: paymentMethods(),
    };
  }

  /* --------------------------------------------------------- Criação */

  function newCode() {
    for (let i = 0; i < 10; i++) {
      let s = 'SE-';
      for (let j = 0; j < 6; j++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!db.get('SELECT 1 AS x FROM orders WHERE code = ?', s)) return s;
    }
    throw new AppError(500, 'CODE_GENERATION', 'Não foi possível gerar o código do pedido.');
  }

  async function createOrder(user, body) {
    const restaurantId = v.int(body, 'restaurant_id', { label: 'Restaurante', min: 1 });
    const addressId = v.int(body, 'address_id', { label: 'Endereço', min: 1 });
    const method = v.str(body, 'payment_method', { label: 'Forma de pagamento', max: 30 });
    const notes = v.str(body, 'notes', { label: 'Observações', optional: true, max: 300 });
    const idem = v.str(body, 'idempotency_key', { label: 'Chave de idempotência', optional: true, max: 80 });
    const expectedTotal = v.int(body, 'expected_total_cents', { label: 'Total esperado', optional: true, min: 0 });
    const addressVersion = v.str(body, 'address_updated_at', { label: 'Versão do endereço', optional: true, max: 40 });
    let changeFor = v.int(body, 'change_for_cents', { label: 'Troco para', optional: true, min: 0, max: 10_000_000 });

    const findDuplicate = () => {
      if (!idem) return null;
      const ex = db.get('SELECT id FROM orders WHERE customer_id = ? AND idempotency_key = ?', user.id, idem);
      return ex ? { order: getOrder(user, ex.id), duplicate: true } : null;
    };
    const dup = findDuplicate();
    if (dup) return dup;

    // Etapa assíncrona (pode consultar o geocodificador): apenas completa coordenadas ausentes.
    const geoUnavailable = await prepareAddress(user, addressId);

    // Etapa autoritativa e atômica: tudo é relido e validado dentro da transação.
    return db.tx(() => {
      const dup2 = findDuplicate();
      if (dup2) return dup2;

      const address = ownAddress(user.id, addressId);
      if (addressVersion && addressVersion !== address.updated_at) {
        throw new AppError(409, 'ADDRESS_CHANGED', 'O endereço de entrega foi alterado. Revise o endereço e confirme o pedido novamente.');
      }
      const q = buildQuote(restaurantId, address, body.items, geoUnavailable);
      if (expectedTotal != null && expectedTotal !== q.total) {
        throw new AppError(409, 'PRICE_CHANGED', 'Os valores do pedido mudaram. Revise o total e confirme novamente.', { total_cents: q.total });
      }
      if (!paymentMethods().some((m) => m.id === method)) {
        throw new AppError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Forma de pagamento indisponível.');
      }
      if (method === 'dinheiro' && changeFor != null && changeFor < q.total) {
        throw new AppError(422, 'INVALID_CHANGE', 'O valor para troco deve ser maior ou igual ao total do pedido.');
      }
      if (method !== 'dinheiro') changeFor = null;

      const status = method === 'online' ? STATUS.AWAITING_PAYMENT : STATUS.NEW;
      const ts = nowIso();
      const o = db.run(
        `INSERT INTO orders (code, customer_id, restaurant_id, status, subtotal_cents, delivery_fee_cents, total_cents,
           payment_method, notes, customer_name, customer_phone,
           addr_label, addr_street, addr_number, addr_complement, addr_neighborhood, addr_city, addr_state, addr_zip,
           addr_lat, addr_lng, addr_coords_source, distance_m, idempotency_key, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newCode(), user.id, q.restaurant.id, status, q.subtotal, q.fee, q.total, method, notes, user.name, user.phone,
        address.label, address.street, address.number, address.complement, address.neighborhood, address.city, address.state, address.zip,
        address.lat, address.lng, address.coords_source, q.ev.distanceMeters, idem, ts, ts,
      );
      for (const l of q.lines) {
        db.run(
          `INSERT INTO order_items (order_id, product_id, name, unit_price_cents, quantity, options_json, options_total_cents, note, line_total_cents)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          o.id, l.product_id, l.name, l.unit_price_cents, l.quantity, JSON.stringify(l.options), l.options_total_cents, l.note, l.line_total_cents,
        );
      }
      db.run(
        `INSERT INTO payments (order_id, method, status, amount_cents, change_for_cents, provider, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        o.id, method, 'pendente', q.total, changeFor, method === 'online' ? 'gateway' : null, ts, ts,
      );
      db.run('INSERT INTO order_events (order_id, status, actor_id, actor_role, note, created_at) VALUES (?,?,?,?,?,?)',
        o.id, status, user.id, 'cliente', 'Pedido criado', ts);
      return { order: getOrder(user, o.id), duplicate: false };
    });
  }

  /* ----------------------------------------------------- Leitura/view */

  function loadOrderRow(id) {
    return db.get(
      `SELECT o.*, r.name AS r_name, r.phone AS r_phone, r.logo_path AS r_logo, r.owner_id AS r_owner,
              r.street AS r_street, r.number AS r_number, r.neighborhood AS r_neighborhood, r.city AS r_city, r.state AS r_state,
              cu.name AS courier_name, cu.phone AS courier_phone, cp.vehicle AS courier_vehicle
       FROM orders o
       JOIN restaurants r ON r.id = o.restaurant_id
       LEFT JOIN users cu ON cu.id = o.courier_id
       LEFT JOIN courier_profiles cp ON cp.user_id = o.courier_id
       WHERE o.id = ?`, id,
    );
  }

  const isClaimable = (o) => o.courier_id == null && (o.status === STATUS.PREPARING || o.status === STATUS.READY);

  function canView(user, o) {
    switch (user.role) {
      case 'cliente': return o.customer_id === user.id;
      case 'estabelecimento': return o.r_owner === user.id && o.status !== STATUS.AWAITING_PAYMENT;
      case 'entregador': return o.courier_id === user.id || isClaimable(o);
      case 'admin': return true;
      default: return false;
    }
  }

  const isParticipant = (user, o) =>
    user.role === 'admin' ||
    (user.role === 'cliente' && o.customer_id === user.id) ||
    (user.role === 'estabelecimento' && o.r_owner === user.id) ||
    (user.role === 'entregador' && o.courier_id === user.id);

  function serialize(user, o) {
    const fullAddress = isParticipant(user, o);
    const items = db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', o.id).map((i) => ({
      name: i.name, quantity: i.quantity, unit_price_cents: i.unit_price_cents,
      options: JSON.parse(i.options_json), options_total_cents: i.options_total_cents,
      note: i.note, line_total_cents: i.line_total_cents,
    }));
    const events = db.all('SELECT status, note, actor_role, created_at FROM order_events WHERE order_id = ? ORDER BY id', o.id);
    const pay = db.get('SELECT method, status, amount_cents, change_for_cents, paid_at FROM payments WHERE order_id = ?', o.id);
    const review = db.get('SELECT rating, comment, created_at FROM reviews WHERE order_id = ?', o.id) || null;

    const transitions = isParticipant(user, o) ? nextStatuses(o.status, user.role) : [];
    const profile = user.role === 'entregador' ? db.get('SELECT available FROM courier_profiles WHERE user_id = ?', user.id) : null;
    const showCourierPhone = user.role !== 'entregador';

    return {
      id: o.id, code: o.code, status: o.status,
      created_at: o.created_at, updated_at: o.updated_at, delivered_at: o.delivered_at,
      canceled_reason: o.canceled_reason, notes: o.notes,
      subtotal_cents: o.subtotal_cents, delivery_fee_cents: o.delivery_fee_cents, total_cents: o.total_cents,
      distance_km: kmLabel(o.distance_m),
      payment: pay ? { ...pay } : null,
      restaurant: {
        id: o.restaurant_id, name: o.r_name, phone: o.r_phone, logo_url: imageUrl(o.r_logo),
        address: `${o.r_street}, ${o.r_number} — ${o.r_neighborhood}, ${o.r_city}/${o.r_state}`,
      },
      customer: fullAddress ? { name: o.customer_name, phone: o.customer_phone } : null,
      address: fullAddress
        ? {
          label: o.addr_label, street: o.addr_street, number: o.addr_number, complement: o.addr_complement,
          neighborhood: o.addr_neighborhood, city: o.addr_city, state: o.addr_state, zip: o.addr_zip,
        }
        : { neighborhood: o.addr_neighborhood, city: o.addr_city, state: o.addr_state },
      items,
      courier: o.courier_id
        ? { name: o.courier_name, vehicle: o.courier_vehicle, phone: showCourierPhone ? o.courier_phone : null }
        : null,
      events: events.map((e) => ({ status: e.status, note: e.note, actor_role: e.actor_role, created_at: e.created_at })),
      review,
      allowed_transitions: transitions,
      can_accept_delivery: Boolean(user.role === 'entregador' && isClaimable(o) && profile?.available),
      can_release_delivery: Boolean(user.role === 'entregador' && o.courier_id === user.id && (o.status === STATUS.PREPARING || o.status === STATUS.READY)),
      can_review: Boolean(user.role === 'cliente' && o.customer_id === user.id && o.status === STATUS.DELIVERED && !review),
    };
  }

  function getOrder(user, idRaw) {
    const o = loadOrderRow(idParam(idRaw));
    if (!o || !canView(user, o)) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
    return serialize(user, o);
  }

  const rowsToOrders = (user, ids) => ids.map((r) => serialize(user, loadOrderRow(r.id)));

  function listForCustomer(user) {
    return rowsToOrders(user, db.all('SELECT id FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 100', user.id));
  }

  function listForRestaurant(user, scope) {
    const ph = RESTAURANT_ACTIVE.map(() => '?').join(',');
    const sql = scope === 'history'
      ? `SELECT o.id FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
         WHERE r.owner_id = ? AND o.status IN ('entregue','cancelado') ORDER BY o.id DESC LIMIT 100`
      : `SELECT o.id FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
         WHERE r.owner_id = ? AND o.status IN (${ph}) ORDER BY o.id ASC LIMIT 200`;
    const params = scope === 'history' ? [user.id] : [user.id, ...RESTAURANT_ACTIVE];
    return rowsToOrders(user, db.all(sql, ...params));
  }

  function listAvailableForCourier(user) {
    const profile = db.get('SELECT available FROM courier_profiles WHERE user_id = ?', user.id);
    if (!profile?.available) return { available: false, orders: [] };
    const ids = db.all("SELECT id FROM orders WHERE courier_id IS NULL AND status IN ('preparando','pronto') ORDER BY id ASC LIMIT 50");
    return { available: true, orders: rowsToOrders(user, ids) };
  }

  function listForCourier(user, scope) {
    const sql = scope === 'history'
      ? "SELECT id FROM orders WHERE courier_id = ? AND status IN ('entregue','cancelado') ORDER BY id DESC LIMIT 100"
      : "SELECT id FROM orders WHERE courier_id = ? AND status NOT IN ('entregue','cancelado') ORDER BY id ASC";
    return rowsToOrders(user, db.all(sql, user.id));
  }

  function listAll(user, query) {
    const where = [];
    const params = [];
    if (query.status && Object.values(STATUS).includes(query.status)) { where.push('o.status = ?'); params.push(query.status); }
    if (query.q) {
      where.push("(o.code LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR r.name LIKE ? ESCAPE '\\')");
      const like = `%${String(query.q).slice(0, 40).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      params.push(like, like, like);
    }
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const rows = db.all(
      `SELECT o.id FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.id DESC LIMIT ?`, ...params, limit,
    );
    return rowsToOrders(user, rows);
  }

  /* -------------------------------------------------------- Transições */

  function applyTransition(actor, id, to, reason) {
    return db.tx(() => {
      const o = loadOrderRow(id);
      if (!o) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
      if (actor.role !== 'sistema') {
        if (!canView(actor, o)) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
        if (!isParticipant(actor, o)) throw new AppError(403, 'FORBIDDEN', 'Você não pode alterar este pedido.');
      }
      if (!canTransition(o.status, to, actor.role)) {
        throw new AppError(409, 'INVALID_TRANSITION', 'Esta mudança de status não é permitida para o estado atual do pedido.', { from: o.status, to });
      }
      if (to === STATUS.ON_THE_WAY && !o.courier_id) {
        throw new AppError(409, 'NO_COURIER', 'Nenhum entregador aceitou este pedido ainda.');
      }
      if (to === STATUS.CANCELED && (actor.role === 'estabelecimento' || actor.role === 'admin') && !reason) {
        throw new AppError(400, 'REASON_REQUIRED', 'Informe o motivo do cancelamento.');
      }
      const ts = nowIso();
      const res = db.run(
        `UPDATE orders SET status = ?, updated_at = ?,
           delivered_at = CASE WHEN ? = 'entregue' THEN ? ELSE delivered_at END,
           canceled_reason = CASE WHEN ? = 'cancelado' THEN ? ELSE canceled_reason END
         WHERE id = ? AND status = ?`,
        to, ts, to, ts, to, reason, o.id, o.status,
      );
      if (res.changes !== 1) throw new AppError(409, 'CONFLICT', 'O pedido foi atualizado por outra pessoa. Recarregue.');

      if (to === STATUS.DELIVERED) {
        db.run(
          `UPDATE payments SET status = 'pago', paid_at = COALESCE(paid_at, ?), updated_at = ?
           WHERE order_id = ? AND status = 'pendente' AND method IN ('dinheiro','cartao_entrega','pix_entrega')`,
          ts, ts, o.id,
        );
      }
      if (to === STATUS.CANCELED) {
        db.run(
          `UPDATE payments SET status = CASE WHEN status = 'pago' THEN 'reembolso_pendente' ELSE 'cancelado' END, updated_at = ? WHERE order_id = ?`,
          ts, o.id,
        );
      }
      db.run('INSERT INTO order_events (order_id, status, actor_id, actor_role, note, created_at) VALUES (?,?,?,?,?,?)',
        o.id, to, actor.id ?? null, actor.role, to === STATUS.CANCELED ? reason : null, ts);
      return loadOrderRow(o.id);
    });
  }

  function changeStatus(user, idRaw, body) {
    const to = v.oneOf(body, 'status', Object.values(STATUS), { label: 'Status' });
    const reason = v.str(body, 'reason', { label: 'Motivo', optional: true, max: 200 });
    return serialize(user, applyTransition(user, idParam(idRaw), to, reason));
  }

  function acceptDelivery(user, idRaw) {
    const id = idParam(idRaw);
    return db.tx(() => {
      const profile = db.get('SELECT * FROM courier_profiles WHERE user_id = ?', user.id);
      if (!profile?.available) throw new AppError(409, 'COURIER_UNAVAILABLE', 'Ative sua disponibilidade para aceitar entregas.');
      const o = loadOrderRow(id);
      if (!o) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
      // Outro entregador chegou primeiro: mensagem clara em vez de "não encontrado".
      if (!canView(user, o)) {
        if (o.courier_id != null && (o.status === STATUS.PREPARING || o.status === STATUS.READY)) {
          throw new AppError(409, 'ALREADY_TAKEN', 'Esta entrega não está mais disponível.');
        }
        throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
      }
      if (o.courier_id === user.id) return serialize(user, o);
      const ts = nowIso();
      const res = db.run(
        "UPDATE orders SET courier_id = ?, updated_at = ? WHERE id = ? AND courier_id IS NULL AND status IN ('preparando','pronto')",
        user.id, ts, id,
      );
      if (res.changes !== 1) throw new AppError(409, 'ALREADY_TAKEN', 'Esta entrega não está mais disponível.');
      db.run('INSERT INTO order_events (order_id, status, actor_id, actor_role, note, created_at) VALUES (?,?,?,?,?,?)',
        id, o.status, user.id, 'entregador', 'Entregador aceitou a entrega', ts);
      return serialize(user, loadOrderRow(id));
    });
  }

  function releaseDelivery(user, idRaw) {
    const id = idParam(idRaw);
    return db.tx(() => {
      const ts = nowIso();
      const res = db.run(
        "UPDATE orders SET courier_id = NULL, updated_at = ? WHERE id = ? AND courier_id = ? AND status IN ('preparando','pronto')",
        ts, id, user.id,
      );
      if (res.changes !== 1) throw new AppError(409, 'CANNOT_RELEASE', 'Não é possível devolver esta entrega.');
      const o = loadOrderRow(id);
      db.run('INSERT INTO order_events (order_id, status, actor_id, actor_role, note, created_at) VALUES (?,?,?,?,?,?)',
        id, o.status, user.id, 'entregador', 'Entregador devolveu a entrega', ts);
      return { ok: true };
    });
  }

  /* ------------------------------------------------------- Avaliação */

  function review(user, idRaw, body) {
    const id = idParam(idRaw);
    const rating = v.int(body, 'rating', { label: 'Nota', min: 1, max: 5 });
    const comment = v.str(body, 'comment', { label: 'Comentário', optional: true, max: 500 });
    return db.tx(() => {
      const o = db.get('SELECT * FROM orders WHERE id = ? AND customer_id = ?', id, user.id);
      if (!o) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
      if (o.status !== STATUS.DELIVERED) throw new AppError(409, 'NOT_DELIVERED', 'Você só pode avaliar pedidos entregues.');
      if (db.get('SELECT 1 AS x FROM reviews WHERE order_id = ?', id)) throw new AppError(409, 'ALREADY_REVIEWED', 'Este pedido já foi avaliado.');
      db.run('INSERT INTO reviews (order_id, customer_id, restaurant_id, rating, comment) VALUES (?,?,?,?,?)', id, user.id, o.restaurant_id, rating, comment);
      return serialize(user, loadOrderRow(id));
    });
  }

  /* ------------------------------------------------ Pagamento online */

  /** Aplica o resultado de um pagamento online (webhook assinado ou confirmação manual do admin). */
  function applyPaymentResult({ orderCode, status, amountCents, providerRef, actorId = null }) {
    return db.tx(() => {
      const o = db.get('SELECT * FROM orders WHERE code = ?', orderCode);
      if (!o) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
      const p = db.get('SELECT * FROM payments WHERE order_id = ?', o.id);
      if (p.method !== 'online') throw new AppError(409, 'NOT_ONLINE_PAYMENT', 'Este pedido não usa pagamento online.');
      const ts = nowIso();
      if (status === 'paid') {
        if (amountCents !== p.amount_cents) throw new AppError(422, 'AMOUNT_MISMATCH', 'O valor pago não confere com o total do pedido.');
        if (p.status === 'pago') return { idempotent: true, order_id: o.id };
        if (o.status === STATUS.CANCELED) {
          db.run("UPDATE payments SET status = 'reembolso_pendente', provider_ref = ?, paid_at = ?, updated_at = ? WHERE id = ?", providerRef, ts, ts, p.id);
          return { refund_pending: true, order_id: o.id };
        }
        db.run("UPDATE payments SET status = 'pago', provider_ref = ?, paid_at = ?, updated_at = ? WHERE id = ?", providerRef, ts, ts, p.id);
        const res = db.run("UPDATE orders SET status = 'novo', updated_at = ? WHERE id = ? AND status = 'aguardando_pagamento'", ts, o.id);
        if (res.changes === 1) {
          db.run('INSERT INTO order_events (order_id, status, actor_id, actor_role, note, created_at) VALUES (?,?,?,?,?,?)',
            o.id, 'novo', actorId, actorId ? 'admin' : 'sistema', 'Pagamento confirmado', ts);
        }
        return { order_id: o.id };
      }
      // failed
      if (p.status === 'pago') throw new AppError(409, 'ALREADY_PAID', 'O pagamento já foi confirmado.');
      db.run("UPDATE payments SET status = 'falhou', updated_at = ? WHERE id = ?", ts, p.id);
      const res = db.run(
        "UPDATE orders SET status = 'cancelado', canceled_reason = 'Pagamento não aprovado', updated_at = ? WHERE id = ? AND status = 'aguardando_pagamento'",
        ts, o.id,
      );
      if (res.changes === 1) {
        db.run('INSERT INTO order_events (order_id, status, actor_id, actor_role, note, created_at) VALUES (?,?,?,?,?,?)',
          o.id, 'cancelado', actorId, 'sistema', 'Pagamento não aprovado', ts);
      }
      return { order_id: o.id };
    });
  }

  function adminConfirmPayment(admin, idRaw) {
    const o = db.get('SELECT code FROM orders WHERE id = ?', idParam(idRaw));
    if (!o) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
    const p = db.get('SELECT amount_cents FROM payments WHERE order_id = ?', idParam(idRaw));
    applyPaymentResult({ orderCode: o.code, status: 'paid', amountCents: p.amount_cents, providerRef: 'confirmacao-manual', actorId: admin.id });
    return getOrder(admin, idRaw);
  }

  return {
    paymentMethods, quote, createOrder, getOrder, listForCustomer, listForRestaurant,
    listAvailableForCourier, listForCourier, listAll, changeStatus, acceptDelivery, releaseDelivery,
    review, applyPaymentResult, adminConfirmPayment, applyTransition, FINAL,
  };
}

module.exports = { createOrderService };
