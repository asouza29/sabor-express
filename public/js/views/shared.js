import { api } from '../api.js';
import { state, setLoc, subscribe, cartSetQty, cartClear, cartEstimate, cartCount } from '../state.js';
import { go } from '../router.js';
import {
  h, icon, openModal, openDrawer, mount, field, input, select, toast, busy, showFormError, getGps, money, img, emptyState, clear,
} from '../ui.js';

export const locationLabel = () => state.loc?.label || 'Escolha onde receber';

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export const addrLabel = (a) => `${a.street}, ${a.number}${a.neighborhood ? ' — ' + a.neighborhood : ''}`;

/** Seleciona um endereço salvo (com coordenadas) como local de entrega. */
export function useAddress(a) {
  setLoc({ lat: a.lat, lng: a.lng, label: addrLabel(a), source: 'address', addressId: a.id });
}

/** Formulário de endereço (criar/editar). onSaved(result) recebe a resposta da API. */
export function openAddressForm({ address = null, onSaved } = {}) {
  let device = null;
  const f = {
    label: field('Apelido', input({ value: address?.label || 'Casa', maxlength: 30, placeholder: 'Casa, Trabalho…' })),
    zip: field('CEP (opcional)', input({ value: address?.zip || '', inputmode: 'numeric', maxlength: 9, placeholder: '00000-000' })),
    street: field('Rua / Avenida', input({ value: address?.street || '', maxlength: 120, autocomplete: 'address-line1' }), { full: true }),
    number: field('Número', input({ value: address?.number || '', maxlength: 20 })),
    complement: field('Complemento', input({ value: address?.complement || '', maxlength: 60, placeholder: 'Apto, bloco…' })),
    neighborhood: field('Bairro', input({ value: address?.neighborhood || '', maxlength: 80 })),
    city: field('Cidade', input({ value: address?.city || '', maxlength: 80 })),
    state: field('UF', select(UFS.map((u) => [u, u]), address?.state || 'SP')),
  };
  const gpsNote = h('div.small.muted');
  const gpsBtn = h('button.btn.btn-outline.btn-sm', { type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
    try {
      device = await getGps();
      gpsNote.textContent = 'Localização atual capturada. Ela só é usada se não conseguirmos localizar o endereço digitado.';
      toast('Localização capturada.', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }) }, icon('gps', 18), 'Usar minha localização atual');
  const form = h('form', { novalidate: true, onsubmit: (e) => e.preventDefault() },
    h('div.form-grid', f.label, f.zip, f.street, f.number, f.complement, f.neighborhood, f.city, f.state),
    h('div.notice.info', icon('info'), h('div', 'Só entregamos em até ', h('strong', `${state.config.max_delivery_km} km`), ' do restaurante. Confirmamos a localização do endereço antes de cada pedido.')),
    h('div.row.wrap.mt-16', gpsBtn, gpsNote));
  const save = h('button.btn.btn-primary', { type: 'submit', onclick: (e) => busy(e.currentTarget, async () => {
    Object.values(f).forEach((x) => x.setError(''));
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.querySelector('input,select').value]));
    if (device) { body.device_lat = device.lat; body.device_lng = device.lng; }
    try {
      const res = address ? await api.put(`/api/me/addresses/${address.id}`, body) : await api.post('/api/me/addresses', body);
      if (!res.location_confirmed) {
        toast(res.geo_unavailable
          ? 'Endereço salvo, mas o serviço de localização está indisponível. Tente confirmar mais tarde.'
          : 'Endereço salvo, mas não conseguimos confirmar a localização. Use “Usar minha localização atual” ao editar.', 'err');
      } else toast('Endereço salvo.', 'ok');
      m.close(); onSaved?.(res);
    } catch (err) { showFormError(err, f); }
  }) }, 'Salvar endereço');
  const m = openModal({ title: address ? 'Editar endereço' : 'Novo endereço', size: 'lg', body: form, footer: [h('button.btn.btn-outline', { type: 'button', onclick: () => m.close() }, 'Cancelar'), save] });
  form.addEventListener('submit', (e) => { e.preventDefault(); save.click(); });
  return m;
}

/** Seletor do local de entrega: endereços salvos, GPS ou novo endereço. */
export function openLocationPicker({ onDone } = {}) {
  const body = h('div');
  const isCustomer = state.user?.role === 'cliente';
  let m;
  const done = () => { m?.close(); onDone?.(); };

  async function draw() {
    mount(body, h('div.col',
      h('button.btn.btn-secondary.btn-block', { onclick: (e) => busy(e.currentTarget, async () => {
        try {
          const p = await getGps();
          setLoc({ lat: p.lat, lng: p.lng, label: 'Minha localização atual', source: 'gps' });
          toast('Mostrando restaurantes perto de você.', 'ok'); done();
        } catch (err) { toast(err.message, 'err'); }
      }) }, icon('gps'), 'Usar minha localização atual'),
      isCustomer ? h('div', h('h3.mt-8', 'Meus endereços'), h('div.col#addr-list', h('div.skeleton', { style: { height: '70px' } }))) : null,
      isCustomer
        ? h('button.btn.btn-outline.btn-block', { onclick: () => openAddressForm({ onSaved: async (res) => { if (res.address.has_coords) { useAddress(res.address); done(); } else draw(); } }) }, icon('plus'), 'Adicionar novo endereço')
        : h('div.notice.info', icon('info'), h('div', h('a', { href: '#/login', onclick: () => m?.close() }, 'Entre'), ' ou ', h('a', { href: '#/register', onclick: () => m?.close() }, 'crie sua conta'), ' para salvar endereços de entrega.'))));
    if (!isCustomer) return;
    try {
      const { addresses } = await api.get('/api/me/addresses');
      const list = body.querySelector('#addr-list');
      if (!list) return;
      mount(list, addresses.length ? addresses.map((a) => h('button.radio-card', { type: 'button', style: { textAlign: 'left', width: '100%' }, disabled: !a.has_coords, onclick: () => { useAddress(a); done(); } },
        icon('pin', 22), h('div.grow', h('div.strong', a.label), h('div.small.muted', addrLabel(a)),
          a.has_coords ? null : h('div.small', { style: { color: 'var(--red)' } }, 'Localização não confirmada — edite o endereço em Minha conta.')),
        state.loc?.addressId === a.id ? h('span.chip.green', 'Atual') : null))
        : h('p.muted', 'Você ainda não tem endereços salvos.'));
    } catch (err) { toast(err.message, 'err'); }
  }
  m = openModal({ title: 'Onde você quer receber?', body });
  draw();
  return m;
}

/* ------------------------------------------------------------ carrinho */
export function cartLines(onChange, { compact = false } = {}) {
  const { items } = state.cart;
  return items.map((it, i) => h('div.cart-line',
    img(it.image, '', 'cl-thumb'), // miniatura (tamanho limitado no CSS)
    h('div.cl-body',
      h('div.cl-top', h('div.cl-name', it.name),
        h('button.cl-remove', { type: 'button', 'aria-label': `Remover ${it.name}`, title: 'Remover', onclick: () => { cartSetQty(i, 0); onChange?.(); } }, icon('trash', 16))),
      it.options.length ? h('div.cl-meta', it.options.join(', ')) : null,
      it.note ? h('div.cl-meta', `“${it.note}”`) : null,
      h('div.cl-bottom',
        h('div.qty', h('button', { type: 'button', 'aria-label': `Diminuir ${it.name}`, disabled: it.qty <= 1, onclick: () => { cartSetQty(i, it.qty - 1); onChange?.(); } }, icon('minus', 16)),
          h('span', { 'aria-live': 'polite' }, it.qty),
          h('button', { type: 'button', 'aria-label': `Aumentar ${it.name}`, disabled: it.qty >= 50, onclick: () => { cartSetQty(i, it.qty + 1); onChange?.(); } }, icon('plus', 16))),
        h('span.cl-price', money((it.unit_cents + it.options_cents) * it.qty))))));
}

export function openCartDrawer() {
  const body = h('div'); const foot = h('div');
  let d;
  const draw = () => {
    const { items, restaurant } = state.cart;
    if (!items.length) {
      mount(body, emptyState({ title: 'Seu carrinho está vazio', text: 'Escolha um restaurante e adicione seus pratos favoritos.', art: 'cart' }));
      mount(foot); foot.style.display = 'none'; return;
    }
    foot.style.display = '';
    mount(body, h('div.row.between.mt-8', h('a', { href: `#/r/${restaurant.id}`, onclick: () => d.close() }, h('strong', restaurant.name)),
      h('button.btn.btn-ghost.btn-sm', { onclick: () => { cartClear(); } }, 'Esvaziar')), cartLines());
    mount(foot, h('div.totals', h('div', h('span', 'Subtotal estimado'), h('strong', money(cartEstimate()))),
      h('div.small.muted', 'Taxa de entrega e total finais são calculados no checkout.')),
      h('button.btn.btn-primary.btn-block.mt-8', { onclick: () => { d.close(); go(state.user ? '/checkout' : '/login?next=%2Fcheckout'); } }, 'Ir para o checkout'));
  };
  d = openDrawer({ title: `Carrinho${cartCount() ? ` (${cartCount()})` : ''}`, body, footer: foot, onClose: () => unsub() });
  const unsub = subscribe((w) => { if (w === 'cart') draw(); });
  draw();
  return d;
}
