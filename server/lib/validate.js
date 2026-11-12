'use strict';
const { AppError } = require('./errors');

const fail = (field, message) => {
  throw new AppError(400, 'VALIDATION_ERROR', message, { field });
};

const isBlank = (raw) => raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

function str(src, field, { label = field, min = 1, max = 200, optional = false } = {}) {
  const raw = src == null ? undefined : src[field];
  if (isBlank(raw)) {
    if (optional) return null;
    fail(field, `${label} é obrigatório.`);
  }
  if (typeof raw !== 'string') fail(field, `${label} inválido.`);
  const v = raw.trim();
  if (v.length < min) fail(field, `${label} deve ter pelo menos ${min} caracteres.`);
  if (v.length > max) fail(field, `${label} deve ter no máximo ${max} caracteres.`);
  return v;
}

function int(src, field, { label = field, min = -Infinity, max = Infinity, optional = false } = {}) {
  let raw = src == null ? undefined : src[field];
  if (isBlank(raw)) {
    if (optional) return null;
    fail(field, `${label} é obrigatório.`);
  }
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) raw = Number(raw.trim());
  if (!Number.isInteger(raw)) fail(field, `${label} deve ser um número inteiro.`);
  if (raw < min) fail(field, `${label} deve ser no mínimo ${min}.`);
  if (raw > max) fail(field, `${label} deve ser no máximo ${max}.`);
  return raw;
}

function num(src, field, { label = field, min = -Infinity, max = Infinity, optional = false } = {}) {
  let raw = src == null ? undefined : src[field];
  if (isBlank(raw)) {
    if (optional) return null;
    fail(field, `${label} é obrigatório.`);
  }
  if (typeof raw === 'string' && raw.trim() !== '') raw = Number(raw.trim().replace(',', '.'));
  if (typeof raw !== 'number' || !Number.isFinite(raw)) fail(field, `${label} deve ser um número.`);
  if (raw < min || raw > max) fail(field, `${label} fora do intervalo permitido.`);
  return raw;
}

function bool(src, field, def = null) {
  const raw = src == null ? undefined : src[field];
  if (raw === undefined || raw === null || raw === '') return def;
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return fail(field, `${field} inválido.`);
}

function oneOf(src, field, list, { label = field, optional = false } = {}) {
  const raw = src == null ? undefined : src[field];
  if (isBlank(raw)) {
    if (optional) return null;
    fail(field, `${label} é obrigatório.`);
  }
  if (!list.includes(raw)) fail(field, `${label} inválido.`);
  return raw;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function email(src, field = 'email') {
  const v = str(src, field, { label: 'E-mail', max: 160 }).toLowerCase();
  if (!EMAIL_RE.test(v)) fail(field, 'E-mail inválido.');
  return v;
}

function phone(src, field = 'phone', { optional = false } = {}) {
  const raw = str(src, field, { label: 'Telefone', optional, max: 30 });
  if (raw === null) return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  if (!/^\d{10,11}$/.test(d)) fail(field, 'Telefone inválido. Informe DDD + número.');
  return d;
}

function zip(src, field = 'zip', { optional = true } = {}) {
  const raw = str(src, field, { label: 'CEP', optional, max: 12 });
  if (raw === null) return null;
  const d = raw.replace(/\D/g, '');
  if (!/^\d{8}$/.test(d)) fail(field, 'CEP inválido.');
  return d;
}

function uf(src, field = 'state') {
  const v = str(src, field, { label: 'UF', min: 2, max: 2 }).toUpperCase();
  if (!/^[A-Z]{2}$/.test(v)) fail(field, 'UF inválida.');
  return v;
}

function hhmm(src, field, label = field) {
  const v = str(src, field, { label, max: 5 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(field, `${label} inválido (use HH:MM).`);
  return v;
}

module.exports = { fail, str, int, num, bool, oneOf, email, phone, zip, uf, hhmm };
