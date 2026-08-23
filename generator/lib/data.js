'use strict';
/**
 * Reads the database into plain objects for the templates. Everything the
 * templates need is computed here — price ranges, image URLs, breadcrumbs,
 * compatibility lists — so the EJS stays presentational.
 */
const fs = require('fs');
const path = require('path');
const db = require('../../backend/db');
const { relPaths } = require('../../backend/lib/images');
const { schemaCondition } = require('../../backend/lib/extract');

const WEB_ROOT = path.resolve(__dirname, '..', '..', 'web');

const PLACEHOLDER = {
  large: '/assets/placeholder.svg',
  thumb: '/assets/placeholder.svg',
  fallback: null,
  alt: 'Image coming soon',
  width: 1200,
  height: 1200,
  isPlaceholder: true,
};

function money(amount, symbol = '£') {
  return `${symbol}${Number(amount).toFixed(2)}`;
}

/** Settings, with the dotted keys rebuilt into a nested object. */
function loadSettings(conn) {
  const flat = db.allSettings(conn);
  const nested = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = nested;
    while (parts.length > 1) {
      const p = parts.shift();
      node[p] = node[p] && typeof node[p] === 'object' ? node[p] : {};
      node = node[p];
    }
    node[parts[0]] = value;
  }
  // Numeric/boolean coercion for the handful of settings that need it.
  nested.shop = nested.shop || {};
  nested.shop.perPage = Number(nested.shop.perPage) || 24;
  nested.images = nested.images || {};
  nested.images.jpegFallback = String(nested.images.jpegFallback ?? 'true') !== 'false';
  return { flat, ...nested };
}

function loadCategories(conn) {
  const rows = conn.prepare(`
    SELECT c.*, (
      SELECT COUNT(*) FROM product_categories pc
      JOIN products p ON p.id = pc.product_id
      WHERE pc.category_id = c.id AND p.status = 'active'
    ) AS product_count
    FROM categories c
    ORDER BY c.position, c.name`).all();

  return rows.map((c) => ({
    ...c,
    faq: safeJson(c.faq, []),
    url: c.kind === 'brand' ? `/brands/${c.slug}/` : `/collections/${c.slug}/`,
  }));
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || 'null');
    return parsed == null ? fallback : parsed;
  } catch { return fallback; }
}

function loadProducts(conn, settings) {
  const symbol = settings.currencySymbol || '£';
  const products = conn.prepare(`SELECT * FROM products WHERE status = 'active' ORDER BY position`).all();

  const imagesFor = conn.prepare('SELECT * FROM images WHERE product_id = ? ORDER BY position');
  const variantsFor = conn.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY position');
  const catsFor = conn.prepare(`
    SELECT c.* FROM categories c
    JOIN product_categories pc ON pc.category_id = c.id
    WHERE pc.product_id = ? ORDER BY c.kind DESC, c.position`);

  return products.map((p) => {
    const imageRows = imagesFor.all(p.id);
    const images = imageRows.map((i) => {
      const paths = relPaths(p.handle, i.base_filename);
      // The JPEG fallback is optional, so only advertise it when it exists —
      // otherwise the templates would emit a <source> pointing at a 404.
      const hasFallback = fs.existsSync(path.join(WEB_ROOT, paths.fallback.replace(/^\//, '')));
      return {
        id: i.id,
        ...paths,
        fallback: hasFallback ? paths.fallback : null,
        alt: i.alt || p.title,
        width: i.width || 1200,
        height: i.height || 1200,
        isPlaceholder: false,
      };
    });
    const imageById = new Map(imageRows.map((i, idx) => [i.id, idx]));

    const variantRows = variantsFor.all(p.id);
    const variants = variantRows.map((v) => {
      const options = [
        [v.opt1_name, v.opt1_value],
        [v.opt2_name, v.opt2_value],
        [v.opt3_name, v.opt3_value],
      ].filter(([, value]) => value);
      const optionTitle = options.map(([, value]) => value).join(' / ');
      return {
        id: v.id,
        // Stable across re-imports (row ids are not), so a saved cart survives
        // a catalogue refresh.
        key: v.sku || optionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'default',
        sku: v.sku,
        price: v.price,
        priceLabel: v.price > 0 ? money(v.price, symbol) : settings.shop.poaLabel || 'Enquire for price',
        compareAt: v.compare_at_price,
        compareAtLabel: v.compare_at_price > 0 ? money(v.compare_at_price, symbol) : '',
        onSale: v.compare_at_price > v.price && v.price > 0,
        optionless: !!v.optionless,
        options,
        title: optionTitle || p.title,
        imageIndex: v.image_id != null && imageById.has(v.image_id) ? imageById.get(v.image_id) : 0,
      };
    });

    const prices = variants.map((v) => v.price).filter((n) => n > 0);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const isPoa = prices.length === 0;

    let priceLabel;
    if (isPoa) priceLabel = settings.shop.poaLabel || 'Enquire for price';
    else if (minPrice === maxPrice) priceLabel = money(minPrice, symbol);
    else priceLabel = `${money(minPrice, symbol)} – ${money(maxPrice, symbol)}`;

    const allCats = catsFor.all(p.id).map((c) => ({
      ...c,
      url: c.kind === 'brand' ? `/brands/${c.slug}/` : `/collections/${c.slug}/`,
    }));
    const categories = allCats.filter((c) => c.kind === 'category');
    const brands = allCats.filter((c) => c.kind === 'brand');

    // The option name is shared across a product's variants; take the first.
    const optionNames = [...new Set(variants.flatMap((v) => v.options.map(([name]) => name)))]
      .filter(Boolean);

    const fitsModels = safeJson(p.fits_models, []);

    return {
      id: p.id,
      handle: p.handle,
      title: p.title,
      url: `/products/${p.handle}/`,
      bodyHtml: p.body_html,
      bodyText: p.body_text,
      vendor: p.vendor,
      seoTitle: p.seo_title || `${p.title} |FlashStore`,
      seoDescription: p.seo_description,
      fitsModels,
      conditionGrade: p.condition_grade,
      schemaCondition: schemaCondition(p.condition_grade),
      partType: p.part_type,
      faq: safeJson(p.faq, []),
      updatedAt: p.updated_at,
      images: images.length ? images : [PLACEHOLDER],
      hasImages: images.length > 0,
      variants,
      optionNames,
      hasOptions: optionNames.length > 0 && variants.some((v) => !v.optionless),
      minPrice,
      maxPrice,
      priceLabel,
      isPoa,
      onSale: variants.some((v) => v.onSale),
      categories,
      brands,
      primaryCategory: categories[0] || null,
      primaryBrand: brands[0] || null,
    };
  });
}

module.exports = { loadSettings, loadCategories, loadProducts, money, safeJson, PLACEHOLDER };
