'use strict';
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const truthy = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'sim', 'on'].includes(String(v).toLowerCase()));

/**
 * Carrega a configuração a partir de variáveis de ambiente.
 * `o` permite sobrescritas (usado nos testes).
 */
function loadConfig(o = {}) {
  const env = process.env;
  const isProd = (o.nodeEnv ?? env.NODE_ENV) === 'production';
  const dataDir = o.dataDir ?? env.DATA_DIR ?? path.join(root, 'data');
  const jwtSecret = o.jwtSecret ?? env.JWT_SECRET ?? (isProd ? null : crypto.randomBytes(32).toString('hex'));
  if (!jwtSecret || jwtSecret.length < 16) {
    throw new Error('JWT_SECRET (mínimo de 16 caracteres) é obrigatório em produção.');
  }
  const port = Number(o.port ?? env.PORT ?? 3000);
  const webhookSecret = o.paymentWebhookSecret ?? env.PAYMENT_WEBHOOK_SECRET ?? null;

  return Object.freeze({
    isProd,
    root,
    dataDir,
    dbFile: o.dbFile ?? env.DB_FILE ?? path.join(dataDir, 'saborexpress.db'),
    uploadsDir: o.uploadsDir ?? path.join(dataDir, 'uploads'),
    publicDir: path.join(root, 'public'),
    port,
    host: env.HOST || '0.0.0.0',
    appUrl: env.APP_URL || `http://localhost:${port}`,
    jwtSecret,
    scryptN: Number(o.scryptN ?? env.SCRYPT_N ?? 16384),
    cookieSecure: o.cookieSecure ?? truthy(env.COOKIE_SECURE, isProd),
    trustProxy: truthy(env.TRUST_PROXY, false),
    timezone: env.STORE_TIMEZONE || 'America/Sao_Paulo',
    rateLimitEnabled: o.rateLimitEnabled ?? truthy(env.RATE_LIMIT, true),
    logRequests: o.logRequests ?? truthy(env.LOG_REQUESTS, false),
    // Coordenadas informadas pelo aparelho (GPS) só são aceitas quando o geocodificador
    // do servidor não consegue resolver o endereço. Em produção, com geocodificador
    // confiável configurado, recomenda-se ALLOW_DEVICE_COORDS=false.
    allowDeviceCoords: o.allowDeviceCoords ?? truthy(env.ALLOW_DEVICE_COORDS, true),
    geocoderProvider: o.geocoderProvider ?? env.GEOCODER_PROVIDER ?? 'nominatim', // 'nominatim' | 'none'
    geocoderContact: env.GEOCODER_CONTACT || 'contato@saborexpress.local',
    // Pagamento online: só habilitado quando há segredo de webhook do gateway configurado.
    paymentWebhookSecret: webhookSecret,
    onlinePaymentEnabled: Boolean(webhookSecret),
    // E-mail transacional (recuperação de senha) via webhook HTTP de um provedor/automação.
    mailWebhookUrl: o.mailWebhookUrl ?? env.MAIL_WEBHOOK_URL ?? null,
    mailFrom: env.MAIL_FROM || 'Sabor Express <nao-responda@saborexpress.local>',
    admin: {
      email: env.ADMIN_EMAIL || null,
      password: env.ADMIN_PASSWORD || null,
      name: env.ADMIN_NAME || 'Administrador',
    },
  });
}

module.exports = { loadConfig };
