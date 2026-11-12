import { api, setUnauthorizedHandler } from './api.js';
import { state, subscribe, setUser, setConfig, cartCount, badges } from './state.js';
import { route, parseHash, match, go, runCleanups, beginNav, isCurrent } from './router.js';
import { h, icon, mount, clear, logoMark, toast, setTitle, loadingBlock, errorBlock, emptyState, closeAllOverlays } from './ui.js';
import { openLocationPicker, openCartDrawer, locationLabel } from './views/shared.js';
import * as site from './views/site.js';
import * as auth from './views/auth.js';
import * as loja from './views/loja.js';
import * as entregas from './views/entregas.js';
import * as admin from './views/admin.js';

const app = document.getElementById('app');
const HOME = { cliente: '/', estabelecimento: '/loja', entregador: '/entregas', admin: '/admin' };
export const homeFor = (u) => (u ? HOME[u.role] || '/' : '/');

/* ------------------------------------------------------------- rotas */
route('/', { layout: 'site', roles: ['cliente', null], view: site.home, title: '' });
route('/r/:id', { layout: 'site', roles: ['cliente', null], view: site.restaurant });
route('/checkout', { layout: 'site', roles: ['cliente'], view: site.checkout, title: 'Finalizar pedido' });
route('/orders', { layout: 'site', roles: ['cliente'], view: site.orders, title: 'Meus pedidos' });
route('/orders/:id', { layout: 'site', roles: ['cliente'], view: site.orderDetail, title: 'Acompanhar pedido' });
route('/account', { layout: 'site', roles: ['cliente'], view: site.account, title: 'Minha conta' });

route('/login', { layout: 'bare', view: auth.login, title: 'Entrar' });
route('/register', { layout: 'bare', view: auth.register, title: 'Criar conta' });
route('/forgot', { layout: 'bare', view: auth.forgot, title: 'Recuperar senha' });
route('/reset', { layout: 'bare', view: auth.reset, title: 'Nova senha' });

const loja_ = { layout: 'panel', panel: 'estabelecimento', roles: ['estabelecimento'] };
route('/loja', { ...loja_, view: loja.dashboard, title: 'Pedidos' });
route('/loja/historico', { ...loja_, view: loja.history, title: 'Histórico' });
route('/loja/cardapio', { ...loja_, view: loja.menu, title: 'Cardápio' });
route('/loja/config', { ...loja_, view: loja.settings, title: 'Minha loja' });
route('/loja/avaliacoes', { ...loja_, view: loja.reviews, title: 'Avaliações' });
route('/loja/conta', { ...loja_, view: site.accountSimple, title: 'Minha conta' });

const ent_ = { layout: 'panel', panel: 'entregador', roles: ['entregador'] };
route('/entregas', { ...ent_, view: entregas.available, title: 'Entregas disponíveis' });
route('/entregas/minhas', { ...ent_, view: entregas.mine, title: 'Minhas entregas' });
route('/entregas/historico', { ...ent_, view: entregas.history, title: 'Histórico' });
route('/entregas/conta', { ...ent_, view: site.accountSimple, title: 'Minha conta' });

const adm_ = { layout: 'panel', panel: 'admin', roles: ['admin'] };
route('/admin', { ...adm_, view: admin.overview, title: 'Visão geral' });
route('/admin/pedidos', { ...adm_, view: admin.orders, title: 'Pedidos' });
route('/admin/usuarios', { ...adm_, view: admin.users, title: 'Usuários' });
route('/admin/restaurantes', { ...adm_, view: admin.restaurants, title: 'Estabelecimentos' });
route('/admin/config', { ...adm_, view: admin.settings, title: 'Configurações' });
route('/admin/conta', { ...adm_, view: site.accountSimple, title: 'Minha conta' });

const NAV = {
  estabelecimento: [
    ['/loja', 'receipt', 'Pedidos', 'pedidos'], ['/loja/historico', 'clock', 'Histórico'], ['/loja/cardapio', 'list', 'Cardápio'],
    ['/loja/config', 'store', 'Minha loja'], ['/loja/avaliacoes', 'star', 'Avaliações'], ['/loja/conta', 'user', 'Conta'],
  ],
  entregador: [
    ['/entregas', 'box', 'Disponíveis', 'disponiveis'], ['/entregas/minhas', 'bike', 'Minhas entregas', 'minhas'],
    ['/entregas/historico', 'clock', 'Histórico'], ['/entregas/conta', 'user', 'Conta'],
  ],
  admin: [
    ['/admin', 'chart', 'Visão geral'], ['/admin/pedidos', 'receipt', 'Pedidos'], ['/admin/usuarios', 'users', 'Usuários'],
    ['/admin/restaurantes', 'store', 'Estabelecimentos'], ['/admin/config', 'settings', 'Configurações'], ['/admin/conta', 'user', 'Conta'],
  ],
};
const PANEL_NAME = { estabelecimento: 'Painel do restaurante', entregador: 'Painel do entregador', admin: 'Administração' };

/* ------------------------------------------------------------- layout */
let shell = null; // { kind, main, header, nav... }

function userMenu() {
  const u = state.user;
  if (!u) {
    return [
      h('a.btn.btn-ghost.btn-sm.hide-m', { href: '#/login' }, 'Entrar'),
      h('a.btn.btn-primary.btn-sm', { href: '#/register' }, 'Cadastrar'),
    ];
  }
  const pop = h('div.menu-pop.hide', { role: 'menu' },
    h('div.who', h('div.strong', u.name), h('div.small.muted', u.email)),
    u.role === 'cliente' ? [
      h('a', { href: '#/orders', role: 'menuitem' }, icon('receipt'), 'Meus pedidos'),
      h('a', { href: '#/account', role: 'menuitem' }, icon('user'), 'Minha conta'),
    ] : h('a', { href: `#${homeFor(u)}`, role: 'menuitem' }, icon('home'), PANEL_NAME[u.role]),
    h('button', { role: 'menuitem', onclick: logout }, icon('logout'), 'Sair'));
  const btn = h('button.icon-btn', { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Menu da conta', onclick: (e) => {
    e.stopPropagation();
    const open = pop.classList.toggle('hide') === false;
    btn.setAttribute('aria-expanded', String(open));
  } }, icon('user'), h('span.hide-m', u.name.split(' ')[0]), icon('chevdown', 16));
  return h('div.menu', btn, pop);
}
document.addEventListener('click', () => {
  document.querySelectorAll('.menu-pop').forEach((p) => p.classList.add('hide'));
  document.querySelectorAll('.menu > button').forEach((b) => b.setAttribute('aria-expanded', 'false'));
});

async function logout() {
  try { await api.post('/api/auth/logout'); } catch { /* sessão já encerrada */ }
  setUser(null);
  go('/');
  toast('Você saiu da conta.');
}

function headerEl(kind) {
  const u = state.user;
  const brand = h('a.brand', { href: `#${homeFor(u)}`, 'aria-label': 'Sabor Express — início' }, logoMark(), h('span.txt', 'Sabor ', h('b', 'Express')));
  if (kind === 'bare') return h('header.site-header', h('div.container', h('div.bar', brand, h('div.header-actions', h('a.btn.btn-ghost.btn-sm', { href: '#/' }, 'Voltar ao início')))));
  if (kind === 'panel') {
    return h('header.site-header', h('div.container', { style: { maxWidth: 'none' } }, h('div.bar', brand,
      h('span.chip.brand.hide-m', PANEL_NAME[u?.role] || ''), h('div.header-actions', userMenu()))));
  }
  const q = parseHash().query.q || '';
  const search = (cls) => h('form.search' + cls, { role: 'search', onsubmit: (e) => { e.preventDefault(); const v = new FormData(e.target).get('q').toString().trim(); go(v ? `/?q=${encodeURIComponent(v)}` : '/'); } },
    h('span.ico', icon('search')), h('input', { type: 'search', name: 'q', placeholder: 'Busque por restaurante ou prato', value: q, 'aria-label': 'Buscar restaurantes ou pratos', autocomplete: 'off' }));
  const count = cartCount();
  const showCustomer = !u || u.role === 'cliente';
  return h('header.site-header', h('div.container',
    h('div.bar', brand,
      showCustomer ? h('button.loc-chip', { onclick: () => openLocationPicker(), 'aria-label': 'Alterar local de entrega' }, icon('pin', 20, 'brandc'),
        h('span.t', h('small', 'Entregar em'), h('span', locationLabel()))) : null,
      showCustomer ? search('.desktop') : null,
      h('div.header-actions',
        showCustomer ? h('button.icon-btn', { onclick: () => openCartDrawer(), 'aria-label': `Carrinho, ${count} ${count === 1 ? 'item' : 'itens'}` }, icon('cart', 22), h('span.hide-m', 'Carrinho'), count ? h('span.count', count) : null) : null,
        userMenu())),
    showCustomer ? h('div.mobile-search', search('')) : null));
}

function bottomNav() {
  const u = state.user;
  if (u && u.role !== 'cliente') return null;
  const { path } = parseHash();
  const count = cartCount();
  const item = (href, ic, label, extra) => h('a', { href: `#${href}`, class: path === href ? 'active' : '', 'aria-current': path === href ? 'page' : null }, icon(ic, 22), label, extra);
  return h('nav.bottom-nav', { 'aria-label': 'Navegação principal' },
    item('/', 'home', 'Início'), item('/orders', 'receipt', 'Pedidos'),
    h('a', { href: '#', onclick: (e) => { e.preventDefault(); openCartDrawer(); } }, icon('cart', 22), 'Carrinho', count ? h('span.count', count) : null),
    item(u ? '/account' : '/login', 'user', u ? 'Conta' : 'Entrar'));
}

const footer = () => h('footer.footer', h('div.container.cols',
  h('div', h('strong', 'Sabor Express'), h('div.small', `Entregamos em até ${state.config.max_delivery_km} km do restaurante.`)),
  h('div.small', 'Pagamento na entrega ou online · Dados protegidos')));

function renderNav() {
  if (!shell || shell.kind !== 'panel') return;
  const role = state.user?.role;
  const { path } = parseHash();
  const items = NAV[role] || [];
  const link = (it, tab) => {
    const [href, ic, label, badge] = it;
    const active = path === href;
    const n = badge ? badges[badge] : 0;
    return h('a', { href: `#${href}`, class: active ? 'active' : '', 'aria-current': active ? 'page' : null }, icon(ic, tab ? 18 : 20), label, n ? h('span.badge', n) : null);
  };
  mount(shell.sidebar, h('div.grp', 'Menu'), items.map((it) => link(it, false)));
  mount(shell.tabs, items.map((it) => link(it, true)));
}

function buildShell(kind) {
  if (shell && shell.kind === kind) {
    mount(shell.headerSlot, headerEl(kind));
    if (shell.bottomSlot) mount(shell.bottomSlot, bottomNav());
    return shell;
  }
  clear(app);
  const headerSlot = h('div.header-slot'); mount(headerSlot, headerEl(kind));
  if (kind === 'panel') {
    const sidebar = h('nav.sidebar', { 'aria-label': 'Menu do painel' });
    const tabs = h('nav.panel-tabs', { 'aria-label': 'Menu do painel' });
    const main = h('main.panel-main#main', { tabindex: '-1' });
    shell = { kind, headerSlot, sidebar, tabs, main };
    app.append(headerSlot, tabs, h('div.panel-shell', sidebar, main));
  } else {
    const main = h('main#main', { tabindex: '-1' });
    const bottomSlot = h('div.header-slot');
    shell = { kind, headerSlot, main, bottomSlot };
    app.append(headerSlot, main);
    if (kind === 'site') { app.append(footer()); mount(bottomSlot, bottomNav()); app.append(bottomSlot); }
  }
  return shell;
}

/* ----------------------------------------------------------- navegação */
async function navigate() {
  const id = beginNav();
  runCleanups();
  closeAllOverlays();
  const { path, query } = parseHash();
  const m = match(path);
  const u = state.user;

  if (!m) {
    const s = buildShell('site');
    mount(s.main, h('div.container.page', emptyState({ title: 'Página não encontrada', text: 'O endereço que você abriu não existe.', action: h('a.btn.btn-primary', { href: '#/' }, 'Voltar ao início'), art: 'search' })));
    setTitle('Página não encontrada');
    return;
  }
  const { route: r, params } = m;
  // Guarda de acesso (a autorização real é sempre do servidor; isto só direciona a navegação).
  if (r.roles) {
    const role = u ? u.role : null;
    if (!r.roles.includes(role)) {
      if (!u) { go(`/login?next=${encodeURIComponent(path + (location.hash.includes('?') ? '?' + location.hash.split('?')[1] : ''))}`, { replace: true }); return; }
      go(homeFor(u), { replace: true }); return;
    }
  }
  if (r.layout === 'bare' && u && path !== '/reset') { go(query.next && query.next.startsWith('/') ? query.next : homeFor(u), { replace: true }); return; }

  const s = buildShell(r.layout);
  if (r.layout === 'panel') renderNav();
  const target = s.main;
  mount(target, r.layout === 'bare' ? loadingBlock(300) : h('div.container.page', loadingBlock(220)));
  setTitle(r.title || '');
  const ctx = { params, query, path, nav: id, alive: () => isCurrent(id) };
  try {
    const node = await r.view(ctx);
    if (!isCurrent(id)) return;
    if (node) mount(target, node);
  } catch (err) {
    if (!isCurrent(id)) return;
    console.error(err);
    mount(target, h('div.container.page', errorBlock(err, () => navigate())));
  }
  if (isCurrent(id)) { window.scrollTo({ top: 0 }); target.focus({ preventScroll: true }); }
}

window.addEventListener('hashchange', navigate);
subscribe((what) => {
  if (!shell) return;
  if (what === 'cart' || what === 'user' || what === 'loc') {
    mount(shell.headerSlot, headerEl(shell.kind));
    if (shell.bottomSlot) mount(shell.bottomSlot, bottomNav());
  }
  if (what === 'badge') renderNav();
  if (what === 'user') { shell = null; }
});

setUnauthorizedHandler(() => {
  if (!state.user) return;
  setUser(null);
  toast('Sua sessão expirou. Entre novamente.', 'err');
  go(`/login?next=${encodeURIComponent(parseHash().path)}`);
});

/* ---------------------------------------------------------------- boot */
(async function boot() {
  mount(app, h('div', { style: { padding: '60px 20px', textAlign: 'center' } }, logoMark(56), h('p.muted', 'Carregando…')));
  try {
    const [cfg, me] = await Promise.all([api.get('/api/config'), api.get('/api/auth/me', { quiet401: true })]);
    setConfig(cfg);
    state.user = me.user;
  } catch (e) {
    mount(app, h('div.container.page', errorBlock(e, () => location.reload())));
    return;
  }
  state.ready = true;
  if (!location.hash || location.hash === '#') location.hash = '/';
  navigate();
})();
