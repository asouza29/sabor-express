import { api, qs } from '../api.js';
import { state, subscribe, setUser, cartAdd, cartClear, cartCount, cartEstimate } from '../state.js';
import { go, onLeave } from '../router.js';
import {
  h, icon, mount, clear, money, kmText, img, field, input, textarea, select, busy, toast, showFormError, confirmDialog, openModal,
  emptyState, skeletonCards, errorBlock, loadingBlock, statusChip, STATUS, PAYMENT_LABEL, PAY_STATUS, dateTime, timeOnly, stars, starPicker,
  phoneFmt, parseMoney, moneyInput, setTitle, switchEl,
} from '../ui.js';
import { openLocationPicker, openAddressForm, useAddress, addrLabel, cartLines, openCartDrawer } from './shared.js';

/* ===================================================================== INÍCIO */
const filters = { category: '', sort: 'relevance', open: false };

function restCard(r) {
  const closed = !r.is_open;
  return h('a.rest-card', { href: `#/r/${r.id}`, class: closed ? 'closed' : '', 'aria-label': `${r.name}${closed ? ' (fechado)' : ''}` },
    h('div.cover', img(r.cover_url, '')),
    h('div.tags', r.has_promo ? h('span.chip.green', 'Promoção') : null,
      closed ? h('span.chip.gray', r.status === 'paused' ? 'Pausado' : 'Fechado') : null),
    h('div.body', img(r.logo_url, `Logo ${r.name}`, 'logo-img'), h('h3', r.name),
      h('div.small.muted.ellipsis', [r.category ? `${r.category.emoji} ${r.category.name}` : null, r.neighborhood].filter(Boolean).join(' · ')),
      h('div.meta',
        h('span', r.rating_avg != null ? [h('span.star', icon('star', 16)), h('strong', String(r.rating_avg).replace('.', ',')), h('span.muted', `(${r.rating_count})`)] : h('span.muted', 'Novo')),
        h('span', icon('clock', 16), `${r.prep_time_min} min`),
        h('span', icon('pin', 16), kmText(r.distance_km)),
        r.delivery_fee_cents === 0 ? h('span.free', 'Entrega grátis') : h('span', icon('bike', 16), money(r.delivery_fee_cents)))));
}

export async function home(ctx) {
  const u = state.user;
  const q = ctx.query.q || '';
  // Cliente logado sem local escolhido: usa o primeiro endereço com localização confirmada.
  if (!state.loc && u?.role === 'cliente') {
    try {
      const { addresses } = await api.get('/api/me/addresses');
      const a = addresses.find((x) => x.has_coords);
      if (a) useAddress(a);
    } catch { /* segue sem local */ }
  }
  const root = h('div.container.page');
  const listBox = h('div'); const promoBox = h('div'); const catBox = h('div');
  const max = state.config.max_delivery_km;

  if (!state.loc) {
    mount(root, hero({ needLoc: true }), h('div.grid-info', h('div.notice.info', icon('info'), h('div', `Mostramos apenas restaurantes que entregam no seu endereço (até ${max} km). Informe onde você está para começar.`))));
    const un = subscribe((w) => { if (w === 'loc' && state.loc) { un(); go('/'); } });
    onLeave(un);
    return root;
  }

  mount(root, hero({}), catBox, promoBox, h('div.section-head', h('h2', q ? `Resultados para “${q}”` : 'Restaurantes perto de você'), filterBar()), listBox);

  async function loadCats() {
    try {
      const { categories } = await api.get('/api/catalog/categories');
      mount(catBox, h('div.cats', { role: 'group', 'aria-label': 'Categorias' }, categories.map((c) => h('button.cat', {
        'aria-pressed': filters.category === c.slug, onclick: () => { filters.category = filters.category === c.slug ? '' : c.slug; loadCats(); loadList(); },
      }, h('span.em', c.emoji), c.name))));
    } catch { /* categorias são opcionais */ }
  }
  async function loadPromos() {
    try {
      const { promotions } = await api.get('/api/catalog/promotions' + qs({ lat: state.loc.lat, lng: state.loc.lng }));
      if (!promotions.length || q || filters.category) { mount(promoBox); return; }
      mount(promoBox, h('div.section-head', h('h2', 'Ofertas imperdíveis')), h('div.promos', promotions.map((p) => {
        const off = Math.round((1 - p.promo_price_cents / p.price_cents) * 100);
        return h('a.promo', { href: `#/r/${p.restaurant.id}` }, img(p.image_url, p.name),
          h('div.grow', h('span.off', `-${off}%`), h('div.strong.ellipsis', p.name), h('div.small.muted.ellipsis', p.restaurant.name),
            h('div', h('span.price-promo', money(p.promo_price_cents)), ' ', h('span.price-old', money(p.price_cents)))));
      })));
    } catch { mount(promoBox); }
  }
  let seq = 0;
  async function loadList() {
    const mine = ++seq;
    mount(listBox, skeletonCards(6));
    try {
      const r = await api.get('/api/catalog/restaurants' + qs({ lat: state.loc.lat, lng: state.loc.lng, q, category: filters.category, sort: filters.sort, open: filters.open ? '1' : '' }));
      if (mine !== seq) return;
      mount(listBox, r.restaurants.length ? h('div.rest-grid', r.restaurants.map(restCard)) : emptyState({
        title: 'Nenhum restaurante por aqui',
        text: q || filters.category || filters.open ? 'Tente limpar a busca ou os filtros.' : `Ainda não há restaurantes que entreguem em até ${r.max_delivery_km} km deste endereço. Tente outro local.`,
        art: 'store',
        action: h('div.row.wrap', { style: { justifyContent: 'center' } },
          (q || filters.category || filters.open) ? h('button.btn.btn-secondary', { onclick: () => { filters.category = ''; filters.open = false; go('/'); loadCats(); loadList(); } }, 'Limpar filtros') : null,
          h('button.btn.btn-primary', { onclick: () => openLocationPicker() }, icon('pin'), 'Trocar endereço')),
      }));
    } catch (e) { if (mine === seq) mount(listBox, errorBlock(e, loadList)); }
  }
  function filterBar() {
    return h('div.filters', h('button.toggle-chip', { 'aria-pressed': filters.open, onclick: (e) => { filters.open = !filters.open; e.currentTarget.setAttribute('aria-pressed', filters.open); loadList(); } }, 'Abertos agora'),
      select([['relevance', 'Relevância'], ['distance', 'Mais perto'], ['rating', 'Melhor avaliados'], ['time', 'Mais rápidos'], ['fee', 'Menor taxa']], filters.sort,
        { 'aria-label': 'Ordenar', style: { width: 'auto', minHeight: '40px', borderRadius: '999px', fontWeight: '700' }, onchange: (e) => { filters.sort = e.target.value; loadList(); } }));
  }
  loadCats(); loadPromos(); loadList();
  let last = `${state.loc.lat},${state.loc.lng}`;
  const un = subscribe((w) => { if (w === 'loc' && state.loc && `${state.loc.lat},${state.loc.lng}` !== last) { last = `${state.loc.lat},${state.loc.lng}`; loadPromos(); loadList(); } });
  onLeave(un);
  return root;
}

function hero({ needLoc }) {
  const max = state.config.max_delivery_km;
  return h('section.hero', h('div.content',
    h('h1', needLoc ? 'Fome? A comida boa chega até você.' : 'O que você vai pedir hoje?'),
    h('p', needLoc ? 'Escolha onde receber e veja os restaurantes que entregam no seu endereço.' : 'Restaurantes da sua região, entrega rápida e acompanhamento do pedido em tempo real.'),
    needLoc ? h('div.row.wrap', h('button.btn.btn-primary.btn-lg', { onclick: () => openLocationPicker() }, icon('pin'), 'Escolher local de entrega'),
      state.user ? null : h('a.btn.btn-outline.btn-lg', { href: '#/register' }, 'Criar conta')) : null,
    h('div.badge-row', h('span', `Entrega em até ${max} km`), h('span', 'Pague na entrega'), h('span', 'Acompanhe o pedido'))));
}

/* ================================================================ RESTAURANTE */
export async function restaurant(ctx) {
  const id = ctx.params.id;
  const loc = state.loc;
  const data = await api.get(`/api/catalog/restaurants/${id}` + qs(loc ? { lat: loc.lat, lng: loc.lng } : {}));
  if (!ctx.alive()) return null;
  const { restaurant: r, menu, delivery } = data;
  setTitle(r.name);
  const canOrder = r.is_open && (!delivery.checked || delivery.ok);

  const cartBox = h('div.card.card-pad.cart-panel');
  const sticky = h('div.sticky-cta.hide');
  const drawCart = () => {
    const mine = state.cart.restaurant?.id === r.id && state.cart.items.length;
    if (!mine) {
      mount(cartBox, h('h3', 'Seu pedido'), h('p.muted.small', state.cart.items.length ? `Você tem itens de ${state.cart.restaurant.name} no carrinho.` : 'Adicione itens do cardápio para começar.'),
        state.cart.items.length ? h('button.btn.btn-outline.btn-sm', { onclick: openCartDrawer }, 'Ver carrinho') : null);
      sticky.classList.add('hide'); return;
    }
    mount(cartBox, h('h3', 'Seu pedido'), cartLines(), h('hr.divider'),
      h('div.totals', h('div', h('span', 'Subtotal estimado'), h('strong', money(cartEstimate()))),
        r.min_order_cents ? h('div.small.muted', `Pedido mínimo: ${money(r.min_order_cents)}`) : null),
      h('button.btn.btn-primary.btn-block.mt-8', { onclick: () => go(state.user ? '/checkout' : '/login?next=%2Fcheckout') }, 'Ir para o checkout'));
    sticky.classList.remove('hide');
    mount(sticky, h('button.btn.btn-primary.btn-block', { onclick: () => go(state.user ? '/checkout' : '/login?next=%2Fcheckout') },
      `Ver carrinho · ${cartCount()} ${cartCount() === 1 ? 'item' : 'itens'} · ${money(cartEstimate())}`));
  };
  const unsub = subscribe((w) => { if (w === 'cart') drawCart(); });
  onLeave(unsub);

  const banner = [];
  if (!r.is_open) banner.push(h('div.notice.warn', icon('clock'), h('div', h('strong', r.status === 'paused' ? 'Pedidos pausados no momento.' : 'Fechado agora.'), ' Você pode ver o cardápio, mas não é possível pedir.')));
  if (delivery.checked && !delivery.ok) banner.push(h('div.notice.error', icon('pin'), h('div', h('strong', 'Este restaurante não entrega no seu endereço.'), h('div', delivery.message), h('button.btn.btn-outline.btn-sm.mt-8', { onclick: () => openLocationPicker() }, 'Trocar endereço'))));
  if (!loc) banner.push(h('div.notice.info', icon('pin'), h('div', 'Escolha seu endereço para confirmar se este restaurante entrega até você.', h('div', h('button.btn.btn-secondary.btn-sm.mt-8', { onclick: () => openLocationPicker({ onDone: () => go(`/r/${id}`) }) }, 'Escolher endereço')))));
  if (delivery.checked && delivery.ok) banner.push(h('div.notice.ok', icon('check'), h('div', h('strong', 'Entrega disponível'), ` — ${kmText(delivery.distance_km)} do seu endereço (limite de ${delivery.max_km} km).`)));

  const sections = menu.filter((s) => s.products.length);
  const root = h('div',
    h('div.container', h('div.r-cover', img(r.cover_url, '')),
      h('div.r-head', img(r.logo_url, `Logo ${r.name}`, 'logo'), h('div.grow', h('h1', r.name), h('div.muted', [r.category ? `${r.category.emoji} ${r.category.name}` : null, `${r.neighborhood}, ${r.city}`].filter(Boolean).join(' · ')))),
      h('div.r-facts', h('span', r.rating_avg != null ? [h('span.star', icon('star', 18)), h('strong', String(r.rating_avg).replace('.', ',')), ` (${r.rating_count} avaliações)`] : 'Sem avaliações ainda'),
        h('span', icon('clock', 18), `${r.prep_time_min} min de preparo`), h('span', icon('bike', 18), r.delivery_fee_cents ? `Taxa ${money(r.delivery_fee_cents)}` : 'Entrega grátis'),
        r.min_order_cents ? h('span', icon('bag', 18), `Mínimo ${money(r.min_order_cents)}`) : null,
        h('span.chip', { class: r.is_open ? 'green' : 'gray' }, r.status === 'open' ? 'Aberto' : r.status === 'paused' ? 'Pausado' : 'Fechado')),
      r.description ? h('p.muted', r.description) : null,
      h('div.col', banner)),
    h('div.container.page', { style: { paddingTop: '8px' } },
      h('div.r-layout', h('div', sections.length ? [
        h('nav.sec-nav', { 'aria-label': 'Seções do cardápio' }, sections.map((s, i) => h('a', { href: `#`, class: i === 0 ? 'active' : '', onclick: (e) => { e.preventDefault(); document.getElementById(`sec-${i}`)?.scrollIntoView({ behavior: 'smooth' }); } }, s.name))),
        sections.map((s, i) => h('section.menu-sec', { id: `sec-${i}` }, h('h2', s.name), h('div.prod-grid', s.products.map((p) => productCard(p, r, canOrder)))))]
        : emptyState({ title: 'Cardápio em preparação', text: 'Este restaurante ainda não cadastrou produtos.', art: 'list' })),
        cartBox)), sticky);
  drawCart();
  return root;
}

function productCard(p, r, canOrder) {
  const disabled = !p.available;
  return h('button.prod', { type: 'button', disabled, onclick: () => openProduct(p, r, canOrder), 'aria-label': `${p.name}, ${money(p.final_price_cents)}${disabled ? ', indisponível' : ''}` },
    h('div.info', h('h4', p.name), p.description ? h('p', p.description) : null,
      h('div.price', p.promo_price_cents ? [h('span.price-promo', money(p.promo_price_cents)), ' ', h('span.price-old', money(p.price_cents))] : h('span.price-now', money(p.price_cents)))),
    h('div.pic', img(p.image_url, p.name), disabled ? h('div.sold', 'Indisponível') : h('span.add', icon('plus', 20))));
}

function openProduct(p, r, canOrder) {
  const checks = new Map(); let qty = 1;
  const noteIn = textarea({ maxlength: 200, rows: 2, placeholder: 'Ex.: sem cebola, ponto da carne…' });
  const total = h('span');
  const calc = () => {
    const opt = p.options.filter((o) => checks.get(o.id)?.checked).reduce((s, o) => s + o.price_cents, 0);
    return { opt, sum: (p.final_price_cents + opt) * qty };
  };
  const refresh = () => { total.textContent = money(calc().sum); qtyEl.firstChild.nextSibling.textContent = qty; qtyEl.firstChild.disabled = qty <= 1; qtyEl.lastChild.disabled = qty >= 50; };
  const qtyEl = h('div.qty', h('button', { type: 'button', 'aria-label': 'Diminuir', onclick: () => { qty = Math.max(1, qty - 1); refresh(); } }, icon('minus', 16)), h('span', '1'),
    h('button', { type: 'button', 'aria-label': 'Aumentar', onclick: () => { qty = Math.min(50, qty + 1); refresh(); } }, icon('plus', 16)));
  const optsEl = p.options.length ? h('div.mt-16', h('h3', 'Adicionais'), p.options.map((o) => {
    const cb = h('input', { type: 'checkbox', disabled: !o.available, onchange: refresh }); checks.set(o.id, cb);
    return h('label.opt-row', { class: o.available ? '' : 'off' }, cb, h('span.grow', o.name, o.available ? '' : ' (indisponível)'), h('span.strong', o.price_cents ? `+ ${money(o.price_cents)}` : 'Grátis'));
  })) : null;
  const add = h('button.btn.btn-primary.grow', { disabled: !canOrder, onclick: () => {
    const picked = p.options.filter((o) => checks.get(o.id)?.checked);
    const item = { product_id: p.id, name: p.name, unit_cents: p.final_price_cents, options_cents: picked.reduce((s, o) => s + o.price_cents, 0),
      option_ids: picked.map((o) => o.id), options: picked.map((o) => o.name), note: noteIn.value.trim() || null, qty, image: p.image_url };
    const rest = { id: r.id, name: r.name };
    let res = cartAdd(rest, item);
    const finish = () => { m.close(); toast(`${qty}× ${p.name} adicionado ao carrinho.`, 'ok'); };
    if (res === 'other-restaurant') {
      confirmDialog({ title: 'Trocar de restaurante?', message: `Seu carrinho tem itens de ${state.cart.restaurant.name}. Para adicionar este item, o carrinho atual será esvaziado.`, confirmText: 'Esvaziar e adicionar', danger: true })
        .then((ok) => { if (ok) { cartAdd(rest, item, { replace: true }); finish(); } });
    } else finish();
  } }, canOrder ? ['Adicionar · ', total] : 'Indisponível no momento');
  const m = openModal({ title: p.name, size: '',
    body: [img(p.image_url, p.name, 'hero-img'), h('div', { style: { marginTop: '14px' } }, p.description ? h('p.muted', p.description) : null,
      h('div', p.promo_price_cents ? [h('span.price-promo', money(p.promo_price_cents)), ' ', h('span.price-old', money(p.price_cents))] : h('strong', money(p.price_cents))),
      optsEl, h('div.field.mt-16', h('label', { for: 'note' }, 'Observações'), (noteIn.id = 'note', noteIn)),
      !canOrder ? h('div.notice.warn', icon('alert'), 'Não é possível pedir deste restaurante agora (fechado ou fora da área de entrega).') : null)],
    footer: h('div.row', { style: { width: '100%' } }, qtyEl, add) });
  refresh();
}

/* ====================================================================== CHECKOUT */
let idemKey = null;
export async function checkout(ctx) {
  const { items, restaurant: rest } = state.cart;
  if (!items.length) return h('div.container.page', emptyState({ title: 'Seu carrinho está vazio', text: 'Adicione itens de um restaurante para finalizar.', art: 'cart', action: h('a.btn.btn-primary', { href: '#/' }, 'Ver restaurantes') }));
  idemKey = idemKey || (crypto.randomUUID?.() || `k${Date.now()}${Math.random().toString(16).slice(2)}`);
  const { addresses } = await api.get('/api/me/addresses');
  if (!ctx.alive()) return null;
  const root = h('div.container.page');
  let addrId = (addresses.find((a) => a.id === state.loc?.addressId && a.has_coords) || addresses.find((a) => a.has_coords) || addresses[0])?.id;
  let method = null; let quote = null; let qErr = null; let change = ''; let notes = '';

  if (!addresses.length) {
    return h('div.container.page', h('h1', 'Finalizar pedido'), emptyState({ title: 'Cadastre um endereço de entrega', text: 'Precisamos do endereço para confirmar que o restaurante entrega até você.', art: 'pin',
      action: h('button.btn.btn-primary', { onclick: () => openAddressForm({ onSaved: () => go('/checkout') }) }, icon('plus'), 'Adicionar endereço') }));
  }
  const body = (extra = {}) => items.map((i) => ({ product_id: i.product_id, quantity: i.qty, option_ids: i.option_ids, note: i.note, ...extra }));

  async function requote() {
    qErr = null; quote = null; draw();
    try { quote = await api.post('/api/orders/quote', { restaurant_id: rest.id, address_id: addrId, items: body() }); method = method && quote.payment_methods.some((m) => m.id === method) ? method : quote.payment_methods[0]?.id; }
    catch (e) { qErr = e; }
    draw();
  }
  function errorAdvice(e) {
    const c = e.code;
    if (c === 'OUT_OF_RANGE') return h('div', h('p', e.message), h('div.row.wrap', h('button.btn.btn-outline.btn-sm', { onclick: () => pickAddress() }, 'Escolher outro endereço'), h('a.btn.btn-outline.btn-sm', { href: '#/' }, 'Ver restaurantes que entregam aqui')));
    if (c === 'ADDRESS_NO_COORDS' || c === 'GEO_UNAVAILABLE') return h('div', h('p', e.message), h('button.btn.btn-outline.btn-sm', { onclick: () => { const a = addresses.find((x) => x.id === addrId); openAddressForm({ address: a, onSaved: () => go('/checkout') }); } }, 'Editar endereço'));
    if (['ITEM_UNAVAILABLE', 'ITEM_NOT_FOUND', 'OPTION_INVALID', 'OPTION_UNAVAILABLE'].includes(c)) return h('div', h('p', e.message), h('a.btn.btn-outline.btn-sm', { href: `#/r/${rest.id}` }, 'Voltar ao cardápio'));
    return h('div', h('p', e.message), c === 'BELOW_MIN_ORDER' ? h('a.btn.btn-outline.btn-sm', { href: `#/r/${rest.id}` }, 'Adicionar mais itens') : null);
  }
  function pickAddress() {
    const m = openModal({ title: 'Endereço de entrega', body: h('div.col', addresses.map((a) => h('button.radio-card', { type: 'button', style: { textAlign: 'left', width: '100%' }, onclick: () => { addrId = a.id; useAddress(a.has_coords ? a : a); m.close(); requote(); } },
      icon('pin', 22), h('div.grow', h('div.strong', a.label), h('div.small.muted', addrLabel(a))), a.id === addrId ? h('span.chip.green', 'Selecionado') : null)),
      h('button.btn.btn-outline', { onclick: () => { m.close(); openAddressForm({ onSaved: () => go('/checkout') }); } }, icon('plus'), 'Novo endereço')) });
  }
  async function submit(btn) {
    if (!quote || !method) return;
    const payload = { restaurant_id: rest.id, address_id: addrId, items: body(), payment_method: method, notes: notes.trim() || undefined,
      idempotency_key: idemKey, expected_total_cents: quote.total_cents, address_updated_at: quote.address_updated_at };
    if (method === 'dinheiro' && change.trim()) {
      const c = parseMoney(change);
      if (c == null || Number.isNaN(c)) { toast('Valor do troco inválido.', 'err'); return; }
      payload.change_for_cents = c;
    }
    try {
      const res = await api.post('/api/orders', payload);
      cartClear(); idemKey = null;
      toast('Pedido enviado ao restaurante!', 'ok');
      go(`/orders/${res.order.id}`);
    } catch (e) {
      if (e.code === 'PRICE_CHANGED' || e.code === 'ADDRESS_CHANGED') { toast(e.message, 'err'); await requote(); }
      else if (e.network) toast(e.message, 'err');
      else { qErr = e; draw(); toast(e.message, 'err'); }
    }
  }
  function draw() {
    const a = addresses.find((x) => x.id === addrId);
    const left = h('div.col.gap-16',
      h('section.card.card-pad', h('div.row.between', h('h3.mb-0', icon('pin', 20), ' Entregar em'), h('button.btn.btn-ghost.btn-sm', { onclick: pickAddress }, 'Trocar')),
        h('div.strong.mt-8', a.label), h('div.muted', addrLabel(a)), h('div.small.muted', `${a.city}/${a.state}${a.complement ? ' · ' + a.complement : ''}`),
        quote ? h('div.chip.green.mt-8', icon('check', 14), `${kmText(quote.distance_km)} do restaurante · limite ${quote.max_delivery_km} km`) : null),
      qErr ? h('div.notice.error', { role: 'alert' }, icon('alert'), errorAdvice(qErr)) : null,
      h('section.card.card-pad', h('h3', icon('money', 20), ' Pagamento'),
        quote ? h('div.col', quote.payment_methods.map((m) => h('label.radio-card', h('input', { type: 'radio', name: 'pay', value: m.id, checked: m.id === method, onchange: () => { method = m.id; draw(); } }), h('span.grow', m.label), m.online ? h('span.chip.blue', 'Online') : null)))
          : h('div.skeleton', { style: { height: '120px' } }),
        method === 'dinheiro' ? h('div.field.mt-16', h('label', { for: 'chg' }, 'Troco para quanto? (opcional)'), input({ id: 'chg', inputmode: 'decimal', placeholder: 'Ex.: 100,00', value: change, oninput: (e) => { change = e.target.value; } })) : null,
        method === 'online' ? h('div.notice.info.mt-16', icon('info'), 'O restaurante só recebe o pedido depois da confirmação do pagamento pelo provedor.') : null),
      h('section.card.card-pad', h('div.field.mb-0', h('label', { for: 'obs' }, 'Observações para o restaurante (opcional)'), textarea({ id: 'obs', maxlength: 300, rows: 2, value: notes, oninput: (e) => { notes = e.target.value; } }))));
    const right = h('aside.card.card-pad.cart-panel', { style: { display: 'block' } }, h('h3', rest.name),
      quote ? [quote.items.map((i) => h('div.row.between.top.small', { style: { padding: '4px 0' } }, h('span.grow', `${i.quantity}× ${i.name}`, i.options.length ? h('div.muted.xs', i.options.map((o) => o.name).join(', ')) : null), h('span', money(i.line_total_cents)))),
        h('hr.divider'), h('div.totals', h('div', h('span', 'Subtotal'), h('span', money(quote.subtotal_cents))), h('div', h('span', 'Taxa de entrega'), h('span', quote.delivery_fee_cents ? money(quote.delivery_fee_cents) : 'Grátis')),
          h('div.grand', h('span', 'Total'), h('span', money(quote.total_cents))))] : h('div.skeleton', { style: { height: '140px' } }),
      h('button.btn.btn-primary.btn-lg.btn-block.mt-16', { disabled: !quote || !method, onclick: (e) => busy(e.currentTarget, () => submit(e.currentTarget)) }, 'Confirmar pedido'),
      h('p.xs.muted.center.mt-8', 'Preços, taxa e distância são conferidos pelo servidor ao confirmar.'));
    mount(root, h('div.page-title', h('h1', 'Finalizar pedido'), h('a.btn.btn-ghost.btn-sm', { href: `#/r/${rest.id}` }, 'Voltar ao cardápio')), h('div.r-layout', left, right));
  }
  requote();
  return root;
}

/* ======================================================================= PEDIDOS */
export async function orders() {
  const { orders: list } = await api.get('/api/orders');
  const root = h('div.container.page', h('div.page-title', h('h1', 'Meus pedidos')));
  if (!list.length) { root.append(emptyState({ title: 'Você ainda não fez pedidos', text: 'Quando fizer, eles aparecem aqui para você acompanhar.', art: 'receipt', action: h('a.btn.btn-primary', { href: '#/' }, 'Pedir agora') })); return root; }
  root.append(h('div.col', list.map((o) => h('a.card.order-card', { href: `#/orders/${o.id}` }, h('div.row.between.top', h('div', h('div.strong', o.restaurant.name), h('div.small.muted', `${o.code} · ${dateTime(o.created_at)}`)), statusChip(o.status)),
    h('div.small.muted.mt-8', o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')), h('div.row.between.mt-8', h('strong', money(o.total_cents)), h('span.small', { style: { color: 'var(--brand-ink)', fontWeight: 700 } }, 'Ver detalhes →'))))));
  return root;
}

const STEPS = [['novo', 'Recebido', 'check'], ['preparando', 'Em preparo', 'flame2'], ['pronto', 'Pronto', 'bag'], ['a_caminho', 'A caminho', 'bike'], ['entregue', 'Entregue', 'home']];
const STEP_ICON = { novo: 'receipt', preparando: 'clock', pronto: 'bag', a_caminho: 'bike', entregue: 'home' };

export function statusStepper(status) {
  const idx = STEPS.findIndex(([s]) => s === status);
  return h('div.stepper', { role: 'list', 'aria-label': 'Andamento do pedido' }, STEPS.map(([s, label], i) => h('div.st', { role: 'listitem', class: i < idx || status === 'entregue' ? 'done' : i === idx ? 'now' : '', 'aria-current': i === idx ? 'step' : null },
    h('div.dot', i < idx || status === 'entregue' ? icon('check', 18) : icon(STEP_ICON[s], 18)), label)));
}

export function orderBreakdown(o) {
  return h('div', o.items.map((i) => h('div.row.between.top', { style: { padding: '5px 0' } }, h('span.grow', h('strong', `${i.quantity}× `), i.name, i.options.length ? h('div.small.muted', i.options.map((x) => x.name).join(', ')) : null, i.note ? h('div.small.muted', `“${i.note}”`) : null), h('span', money(i.line_total_cents)))),
    h('hr.divider'), h('div.totals', h('div', h('span', 'Subtotal'), h('span', money(o.subtotal_cents))), h('div', h('span', 'Taxa de entrega'), h('span', o.delivery_fee_cents ? money(o.delivery_fee_cents) : 'Grátis')), h('div.grand', h('span', 'Total'), h('span', money(o.total_cents)))));
}

export async function orderDetail(ctx) {
  const id = ctx.params.id;
  const root = h('div.container.page');
  let timer;
  const stop = () => clearInterval(timer);
  onLeave(stop);
  async function load(first) {
    const { order: o } = await api.get(`/api/orders/${id}`);
    if (!ctx.alive()) return;
    setTitle(`Pedido ${o.code}`);
    draw(o);
    if (['entregue', 'cancelado'].includes(o.status)) stop();
  }
  function draw(o) {
    const active = !['entregue', 'cancelado'].includes(o.status);
    const cancelable = o.allowed_transitions.includes('cancelado');
    const rating = starPicker(0); const comment = textarea({ maxlength: 500, rows: 3, placeholder: 'Conte como foi (opcional)' });
    mount(root, h('div.page-title', h('div', h('a.small', { href: '#/orders' }, '← Meus pedidos'), h('h1', `Pedido ${o.code}`)), statusChip(o.status)),
      h('div.r-layout', h('div.col.gap-16',
        h('section.card.card-pad', o.status === 'cancelado'
          ? h('div.notice.error', icon('x'), h('div', h('strong', 'Pedido cancelado'), o.canceled_reason ? h('div', o.canceled_reason) : null))
          : o.status === 'aguardando_pagamento' ? h('div.notice.warn', icon('clock'), h('div', h('strong', 'Aguardando a confirmação do pagamento.'), h('div', 'O restaurante receberá o pedido assim que o pagamento for confirmado.')))
            : [statusStepper(o.status), active ? h('p.small.muted.center.mt-8', 'Atualizamos automaticamente.') : null]),
        o.courier ? h('section.card.card-pad.row', icon('bike', 28), h('div.grow', h('div.strong', `${o.courier.name} está com sua entrega`), h('div.small.muted', `Veículo: ${({ moto: 'moto', bicicleta: 'bicicleta', carro: 'carro', a_pe: 'a pé' })[o.courier.vehicle] || '—'}`)),
          o.courier.phone ? h('a.btn.btn-outline.btn-sm', { href: `tel:${o.courier.phone}` }, icon('phone', 16), phoneFmt(o.courier.phone)) : null) : null,
        h('section.card.card-pad', h('h3', 'Itens'), orderBreakdown(o)),
        o.can_review ? h('section.card.card-pad', h('h3', 'Como foi seu pedido?'), rating, h('div.field.mt-8', comment), h('button.btn.btn-primary', { onclick: (e) => busy(e.currentTarget, async () => {
          if (!rating.value()) { toast('Escolha uma nota de 1 a 5.', 'err'); return; }
          try { await api.post(`/api/orders/${o.id}/review`, { rating: rating.value(), comment: comment.value }); toast('Obrigado pela avaliação!', 'ok'); load(); } catch (e2) { toast(e2.message, 'err'); }
        }) }, 'Enviar avaliação')) : null,
        o.review ? h('section.card.card-pad', h('h3', 'Sua avaliação'), stars(o.review.rating, 20), o.review.comment ? h('p.muted.mt-8', `“${o.review.comment}”`) : null) : null),
      h('div.col.gap-16', h('section.card.card-pad', h('h3', o.restaurant.name), h('div.small.muted', o.restaurant.address), o.restaurant.phone ? h('div.small.mt-8', icon('phone', 14), ' ', phoneFmt(o.restaurant.phone)) : null,
        h('hr.divider'), h('div.small.muted', 'Entrega em'), h('div', `${o.address.street}, ${o.address.number}${o.address.complement ? ' — ' + o.address.complement : ''}`), h('div.small.muted', `${o.address.neighborhood}, ${o.address.city}/${o.address.state}`),
        h('div.chip.mt-8', icon('pin', 14), kmText(o.distance_km)), h('hr.divider'), h('div.small.muted', 'Pagamento'), h('div', PAYMENT_LABEL[o.payment?.method] || o.payment?.method), h('div.small.muted', PAY_STATUS[o.payment?.status] || ''),
        o.notes ? [h('hr.divider'), h('div.small.muted', 'Suas observações'), h('div', o.notes)] : null),
        h('section.card.card-pad', h('h3', 'Histórico'), h('ul.timeline', [...o.events].reverse().map((e) => h('li', h('strong', STATUS[e.status]?.label || e.status), e.note ? ` — ${e.note}` : '', h('div.xs.muted', dateTime(e.created_at)))))),
        cancelable ? h('button.btn.btn-danger', { onclick: async () => { if (await confirmDialog({ title: 'Cancelar pedido?', message: 'Esta ação não pode ser desfeita.', confirmText: 'Cancelar pedido', cancelText: 'Manter pedido', danger: true })) { try { await api.post(`/api/orders/${o.id}/status`, { status: 'cancelado' }); toast('Pedido cancelado.'); load(); } catch (e) { toast(e.message, 'err'); } } } }, 'Cancelar pedido') : null)));
    if (active) { stop(); timer = setInterval(() => load().catch(() => {}), 10000); }
  }
  mount(root, loadingBlock(300));
  await load(true);
  return root;
}

/* ======================================================================== CONTA */
function profileCard() {
  const u = state.user;
  const f = { name: field('Nome', input({ value: u.name, maxlength: 100 })), phone: field('Telefone com DDD', input({ value: phoneFmt(u.phone), inputmode: 'tel', maxlength: 20 })) };
  return h('section.card.card-pad', h('h3', 'Meus dados'), h('div.form-grid', f.name, f.phone), h('div.field', h('label', 'E-mail'), h('div.muted', u.email)),
    h('button.btn.btn-primary', { onclick: (e) => busy(e.currentTarget, async () => {
      Object.values(f).forEach((x) => x.setError(''));
      try { const r = await api.patch('/api/me', { name: f.name.querySelector('input').value, phone: f.phone.querySelector('input').value }); setUser(r.user); toast('Dados atualizados.', 'ok'); } catch (err) { showFormError(err, f); }
    }) }, 'Salvar dados'));
}
function passwordCard() {
  const f = { current_password: field('Senha atual', input({ type: 'password', autocomplete: 'current-password' })), new_password: field('Nova senha (mín. 8 caracteres)', input({ type: 'password', autocomplete: 'new-password' })) };
  return h('section.card.card-pad', h('h3', 'Alterar senha'), h('div.form-grid', f.current_password, f.new_password),
    h('button.btn.btn-outline', { onclick: (e) => busy(e.currentTarget, async () => {
      Object.values(f).forEach((x) => x.setError(''));
      try { await api.post('/api/auth/password', { current_password: f.current_password.querySelector('input').value, new_password: f.new_password.querySelector('input').value }); toast('Senha alterada.', 'ok'); f.current_password.querySelector('input').value = ''; f.new_password.querySelector('input').value = ''; }
      catch (err) { if (err.details?.field) showFormError(err, f); else { f.current_password.setError(err.message); } }
    }) }, 'Alterar senha'));
}

export async function account() {
  const root = h('div.container.page', h('div.page-title', h('h1', 'Minha conta')));
  const addrBox = h('section.card.card-pad');
  async function loadAddr() {
    try {
      const { addresses } = await api.get('/api/me/addresses');
      mount(addrBox, h('div.row.between', h('h3.mb-0', 'Meus endereços'), h('button.btn.btn-secondary.btn-sm', { onclick: () => openAddressForm({ onSaved: loadAddr }) }, icon('plus', 16), 'Novo')),
        h('div.col.mt-16', addresses.length ? addresses.map((a) => h('div.card.card-pad', h('div.row.between.top.wrap', h('div', h('div.strong', a.label), h('div.small.muted', addrLabel(a)), h('div.small.muted', `${a.city}/${a.state}`),
          a.has_coords ? h('span.chip.green.mt-8', icon('check', 14), 'Localização confirmada') : h('span.chip.red.mt-8', icon('alert', 14), 'Localização não confirmada')),
          h('div.row.wrap', a.has_coords ? h('button.btn.btn-outline.btn-sm', { onclick: () => { useAddress(a); toast('Endereço definido como local de entrega.', 'ok'); } }, 'Usar agora') : null,
            h('button.btn.btn-outline.btn-sm', { onclick: () => openAddressForm({ address: a, onSaved: loadAddr }) }, icon('edit', 16), 'Editar'),
            h('button.btn.btn-danger.btn-sm', { 'aria-label': `Excluir ${a.label}`, onclick: async () => { if (await confirmDialog({ title: 'Excluir endereço?', message: `${addrLabel(a)}`, confirmText: 'Excluir', danger: true })) { try { await api.del(`/api/me/addresses/${a.id}`); loadAddr(); } catch (e) { toast(e.message, 'err'); } } } }, icon('trash', 16))))))
          : h('p.muted', 'Nenhum endereço cadastrado.')));
    } catch (e) { mount(addrBox, errorBlock(e, loadAddr)); }
  }
  loadAddr();
  root.append(h('div.col.gap-16', profileCard(), addrBox, passwordCard(), h('button.btn.btn-outline', { onclick: async () => { try { await api.post('/api/auth/logout'); } catch { /* ok */ } setUser(null); go('/'); } }, icon('logout', 18), 'Sair da conta')));
  return root;
}

/** Conta simplificada para restaurante / entregador / admin (dados + senha). */
export async function accountSimple() {
  return h('div', { style: { maxWidth: '720px' } }, h('div.page-title', h('h1', 'Minha conta')), h('div.col.gap-16', profileCard(), passwordCard()));
}
