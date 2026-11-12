import { api, qs } from '../api.js';
import { state } from '../state.js';
import {
  h, icon, mount, money, select, input, switchEl, toast, busy, confirmDialog, promptDialog, openModal, emptyState, errorBlock, loadingBlock, statusChip, STATUS, dateTime,
  kmText, PAYMENT_LABEL, PAY_STATUS, stars,
} from '../ui.js';
import { orderBreakdown } from './site.js';
import { go } from '../router.js';

const ROLE = { cliente: 'Cliente', estabelecimento: 'Restaurante', entregador: 'Entregador', admin: 'Administrador' };

/** Chip de situação da CONTA / do restaurante na plataforma (diferente de "aberto agora"). */
const stateChip = (on, onText = 'Ativo', offText = 'Inativo') => h(`span.chip.${on ? 'green' : 'gray'}`, on ? onText : offText);

/**
 * Interruptor de ativação com confirmação ao desativar.
 * `apply(v)` faz a chamada à API; `confirm` (opcional) devolve a configuração do diálogo ao desativar.
 */
function activationSwitch({ active, label, confirm, apply, done, revert }) {
  const sw = switchEl(active, async (v) => {
    const box = sw.querySelector('input');
    if (!v && confirm) {
      box.disabled = true;
      const ok = await confirmDialog({ ...confirm, danger: true });
      box.disabled = false;
      if (!ok) { box.checked = true; return; }
    }
    box.disabled = true;
    try { await apply(v); toast(v ? 'Ativado com sucesso.' : 'Desativado com sucesso.', 'ok'); done(); }
    catch (e) { box.checked = !v; box.disabled = false; toast(e.message, 'err'); revert?.(); }
  }, label);
  return sw;
}

const kpi = (cls, ic, value, label) => h('div.card.kpi', { class: cls }, h('div.ico', icon(ic, 20)), h('div.v', value), h('div.l', label));

export async function overview() {
  const s = await api.get('/api/admin/stats');
  const max = Math.max(1, ...s.daily.map((d) => d.orders));
  const u = (r) => s.users.find((x) => x.role === r)?.total || 0;
  const active = Object.entries(s.orders.by_status).filter(([k]) => ['novo', 'preparando', 'pronto', 'a_caminho', 'aguardando_pagamento'].includes(k)).reduce((a, [, n]) => a + n, 0);
  return h('div', h('div.page-title', h('h1', 'Visão geral'), h('span.chip.brand', `Entregas até ${state.config.max_delivery_km} km`)),
    h('div.kpis', kpi('', 'receipt', s.orders.last_24h, 'Pedidos nas últimas 24 h'), kpi('blue', 'bike', active, 'Pedidos em andamento'), kpi('green', 'check', s.orders.delivered_count, 'Pedidos entregues'),
      kpi('green', 'money', money(s.orders.delivered_revenue_cents), 'Faturamento entregue'), kpi('', 'store', `${s.restaurants.active}/${s.restaurants.total}`, 'Restaurantes ativos'),
      kpi('blue', 'star', s.rating.average ?? '—', `Nota média (${s.rating.count} avaliações)`)),
    s.restaurants.without_location ? h('div.notice.warn.mb-16', icon('alert'), `${s.restaurants.without_location} restaurante(s) sem localização confirmada — não aparecem para clientes nem recebem pedidos (regra de 15 km).`) : null,
    h('div.r-layout.split-3-2',
      h('section.card.card-pad', h('h3', 'Pedidos nos últimos 7 dias'), h('div.bars', { role: 'img', 'aria-label': 'Gráfico de pedidos por dia' }, s.daily.map((d) => h('div.b', h('span.n', d.orders), h('div.bar', { style: { height: `${Math.max(2, (d.orders / max) * 100)}%` } }), h('span.d', d.date.slice(8) + '/' + d.date.slice(5, 7)))))),
      h('section.card.card-pad', h('h3', 'Usuários'), h('div.col.gap-8', ['cliente', 'estabelecimento', 'entregador', 'admin'].map((r) => h('div.row.between', h('span', ROLE[r]), h('strong', u(r))))),
        h('hr.divider'), h('h3', 'Pedidos por status'), h('div.row.wrap', Object.entries(s.orders.by_status).map(([k, n]) => h('span.chip', { class: STATUS[k]?.cls || '' }, `${STATUS[k]?.label || k}: ${n}`))))),
    h('section.card.card-pad.mt-16', h('h3', 'Restaurantes com mais entregas'), s.top_restaurants.length ? h('div.tbl-wrap', { style: { border: 0 } }, h('table.tbl', h('thead', h('tr', ['Restaurante', 'Entregas', 'Faturamento'].map((t) => h('th', t)))),
      h('tbody', s.top_restaurants.map((r) => h('tr', h('td', h('strong', r.name)), h('td', r.delivered), h('td', money(r.revenue_cents))))))) : h('p.muted', 'Sem entregas concluídas ainda.')));
}

function orderModal(o, reload) {
  const body = h('div', h('div.row.between', statusChip(o.status), h('span.small.muted', dateTime(o.created_at))),
    h('p.small.mt-8', h('strong', o.restaurant.name), ' → ', o.customer?.name, h('br'), `${o.address.street}, ${o.address.number} — ${o.address.neighborhood}, ${o.address.city}/${o.address.state} (${kmText(o.distance_km)})`),
    orderBreakdown(o), h('hr.divider'), h('div.small', 'Pagamento: ', h('strong', PAYMENT_LABEL[o.payment?.method] || o.payment?.method), ' · ', PAY_STATUS[o.payment?.status] || ''),
    o.courier ? h('div.small', 'Entregador: ', h('strong', o.courier.name)) : null, h('hr.divider'),
    h('ul.timeline', [...o.events].reverse().map((e) => h('li', h('strong', STATUS[e.status]?.label || e.status), ` · ${e.actor_role}`, e.note ? ` — ${e.note}` : '', h('div.xs.muted', dateTime(e.created_at))))));
  const foot = [];
  if (o.status === 'aguardando_pagamento') foot.push(h('button.btn.btn-green', { onclick: (e) => busy(e.currentTarget, async () => { try { await api.post(`/api/admin/orders/${o.id}/confirm-payment`); toast('Pagamento confirmado.', 'ok'); m.close(); reload(); } catch (err) { toast(err.message, 'err'); } }) }, 'Confirmar pagamento manualmente'));
  if (o.allowed_transitions.includes('cancelado')) foot.push(h('button.btn.btn-danger', { onclick: async () => {
    const reason = await promptDialog({ title: 'Cancelar pedido', label: 'Motivo', confirmText: 'Cancelar pedido' });
    if (reason) { try { await api.post(`/api/orders/${o.id}/status`, { status: 'cancelado', reason }); toast('Pedido cancelado.'); m.close(); reload(); } catch (err) { toast(err.message, 'err'); } }
  } }, 'Cancelar pedido'));
  foot.push(h('button.btn.btn-outline', { onclick: () => m.close() }, 'Fechar'));
  const m = openModal({ title: `Pedido ${o.code}`, size: 'lg', body, footer: foot });
}

export async function orders() {
  let status = ''; let q = '';
  const box = h('div');
  async function load() {
    mount(box, loadingBlock(200));
    try {
      const { orders: list } = await api.get('/api/admin/orders' + qs({ status, q, limit: 100 }));
      mount(box, list.length ? h('div.tbl-wrap', h('table.tbl.stack', h('thead', h('tr', ['Pedido', 'Data', 'Restaurante', 'Cliente', 'Total', 'Status', ''].map((t) => h('th', t)))),
        h('tbody', list.map((o) => h('tr', h('td', { 'data-label': 'Pedido' }, h('strong', o.code)), h('td', { 'data-label': 'Data' }, dateTime(o.created_at)), h('td', { 'data-label': 'Restaurante' }, o.restaurant.name), h('td', { 'data-label': 'Cliente' }, o.customer?.name), h('td.nowrap', { 'data-label': 'Total' }, money(o.total_cents)), h('td', { 'data-label': 'Status' }, statusChip(o.status)),
          h('td', { 'data-label': '' }, h('button.btn.btn-outline.btn-sm', { onclick: () => orderModal(o, load) }, 'Detalhes'))))))) : emptyState({ title: 'Nenhum pedido encontrado', text: 'Ajuste os filtros.', art: 'receipt' }));
    } catch (e) { mount(box, errorBlock(e, load)); }
  }
  const search = input({ type: 'search', placeholder: 'Código, cliente ou restaurante', 'aria-label': 'Buscar pedidos', style: { maxWidth: '300px' } });
  let tm; search.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { q = search.value.trim(); load(); }, 300); });
  await load();
  return h('div', h('div.page-title', h('h1', 'Pedidos'), h('div.row.wrap', search,
    select([['', 'Todos os status'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])], '', { 'aria-label': 'Filtrar por status', style: { width: 'auto' }, onchange: (e) => { status = e.target.value; load(); } }))), box);
}

export async function users() {
  let role = ''; let q = ''; let act = '';
  const box = h('div');
  async function load() {
    mount(box, loadingBlock(200));
    try {
      const { users: list } = await api.get('/api/admin/users' + qs({ role, q, active: act }));
      mount(box, list.length ? h('div.tbl-wrap', h('table.tbl.stack', h('thead', h('tr', ['Nome', 'E-mail', 'Perfil', 'Cadastro', 'Conta', ''].map((t) => h('th', t)))),
        h('tbody', list.map((u) => h('tr', h('td', { 'data-label': 'Nome' }, h('div', h('strong', u.name), u.restaurant_name ? h('div.xs.muted', u.restaurant_name) : null)), h('td', { 'data-label': 'E-mail' }, u.email), h('td', { 'data-label': 'Perfil' }, h('span.chip.brand', ROLE[u.role])), h('td', { 'data-label': 'Cadastro' }, dateTime(u.created_at)),
          h('td', { 'data-label': 'Conta' }, h('div.row.gap-8', u.id === state.user.id ? [stateChip(true, 'Ativa'), h('span.xs.muted', 'você')]
            : [activationSwitch({
              active: u.active, label: `Conta ativa: ${u.name}`, done: load, revert: load,
              apply: (v) => api.patch(`/api/admin/users/${u.id}`, { active: v }),
              confirm: { title: 'Desativar conta?', confirmText: 'Desativar',
                message: `${u.name} (${ROLE[u.role]}) não conseguirá mais entrar nem usar a plataforma${u.role === 'estabelecimento' ? '; o painel do restaurante e a vitrine ficarão indisponíveis' : ''}. Nenhum dado, pedido ou histórico será apagado e você poderá reativar a conta quando quiser.`,
              },
            }), stateChip(u.active, 'Ativa', 'Inativa')])),
          h('td', { 'data-label': '' }, ['cliente', 'admin'].includes(u.role) && u.id !== state.user.id ? h('button.btn.btn-ghost.btn-sm', { onclick: async () => {
            const to = u.role === 'admin' ? 'cliente' : 'admin';
            if (await confirmDialog({ title: 'Alterar permissão?', message: `${u.name} passará a ser ${ROLE[to]}.`, confirmText: 'Alterar', danger: to === 'admin' })) { try { await api.patch(`/api/admin/users/${u.id}`, { role: to }); load(); } catch (e) { toast(e.message, 'err'); } }
          } }, u.role === 'admin' ? 'Tornar cliente' : 'Tornar admin') : null)))))) : emptyState({ title: 'Nenhum usuário encontrado', art: 'users' }));
    } catch (e) { mount(box, errorBlock(e, load)); }
  }
  const search = input({ type: 'search', placeholder: 'Nome ou e-mail', 'aria-label': 'Buscar usuários', style: { maxWidth: '260px' } });
  let tm; search.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { q = search.value.trim(); load(); }, 300); });
  await load();
  return h('div', h('div.page-title', h('h1', 'Usuários'), h('div.row.wrap', search,
    select([['', 'Todos os perfis'], ...Object.entries(ROLE)], '', { 'aria-label': 'Filtrar por perfil', style: { width: 'auto' }, onchange: (e) => { role = e.target.value; load(); } }),
    select([['', 'Ativos e inativos'], ['1', 'Somente ativos'], ['0', 'Somente inativos']], '', { 'aria-label': 'Filtrar por situação', style: { width: 'auto' }, onchange: (e) => { act = e.target.value; load(); } }))), box);
}

export async function restaurants() {
  const box = h('div');
  async function load() {
    try {
      const { restaurants: list } = await api.get('/api/admin/restaurants');
      mount(box, list.length ? h('div.tbl-wrap', h('table.tbl.stack', h('thead', h('tr', ['Restaurante', 'Responsável', 'Local', 'Produtos', 'Pedidos', 'Nota', 'Localização', 'Na plataforma', 'Funcionamento'].map((t) => h('th', t)))),
        h('tbody', list.map((r) => h('tr', h('td', { 'data-label': 'Restaurante' }, h('strong', r.name)), h('td', { 'data-label': 'Responsável' }, h('div', r.owner_name, h('div.xs.muted', r.owner_email), r.owner_active ? null : h('span.chip.red', 'Conta do responsável inativa'))), h('td', { 'data-label': 'Local' }, `${r.neighborhood}, ${r.city}`), h('td', { 'data-label': 'Produtos' }, r.products), h('td', { 'data-label': 'Pedidos' }, r.orders), h('td', { 'data-label': 'Nota' }, r.rating_avg != null ? stars(r.rating_avg) : '—'),
          h('td', { 'data-label': 'Localização' }, r.has_coords ? h('span.chip.green', icon('check', 14), r.coords_source === 'device' ? 'GPS' : 'Confirmada') : h('span.chip.red', icon('alert', 14), 'Sem localização')),
          h('td', { 'data-label': 'Na plataforma' }, h('div.row.gap-8', activationSwitch({
            active: r.active, label: `Restaurante ativo na plataforma: ${r.name}`, done: load, revert: load,
            apply: (v) => api.patch(`/api/admin/restaurants/${r.id}`, { active: v }),
            confirm: { title: 'Desativar restaurante?', confirmText: 'Desativar',
              message: `${r.name} deixará de aparecer para os clientes e não receberá novos pedidos. Produtos, pedidos anteriores e histórico são preservados.${r.open_orders ? ` Atenção: há ${r.open_orders} pedido(s) em andamento — eles NÃO serão cancelados nem apagados e continuam disponíveis para tratamento na aba Pedidos.` : ''}`,
            },
          }), stateChip(r.active, 'Ativo', 'Inativo'))),
          h('td', { 'data-label': 'Funcionamento' }, h('span.chip', { class: r.open_now ? 'green' : 'gray' }, r.open_now ? 'Aberto agora' : 'Fechado agora'))))))) : emptyState({ title: 'Nenhum estabelecimento cadastrado', art: 'store' }));
    } catch (e) { mount(box, errorBlock(e, load)); }
  }
  mount(box, loadingBlock(200)); await load();
  return h('div', h('div.page-title', h('h1', 'Estabelecimentos')), box);
}

export async function settings() {
  const s = await api.get('/api/admin/settings');
  const row = (k, v) => h('div.row.between.top', { style: { padding: '9px 0', borderBottom: '1px solid var(--line-2)' } }, h('span.muted', k), h('strong', { style: { textAlign: 'right' } }, v));
  const yes = (b) => h(`span.chip.${b ? 'green' : 'amber'}`, b ? 'Configurado' : 'Não configurado');
  return h('div', h('div.page-title', h('h1', 'Configurações operacionais'), h('span.chip.gray', s.environment)),
    h('div.notice.info.mb-16', icon('info'), 'Estes parâmetros são definidos no servidor (variáveis de ambiente e código) e exibidos aqui somente para consulta.'),
    h('div.r-layout.split-2',
      h('section.card.card-pad', h('h3', 'Regra de entrega'), row('Distância máxima', `${s.delivery.max_km} km`), row('Limite incluso?', s.delivery.inclusive ? 'Sim (15,0 km é permitido)' : 'Não'), row('Método', s.delivery.method), row('Referência', s.delivery.reference), row('Arredondamento', s.delivery.rounding), row('Validação', s.delivery.validated_on)),
      h('section.card.card-pad', h('h3', 'Integrações'), row('Fuso horário', s.timezone), row('Geocodificador', h('span', s.geocoder.provider, ' ', yes(s.geocoder.enabled))), row('Coordenadas do aparelho (GPS)', s.device_coords_allowed ? 'Aceitas como reserva' : 'Desativadas'),
        row('Pagamento online', yes(s.online_payment_enabled)), row('E-mail (recuperação de senha)', yes(s.mailer_enabled)))));
}
