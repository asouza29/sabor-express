import { api } from '../api.js';
import { setUser } from '../state.js';
import { go, parseHash } from '../router.js';
import { h, icon, field, input, busy, toast, showFormError, logoMark } from '../ui.js';

const HOME = { cliente: '/', estabelecimento: '/loja', entregador: '/entregas', admin: '/admin' };

function layout(title, subtitle, ...content) {
  return h('div.auth-wrap',
    h('aside.auth-side', h('div', { style: { position: 'relative', zIndex: 1 } }, logoMark(64, { tile: true }), h('h1.mt-16', 'Comida boa, do jeito que você gosta.'),
      h('p', 'Peça dos restaurantes da sua região, acompanhe cada etapa e receba rápido.'),
      h('ul', ['Entregas em até 15 km do restaurante', 'Pague na entrega ou online', 'Acompanhe o pedido em tempo real'].map((t) => h('li', h('span.ck', icon('check', 16)), t))))),
    h('div.auth-form', h('div.box', h('h1', title), subtitle ? h('p.muted', subtitle) : null, ...content)));
}

function afterLogin(user) {
  setUser(user);
  const next = parseHash().query.next;
  go(next && next.startsWith('/') && user.role === 'cliente' ? next : HOME[user.role] || '/', { replace: true });
}

export async function login() {
  const f = { email: field('E-mail', input({ type: 'email', autocomplete: 'email', required: true, autofocus: true })), password: field('Senha', input({ type: 'password', autocomplete: 'current-password', required: true })) };
  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); btn.click(); } }, f.email, f.password,
    h('div.row.between.mb-16', h('span'), h('a.small', { href: '#/forgot' }, 'Esqueci minha senha')));
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit', onclick: (e) => { e.preventDefault(); busy(e.currentTarget, async () => {
    Object.values(f).forEach((x) => x.setError(''));
    try { const r = await api.post('/api/auth/login', { email: f.email.querySelector('input').value, password: f.password.querySelector('input').value }, { quiet401: true }); afterLogin(r.user); }
    catch (err) { if (err.status === 401 || err.status === 403) f.password.setError(err.message); else showFormError(err, f); }
  }); } }, 'Entrar');
  form.append(btn);
  const next = parseHash().query.next;
  return layout('Entrar', 'Bem-vindo de volta!', form, h('p.center.mt-16', 'Ainda não tem conta? ', h('a.strong', { href: `#/register${next ? `?next=${encodeURIComponent(next)}` : ''}` }, 'Cadastre-se')));
}

export async function register() {
  let role = parseHash().query.role || 'cliente';
  const f = {
    name: field('Nome completo', input({ autocomplete: 'name', maxlength: 100 })), email: field('E-mail', input({ type: 'email', autocomplete: 'email' })),
    phone: field('Telefone com DDD', input({ type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '(11) 91234-5678' })),
    password: field('Senha (mínimo 8 caracteres)', input({ type: 'password', autocomplete: 'new-password' })),
  };
  const roles = [['cliente', '🍽️', 'Quero pedir'], ['estabelecimento', '🏪', 'Sou restaurante'], ['entregador', '🛵', 'Quero entregar']];
  const pick = h('div.role-pick', { role: 'radiogroup', 'aria-label': 'Tipo de conta' }, roles.map(([v, em, label]) => h('label', h('input', { type: 'radio', name: 'role', value: v, checked: v === role, onchange: () => { role = v; } }), h('span.opt', h('span.em', em), label))));
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit', onclick: (e) => { e.preventDefault(); busy(e.currentTarget, async () => {
    Object.values(f).forEach((x) => x.setError(''));
    try { const r = await api.post('/api/auth/register', { role, name: f.name.querySelector('input').value, email: f.email.querySelector('input').value, phone: f.phone.querySelector('input').value, password: f.password.querySelector('input').value });
      toast('Conta criada! Bem-vindo(a).', 'ok'); afterLogin(r.user); }
    catch (err) { showFormError(err, f); }
  }); } }, 'Criar conta');
  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); btn.click(); } }, pick, f.name, f.email, f.phone, f.password, btn);
  return layout('Criar conta', 'Leva menos de um minuto.', form, h('p.center.mt-16', 'Já tem conta? ', h('a.strong', { href: '#/login' }, 'Entrar')));
}

export async function forgot() {
  const f = { email: field('E-mail da conta', input({ type: 'email', autocomplete: 'email', autofocus: true })) };
  const box = h('div');
  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); btn.click(); } }, f.email);
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit', onclick: (e) => { e.preventDefault(); busy(e.currentTarget, async () => {
    f.email.setError('');
    try { const r = await api.post('/api/auth/forgot', { email: f.email.querySelector('input').value });
      box.replaceChildren(h('div.notice.ok', icon('check'), h('div', r.message))); form.remove(); }
    catch (err) { showFormError(err, f); }
  }); } }, 'Enviar instruções');
  form.append(btn);
  return layout('Recuperar senha', 'Informe seu e-mail e enviaremos um link para criar uma nova senha.', form, box, h('p.center.mt-16', h('a', { href: '#/login' }, '← Voltar ao login')));
}

export async function reset(ctx) {
  const token = ctx.query.token || '';
  if (!token) return layout('Link inválido', null, h('div.notice.error', icon('alert'), 'Este link de redefinição não é válido.'), h('p.mt-16', h('a.btn.btn-primary', { href: '#/forgot' }, 'Solicitar novo link')));
  const f = { password: field('Nova senha (mínimo 8 caracteres)', input({ type: 'password', autocomplete: 'new-password', autofocus: true })) };
  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); btn.click(); } }, f.password);
  const btn = h('button.btn.btn-primary.btn-lg.btn-block', { type: 'submit', onclick: (e) => { e.preventDefault(); busy(e.currentTarget, async () => {
    f.password.setError('');
    try { await api.post('/api/auth/reset', { token, password: f.password.querySelector('input').value }); toast('Senha redefinida. Entre com a nova senha.', 'ok'); go('/login', { replace: true }); }
    catch (err) { f.password.setError(err.message); }
  }); } }, 'Salvar nova senha');
  form.append(btn);
  return layout('Criar nova senha', null, form);
}
