// Biblioteca de UI: construtor de DOM seguro, ícones, formatação, toasts, modais.
// Regra de segurança: textos de usuário SEMPRE entram como nós de texto (nunca innerHTML).

const isAttrs = (x) => x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Node);

/** h('div.card.pad#id', {onclick}, filhos...) */
export function h(spec, attrs, ...kids) {
  if (!isAttrs(attrs)) { if (attrs !== undefined && attrs !== null) kids.unshift(attrs); attrs = {}; }
  const m = /^([a-z0-9]+)?((?:[.#][\w-]*)*)$/i.exec(spec);
  const el = document.createElement(m?.[1] || 'div');
  for (const part of (m?.[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected', 'indeterminate'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false || k === true) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...kids) => append(clear(el), kids);
export const $ = (sel, root = document) => root.querySelector(sel);

/* -------------------------------------------------------------- ícones */
const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 7H6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bike: '<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-8h5l3 8M10 9 8.5 6H6M13 9l-2 8"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  store: '<path d="M4 9 5.5 4h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.6 3-6 7-6s7 2.4 7 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.4c2.3.7 4 2.5 4 5.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/>',
  phone: '<path d="M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevdown: '<path d="m6 9 6 6 6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5"/>',
  gps: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  box: '<path d="M3 8 12 3l9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/>',
  shield: '<path d="M12 3 4 6v6c0 4.500 3.200 7.800 8 9 4.800-1.200 8-4.500 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.500-4M4 5v4h4M4 13a8 8 0 0 0 14.500 4M20 19v-4h-4"/>',
};
export function icon(name, size = 20, cls = '') {
  const s = document.createElement('span');
  s.className = `ico ${cls}`.trim();
  s.style.cssText = 'display:inline-flex;line-height:0;flex:none';
  s.setAttribute('aria-hidden', 'true');
  // Conteúdo estático definido acima (nunca dados de usuário).
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return s;
}

/** Logo oficial. `tile: true` usa a variante sobre ladrilho branco (para fundos coloridos ou escuros). */
export const logoMark = (size = 38, { tile = false } = {}) => {
  const s = document.createElement('span');
  s.className = 'mark'; s.style.cssText = `display:inline-flex;width:${size}px;height:${size}px`;
  const im = document.createElement('img');
  im.src = tile ? '/assets/brand/logo-tile.png' : '/assets/brand/logo.png';
  im.alt = ''; im.width = size; im.height = size; im.decoding = 'async';
  im.style.cssText = 'width:100%;height:100%;object-fit:contain';
  s.setAttribute('aria-hidden', 'true'); s.append(im);
  return s;
};

/* ----------------------------------------------------------- formatação */
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents) => brl.format((cents || 0) / 100);
export const kmText = (km) => `${String(km).replace('.', ',')} km`;
export const dateTime = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const timeOnly = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}
export function phoneFmt(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p || '';
}
export const parseMoney = (s) => {
  const t = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (!t) return null;
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
export const moneyInput = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export const STATUS = {
  aguardando_pagamento: { label: 'Aguardando pagamento', cls: 'amber' },
  novo: { label: 'Novo pedido', cls: 'blue' },
  preparando: { label: 'Em preparo', cls: 'brand' },
  pronto: { label: 'Pronto', cls: 'amber' },
  a_caminho: { label: 'A caminho', cls: 'blue' },
  entregue: { label: 'Entregue', cls: 'green' },
  cancelado: { label: 'Cancelado', cls: 'red' },
};
export const statusChip = (s) => h(`span.chip.${STATUS[s]?.cls || 'gray'}`, STATUS[s]?.label || s);
export const PAYMENT_LABEL = { dinheiro: 'Dinheiro na entrega', cartao_entrega: 'Cartão na entrega', pix_entrega: 'PIX na entrega', online: 'Pagamento online' };
export const PAY_STATUS = { pendente: 'Pendente', pago: 'Pago', falhou: 'Falhou', cancelado: 'Cancelado', reembolso_pendente: 'Reembolso pendente' };

/* --------------------------------------------------------------- imagens */
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#FFF0E4"/><circle cx="60" cy="62" r="28" fill="#fff" stroke="#F6CDAE" stroke-width="4"/><circle cx="60" cy="62" r="16" fill="#FFE2CC"/><path d="M24 40v28M20 40v10a4 4 0 0 0 8 0V40M96 38c-6 4-8 14-6 30M96 38v52" stroke="#E7B48D" stroke-width="3" fill="none" stroke-linecap="round" transform="translate(0 -4)"/></svg>');
export function img(src, alt = '', cls = '') {
  const el = h('img', { src: src || PLACEHOLDER, alt, loading: 'lazy', decoding: 'async', class: cls });
  el.addEventListener('error', () => { if (el.src !== PLACEHOLDER) el.src = PLACEHOLDER; }, { once: true });
  return el;
}

/* ----------------------------------------------------------- formulários */
let uid = 0;
export function field(label, control, { hint, error, full = false } = {}) {
  const id = control.id || `f${++uid}`;
  control.id = id;
  const wrap = h('div.field', { class: full ? 'full' : '' }, h('label', { for: id }, label), control,
    hint ? h('span.hint', hint) : null, h('span.err', { role: 'alert' }));
  wrap.setError = (msg) => {
    wrap.lastChild.textContent = msg || '';
    control.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  return wrap;
}
export const input = (attrs = {}) => h('input.input', attrs);
export const textarea = (attrs = {}) => h('textarea.input', attrs);
export function select(options, value, attrs = {}) {
  const s = h('select.input', attrs, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = value ?? '';
  return s;
}
export function switchEl(checked, onChange, label) {
  const i = h('input', { type: 'checkbox', checked: !!checked, 'aria-label': label, onchange: (e) => onChange?.(e.target.checked) });
  return h('span.switch', i, h('span.track'));
}

/** Aplica estado "ocupado" a um botão durante uma ação assíncrona. */
export async function busy(btn, fn) {
  if (btn.disabled) return;
  const old = [...btn.childNodes];
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  clear(btn); append(btn, [h('span.spinner')]);
  try { return await fn(); } finally {
    clear(btn); append(btn, old); btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

/** Mostra erros de validação do servidor ({details:{field}}) no campo certo; senão, toast. */
export function showFormError(err, fields) {
  const f = err?.details?.field;
  if (f && fields[f]?.setError) { fields[f].setError(err.message); fields[f].querySelector('input,select,textarea')?.focus(); return; }
  toast(err.message || 'Não foi possível concluir.', 'err');
}

/* ----------------------------------------------------------------- toasts */
export function toast(msg, type = '') {
  const box = document.getElementById('toasts');
  const t = h(`div.toast.${type}`, h('span', msg), h('button.x', { 'aria-label': 'Fechar', onclick: () => t.remove() }, icon('x', 16)));
  box.append(t);
  setTimeout(() => t.remove(), type === 'err' ? 7000 : 4200);
}

/* ------------------------------------------------------------------ modais */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let scrollLocks = 0;
const openOverlays = new Set();
/** Fecha todos os modais/gavetas abertos (usado ao navegar, p.ex. botão Voltar). */
export function closeAllOverlays() { [...openOverlays].forEach((o) => o.close()); }
const lockScroll = (on) => {
  scrollLocks += on ? 1 : -1;
  document.body.style.overflow = scrollLocks > 0 ? 'hidden' : '';
};

function overlay(kind, panel, { onClose, dismissible = true }) {
  const prev = document.activeElement;
  const wrap = h(`div.${kind}-wrap`, h('div.scrim', { onclick: () => dismissible && api.close() }), panel);
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  const keydown = (e) => {
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); api.close(); }
    if (e.key === 'Tab') {
      const els = [...panel.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!els.length) return;
      const first = els[0]; const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const api = {
    el: panel,
    close(result) {
      if (!wrap.isConnected) return;
      openOverlays.delete(api);
      wrap.remove(); lockScroll(false);
      document.removeEventListener('keydown', keydown, true);
      try { prev?.focus?.(); } catch { /* elemento removido */ }
      onClose?.(result);
    },
  };
  openOverlays.add(api);
  document.body.append(wrap); lockScroll(true);
  document.addEventListener('keydown', keydown, true);
  // Foco inicial no primeiro campo — mas nunca "rouba" o foco se a pessoa já foi para outro campo do painel.
  setTimeout(() => {
    if (!wrap.isConnected || panel.contains(document.activeElement)) return;
    (panel.querySelector('[autofocus]') || panel.querySelector('.mbody input,.mbody select,.mbody textarea') || panel.querySelector(FOCUSABLE))?.focus();
  }, 30);
  return api;
}

export function openModal({ title, body, footer, size = '', onClose, dismissible = true }) {
  const panel = h(`div.modal${size ? '.' + size : ''}`, { 'aria-label': title },
    h('header', h('h2', title), dismissible ? h('button.icon-btn', { 'aria-label': 'Fechar', onclick: () => m.close() }, icon('x')) : null),
    h('div.mbody', body), footer ? h('footer', footer) : null);
  const m = overlay('modal', panel, { onClose, dismissible });
  return m;
}

export function openDrawer({ title, body, footer, onClose }) {
  const panel = h('aside.drawer', { 'aria-label': title },
    h('header', h('h2', title), h('button.icon-btn', { 'aria-label': 'Fechar', onclick: () => d.close() }, icon('x'))),
    h('div.dbody', body), footer ? h('footer', footer) : null);
  const d = overlay('drawer', panel, { onClose });
  return d;
}

export function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Voltar', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const m = openModal({
      title, size: 'sm', body: h('p', message), onClose: () => resolve(answer),
      footer: [
        h('button.btn.btn-outline', { onclick: () => m.close() }, cancelText),
        h(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, { autofocus: true, onclick: () => { answer = true; m.close(); } }, confirmText),
      ],
    });
  });
}

export function promptDialog({ title, message, label, placeholder = '', confirmText = 'Confirmar', required = true, maxlength = 200 }) {
  return new Promise((resolve) => {
    let answer = null;
    const i = textarea({ placeholder, maxlength, rows: 3 });
    const f = field(label, i);
    const submit = () => {
      const v = i.value.trim();
      if (required && !v) { f.setError('Preencha este campo.'); i.focus(); return; }
      answer = v; m.close();
    };
    const m = openModal({
      title, size: 'sm', body: [message ? h('p.muted', message) : null, f], onClose: () => resolve(answer),
      footer: [h('button.btn.btn-outline', { onclick: () => m.close() }, 'Voltar'), h('button.btn.btn-primary', { onclick: submit }, confirmText)],
    });
  });
}

/* ------------------------------------------------------------- estados */
export function emptyState({ title, text, action, art = 'bag' }) {
  return h('div.empty', h('div.art', icon(art, 96, 'muted')), h('h3', title), text ? h('p', text) : null, action || null);
}
export const skeletonCards = (n = 6) => h('div.rest-grid', Array.from({ length: n }, () => h('div.skeleton.sk-card', { 'aria-hidden': 'true' })));
export const loadingBlock = (h2 = 160) => h('div.skeleton', { style: { height: `${h2}px` }, role: 'status', 'aria-label': 'Carregando' });
export const errorBlock = (err, retry) => h('div.notice.error', { role: 'alert' }, icon('alert'),
  h('div.grow', h('strong', 'Não foi possível carregar.'), h('div', err?.message || ''),
    retry ? h('button.btn.btn-outline.btn-sm.mt-8', { onclick: retry }, 'Tentar de novo') : null));

export const stars = (n, size = 16) => h('span.rating', { 'aria-label': `Nota ${n}` }, h('span.star', icon('star', size)), n == null ? '—' : String(n).replace('.', ','));

export function starPicker(initial = 0, onChange) {
  let val = initial;
  const wrap = h('div.stars', { role: 'radiogroup', 'aria-label': 'Nota de 1 a 5' });
  const draw = () => {
    clear(wrap);
    for (let i = 1; i <= 5; i++) {
      wrap.append(h('button', {
        type: 'button', class: i <= val ? 'on' : '', role: 'radio', 'aria-checked': i === val, 'aria-label': `${i} ${i === 1 ? 'estrela' : 'estrelas'}`,
        onclick: () => { val = i; onChange?.(i); draw(); },
      }, icon('star', 34)));
    }
  };
  draw();
  wrap.value = () => val;
  return wrap;
}

/** Geolocalização do navegador → { lat, lng } (com mensagens de erro em português). */
export function getGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Seu navegador não oferece localização.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'Permissão de localização negada. Libere o acesso no navegador ou escolha um endereço.' : 'Não foi possível obter sua localização agora.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

export function setTitle(t) { document.title = t ? `${t} · Sabor Express` : 'Sabor Express — comida boa, entrega rápida'; }
