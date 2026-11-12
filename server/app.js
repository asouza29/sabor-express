'use strict';
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { Router, createHttpServer } = require('./lib/http');
const { AppError } = require('./lib/errors');
const { createGeocoder } = require('./lib/geocoder');
const { createMailer } = require('./lib/mailer');
const { createUploads } = require('./services/common');
const { createGeoService } = require('./services/geoService');
const { createAuthService } = require('./services/authService');
const { createAddressService } = require('./services/addressService');
const { createCatalogService } = require('./services/catalogService');
const { createRestaurantService } = require('./services/restaurantService');
const { createOrderService } = require('./services/orderService');
const { createCourierService } = require('./services/courierService');
const { createAdminService } = require('./services/adminService');
const { registerRoutes } = require('./routes');

function onError(err) {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
  }
  console.error('[erro interno]', err);
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro inesperado. Tente novamente.' } } };
}

/**
 * Monta a aplicação (camadas: rotas/API -> serviços -> domínio -> persistência).
 * `overrides` permite injetar config, banco, relógio, geocodificador e mailer (usado nos testes).
 */
function createApp(overrides = {}) {
  const config = overrides.config || loadConfig(overrides.configOverrides);
  const db = overrides.db || openDb(config.dbFile);
  const now = overrides.now || (() => new Date());
  const geocoder = overrides.geocoder || createGeocoder(config);
  const mailer = overrides.mailer || createMailer(config);
  const uploads = createUploads(config);

  const geo = createGeoService({ db, geocoder, config });
  const catalog = createCatalogService({ db, config, now });
  const svc = {
    geo, catalog,
    auth: createAuthService({ db, config, mailer }),
    addresses: createAddressService({ db, geo }),
    store: createRestaurantService({ db, geo, uploads, catalog }),
    orders: createOrderService({ db, config, now, geo }),
    courier: createCourierService({ db }),
    admin: createAdminService({ db, config, now, geocoder, mailer }),
  };

  const router = new Router();
  registerRoutes(router, { config, svc });
  const server = createHttpServer({ router, config, onError });

  return {
    server,
    ctx: { config, db, now, svc, geocoder },
    close: () => new Promise((resolve) => {
      server.close(() => { try { db.close(); } catch { /* já fechado */ } resolve(); });
      server.closeAllConnections?.();
    }),
  };
}

module.exports = { createApp };
