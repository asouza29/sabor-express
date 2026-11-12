'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_V1 = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('cliente','estabelecimento','entregador','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Casa',
  street TEXT NOT NULL,
  number TEXT NOT NULL,
  complement TEXT,
  neighborhood TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT,
  lat REAL,
  lng REAL,
  coords_source TEXT CHECK (coords_source IN ('geocoder','device')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_addresses_user ON addresses(user_id);

CREATE TABLE food_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES food_categories(id) ON DELETE SET NULL,
  phone TEXT,
  street TEXT, number TEXT, complement TEXT, neighborhood TEXT, city TEXT, state TEXT, zip TEXT,
  lat REAL, lng REAL,
  coords_source TEXT CHECK (coords_source IN ('geocoder','device')),
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  min_order_cents INTEGER NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  prep_time_min INTEGER NOT NULL DEFAULT 30,
  logo_path TEXT,
  cover_path TEXT,
  accepting_orders INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_restaurants_geo ON restaurants(lat, lng);

CREATE TABLE opening_hours (
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens TEXT NOT NULL,
  closes TEXT NOT NULL,
  PRIMARY KEY (restaurant_id, weekday)
);

CREATE TABLE menu_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES menu_sections(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  promo_price_cents INTEGER CHECK (promo_price_cents IS NULL OR promo_price_cents > 0),
  image_path TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_products_restaurant ON products(restaurant_id);

CREATE TABLE product_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  available INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_options_product ON product_options(product_id);

CREATE TABLE courier_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle TEXT NOT NULL DEFAULT 'moto' CHECK (vehicle IN ('moto','bicicleta','carro','a_pe')),
  available INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  courier_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('aguardando_pagamento','novo','preparando','pronto','a_caminho','entregue','cancelado')),
  subtotal_cents INTEGER NOT NULL,
  delivery_fee_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  addr_label TEXT, addr_street TEXT NOT NULL, addr_number TEXT NOT NULL, addr_complement TEXT,
  addr_neighborhood TEXT NOT NULL, addr_city TEXT NOT NULL, addr_state TEXT NOT NULL, addr_zip TEXT,
  addr_lat REAL NOT NULL, addr_lng REAL NOT NULL, addr_coords_source TEXT,
  distance_m INTEGER NOT NULL,
  idempotency_key TEXT,
  canceled_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  delivered_at TEXT,
  UNIQUE (customer_id, idempotency_key)
);
CREATE INDEX idx_orders_customer ON orders(customer_id, created_at);
CREATE INDEX idx_orders_restaurant ON orders(restaurant_id, status);
CREATE INDEX idx_orders_courier ON orders(courier_id, status);
CREATE INDEX idx_orders_status ON orders(status, created_at);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  options_json TEXT NOT NULL DEFAULT '[]',
  options_total_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  line_total_cents INTEGER NOT NULL
);
CREATE INDEX idx_items_order ON order_items(order_id);

CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_events_order ON order_events(order_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pendente','pago','falhou','cancelado','reembolso_pendente')),
  amount_cents INTEGER NOT NULL,
  change_for_cents INTEGER,
  provider TEXT,
  provider_ref TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reviews_restaurant ON reviews(restaurant_id);
`;

const DEFAULT_CATEGORIES = [
  ['Pizza', 'pizza', '🍕'], ['Lanches', 'lanches', '🍔'], ['Japonesa', 'japonesa', '🍣'],
  ['Brasileira', 'brasileira', '🍛'], ['Massas', 'massas', '🍝'], ['Saudável', 'saudavel', '🥗'],
  ['Açaí', 'acai', '🍧'], ['Doces', 'doces', '🍰'], ['Padaria', 'padaria', '🥖'],
  ['Carnes', 'carnes', '🥩'], ['Bebidas', 'bebidas', '🥤'], ['Salgados', 'salgados', '🥟'],
];

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version < 1) {
    db.exec('BEGIN');
    try {
      db.exec(SCHEMA_V1);
      const ins = db.prepare('INSERT INTO food_categories(name, slug, emoji, position) VALUES (?,?,?,?)');
      DEFAULT_CATEGORIES.forEach(([n, s, e], i) => ins.run(n, s, e, i));
      db.exec('PRAGMA user_version = 1');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

const norm = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

/** Abre o banco, aplica migrações e devolve um wrapper síncrono enxuto. */
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(raw);

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };

  return {
    raw,
    get: (sql, ...p) => stmt(sql).get(...norm(p)),
    all: (sql, ...p) => stmt(sql).all(...norm(p)),
    run: (sql, ...p) => {
      const r = stmt(sql).run(...norm(p));
      return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
    },
    /** Transação síncrona (não aninhar; nenhum await dentro de fn). */
    tx(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* já encerrada */ }
        throw e;
      }
    },
    close: () => raw.close(),
  };
}

module.exports = { openDb };
