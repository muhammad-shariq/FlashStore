#!/usr/bin/env node
'use strict';
/**
 * Seeds data/store.db from the Shopify product export.
 *
 * Idempotent: re-running refreshes the Shopify-owned columns (title, body,
 * vendor, variants, image list) but leaves admin-owned columns alone once they
 * hold a value — seo_title, seo_description, fits_models, condition_grade,
 * part_type, faq, status and category assignments. Pass --force to re-derive
 * everything from the CSV, discarding those edits.
 *
 *   node scripts/import-shopify.js [--csv <path>] [--force]
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const db = require('../backend/db');
const { cleanHtml, toText, truncate, composeTitle } = require('../backend/lib/sanitize');
const { slugify } = require('../backend/lib/slug');
const { detectPartType, detectCondition, extractModels } = require('../backend/lib/extract');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const csvArg = argv.indexOf('--csv');
const CSV_PATH = csvArg !== -1 && argv[csvArg + 1]
  ? path.resolve(argv[csvArg + 1])
  : path.join(ROOT, 'shopify backup ', 'products_export_1.csv');

const num = (v) => {
  const n = Number.parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
/** Shopify exports SKUs with a leading apostrophe to stop Excel mangling them. */
const cleanSku = (v) => String(v || '').replace(/^'+/, '').trim();

/** Stable, readable filename stem for an image: "03-s-l1600-1". */
function imageStem(url, position) {
  const base = decodeURIComponent(String(url).split('?')[0].split('/').pop() || 'image');
  const stem = slugify(base.replace(/\.[a-z0-9]+$/i, '')) || 'image';
  return `${String(position).padStart(2, '0')}-${stem}`.slice(0, 80);
}

function loadGroups(csvPath) {
  const rows = parse(fs.readFileSync(csvPath), { columns: true, bom: true, relax_quotes: true });
  const groups = new Map();
  for (const r of rows) {
    const handle = String(r.Handle || '').trim();
    if (!handle) continue;
    if (!groups.has(handle)) groups.set(handle, []);
    groups.get(handle).push(r);
  }
  return { groups, rowCount: rows.length };
}

/**
 * Many bodies are one short line, which makes for a useless meta description.
 * Fall back to a sentence composed from the structured attributes so every
 * page ships a description that actually describes the product.
 */
function buildMetaDescription(title, bodyText, partType, condition, models) {
  const body = toText(bodyText);
  const cond = condition ? condition.replace(/ · /g, ', ') : '';
  const part = partType.toLowerCase();

  // Lead with the structured facts: they read as a natural sentence, they put
  // the compatibility information where a search snippet will show it, and
  // they differ per product even where the shop reused the same body text.
  let lead;
  if (models.length) {
    const list = models.slice(0, 3).join(', ');
    const more = models.length > 3 ? ` and ${models.length - 3} more` : '';
    lead = `${cond} ${part} for ${list}${more}.`.trim();
  } else {
    lead = `${cond} ${part} — ${title}.`.trim();
  }
  lead = lead.charAt(0).toUpperCase() + lead.slice(1);

  const tail = body.length >= 40 ? ` ${body}` : ' In stock now, dispatched from the UK.';
  return truncate(`${lead}${tail}`, 155);
}

function buildProduct(handle, rows) {
  const head = rows.find((r) => String(r.Title || '').trim()) || rows[0];
  const title = String(head.Title || handle).trim();
  const bodyHtml = cleanHtml(head['Body (HTML)']);
  const bodyText = toText(head['Body (HTML)']);

  /* ---- images: distinct src, ordered by Image Position ---- */
  const imgMap = new Map();
  for (const r of rows) {
    const src = String(r['Image Src'] || '').trim();
    if (!src || imgMap.has(src)) continue;
    imgMap.set(src, {
      src,
      position: num(r['Image Position']) || imgMap.size + 1,
      alt: String(r['Image Alt Text'] || '').trim(),
    });
  }
  const images = [...imgMap.values()]
    .sort((a, b) => a.position - b.position)
    .map((img, i) => ({
      ...img,
      position: i + 1,
      base_filename: imageStem(img.src, i + 1),
      // Shopify alt text is empty throughout this export; compose a
      // descriptive default so no image ships without one.
      alt: img.alt || `${title} — image ${i + 1}`,
    }));

  /* ---- variants ---- */
  // Shopify only writes the option *names* on the first row of a group, so
  // they have to be carried down to every subsequent variant row.
  const optNames = [1, 2, 3].map((n) => {
    const row = rows.find((r) => String(r[`Option${n} Name`] || '').trim());
    return row ? String(row[`Option${n} Name`]).trim() : '';
  });

  const variants = [];
  for (const r of rows) {
    const sku = cleanSku(r['Variant SKU']);
    const hasPrice = String(r['Variant Price'] || '').trim() !== '';
    if (!sku && !hasPrice) continue;

    const o1n = optNames[0];
    const o1v = String(r['Option1 Value'] || '').trim();
    const optionless = (!o1n || /^title$/i.test(o1n)) && (!o1v || /^default title$/i.test(o1v));

    const price = num(r['Variant Price']);
    const compare = num(r['Variant Compare At Price']);

    variants.push({
      sku,
      position: variants.length + 1,
      opt1_name: optionless ? '' : o1n,
      opt1_value: optionless ? '' : o1v,
      opt2_name: optNames[1],
      opt2_value: String(r['Option2 Value'] || '').trim(),
      opt3_name: optNames[2],
      opt3_value: String(r['Option3 Value'] || '').trim(),
      price,
      // Only a genuine markdown counts as a sale price.
      compare_at_price: compare > price ? compare : 0,
      barcode: String(r['Variant Barcode'] || '').trim(),
      grams: num(r['Variant Grams']),
      weight_unit: String(r['Variant Weight Unit'] || 'kg').trim(),
      available: /^continue$/i.test(String(r['Variant Inventory Policy'] || '')) ? 1 : 1,
      optionless: optionless ? 1 : 0,
      image_src: String(r['Variant Image'] || '').trim(),
    });
  }
  if (variants.length === 0) {
    variants.push({
      sku: '', position: 1, opt1_name: '', opt1_value: '', opt2_name: '', opt2_value: '',
      opt3_name: '', opt3_value: '', price: 0, compare_at_price: 0, barcode: '',
      grams: 0, weight_unit: 'kg', available: 1, optionless: 1, image_src: '',
    });
  }

  const partType = detectPartType(title);
  const condition = detectCondition(title, bodyText);
  const models = extractModels(title, bodyText);

  return {
    handle,
    title,
    body_html: bodyHtml,
    body_text: bodyText,
    vendor: String(head.Vendor || '').trim(),
    shopify_status: String(head.Status || '').trim(),
    shopify_published: String(head.Published || '').trim(),
    // Every product goes live; the Shopify draft flags are recorded above but
    // not enforced (all 196 products are published on the new site).
    status: 'active',
    seo_title: composeTitle(title, 'FlashStore Plus', 70),
    seo_description: buildMetaDescription(title, bodyText, partType, condition, models),
    part_type: partType,
    condition_grade: condition,
    fits_models: JSON.stringify(models),
    images,
    variants,
  };
}

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }
  const conn = db.open();
  const { groups, rowCount } = loadGroups(CSV_PATH);
  console.log(`Read ${rowCount} CSV rows → ${groups.size} products from ${path.basename(CSV_PATH)}`);

  const stats = { inserted: 0, updated: 0, variants: 0, images: 0 };

  const upsert = conn.transaction(() => {
    let position = 0;
    for (const [handle, rows] of groups) {
      const p = buildProduct(handle, rows);
      p.position = position++;

      const existing = conn.prepare('SELECT * FROM products WHERE handle = ?').get(handle);
      // Admin-owned fields survive re-import unless --force.
      const keep = (col) => (!FORCE && existing && String(existing[col] || '').trim() !== ''
        ? existing[col] : p[col]);

      if (existing) {
        conn.prepare(`
          UPDATE products SET title=?, body_html=?, body_text=?, vendor=?,
            shopify_status=?, shopify_published=?, status=?, seo_title=?, seo_description=?,
            part_type=?, condition_grade=?, fits_models=?, position=?, updated_at=datetime('now')
          WHERE id=?`)
          .run(p.title, p.body_html, p.body_text, p.vendor, p.shopify_status, p.shopify_published,
            FORCE ? p.status : (existing.status || p.status),
            keep('seo_title'), keep('seo_description'), keep('part_type'),
            keep('condition_grade'),
            (!FORCE && existing.fits_models && existing.fits_models !== '[]')
              ? existing.fits_models : p.fits_models,
            p.position, existing.id);
        stats.updated++;
      } else {
        conn.prepare(`
          INSERT INTO products (handle, title, body_html, body_text, vendor, status,
            shopify_status, shopify_published, seo_title, seo_description,
            fits_models, condition_grade, part_type, position)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(p.handle, p.title, p.body_html, p.body_text, p.vendor, p.status,
            p.shopify_status, p.shopify_published, p.seo_title, p.seo_description,
            p.fits_models, p.condition_grade, p.part_type, p.position);
        stats.inserted++;
      }

      const productId = conn.prepare('SELECT id FROM products WHERE handle = ?').get(handle).id;

      /* Images: keyed by src_original so admin-added uploads (which have no
         src_original) are never touched by a re-import. */
      const imageIdBySrc = new Map();
      for (const img of p.images) {
        const row = conn.prepare('SELECT id, alt FROM images WHERE product_id=? AND src_original=?')
          .get(productId, img.src);
        if (row) {
          conn.prepare('UPDATE images SET position=?, base_filename=?, alt=? WHERE id=?')
            .run(img.position, img.base_filename,
              (!FORCE && String(row.alt || '').trim()) ? row.alt : img.alt, row.id);
          imageIdBySrc.set(img.src, row.id);
        } else {
          const info = conn.prepare(`INSERT INTO images (product_id, position, src_original, base_filename, alt)
                                     VALUES (?,?,?,?,?)`)
            .run(productId, img.position, img.src, img.base_filename, img.alt);
          imageIdBySrc.set(img.src, info.lastInsertRowid);
        }
        stats.images++;
      }

      /* Variants are fully owned by the CSV on import: replace wholesale. */
      conn.prepare('DELETE FROM variants WHERE product_id = ?').run(productId);
      for (const v of p.variants) {
        conn.prepare(`
          INSERT INTO variants (product_id, sku, position, opt1_name, opt1_value,
            opt2_name, opt2_value, opt3_name, opt3_value, price, compare_at_price,
            barcode, grams, weight_unit, available, optionless, image_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(productId, v.sku, v.position, v.opt1_name, v.opt1_value,
            v.opt2_name, v.opt2_value, v.opt3_name, v.opt3_value, v.price, v.compare_at_price,
            v.barcode, v.grams, v.weight_unit, v.available, v.optionless,
            imageIdBySrc.get(v.image_src) || null);
        stats.variants++;
      }
    }
  });

  upsert();

  /* ---- ensure meta descriptions are unique ----
     Several products legitimately share a body and a compatibility list —
     "iPhone 8 Empty Box with Full Accessories" and the "without Accessories"
     variant, for instance. Two pages with the same description compete for the
     same snippet, so any collision is resolved by folding the (unique) product
     title into the description. Only the colliding products are rewritten, so
     the result stays deterministic. */
  const dedupe = conn.transaction(() => {
    const byDesc = new Map();
    for (const r of conn.prepare('SELECT id, handle, title, seo_description FROM products').all()) {
      if (!byDesc.has(r.seo_description)) byDesc.set(r.seo_description, []);
      byDesc.get(r.seo_description).push(r);
    }
    let fixed = 0;
    for (const group of byDesc.values()) {
      if (group.length < 2) continue;
      const titles = new Set(group.map((r) => r.title.toLowerCase()));
      // Identical titles as well means a genuine duplicate listing; the
      // generator canonicalises those, so leave their description alone.
      if (titles.size === 1) continue;
      for (const r of group) {
        const rewritten = truncate(`${r.title}. ${r.seo_description}`, 155);
        conn.prepare('UPDATE products SET seo_description = ? WHERE id = ?').run(rewritten, r.id);
        fixed++;
      }
    }
    if (fixed) console.log(`Disambiguated ${fixed} colliding meta description(s).`);
  });
  dedupe();

  /* Seed settings from site.config.json on first run only. */
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
    (v && typeof v === 'object' && !Array.isArray(v))
      ? flat(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, String(v)]]);
  for (const [k, v] of flat(cfg)) {
    if (db.getSetting(conn, k) === null) db.setSetting(conn, k, v);
  }

  console.log(`\nProducts: ${stats.inserted} inserted, ${stats.updated} updated`);
  console.log(`Variants: ${stats.variants}`);
  console.log(`Images:   ${stats.images}`);
  const counts = conn.prepare(`SELECT
      (SELECT COUNT(*) FROM products) p,
      (SELECT COUNT(*) FROM variants) v,
      (SELECT COUNT(*) FROM images) i`).get();
  console.log(`\nDatabase now holds ${counts.p} products, ${counts.v} variants, ${counts.i} images.`);
  conn.close();
}

main();
