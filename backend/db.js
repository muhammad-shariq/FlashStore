'use strict';
/**
 * SQLite access layer. The database at data/store.db is the single source of
 * truth for the whole site; web/ is disposable generated output.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'store.db');

const SCHEMA_VERSION = 1;

function open() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id               INTEGER PRIMARY KEY,
      handle           TEXT NOT NULL UNIQUE,
      title            TEXT NOT NULL,
      body_html        TEXT DEFAULT '',
      body_text        TEXT DEFAULT '',
      vendor           TEXT DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'active',   -- active | hidden
      shopify_status   TEXT DEFAULT '',                  -- original flag, informational
      shopify_published TEXT DEFAULT '',
      seo_title        TEXT DEFAULT '',
      seo_description  TEXT DEFAULT '',
      fits_models      TEXT DEFAULT '[]',                -- JSON array of model strings
      condition_grade  TEXT DEFAULT '',
      part_type        TEXT DEFAULT '',
      faq              TEXT DEFAULT '[]',                -- JSON array of {q,a}
      position         INTEGER DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

    CREATE TABLE IF NOT EXISTS images (
      id            INTEGER PRIMARY KEY,
      product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      position      INTEGER NOT NULL DEFAULT 1,
      src_original  TEXT DEFAULT '',      -- remote CDN url (empty for admin uploads)
      base_filename TEXT NOT NULL,        -- e.g. "01-samsung-s10e" (no extension/size)
      alt           TEXT DEFAULT '',
      width         INTEGER DEFAULT 0,
      height        INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_images_product ON images(product_id, position);

    CREATE TABLE IF NOT EXISTS variants (
      id                INTEGER PRIMARY KEY,
      product_id        INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku               TEXT DEFAULT '',
      position          INTEGER NOT NULL DEFAULT 1,
      opt1_name         TEXT DEFAULT '',
      opt1_value        TEXT DEFAULT '',
      opt2_name         TEXT DEFAULT '',
      opt2_value        TEXT DEFAULT '',
      opt3_name         TEXT DEFAULT '',
      opt3_value        TEXT DEFAULT '',
      price             REAL DEFAULT 0,
      compare_at_price  REAL DEFAULT 0,
      barcode           TEXT DEFAULT '',
      grams             REAL DEFAULT 0,
      weight_unit       TEXT DEFAULT 'kg',
      available         INTEGER DEFAULT 1,
      optionless        INTEGER DEFAULT 0,
      image_id          INTEGER REFERENCES images(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id, position);

    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'category',   -- category | brand
      description TEXT DEFAULT '',                    -- SEO intro copy
      seo_title       TEXT DEFAULT '',
      seo_description TEXT DEFAULT '',
      faq         TEXT DEFAULT '[]',
      parent_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      position    INTEGER DEFAULT 0,
      featured    INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (product_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS build_log (
      id            INTEGER PRIMARY KEY,
      started_at    TEXT,
      finished_at   TEXT,
      pages_written INTEGER DEFAULT 0,
      ok            INTEGER DEFAULT 0,
      message       TEXT DEFAULT ''
    );
  `);
  db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(String(SCHEMA_VERSION));
}

/* ---------- settings helpers ---------- */

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, value == null ? '' : String(value));
}

function allSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

module.exports = { open, DB_PATH, ROOT, getSetting, setSetting, allSettings, SCHEMA_VERSION };
