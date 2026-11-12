import { api } from '../api.js';
import { setBadge } from '../state.js';
import { onLeave, go } from '../router.js';
import {
  h, icon, mount, money, select, switchEl, toast, busy, confirmDialog, emptyState, errorBlock, loadingBlock, statusChip, kmText, phoneFmt, dateTime, ago, PAYMENT_LABEL,
} from '../ui.js';

const VEHICLES = [['moto', 'Moto'], ['bicicleta', 'Bicicleta'], ['carro', 'Carro'], ['a_pe', 'A pé']];

async function profileBar(onChange) {
  const { profile } = await api.get('/api/courier/profile');
  const state = h('div');
  const draw = (p) => {
    state.className = `avail-toggle ${p.available ? 'on' : 'off'}`;
    mount(state, icon('bike', 28), h('div.grow', h('div.strong', p.available ? 'Você está disponível' : 'Você está indisponível'),
      h('div.small.muted', p.available ? 'Entregas elegíveis aparecem na aba “Disponíveis”.' : 'Ative para ver e aceitar entregas.')),
      select(VEHICLES, p.vehicle, { 'aria-label': 'Veículo', style: { width: 'auto' }, onchange: async (e) => { try { draw((await api.patch('/api/courier/profile', { vehicle: e.target.value })).profile); } catch (err) { toast(err.message, 'err'); } } }),
      h('label.row.gap-8', h('span.small.strong', p.available ? 'Online' : 'Offline'), switchEl(p.available, async (v) => {
        try { const r = await api.patch('/api/courier/profile', { available: v }); draw(r.profile); onChange?.(); toast(v ? 'Você está online.' : 'Você está offline.', 'ok'); } catch (err) { toast(err.message, 'err'); }
      }, 'Disponível para entregas')));
  };
  draw(profile);
  return h('div.col', state, h('div.row.wrap.small.muted', h('span', `${profile.delivered_count} entregas concluídas`), h('span', `${profile.active_count} em andamento`)));
}

function poll(ctx, load, ms = 8000) {
  const t = setInterval(() => ctx.alive() && load().catch(() => {}), ms);
  onLeave(() => clearInterval(t));
}

export async function available(ctx) {
  const list = h('div'); let first = true;
  const bar = await profileBar(() => load());
  async function load() {
    try {
      const r = await api.get('/api/courier/deliveries/available');
      if (!ctx.alive()) return;
      setBadge('disponiveis', r.orders.length);
      if (!r.available) { mount(list, emptyState({ title: 'Você está offline', text: 'Ative sua disponibilidade para ver entregas.', art: 'bike' })); return; }
      mount(list, r.orders.length ? h('div.col', r.orders.map((o) => h('article.card.card-pad',
        h('div.row.between.top', h('div', h('div.strong', o.restaurant.name), h('div.small.muted', o.restaurant.address)), statusChip(o.status)),
        h('div.row.wrap.mt-8', h('span.chip', icon('pin', 14), `${kmText(o.distance_km)} até o cliente`), h('span.chip', icon('box', 14), `${o.items.reduce((s, i) => s + i.quantity, 0)} itens`), h('span.chip.gray', `há ${ago(o.created_at)}`)),
        h('div.small.muted.mt-8', `Entrega em: ${o.address.neighborhood}, ${o.address.city}`),
        h('button.btn.btn-primary.mt-16', { onclick: (e) => busy(e.currentTarget, async () => {
          try { await api.post(`/api/orders/${o.id}/accept-delivery`); toast('Entrega aceita!', 'ok'); go('/entregas/minhas'); } catch (err) { toast(err.message, 'err'); load(); }
        }) }, 'Aceitar entrega'))))
        : emptyState({ title: 'Nenhuma entrega disponível', text: 'Novas entregas aparecem aqui assim que um restaurante começa a preparar.', art: 'box' }));
    } catch (e) { if (first) mount(list, errorBlock(e, load)); }
    first = false;
  }
  mount(list, loadingBlock(200)); await load(); poll(ctx, load);
  return h('div', h('div.page-title', h('h1', 'Entregas disponíveis')), h('div.mb-16', bar), list);
}

function deliveryCard(o, reload) {
  const acts = [];
  if (o.allowed_transitions.includes('a_caminho')) acts.push(h('button.btn.btn-primary', { onclick: (e) => step(e, o, 'a_caminho', reload) }, icon('bike', 18), 'Retirei o pedido — iniciar entrega'));
  if (o.allowed_transitions.includes('entregue')) acts.push(h('button.btn.btn-green', { onclick: (e) => step(e, o, 'entregue', reload) }, icon('check', 18), 'Confirmar entrega'));
  const waiting = !acts.length && ['preparando', 'pronto'].includes(o.status);
  const cashish = ['dinheiro', 'cartao_entrega', 'pix_entrega'].includes(o.payment?.method) && o.payment?.status !== 'pago';
  return h('article.card.card-pad',
    h('div.row.between.top', h('div', h('div.strong', o.code), h('div.small.muted', dateTime(o.created_at))), statusChip(o.status)),
    h('div.grid', { style: { display: 'grid', gap: '14px', marginTop: '12px' } },
      h('div', h('div.xs.strong.muted', 'RETIRAR EM'), h('div.strong', o.restaurant.name), h('div.small', o.restaurant.address), o.restaurant.phone ? h('a.small', { href: `tel:${o.restaurant.phone}` }, icon('phone', 14), ' ', phoneFmt(o.restaurant.phone)) : null),
      h('div', h('div.xs.strong.muted', 'ENTREGAR PARA'), h('div.strong', o.customer?.name),
        h('div.small', `${o.address.street}, ${o.address.number}${o.address.complement ? ' — ' + o.address.complement : ''}`), h('div.small.muted', `${o.address.neighborhood}, ${o.address.city}/${o.address.state} · ${kmText(o.distance_km)}`),
        o.customer?.phone ? h('a.small', { href: `tel:${o.customer.phone}` }, icon('phone', 14), ' ', phoneFmt(o.customer.phone)) : null),
      h('div', h('div.xs.strong.muted', 'PEDIDO'), h('ul', { style: { margin: '4px 0', paddingLeft: '18px' } }, o.items.map((i) => h('li.small', `${i.quantity}× ${i.name}`))), o.notes ? h('div.small.notice.warn', { style: { padding: '6px 10px' } }, `Obs.: ${o.notes}`) : null)),
    cashish ? h('div.notice.info.mt-8', icon('money'), h('div', h('strong', `Cobrar do cliente: ${money(o.total_cents)}`), h('div.small', PAYMENT_LABEL[o.payment.method]), o.payment.change_for_cents ? h('div.small', `Levar troco para ${money(o.payment.change_for_cents)}`) : null)) : h('div.chip.green.mt-8', icon('check', 14), 'Pagamento já confirmado'),
    waiting ? h('div.notice.warn.mt-8', icon('clock'), 'Aguardando o restaurante marcar o pedido como pronto.') : null,
    h('div.row.wrap.mt-16', acts, o.can_release_delivery ? h('button.btn.btn-danger.btn-sm', { onclick: async () => { if (await confirmDialog({ title: 'Devolver entrega?', message: 'Ela voltará para a lista de disponíveis.', confirmText: 'Devolver', danger: true })) { try { await api.post(`/api/orders/${o.id}/release-delivery`); toast('Entrega devolvida.'); reload(); } catch (e) { toast(e.message, 'err'); } } } }, 'Devolver entrega') : null));
}
async function step(e, o, status, reload) {
  await busy(e.currentTarget, async () => { try { await api.post(`/api/orders/${o.id}/status`, { status }); toast(status === 'entregue' ? 'Entrega concluída. Bom trabalho!' : 'Boa entrega!', 'ok'); } catch (err) { toast(err.message, 'err'); } reload(); });
}

export async function mine(ctx) {
  const list = h('div'); let first = true;
  async function load() {
    try {
      const { orders } = await api.get('/api/courier/deliveries');
      if (!ctx.alive()) return;
      setBadge('minhas', orders.length);
      mount(list, orders.length ? h('div.col', orders.map((o) => deliveryCard(o, load))) : emptyState({ title: 'Nenhuma entrega em andamento', text: 'Aceite uma entrega na aba “Disponíveis”.', art: 'bike', action: h('a.btn.btn-primary', { href: '#/entregas' }, 'Ver disponíveis') }));
    } catch (e) { if (first) mount(list, errorBlock(e, load)); }
    first = false;
  }
  mount(list, loadingBlock(200)); await load(); poll(ctx, load);
  return h('div', h('div.page-title', h('h1', 'Minhas entregas')), list);
}

export async function history() {
  const { orders } = await api.get('/api/courier/deliveries?scope=history');
  return h('div', h('div.page-title', h('h1', 'Histórico de entregas')), orders.length
    ? h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', ['Pedido', 'Data', 'Restaurante', 'Bairro', 'Distância', 'Status'].map((t) => h('th', t)))),
      h('tbody', orders.map((o) => h('tr', h('td', h('strong', o.code)), h('td', dateTime(o.delivered_at || o.updated_at)), h('td', o.restaurant.name), h('td', o.address.neighborhood), h('td', kmText(o.distance_km)), h('td', statusChip(o.status)))))))
    : emptyState({ title: 'Sem entregas no histórico', text: 'Entregas concluídas aparecem aqui.', art: 'clock' }));
}
