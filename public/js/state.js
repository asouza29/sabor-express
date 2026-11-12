// Estado global mínimo (usuário, localização de entrega, carrinho).
// localStorage guarda apenas conveniências (localização escolhida e carrinho); nunca preços de verdade:
// o servidor recalcula tudo na cotação e no pedido.
const listeners = new Set();

const safe = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

export const state = {
  config: { max_delivery_km: 15, payment_methods: [] },
  user: null,
  loc: safe.get('se_loc'),      // { lat, lng, label, source: 'address'|'gps', addressId? }
  cart: safe.get('se_cart') || { restaurant: null, items: [] },
  ready: false,
};

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => fn(what));

export const badges = {};
export function setBadge(k, n) { if (badges[k] === n) return; badges[k] = n; emit('badge'); }
export function setUser(u) { state.user = u; emit('user'); }
export function setConfig(c) { state.config = c; }
export function setLoc(loc) {
  state.loc = loc;
  if (loc) safe.set('se_loc', loc); else safe.del('se_loc');
  emit('loc');
}

/* ------------------------------------------------------------- carrinho */
const persistCart = () => { safe.set('se_cart', state.cart); emit('cart'); };
const lineKey = (it) => `${it.product_id}|${[...it.option_ids].sort((a, b) => a - b).join(',')}|${it.note || ''}`;

export const cartCount = () => state.cart.items.reduce((s, i) => s + i.qty, 0);
/** Estimativa só para exibição (o servidor recalcula). */
export const cartEstimate = () => state.cart.items.reduce((s, i) => s + (i.unit_cents + i.options_cents) * i.qty, 0);

/** Retorna 'ok' | 'other-restaurant' (precisa confirmar troca). */
export function cartAdd(restaurant, item, { replace = false } = {}) {
  if (state.cart.restaurant && state.cart.restaurant.id !== restaurant.id && state.cart.items.length && !replace) return 'other-restaurant';
  if (!state.cart.restaurant || state.cart.restaurant.id !== restaurant.id) state.cart = { restaurant, items: [] };
  const k = lineKey(item);
  const ex = state.cart.items.find((i) => lineKey(i) === k);
  if (ex) ex.qty = Math.min(50, ex.qty + item.qty);
  else state.cart.items.push({ ...item });
  persistCart();
  return 'ok';
}
export function cartSetQty(index, qty) {
  const it = state.cart.items[index];
  if (!it) return;
  if (qty <= 0) state.cart.items.splice(index, 1); else it.qty = Math.min(50, qty);
  if (!state.cart.items.length) state.cart = { restaurant: null, items: [] };
  persistCart();
}
export function cartClear() { state.cart = { restaurant: null, items: [] }; persistCart(); }
