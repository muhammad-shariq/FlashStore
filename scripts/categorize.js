#!/usr/bin/env node
'use strict';
/**
 * Builds the category and brand taxonomy the Shopify export never contained
 * (Tags is empty on all 196 products and Type is set on only 3).
 *
 * Assignments are additive: an existing product_categories row is never
 * removed, so manual reassignments made in the admin survive a re-run.
 * Pass --reset to clear all assignments and re-derive from scratch.
 *
 *   node scripts/categorize.js [--reset]
 */
const db = require('../backend/db');
const { detectPartType, detectBrand } = require('../backend/lib/extract');
const { slugify } = require('../backend/lib/slug');

const RESET = process.argv.includes('--reset');

/**
 * part_type (already derived on import) maps onto customer-facing categories.
 * Several part types deliberately collapse into one category — shoppers look
 * for "Cables & Chargers", not separately for cables, chargers and adapters.
 */
const CATEGORY_FOR_PART_TYPE = {
  'LCD Screen': 'LCD Screens & Displays',
  'Back Cover': 'Back Covers & Housings',
  'Rear Housing': 'Back Covers & Housings',
  'Empty Box': 'Empty Boxes',
  'Case': 'Cases & Covers',
  'Battery': 'Batteries',
  'Charging Port': 'Charging Ports & Flex Cables',
  'Flex Cable': 'Charging Ports & Flex Cables',
  'Camera': 'Cameras & Lenses',
  'Screen Protector': 'Screen Protectors',
  'Cable': 'Cables & Chargers',
  'Charger': 'Cables & Chargers',
  'Adapter': 'Cables & Chargers',
  'Audio': 'Audio & Headphones',
  'Phone': 'Phones & Tablets',
  'Stylus': 'Other Accessories',
  'Computer Accessory': 'Other Accessories',
  'Repair Tool': 'Repair Tools & Equipment',
  'Accessory': 'Other Accessories',
};

/** Display order and SEO intro copy for each category. */
const CATEGORY_META = {
  'LCD Screens & Displays': {
    position: 1,
    featured: 1,
    description: 'Genuine and pulled LCD, OLED and AMOLED replacement screens for Apple iPhone and Samsung Galaxy handsets. Every display is tested before dispatch and graded honestly, so you know exactly what you are buying. Where a screen is supplied with its frame or front camera the listing says so explicitly, along with the manufacturer part number it was pulled from. Same-day dispatch from the UK on orders placed before the daily cut-off.',
  },
  'Back Covers & Housings': {
    position: 2,
    featured: 1,
    description: 'Replacement rear battery covers, back glass panels and complete rear housings for iPhone, Samsung Galaxy, Huawei and Honor devices. These are genuine original parts rather than aftermarket copies, which means the camera cut-outs, adhesive channels and wireless charging coils line up the way they should. Many listings include the camera lens and, where relevant, the internal parts still fitted to the housing.',
  },
  'Empty Boxes': {
    position: 3,
    featured: 1,
    description: 'Original Apple and Samsung retail boxes, supplied empty or with their genuine accessories. If you are reselling a handset, the original box and cable measurably increase what a buyer will pay, and they make for far safer postage. Every box is UK retail stock in excellent condition; listings state clearly whether accessories and cables are included and which storage capacity the box was printed for.',
  },
  'Batteries': {
    position: 4,
    description: 'Genuine pre-owned and tested replacement batteries for Samsung Galaxy S and Note series handsets. Each cell is health-checked before listing so you are not fitting a battery that is already worn out. Fitting a replacement battery is by far the cheapest way to bring an ageing phone back to a full day of use.',
  },
  'Charging Ports & Flex Cables': {
    position: 5,
    description: 'Charging port assemblies, dock connectors and internal flex cables for Samsung Galaxy and Apple iPhone devices. A worn charging port is one of the most common reasons a phone stops charging reliably, and it is usually a far cheaper repair than people expect. Parts are genuine pulls unless the listing states otherwise.',
  },
  'Cameras & Lenses': {
    position: 6,
    description: 'Rear and main camera modules, camera flex cables and replacement camera lens glass for iPhone models. Cracked lens glass and a camera that will not focus are both repairable faults rather than reasons to replace a handset. All modules are genuine parts pulled from working devices and tested before dispatch.',
  },
  'Screen Protectors': {
    position: 7,
    description: 'Tempered glass, privacy and matt-finish screen protectors for iPhone, supplied in trade packs of ten. Listings are organised by display size rather than model, so a single pack covers every handset sharing that diagonal — the compatibility list on each product page spells out exactly which models fit. Ideal for repair shops buying in volume.',
  },
  'Cases & Covers': {
    position: 8,
    description: 'Genuine Apple silicone and leather cases, Samsung covers and iPad smart covers. These are original manufacturer accessories rather than lookalikes, so the fit around buttons and cameras is exact and MagSafe accessories attach properly where the case supports it. Colours vary by listing and are shown in the product options.',
  },
  'Cables & Chargers': {
    position: 9,
    description: 'Genuine Apple and Samsung charging cables, USB-C and USB-A mains adapters, wireless chargers and headphone adapters. Using a genuine charger matters more than most people realise: correct power negotiation protects the battery and avoids the "accessory not supported" warnings that cheap copies trigger.',
  },
  'Audio & Headphones': {
    position: 10,
    description: 'Genuine Apple EarPods, handsfree kits and audio adapters. Original Apple audio accessories carry the authentication chip that lightning and USB-C ports look for, which is why they keep working after software updates when unbranded alternatives stop.',
  },
  'Phones & Tablets': {
    position: 11,
    featured: 1,
    description: 'Fully refurbished iPhone handsets, tested and graded before sale. Each phone is checked across every function — screen, cameras, speakers, battery health and charging — and the listing states its storage capacity and cosmetic grade plainly. A refurbished handset is the most cost-effective way to buy a known-good iPhone.',
  },
  'Repair Tools & Equipment': {
    position: 12,
    description: 'Professional repair-shop equipment including logic board testers, programmers and back-glass separating machines. These are trade tools aimed at repair businesses rather than one-off DIY fixes, and they pay for themselves quickly on the repairs they make possible.',
  },
  'Other Accessories': {
    position: 13,
    description: 'Stylus pens, Apple desktop accessories and everything else in the catalogue that does not sit neatly in another category. If you are looking for a specific part and cannot find it here, get in touch — stock moves quickly and not everything makes it onto the site.',
  },
};

const BRAND_META = {
  Apple: {
    position: 1,
    description: 'Replacement parts and genuine accessories for the full Apple range — iPhone, iPad, and Apple desktop accessories. Screens, rear housings, camera modules, batteries, empty retail boxes, cases and charging accessories, with the exact model compatibility listed on every product page.',
  },
  Samsung: {
    position: 2,
    description: 'Genuine Samsung Galaxy parts including S series, Note series, A and J series and the Z Fold and Z Flip foldables. Listings carry the manufacturer part number (SM-G970F, SM-N986 and so on) alongside the marketing name, so you can match a part to your handset with certainty.',
  },
  'Huawei & Honor': {
    position: 3,
    description: 'Replacement back covers and parts for Huawei P and Mate series and Honor handsets. These models are increasingly hard to source parts for, which is exactly why we keep them listed.',
  },
  'Other Brands': {
    position: 4,
    description: 'Parts, tools and accessories that fall outside the Apple, Samsung and Huawei ranges, including universal repair equipment and trade tooling.',
  },
};

function main() {
  const conn = db.open();

  const upsertCategory = (name, kind, meta) => {
    const slug = slugify(name);
    const existing = conn.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (existing) return existing.id;
    const info = conn.prepare(`
      INSERT INTO categories (slug, name, kind, description, position, featured, seo_title, seo_description)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      slug, name, kind, meta.description || '', meta.position || 0, meta.featured || 0,
      `${name} |FlashStore`.slice(0, 70),
      (meta.description || '').slice(0, 152).replace(/\s+\S*$/, '') + '…',
    );
    return info.lastInsertRowid;
  };

  const run = conn.transaction(() => {
    if (RESET) {
      conn.prepare('DELETE FROM product_categories').run();
      console.log('Cleared all existing product/category assignments (--reset).');
    }

    const categoryIds = new Map();
    for (const [name, meta] of Object.entries(CATEGORY_META)) {
      categoryIds.set(name, upsertCategory(name, 'category', meta));
    }
    const brandIds = new Map();
    for (const [name, meta] of Object.entries(BRAND_META)) {
      brandIds.set(name, upsertCategory(name, 'brand', meta));
    }

    const link = conn.prepare(`INSERT INTO product_categories (product_id, category_id)
                               VALUES (?,?) ON CONFLICT DO NOTHING`);
    const products = conn.prepare('SELECT id, handle, title, vendor, part_type FROM products').all();

    const catCounts = {}, brandCounts = {};
    for (const p of products) {
      const partType = p.part_type || detectPartType(p.title);
      const catName = CATEGORY_FOR_PART_TYPE[partType] || 'Other Accessories';
      const brandName = detectBrand(p.title, p.vendor);

      link.run(p.id, categoryIds.get(catName));
      link.run(p.id, brandIds.get(brandName));
      catCounts[catName] = (catCounts[catName] || 0) + 1;
      brandCounts[brandName] = (brandCounts[brandName] || 0) + 1;
    }

    console.log('\nCategories:');
    for (const [name, meta] of Object.entries(CATEGORY_META)) {
      console.log(`  ${String(meta.position).padStart(2)}. ${name.padEnd(30)} ${catCounts[name] || 0}`);
    }
    console.log('\nBrands:');
    for (const name of Object.keys(BRAND_META)) {
      console.log(`  ${name.padEnd(20)} ${brandCounts[name] || 0}`);
    }

    const fallback = conn.prepare(`
      SELECT p.title FROM products p
      JOIN product_categories pc ON pc.product_id = p.id
      JOIN categories c ON c.id = pc.category_id
      WHERE c.slug = ? ORDER BY p.title`).all(slugify('Other Accessories'));
    if (fallback.length) {
      console.log(`\nIn the "Other Accessories" fallback bucket (${fallback.length}) — review these:`);
      for (const r of fallback) console.log(`  - ${r.title}`);
    }
  });

  run();

  const totals = conn.prepare(`SELECT
      (SELECT COUNT(*) FROM categories WHERE kind='category') cats,
      (SELECT COUNT(*) FROM categories WHERE kind='brand') brands,
      (SELECT COUNT(*) FROM product_categories) links`).get();
  console.log(`\n${totals.cats} categories, ${totals.brands} brands, ${totals.links} assignments.`);

  const orphans = conn.prepare(`SELECT COUNT(*) n FROM products p
    WHERE NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id)`).get().n;
  if (orphans) console.log(`WARNING: ${orphans} products have no category.`);
  conn.close();
}

main();
