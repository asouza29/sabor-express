'use strict';
const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const v = require('../lib/validate');
const { hashPassword, verifyPassword } = require('../lib/password');
const jwt = require('../lib/jwt');
const { nowIso } = require('./common');

const SELF_ROLES = ['cliente', 'estabelecimento', 'entregador'];
const SESSION_SECONDS = 7 * 24 * 3600;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createAuthService({ db, config, mailer }) {
  let dummyHash;
  const getDummyHash = () => (dummyHash ??= hashPassword('senha-inexistente', { N: config.scryptN }));

  const publicUser = (u) => ({ id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone });

  function passwordField(body, field = 'password') {
    const p = body?.[field];
    if (typeof p !== 'string' || p.length < 8) throw new AppError(400, 'VALIDATION_ERROR', 'A senha deve ter pelo menos 8 caracteres.', { field });
    if (p.length > 128) throw new AppError(400, 'VALIDATION_ERROR', 'A senha deve ter no máximo 128 caracteres.', { field });
    return p;
  }

  const issueToken = (u) => jwt.sign({ sub: u.id, v: u.token_version }, config.jwtSecret, { expiresInSec: SESSION_SECONDS });

  /** Valida o cookie de sessão; devolve o usuário ativo ou null. */
  function authenticate(token) {
    const payload = jwt.verify(token, config.jwtSecret);
    if (!payload) return null;
    const u = db.get('SELECT id, role, name, email, phone, active, token_version FROM users WHERE id = ?', payload.sub);
    if (!u || !u.active || u.token_version !== payload.v) return null;
    return u;
  }

  async function register(body) {
    const role = v.oneOf(body, 'role', SELF_ROLES, { label: 'Tipo de conta' });
    const name = v.str(body, 'name', { label: 'Nome', min: 2, max: 100 });
    const email = v.email(body, 'email');
    const phone = v.phone(body, 'phone');
    const pw = passwordField(body);
    if (db.get('SELECT 1 AS x FROM users WHERE email = ?', email)) {
      throw new AppError(409, 'EMAIL_IN_USE', 'Já existe uma conta com este e-mail.');
    }
    const hash = await hashPassword(pw, { N: config.scryptN });
    const id = db.tx(() => {
      if (db.get('SELECT 1 AS x FROM users WHERE email = ?', email)) {
        throw new AppError(409, 'EMAIL_IN_USE', 'Já existe uma conta com este e-mail.');
      }
      const r = db.run('INSERT INTO users (role, name, email, phone, password_hash) VALUES (?,?,?,?,?)', role, name, email, phone, hash);
      if (role === 'entregador') db.run('INSERT INTO courier_profiles (user_id) VALUES (?)', r.id);
      return r.id;
    });
    return db.get('SELECT * FROM users WHERE id = ?', id);
  }

  async function login(body) {
    const email = v.email(body, 'email');
    const pw = typeof body.password === 'string' ? body.password : '';
    const u = db.get('SELECT * FROM users WHERE email = ?', email);
    const ok = await verifyPassword(pw, u ? u.password_hash : await getDummyHash());
    if (!u || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    if (!u.active) throw new AppError(403, 'ACCOUNT_DISABLED', 'Esta conta está desativada. Entre em contato com o suporte.');
    return u;
  }

  /** Recuperação de senha: resposta sempre genérica (não revela se o e-mail existe). */
  async function forgotPassword(body) {
    const email = v.email(body, 'email');
    const u = db.get('SELECT * FROM users WHERE email = ? AND active = 1', email);
    if (!u) return;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.run('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)', u.id, sha256(token), expires);
    try {
      await mailer.send({
        to: u.email,
        subject: 'Sabor Express — redefinição de senha',
        text: `Olá, ${u.name}!\n\nPara criar uma nova senha, acesse (válido por 1 hora):\n${config.appUrl}/#/reset?token=${token}\n\nSe você não pediu isso, ignore este e-mail.`,
      });
    } catch (e) {
      console.error('[auth] falha ao enviar e-mail de redefinição:', e.message);
    }
  }

  async function resetPassword(body) {
    const token = v.str(body, 'token', { label: 'Token', min: 20, max: 200 });
    const pw = passwordField(body, 'password');
    const row = db.get('SELECT * FROM password_resets WHERE token_hash = ?', sha256(token));
    if (!row || row.used_at || row.expires_at < nowIso()) {
      throw new AppError(400, 'INVALID_TOKEN', 'Link de redefinição inválido ou expirado. Solicite um novo.');
    }
    const hash = await hashPassword(pw, { N: config.scryptN });
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?', hash, nowIso(), row.user_id);
      db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', nowIso(), row.id);
      db.run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', row.user_id);
    });
  }

  async function changePassword(user, body) {
    const current = typeof body.current_password === 'string' ? body.current_password : '';
    const next = passwordField(body, 'new_password');
    const u = db.get('SELECT * FROM users WHERE id = ?', user.id);
    if (!(await verifyPassword(current, u.password_hash))) {
      throw new AppError(400, 'WRONG_PASSWORD', 'A senha atual está incorreta.');
    }
    const hash = await hashPassword(next, { N: config.scryptN });
    db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?', hash, nowIso(), user.id);
    return db.get('SELECT * FROM users WHERE id = ?', user.id);
  }

  function updateProfile(user, body) {
    const name = v.str(body, 'name', { label: 'Nome', min: 2, max: 100 });
    const phone = v.phone(body, 'phone', { optional: user.role === 'admin' });
    db.run('UPDATE users SET name = ?, phone = ?, updated_at = ? WHERE id = ?', name, phone, nowIso(), user.id);
    return db.get('SELECT * FROM users WHERE id = ?', user.id);
  }

  /** Cria o administrador inicial a partir de ADMIN_EMAIL / ADMIN_PASSWORD (apenas se não houver nenhum). */
  async function ensureAdmin() {
    const { email, password, name } = config.admin;
    if (!email || !password) return null;
    if (db.get("SELECT 1 AS x FROM users WHERE role = 'admin'")) return null;
    if (password.length < 8) throw new Error('ADMIN_PASSWORD deve ter ao menos 8 caracteres.');
    const hash = await hashPassword(password, { N: config.scryptN });
    db.run("INSERT INTO users (role, name, email, password_hash) VALUES ('admin', ?, ?, ?)", name, email.toLowerCase(), hash);
    return email;
  }

  return {
    publicUser, issueToken, authenticate, register, login, forgotPassword, resetPassword,
    changePassword, updateProfile, ensureAdmin, SESSION_SECONDS,
  };
}

module.exports = { createAuthService };
