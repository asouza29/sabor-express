import { api } from '../api.js';
import { setBadge } from '../state.js';
import { onLeave, go } from '../router.js';
import {
  h, icon, mount, money, img, field, input, textarea, select, switchEl, busy, toast, showFormError, confirmDialog, promptDialog, openModal,
  emptyState, errorBlock, loadingBlock, statusChip, STATUS, PAYMENT_LABEL, dateTime, ago, timeOnly, kmText, stars, parseMoney, moneyInput, WEEKDAYS, getGps, phoneFmt,
} from '../ui.js';
import { UFS } from './shared.js';

/* Carrega a loja; sem loja cadastrada mostra o cadastro inicial. */
async function withStore(ctx, render) {
  const data = await api.get('/api/store');
  if (!ctx.alive()) return null;
  if (!data.store) return storeForm({ store: null, onSaved: () => go('/loja/config') });
  return render(data);
}

function checklist(on) {
  if (on.ready) return null;
  const item = (ok, text, href) => h('li.row', ok ? h('span.chip.green', icon('check', 14)) : h('span.chip.amber', icon('alert', 14)), href && !ok ? h('a', { href }, text) : h('span', text));
  return h('div.notice.warn', icon('alert'), h('div.grow', h('strong', 'Sua loja ainda não aparece para os clientes.'), h('div.small', 'Conclua os passos abaixo:'),
    h('ul', { style: { listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: '6px' } },
      item(on.has_location, 'Localização do endereço confirmada (necessária para a regra de 15 km)', '#/loja/config'),
      item(on.has_hours, 'Horários de funcionamento definidos', '#/loja/config'), item(on.has_products, 'Ao menos um produto disponível no cardápio', '#/loja/cardapio'))));
}

/* ===================================================================== PEDIDOS */
const COLS = [['novo', 'Novos'], ['preparando', 'Em preparo'], ['pronto', 'Prontos'], ['a_caminho', 'A caminho']];

function orderCard(o, reload, fresh) {
  const acts = [];
  if (o.allowed_transitions.includes('preparando')) acts.push(h('button.btn.btn-green.btn-sm', { onclick: (e) => change(e, o, 'preparando', reload) }, 'Aceitar e preparar'));
  if (o.allowed_transitions.includes('pronto')) acts.push(h('button.btn.btn-primary.btn-sm', { onclick: (e) => change(e, o, 'pronto', reload) }, 'Marcar como pronto'));
  if (o.allowed_transitions.includes('cancelado')) acts.push(h('button.btn.btn-danger.btn-sm', { onclick: async () => {
    const reason = await promptDialog({ title: 'Cancelar pedido', message: `${o.code} — o cliente será avisado.`, label: 'Motivo do cancelamento', confirmText: 'Cancelar pedido' });
    if (reason) { try { await api.post(`/api/orders/${o.id}/status`, { status: 'cancelado', reason }); toast('Pedido cancelado.'); reload(); } catch (e) { toast(e.message, 'err'); } }
  } }, 'Cancelar'));
  return h('article.kcard', { class: fresh ? 'fresh' : '' },
    h('div.row.between', h('strong', o.code), h('span.xs.muted', `há ${ago(o.created_at)}`)),
    h('div.small', o.customer?.name, ' · ', kmText(o.distance_km)),
    h('ul', o.items.map((i) => h('li', `${i.quantity}× ${i.name}`, i.options.length ? h('div.xs.muted', i.options.map((x) => x.name).join(', ')) : null, i.note ? h('div.xs.muted', `“${i.note}”`) : null))),
    o.notes ? h('div.small.notice.warn', { style: { padding: '6px 10px' } }, `Obs.: ${o.notes}`) : null,
    h('div.row.between.small', h('strong', money(o.total_cents)), h('span.muted', PAYMENT_LABEL[o.payment?.method] || '')),
    o.payment?.change_for_cents ? h('div.xs.muted', `Troco para ${money(o.payment.change_for_cents)}`) : null,
    o.status === 'pronto' || o.status === 'preparando' ? h('div.small.mt-8', o.courier ? [icon('bike', 14), ` Entregador: ${o.courier.name}`] : h('span.muted', 'Aguardando entregador aceitar')) : null,
    o.status === 'a_caminho' && o.courier ? h('div.small.mt-8', icon('bike', 14), ` ${o.courier.name} está entregando`) : null,
    acts.length ? h('div.acts', acts) : null);
}
async function change(e, o, status, reload) {
  await busy(e.currentTarget, async () => {
    try { await api.post(`/api/orders/${o.id}/status`, { status }); reload(); } catch (err) { toast(err.message, 'err'); reload(); }
  });
}

export async function dashboard(ctx) {
  return withStore(ctx, async ({ store, onboarding }) => {
    const board = h('div'); let known = null; let timer; let first = true;
    const root = h('div', h('div.page-title', h('div', h('h1', store.name), h('div.muted', 'Acompanhe e atualize os pedidos recebidos.')),
      h('label.row', h('span.strong', 'Recebendo pedidos'), switchEl(store.accepting_orders, async (v) => { try { await api.patch('/api/store', { accepting_orders: v }); toast(v ? 'Loja aberta para pedidos.' : 'Pedidos pausados.', 'ok'); } catch (e) { toast(e.message, 'err'); } }, 'Receber pedidos')))
      , checklist(onboarding), board);
    async function load() {
      try {
        const { orders } = await api.get('/api/store/orders');
        if (!ctx.alive()) return;
        const ids = new Set(orders.map((o) => o.id));
        const fresh = known ? orders.filter((o) => !known.has(o.id) && o.status === 'novo') : [];
        if (fresh.length) toast(`${fresh.length === 1 ? 'Novo pedido' : fresh.length + ' novos pedidos'}: ${fresh[0].code}`, 'ok');
        known = ids;
        const novos = orders.filter((o) => o.status === 'novo').length;
        setBadge('pedidos', novos);
        document.title = novos ? `(${novos}) Pedidos · Sabor Express` : 'Pedidos · Sabor Express';
        const freshIds = new Set(fresh.map((o) => o.id));
        mount(board, orders.length || first ? h('div.kanban', COLS.map(([st, label]) => {
          const list = orders.filter((o) => o.status === st);
          return h('section.kcol', { 'aria-label': label }, h('h3', label, h('span.n', list.length)), list.length ? list.map((o) => orderCard(o, load, freshIds.has(o.id))) : h('p.small.muted.center', 'Nenhum pedido'));
        })) : null);
        if (!orders.length) board.append(emptyState({ title: 'Nenhum pedido em andamento', text: 'Novos pedidos aparecem aqui automaticamente.', art: 'receipt' }));
        first = false;
      } catch (e) { if (first) mount(board, errorBlock(e, load)); }
    }
    mount(board, loadingBlock(200)); await load();
    timer = setInterval(load, 8000);
    onLeave(() => { clearInterval(timer); setBadge('pedidos', 0); });
    return root;
  });
}

export async function history(ctx) {
  return withStore(ctx, async () => {
    const { orders } = await api.get('/api/store/orders?scope=history');
    return h('div', h('div.page-title', h('h1', 'Histórico de pedidos')), orders.length ? h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', ['Pedido', 'Data', 'Cliente', 'Itens', 'Total', 'Status'].map((t) => h('th', t)))),
      h('tbody', orders.map((o) => h('tr', h('td', h('strong', o.code)), h('td', dateTime(o.created_at)), h('td', o.customer?.name), h('td', o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')), h('td.nowrap', money(o.total_cents)), h('td', statusChip(o.status)))))))
      : emptyState({ title: 'Sem histórico ainda', text: 'Pedidos entregues e cancelados ficam aqui.', art: 'clock' }));
  });
}

/* ==================================================================== CARDÁPIO */
export async function menu(ctx) {
  return withStore(ctx, async () => {
    const root = h('div'); const body = h('div');
    let sections = []; let products = [];
    async function load() {
      [{ sections }, { products }] = await Promise.all([api.get('/api/store/sections'), api.get('/api/store/products')]);
      draw();
    }
    function row(p) {
      return h('div.menu-row', p.image_url ? img(p.image_url, p.name) : h('div.noimg', icon('camera', 22)),
        h('div.grow', h('div.strong', p.name), h('div.small.muted.ellipsis', p.description || 'Sem descrição'),
          h('div', p.promo_price_cents ? [h('span.price-promo', money(p.promo_price_cents)), ' ', h('span.price-old', money(p.price_cents))] : money(p.price_cents), p.options.length ? h('span.xs.muted', ` · ${p.options.length} adicionais`) : null)),
        h('label.row.gap-8', h('span.small.muted.hide-m', p.available ? 'Disponível' : 'Esgotado'), switchEl(p.available, async (v) => { try { await api.patch(`/api/store/products/${p.id}/availability`, { available: v }); toast(v ? 'Produto disponível.' : 'Produto marcado como esgotado.', 'ok'); load(); } catch (e) { toast(e.message, 'err'); load(); } }, `Disponibilidade de ${p.name}`)),
        h('button.btn.btn-outline.btn-sm', { 'aria-label': `Editar ${p.name}`, onclick: () => productForm(p, sections, load) }, icon('edit', 16)),
        h('button.btn.btn-danger.btn-sm', { 'aria-label': `Excluir ${p.name}`, onclick: async () => { if (await confirmDialog({ title: 'Excluir produto?', message: `“${p.name}” será removido do cardápio. Pedidos antigos não são afetados.`, confirmText: 'Excluir', danger: true })) { try { await api.del(`/api/store/products/${p.id}`); toast('Produto excluído.'); load(); } catch (e) { toast(e.message, 'err'); } } } }, icon('trash', 16)));
    }
    function draw() {
      const groups = [...sections.map((s) => ({ s, list: products.filter((p) => p.section_id === s.id) })), { s: null, list: products.filter((p) => !sections.some((s) => s.id === p.section_id)) }];
      mount(body, products.length || sections.length ? groups.filter((g) => g.s || g.list.length).map(({ s, list }) => h('section.mt-24',
        h('div.row.between.wrap', h('h2.mb-0', s ? s.name : 'Sem seção'), s ? h('div.row.gap-8.wrap',
          h('button.btn.btn-ghost.btn-sm', { onclick: async () => { const n = await promptDialog({ title: 'Renomear seção', label: 'Nome da seção', confirmText: 'Salvar', maxlength: 60 }); if (n) { try { await api.put(`/api/store/sections/${s.id}`, { name: n }); load(); } catch (e) { toast(e.message, 'err'); } } } }, icon('edit', 16), 'Renomear'),
          h('button.btn.btn-ghost.btn-sm', { onclick: async () => { if (await confirmDialog({ title: 'Excluir seção?', message: 'Os produtos dela continuam no cardápio, sem seção.', confirmText: 'Excluir', danger: true })) { try { await api.del(`/api/store/sections/${s.id}`); load(); } catch (e) { toast(e.message, 'err'); } } } }, icon('trash', 16), 'Excluir')) : null),
        h('div.card.mt-8', list.length ? list.map(row) : h('p.muted.small', { style: { padding: '14px' } }, 'Nenhum produto nesta seção.'))))
        : emptyState({ title: 'Seu cardápio está vazio', text: 'Cadastre produtos com foto, descrição e preço. Sem produtos, sua loja não aparece para os clientes.', art: 'list', action: h('button.btn.btn-primary', { onclick: () => productForm(null, sections, load) }, icon('plus'), 'Cadastrar primeiro produto') }));
    }
    mount(root, h('div.page-title', h('h1', 'Cardápio'), h('div.row.wrap',
      h('button.btn.btn-outline', { onclick: async () => { const n = await promptDialog({ title: 'Nova seção', message: 'Ex.: Pizzas, Bebidas, Sobremesas', label: 'Nome da seção', confirmText: 'Criar', maxlength: 60 }); if (n) { try { await api.post('/api/store/sections', { name: n }); load(); } catch (e) { toast(e.message, 'err'); } } } }, icon('plus', 18), 'Nova seção'),
      h('button.btn.btn-primary', { onclick: () => productForm(null, sections, load) }, icon('plus', 18), 'Novo produto'))), body);
    mount(body, loadingBlock(240)); await load();
    return root;
  });
}

function productForm(p, sections, onSaved) {
  let file = null; let removeImage = false; let opts = (p?.options || []).map((o) => ({ ...o }));
  const f = {
    name: field('Nome do produto', input({ value: p?.name || '', maxlength: 80 })),
    price: field('Preço (R$)', input({ value: moneyInput(p?.price_cents), inputmode: 'decimal', placeholder: '0,00' })),
    promo: field('Preço promocional (opcional)', input({ value: moneyInput(p?.promo_price_cents), inputmode: 'decimal', placeholder: 'Menor que o preço' })),
    section: field('Seção', select([['', 'Sem seção'], ...sections.map((s) => [s.id, s.name])], p?.section_id ?? '')),
    description: field('Descrição', textarea({ value: p?.description || '', maxlength: 400, rows: 3, placeholder: 'Ingredientes, tamanho, acompanhamentos…' }), { full: true }),
  };
  const avail = h('input', { type: 'checkbox', checked: p ? p.available : true });
  const preview = h('div'); const imgErr = h('div.small', { style: { color: 'var(--red)' } });
  const drawPreview = () => {
    const src = file ? URL.createObjectURL(file) : removeImage ? null : p?.image_url;
    mount(preview, src ? h('img', { src, alt: 'Pré-visualização' }) : h('div.ph', icon('camera', 28)));
  };
  const picker = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', id: 'pimg', onchange: (e) => {
    const x = e.target.files[0]; imgErr.textContent = '';
    if (!x) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(x.type)) { imgErr.textContent = 'Use uma imagem JPG, PNG ou WebP.'; e.target.value = ''; return; }
    if (x.size > 3 * 1024 * 1024) { imgErr.textContent = 'A imagem deve ter no máximo 3 MB.'; e.target.value = ''; return; }
    file = x; removeImage = false; drawPreview();
  } });
  const optBox = h('div');
  const drawOpts = () => mount(optBox, opts.map((o, i) => h('div.row.mt-8', input({ value: o.name, placeholder: 'Ex.: Queijo extra', maxlength: 60, 'aria-label': 'Nome do adicional', oninput: (e) => { o.name = e.target.value; } }),
    input({ value: moneyInput(o.price_cents ?? 0), inputmode: 'decimal', style: { maxWidth: '110px' }, 'aria-label': 'Preço do adicional', oninput: (e) => { o.price_text = e.target.value; } }),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-label': 'Remover adicional', onclick: () => { opts.splice(i, 1); drawOpts(); } }, icon('trash', 16)))));
  drawPreview(); drawOpts();
  const form = h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() },
    h('div.file-drop', preview, h('div.grow', h('div.strong', 'Foto do produto'), h('div.small.muted', 'JPG, PNG ou WebP, até 3 MB.'), imgErr,
      h('div.row.wrap.mt-8', h('label.btn.btn-outline.btn-sm', { for: 'pimg' }, icon('camera', 16), file || p?.image_url ? 'Trocar foto' : 'Escolher foto'),
        p?.image_url ? h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { removeImage = true; file = null; picker.value = ''; drawPreview(); } }, 'Remover') : null)), picker),
    h('div.form-grid.mt-16', f.name, f.price, f.promo, f.section, f.description),
    h('div.field', h('label.check', avail, h('span', h('strong', 'Disponível para pedidos'), h('div.small.muted', 'Desmarque para marcar como esgotado.')))),
    h('div.field', h('div.row.between', h('span.label', 'Adicionais (opcional)'), h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: () => { opts.push({ name: '', price_cents: 0, available: true }); drawOpts(); } }, icon('plus', 14), 'Adicionar')), optBox));
  const save = h('button.btn.btn-primary', { type: 'submit', onclick: (e) => busy(e.currentTarget, async () => {
    Object.values(f).forEach((x) => x.setError(''));
    const val = (k) => f[k].querySelector('input,select,textarea').value;
    const price = parseMoney(val('price')); const promoTxt = val('promo').trim(); const promo = promoTxt ? parseMoney(promoTxt) : null;
    if (price == null || Number.isNaN(price) || price <= 0) { f.price.setError('Informe um preço válido.'); return; }
    if (promoTxt && (Number.isNaN(promo) || promo <= 0)) { f.promo.setError('Preço promocional inválido.'); return; }
    if (promo != null && promo >= price) { f.promo.setError('A promoção deve ser menor que o preço normal.'); return; }
    const options = [];
    for (const o of opts) {
      if (!o.name.trim()) continue;
      const cents = o.price_text !== undefined ? parseMoney(o.price_text) : o.price_cents;
      if (o.price_text !== undefined && o.price_text.trim() === '') { options.push({ id: o.id, name: o.name.trim(), price_cents: 0, available: o.available ?? true }); continue; }
      if (Number.isNaN(cents) || cents < 0) { toast(`Preço inválido no adicional “${o.name}”.`, 'err'); return; }
      options.push({ id: o.id ?? null, name: o.name.trim(), price_cents: cents ?? 0, available: o.available ?? true });
    }
    const fd = new FormData();
    fd.append('name', val('name')); fd.append('description', val('description')); fd.append('price_cents', String(price)); fd.append('promo_price_cents', promo == null ? '' : String(promo));
    fd.append('section_id', val('section')); fd.append('available', String(avail.checked)); fd.append('options', JSON.stringify(options));
    if (file) fd.append('image', file); else if (removeImage) fd.append('remove_image', 'true');
    try { if (p) await api.put(`/api/store/products/${p.id}`, fd); else await api.post('/api/store/products', fd); toast(p ? 'Produto atualizado.' : 'Produto cadastrado.', 'ok'); m.close(); onSaved(); }
    catch (err) { showFormError({ ...err, details: err.details?.field === 'price_cents' ? { field: 'price' } : err.details?.field === 'promo_price_cents' ? { field: 'promo' } : err.details?.field === 'section_id' ? { field: 'section' } : err.details }, f); }
  }) }, p ? 'Salvar alterações' : 'Cadastrar produto');
  const m = openModal({ title: p ? 'Editar produto' : 'Novo produto', size: 'lg', body: form, footer: [h('button.btn.btn-outline', { type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
}

/* ================================================================= MINHA LOJA */
function storeForm({ store, onSaved }) {
  let device = null;
  const s = store || {};
  return api.get('/api/catalog/categories').then(({ categories }) => {
    const f = {
      name: field('Nome da loja', input({ value: s.name || '', maxlength: 80 }), { full: true }),
      description: field('Descrição', textarea({ value: s.description || '', maxlength: 300, rows: 2 }), { full: true }),
      category_id: field('Categoria', select([['', 'Selecione'], ...categories.map((c) => [c.id, `${c.emoji} ${c.name}`])], s.category_id ?? '')),
      phone: field('Telefone com DDD', input({ value: phoneFmt(s.phone), inputmode: 'tel' })),
      zip: field('CEP (opcional)', input({ value: s.zip || '', inputmode: 'numeric', maxlength: 9 })),
      street: field('Rua / Avenida', input({ value: s.street || '', maxlength: 120 })),
      number: field('Número', input({ value: s.number || '', maxlength: 20 })), complement: field('Complemento', input({ value: s.complement || '', maxlength: 60 })),
      neighborhood: field('Bairro', input({ value: s.neighborhood || '', maxlength: 80 })), city: field('Cidade', input({ value: s.city || '', maxlength: 80 })),
      state: field('UF', select(UFS.map((u) => [u, u]), s.state || 'SP')),
      delivery_fee_cents: field('Taxa de entrega (R$)', input({ value: moneyInput(s.delivery_fee_cents ?? 0), inputmode: 'decimal' })),
      min_order_cents: field('Pedido mínimo (R$)', input({ value: moneyInput(s.min_order_cents ?? 0), inputmode: 'decimal' })),
      prep_time_min: field('Tempo de preparo (min)', input({ value: s.prep_time_min ?? 30, inputmode: 'numeric' })),
    };
    const gpsNote = h('div.small.muted', store?.has_coords ? `Localização confirmada (${s.coords_source === 'device' ? 'GPS do aparelho' : 'pelo endereço'}).` : 'Localização ainda não confirmada.');
    const status = h('div');
    const gps = h('button.btn.btn-outline.btn-sm', { type: 'button', onclick: (e) => busy(e.currentTarget, async () => { try { device = await getGps(); gpsNote.textContent = 'Localização atual capturada — será usada se o endereço não for localizado.'; } catch (err) { toast(err.message, 'err'); } }) }, icon('gps', 16), 'Usar localização atual da loja');
    const save = h('button.btn.btn-primary.btn-lg', { type: 'submit', onclick: (e) => busy(e.currentTarget, async () => {
      Object.values(f).forEach((x) => x.setError(''));
      const v = (k) => f[k].querySelector('input,select,textarea').value;
      const money = (k) => { const n = parseMoney(v(k)); return n == null ? 0 : n; };
      const body = { name: v('name'), description: v('description'), category_id: v('category_id') || null, phone: v('phone'), zip: v('zip') || null, street: v('street'), number: v('number'), complement: v('complement') || null,
        neighborhood: v('neighborhood'), city: v('city'), state: v('state'), delivery_fee_cents: money('delivery_fee_cents'), min_order_cents: money('min_order_cents'), prep_time_min: Number(v('prep_time_min')) };
      if (Number.isNaN(body.delivery_fee_cents) || Number.isNaN(body.min_order_cents)) { toast('Confira os valores em reais.', 'err'); return; }
      if (device) { body.device_lat = device.lat; body.device_lng = device.lng; }
      try {
        const r = store ? await api.patch('/api/store', body) : await api.post('/api/store', body);
        if (!r.location_confirmed) toast(r.geo_unavailable ? 'Salvo, mas o serviço de localização está indisponível. A loja só aparece para clientes após confirmar a localização.' : 'Salvo, mas não foi possível confirmar a localização. Use “Usar localização atual da loja”.', 'err');
        else toast('Loja salva.', 'ok');
        onSaved(r);
      } catch (err) { showFormError(err, f); }
    }) }, store ? 'Salvar alterações' : 'Cadastrar minha loja');
    const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); save.click(); } },
      h('section.card.card-pad', h('h3', 'Informações'), h('div.form-grid', f.name, f.description, f.category_id, f.phone)),
      h('section.card.card-pad.mt-16', h('h3', 'Endereço e localização'), h('div.form-grid', f.zip, f.street, f.number, f.complement, f.neighborhood, f.city, f.state),
        h('div.row.wrap', gps, gpsNote), h('div.notice.info.mt-16', icon('info'), `A distância das entregas (máx. 15 km) é medida a partir desta localização. Se o endereço mudar, a localização é confirmada de novo.`)),
      h('section.card.card-pad.mt-16', h('h3', 'Entrega'), h('div.form-grid', f.delivery_fee_cents, f.min_order_cents, f.prep_time_min)), status,
      h('div.mt-16', save));
    return form;
  });
}

function imagesCard(store, reload) {
  const slot = (kind, label, url) => {
    const pick = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr-only', id: `img-${kind}`, onchange: async (e) => {
      const x = e.target.files[0]; if (!x) return;
      if (x.size > 3 * 1024 * 1024) { toast('A imagem deve ter no máximo 3 MB.', 'err'); return; }
      const fd = new FormData(); fd.append(kind, x);
      try { await api.put('/api/store/images', fd); toast('Imagem atualizada.', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); }
    } });
    return h('div.file-drop', url ? img(url, label) : h('div.ph', icon('camera', 28)), h('div.grow', h('div.strong', label), h('div.small.muted', 'JPG, PNG ou WebP, até 3 MB.'),
      h('div.row.wrap.mt-8', h('label.btn.btn-outline.btn-sm', { for: `img-${kind}` }, icon('camera', 16), url ? 'Trocar' : 'Enviar'),
        url ? h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: async () => { const fd = new FormData(); fd.append(`remove_${kind}`, 'true'); try { await api.put('/api/store/images', fd); reload(); } catch (err) { toast(err.message, 'err'); } } }, 'Remover') : null)), pick);
  };
  return h('section.card.card-pad', h('h3', 'Imagens da loja'), h('div.col', slot('logo', 'Logotipo', store.logo_url), slot('cover', 'Capa', store.cover_url)));
}

async function hoursCard() {
  const { hours } = await api.get('/api/store/hours');
  const rows = hours.map((x) => ({ ...x }));
  const box = h('section.card.card-pad', h('h3', 'Horário de funcionamento'), h('p.small.muted', 'Para horários que passam da meia-noite, use por exemplo 18:00 → 02:00.'));
  rows.forEach((r) => {
    const o = input({ type: 'time', value: r.opens, 'aria-label': `Abertura ${WEEKDAYS[r.weekday]}`, onchange: (e) => { r.opens = e.target.value; } });
    const c = input({ type: 'time', value: r.closes, 'aria-label': `Fechamento ${WEEKDAYS[r.weekday]}`, onchange: (e) => { r.closes = e.target.value; } });
    const times = h('div.times', o, h('span', 'até'), c);
    const sw = switchEl(!r.closed, (on) => { r.closed = !on; times.style.opacity = on ? 1 : .35; o.disabled = c.disabled = !on; }, `${WEEKDAYS[r.weekday]} aberto`);
    times.style.opacity = r.closed ? .35 : 1; o.disabled = c.disabled = r.closed;
    box.append(h('div.hours-row', h('strong', WEEKDAYS[r.weekday]), times, h('label.row.gap-8', sw, h('span.small.muted', 'Aberto'))));
  });
  box.append(h('button.btn.btn-primary.mt-16', { onclick: (e) => busy(e.currentTarget, async () => {
    try { await api.put('/api/store/hours', { hours: rows.map((r) => ({ weekday: r.weekday, closed: r.closed, opens: r.opens, closes: r.closes })) }); toast('Horários salvos.', 'ok'); } catch (err) { toast(err.message, 'err'); }
  }) }, 'Salvar horários'));
  return box;
}

export async function settings(ctx) {
  const data = await api.get('/api/store');
  if (!ctx.alive()) return null;
  if (!data.store) return h('div', h('div.page-title', h('h1', 'Cadastre sua loja')), h('p.muted', 'Preencha os dados abaixo para começar a vender.'), await storeForm({ store: null, onSaved: () => go('/loja/config') }));
  const root = h('div');
  const reload = () => go('/loja/config');
  mount(root, h('div.page-title', h('h1', 'Minha loja')), checklist(data.onboarding), h('div.col.gap-16', await storeForm({ store: data.store, onSaved: () => reload() }), imagesCard(data.store, reload), await hoursCard()));
  return root;
}

export async function reviews(ctx) {
  return withStore(ctx, async () => {
    const { reviews: list } = await api.get('/api/store/reviews');
    const avg = list.length ? (list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(1) : null;
    return h('div', h('div.page-title', h('h1', 'Avaliações'), avg ? h('div.row', stars(avg, 22), h('span.muted', `${list.length} avaliações recentes`)) : null),
      list.length ? h('div.col', list.map((r) => h('div.card.card-pad', h('div.row.between', stars(r.rating), h('span.small.muted', `${r.author} · ${dateTime(r.created_at)}`)), r.comment ? h('p.mt-8.mb-0', r.comment) : h('p.muted.small.mt-8.mb-0', 'Sem comentário.'))))
        : emptyState({ title: 'Ainda sem avaliações', text: 'As notas dos clientes aparecem aqui depois das primeiras entregas.', art: 'star' }));
  });
}
