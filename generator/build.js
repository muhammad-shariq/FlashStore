#!/usr/bin/env node
'use strict';
/**
 * Generates the whole static site into web/ from data/store.db.
 *
 * This is the ONLY writer of web/ apart from the image pipeline, which owns
 * web/assets/products/ exclusively. Every page is fully rendered at build time:
 * no content anywhere on the site depends on JavaScript, because most AI
 * crawlers do not execute it.
 *
 *   node generator/build.js [--quiet] [--no-validate]
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const db = require('../backend/db');
const data = require('./lib/data');
const seo = require('./lib/seo');
const content = require('./lib/content');
const { validateSite } = require('./lib/validate');
const { escapeHtml, composeTitle } = require('../backend/lib/sanitize');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const TEMPLATES = path.join(__dirname, 'templates');
const ASSET_SRC = path.join(__dirname, 'assets');

const QUIET = process.argv.includes('--quiet');
const SKIP_VALIDATE = process.argv.includes('--no-validate');
const log = (...a) => { if (!QUIET) console.log(...a); };

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

/** Short hash of the front-end assets, used to bust caches only when needed. */
function assetHash() {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  for (const file of fs.readdirSync(ASSET_SRC).sort()) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(ASSET_SRC, file)));
  }
  const fontDir = path.join(__dirname, 'fonts');
  if (fs.existsSync(fontDir)) {
    for (const file of fs.readdirSync(fontDir).sort()) {
      hash.update(file);
      hash.update(fs.readFileSync(path.join(fontDir, file)));
    }
  }
  return hash.digest('hex').slice(0, 10);
}


const written = [];

function writeFile(relPath, contents) {
  const target = path.join(WEB, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  written.push(relPath);
}

/** Directory-per-page so URLs are extensionless without server rewrites. */
function writePage(urlPath, html) {
  const rel = urlPath === '/' ? 'index.html' : path.join(urlPath.replace(/^\/|\/$/g, ''), 'index.html');
  writeFile(rel, html);
  return rel;
}

/** Remove previously generated HTML but never touch generated image assets. */
function cleanWeb() {
  if (!fs.existsSync(WEB)) return;
  const keep = new Set(['assets']);
  for (const entry of fs.readdirSync(WEB)) {
    if (keep.has(entry)) continue;
    fs.rmSync(path.join(WEB, entry), { recursive: true, force: true });
  }
  // Inside assets/, only products/ is owned by the image pipeline.
  const assets = path.join(WEB, 'assets');
  if (fs.existsSync(assets)) {
    for (const entry of fs.readdirSync(assets)) {
      if (entry === 'products') continue;
      fs.rmSync(path.join(assets, entry), { recursive: true, force: true });
    }
  }
}

function paginate(items, perPage) {
  const pages = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

/** Compact page list: 1 … 4 5 [6] 7 8 … 12 */
function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set([1, total, current]);
  for (let d = 1; d <= 2; d++) {
    if (current - d > 1) out.add(current - d);
    if (current + d < total) out.add(current + d);
  }
  const sorted = [...out].sort((a, b) => a - b);
  const withGaps = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) withGaps.push('…');
    withGaps.push(sorted[i]);
  }
  return withGaps;
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

function build() {
  const startedAt = new Date().toISOString();
  const conn = db.open();

  const settings = data.loadSettings(conn);
  const allCategories = data.loadCategories(conn);
  const products = data.loadProducts(conn, settings);

  const categories = allCategories.filter((c) => c.kind === 'category' && c.product_count > 0);
  const brands = allCategories.filter((c) => c.kind === 'brand' && c.product_count > 0);

  const site = settings.siteUrl;
  const abs = (p) => seo.abs(site, p);
  // Content-hashed rather than timestamped: a rebuild that changes nothing
  // should produce no diff, so `git status` after a publish shows only what
  // actually changed instead of all 223 pages.
  const assetVersion = `?v=${assetHash()}`;
  const year = new Date().getFullYear();

  log(`Building ${products.length} products, ${categories.length} categories, ${brands.length} brands`);

  /* The Shopify export contains a handful of genuine duplicate listings — the
     same part split across two products with different colour subsets. Two
     pages sharing a <title> compete with each other in search, so the page
     title is disambiguated by its distinguishing options. The product's own
     title is left untouched as the on-page <h1>; the pairs are reported below
     so they can be merged properly in the admin. */
  const titleGroups = new Map();
  for (const p of products) {
    const key = p.title.trim().toLowerCase();
    if (!titleGroups.has(key)) titleGroups.set(key, []);
    titleGroups.get(key).push(p);
  }
  const duplicateGroups = [...titleGroups.values()].filter((g) => g.length > 1);
  for (const group of duplicateGroups) {
    for (const p of group) {
      const opts = p.variants.map((v) => v.title).filter(Boolean);
      p.titleQualifier = opts.length ? opts.slice(0, 3).join(', ') : p.handle;
      p.isDuplicateTitle = true;
    }
    // Where the options differ, the qualifier is enough to tell the pages
    // apart. Where they are identical too, the listings are true duplicates:
    // the richest one stays indexable and the rest canonicalise to it, which
    // is the correct way to consolidate duplicate content rather than letting
    // two identical pages compete.
    const byQualifier = new Map();
    for (const p of group) {
      const key = p.titleQualifier.toLowerCase();
      if (!byQualifier.has(key)) byQualifier.set(key, []);
      byQualifier.get(key).push(p);
    }
    for (const same of byQualifier.values()) {
      if (same.length < 2) continue;
      const ranked = [...same].sort((a, b) =>
        (b.images.length - a.images.length)
        || (b.bodyText.length - a.bodyText.length)
        || a.handle.localeCompare(b.handle));
      const [primary, ...rest] = ranked;
      for (const dup of rest) {
        dup.canonicalTo = primary.url;
        dup.noindex = true;
      }
    }
  }
  if (duplicateGroups.length) {
    log(`\n${duplicateGroups.length} duplicate product title(s) found in the source data.`);
    log('Page titles have been disambiguated automatically, but these should be merged in the admin:');
    for (const g of duplicateGroups) {
      log(`  "${g[0].title}" → ${g.map((p) => p.handle + (p.canonicalTo ? ' [canonicalised]' : '')).join('  vs  ')}`);
    }
    log('');
  }

  cleanWeb();

  /* ---- shared render context ---- */
  /* Each contact channel is usable independently: a WhatsApp number works
     whether or not a postal address has been entered. */
  const contact = {
    whatsapp: seo.hasWhatsApp(settings),
    phone: seo.hasPhone(settings),
    address: seo.hasAddress(settings),
    email: seo.hasEmail(settings),
  };
  const whatsappLink = `https://wa.me/${seo.whatsappNumber(settings)}`;
  const telLink = `tel:${String(settings.contact.phoneDisplay || '').replace(/[^0-9+]/g, '')}`;

  const SOCIAL_ICONS = {
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 9h3V6h-3a4 4 0 0 0-4 4v2H8v3h2v6h3v-6h2.5l.5-3H13v-2a1 1 0 0 1 1-1Z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    twitter: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 3h3l-7 8 7 10h-5l-4-6-5 6H4l7.5-9L4.5 3H10l3.5 5Z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 7.5a3 3 0 0 0-2-2c-1.8-.5-7-.5-7-.5s-5.2 0-7 .5a3 3 0 0 0-2 2C2.5 9.3 2.5 12 2.5 12s0 2.7.5 4.5a3 3 0 0 0 2 2c1.8.5 7 .5 7 .5s5.2 0 7-.5a3 3 0 0 0 2-2c.5-1.8.5-4.5.5-4.5s0-2.7-.5-4.5ZM10 15.5v-7l6 3.5-6 3.5Z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 3h3a5 5 0 0 0 4 4v3a8 8 0 0 1-4-1.2V15a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V3Z"/></svg>',
    ebay: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 12a4 4 0 1 1 8 0H5a3 3 0 0 0 5 1.5l1.5.8A4 4 0 0 1 3 12Zm10-5h1.6v3a3.4 3.4 0 1 1 0 4.6V17H13V7Zm4 5a2 2 0 1 0-4 0 2 2 0 0 0 4 0Z"/></svg>',
  };
  const socialLinks = Object.entries(settings.social || {})
    .filter(([, url]) => url && url.startsWith('http'))
    .map(([name, url]) => ({ name: name[0].toUpperCase() + name.slice(1), url, icon: SOCIAL_ICONS[name] || SOCIAL_ICONS.facebook }));

  // Full category names ("Back Covers & Housings") wrap in the header, so the
  // nav uses a shortened label while pages keep the full name.
  for (const c of [...categories, ...brands]) {
    c.navLabel = c.name.split(' & ')[0].replace(/\s+Parts$/i, '');
    c.countLabel = `${c.product_count} ${c.product_count === 1 ? 'product' : 'products'}`;
  }

  const nav = {
    categories,
    brands,
    headerCategories: categories.slice(0, 4),
    pages: content.PAGES.map((p) => ({ name: p.nav, url: `/${p.slug}/` })).concat([{ name: 'Contact', url: '/contact/' }]),
    totalProducts: products.length,
    contact,
    whatsappLink,
    telLink,
    socialLinks,
  };

  const clientConfig = JSON.stringify({
    storeName: settings.storeName,
    siteUrl: site,
    currencySymbol: settings.currencySymbol || '£',
    whatsapp: settings.contact.whatsapp,
    orderEmail: settings.contact.orderEmail,
    poaLabel: settings.shop.poaLabel,
  });

  const layoutPath = path.join(TEMPLATES, 'layout.ejs');
  const layout = fs.readFileSync(layoutPath, 'utf8');

  function render(templateName, locals, page) {
    const body = ejs.render(
      fs.readFileSync(path.join(TEMPLATES, templateName), 'utf8'),
      { settings, nav, page, abs, escapeHtml, ...locals },
      { filename: path.join(TEMPLATES, templateName) },
    );
    return ejs.render(layout, {
      settings, nav, page, body, abs, clientConfig, assetVersion, year, escapeHtml,
    }, { filename: layoutPath });
  }

  const baseNodes = [seo.organisation(settings), seo.website(settings)];

  /* ------------------------------------------------------------ */
  /* home                                                          */
  /* ------------------------------------------------------------ */
  const modelCount = new Set(products.flatMap((p) => p.fitsModels)).size;
  const featuredCategories = categories.filter((c) => c.featured).slice(0, 3);
  const featured = featuredCategories.map((c) => ({
    category: c,
    products: products.filter((p) => p.categories.some((pc) => pc.id === c.id)).slice(0, 8),
  }));

  writePage('/', render('home.ejs', {
    categories, brands, featured,
    stats: { products: products.length, models: modelCount },
  }, {
    url: '/',
    title: `${settings.storeName} — Genuine Phone Parts & Screens`,
    description: settings.seo.defaultDescription,
    image: products[0] && !products[0].images[0].isPlaceholder ? products[0].images[0].large : null,
    jsonLd: seo.graph(settings, [...baseNodes, seo.itemListNode(products.slice(0, 24), settings)]),
    scripts: [],
  }));

  /* ------------------------------------------------------------ */
  /* collections (categories, brands, all products)               */
  /* ------------------------------------------------------------ */
  function buildListing(opts) {
    const { basePath, items, heading, subheading, category, titleTemplate, descTemplate, siblings } = opts;
    const perPage = settings.shop.perPage;
    const chunks = paginate(items, perPage);

    chunks.forEach((chunk, i) => {
      const current = i + 1;
      const total = chunks.length;
      const pageUrl = (n) => (n === 1 ? basePath : `${basePath}page/${n}/`);
      const url = pageUrl(current);
      const suffix = total > 1 ? ` — page ${current} of ${total}` : '';

      // Brand and condition facets, computed from the products actually shown.
      const brandCounts = new Map();
      const condCounts = new Map();
      for (const p of items) {
        for (const b of p.brands) {
          if (!brandCounts.has(b.slug)) brandCounts.set(b.slug, { slug: b.slug, name: b.name, count: 0 });
          brandCounts.get(b.slug).count++;
        }
        const cond = (p.conditionGrade || '').split(' · ')[0];
        if (cond) {
          const slug = cond.toLowerCase().replace(/\s+/g, '-');
          if (!condCounts.has(slug)) condCounts.set(slug, { slug, name: cond, count: 0 });
          condCounts.get(slug).count++;
        }
      }

      const trail = [{ name: 'Home', url: '/' }];
      if (category) {
        trail.push({ name: category.kind === 'brand' ? 'Brands' : 'Products', url: '/products/' });
        trail.push({ name: category.name, url: basePath });
      } else {
        trail.push({ name: heading, url: basePath });
      }
      if (total > 1 && current > 1) trail.push({ name: `Page ${current}`, url });

      const nodes = [...baseNodes, seo.breadcrumbs(settings, trail),
        { '@type': 'CollectionPage', '@id': abs(`${url}#page`), url: abs(url), name: heading, description: descTemplate },
        seo.itemListNode(chunk, settings, (current - 1) * perPage + 1)];
      if (category && category.faq && category.faq.length && current === 1) {
        nodes.push(seo.faqNode(category.faq));
      }

      writePage(url, render('collection.ejs', {
        products: chunk, category, heading, subheading,
        facets: {
          brands: category && category.kind === 'brand' ? [] : [...brandCounts.values()].sort((a, b) => b.count - a.count),
          conditions: [...condCounts.values()].sort((a, b) => b.count - a.count),
        },
        totalPages: total, currentPage: current,
        pageNumbers: pageNumbers(current, total), pageUrl,
        trail, siblings: siblings || [],
      }, {
        url,
        title: `${titleTemplate}${suffix} | ${settings.seo.titleSuffix}`.slice(0, 70),
        description: current === 1 ? descTemplate : `${descTemplate} Page ${current} of ${total}.`.slice(0, 160),
        image: chunk[0] && !chunk[0].images[0].isPlaceholder ? chunk[0].images[0].large : null,
        prevUrl: current > 1 ? pageUrl(current - 1) : null,
        nextUrl: current < total ? pageUrl(current + 1) : null,
        jsonLd: seo.graph(settings, nodes),
        scripts: ['/assets/filters.js'],
      }));
    });
    return chunks.length;
  }

  buildListing({
    basePath: '/products/',
    items: products,
    heading: 'All products',
    subheading: `Every part, screen and accessory we stock — ${products.length} products across ${categories.length} categories.`,
    titleTemplate: `All ${products.length} Products`,
    descTemplate: `Browse all ${products.length} genuine mobile phone parts, screens, back covers, batteries and accessories in stock at ${settings.storeName}. UK dispatch.`,
    siblings: categories,
  });

  for (const c of categories) {
    const items = products.filter((p) => p.categories.some((pc) => pc.id === c.id));
    c.faq = c.faq && c.faq.length
      ? c.faq
      : content.resolveFaq(content.CATEGORY_FAQ_KEYS[c.slug] || ['genuine', 'compatibility', 'dispatch']);
    buildListing({
      basePath: `/collections/${c.slug}/`,
      items,
      category: c,
      heading: c.name,
      subheading: `${items.length} ${items.length === 1 ? 'product' : 'products'} in stock.`,
      titleTemplate: c.seo_title ? c.seo_title.replace(` | ${settings.seo.titleSuffix}`, '') : c.name,
      descTemplate: c.seo_description || `${c.name} for iPhone, Samsung Galaxy and more. ${items.length} products in stock at ${settings.storeName}.`,
      siblings: categories.filter((x) => x.id !== c.id),
    });
  }

  for (const b of brands) {
    const items = products.filter((p) => p.brands.some((pb) => pb.id === b.id));
    buildListing({
      basePath: `/brands/${b.slug}/`,
      items,
      category: b,
      heading: `${b.name} parts & accessories`,
      subheading: `${items.length} ${items.length === 1 ? 'product' : 'products'} for ${b.name} devices.`,
      titleTemplate: `${b.name} Parts & Accessories`,
      descTemplate: b.seo_description || `Genuine ${b.name} replacement parts and accessories — ${items.length} products in stock at ${settings.storeName}.`,
      siblings: categories,
    });
  }

  /* ------------------------------------------------------------ */
  /* products                                                      */
  /* ------------------------------------------------------------ */
  for (const p of products) {
    const cat = p.primaryCategory;
    const trail = [{ name: 'Home', url: '/' }, { name: 'Products', url: '/products/' }];
    if (cat) trail.push({ name: cat.name, url: cat.url });
    trail.push({ name: p.title, url: p.url });

    const faq = p.faq.length ? p.faq : content.resolveFaq(content.productFaqKeys(p));
    const related = (cat
      ? products.filter((x) => x.id !== p.id && x.categories.some((c) => c.id === cat.id))
      : products.filter((x) => x.id !== p.id)).slice(0, 4);

    const nodes = [...baseNodes, seo.breadcrumbs(settings, trail), seo.productNode(p, settings), seo.faqNode(faq)];

    /* Title precedence: a duplicate title must be disambiguated, otherwise the
       page title set in the admin wins, and only then do we compose one. */
    const brand = settings.seo.titleSuffix;
    let pageTitle;
    if (p.isDuplicateTitle) {
      pageTitle = composeTitle(`${p.title} (${p.titleQualifier})`, brand);
    } else if (p.seoTitle) {
      // Respect the title set in the admin, but keep it within display length.
      pageTitle = p.seoTitle.endsWith(brand)
        ? composeTitle(p.seoTitle.slice(0, -(brand.length + 3)), brand)
        : composeTitle(p.seoTitle, '');
    } else {
      pageTitle = composeTitle(p.title, brand);
    }

    writePage(p.url, render('product.ejs', {
      product: p, trail, faq, related,
      summary: seo.summarySentence(p, settings),
    }, {
      url: p.url,
      title: pageTitle,
      description: p.isDuplicateTitle
        ? `${p.titleQualifier}. ${p.seoDescription}`.slice(0, 160)
        : p.seoDescription,
      image: p.images[0].isPlaceholder ? null : p.images[0].large,
      imageAlt: p.images[0].alt,
      preloadImage: p.images[0].isPlaceholder ? null : p.images[0].large,
      ogType: 'product',
      canonicalUrl: p.canonicalTo || null,
      noindex: !!p.noindex,
      jsonLd: seo.graph(settings, nodes),
      scripts: ['/assets/product.js'],
    }));
  }

  /* ------------------------------------------------------------ */
  /* cart, search                                                  */
  /* ------------------------------------------------------------ */
  writePage('/cart/', render('cart.ejs', { contact, whatsappLink }, {
    url: '/cart/',
    title: `Your order | ${settings.seo.titleSuffix}`,
    description: 'Review the parts in your order and send the list to us by WhatsApp or email for availability, postage and a total.',
    noindex: true,
    jsonLd: seo.graph(settings, baseNodes),
    scripts: [],
  }));

  writePage('/search/', render('search.ejs', { categories, totalProducts: products.length }, {
    url: '/search/',
    title: `Search ${products.length} parts | ${settings.seo.titleSuffix}`,
    description: `Search all ${products.length} mobile phone parts by model, part number or SKU — screens, back covers, batteries, cameras and accessories.`,
    noindex: true,
    jsonLd: seo.graph(settings, baseNodes),
    scripts: [],
  }));

  /* ------------------------------------------------------------ */
  /* content pages                                                 */
  /* ------------------------------------------------------------ */
  for (const page of content.PAGES) {
    const url = `/${page.slug}/`;
    const trail = [{ name: 'Home', url: '/' }, { name: page.nav, url }];
    const body = db.getSetting(conn, `page.${page.slug}.body`) || page.body;
    const faq = content.resolveFaq(page.faqKeys);
    const nodes = [...baseNodes, seo.breadcrumbs(settings, trail), seo.faqNode(faq)];

    writePage(url, render('page.ejs', {
      pageData: { heading: page.heading, intro: page.intro, body, faq }, trail,
    }, {
      url,
      title: `${page.heading} | ${settings.seo.titleSuffix}`,
      description: page.intro,
      jsonLd: seo.graph(settings, nodes),
      scripts: [],
    }));
  }

  /* contact */
  {
    const trail = [{ name: 'Home', url: '/' }, { name: 'Contact', url: '/contact/' }];
    const faq = content.resolveFaq(['compatibility', 'trade', 'dispatch', 'payment']);
    const nodes = [...baseNodes, seo.breadcrumbs(settings, trail), seo.faqNode(faq)];
    if (contact.address) {
      nodes.push({
        '@type': 'LocalBusiness',
        '@id': abs('/contact/#localbusiness'),
        name: settings.storeName,
        url: abs('/'),
        telephone: contact.phone ? settings.contact.phoneDisplay : undefined,
        email: contact.email ? settings.contact.supportEmail : undefined,
        address: {
          '@type': 'PostalAddress',
          streetAddress: [settings.contact.addressLine1, settings.contact.addressLine2].filter(Boolean).join(', '),
          addressLocality: settings.contact.city,
          postalCode: settings.contact.postcode,
          addressCountry: settings.contact.countryCode || 'GB',
        },
        priceRange: '££',
      });
    }
    writePage('/contact/', render('contact.ejs', {
      trail, faq, contact, whatsappLink, telLink,
      body: db.getSetting(conn, 'page.contact.body') || content.CONTACT_BODY,
    }, {
      url: '/contact/',
      title: `Contact us | ${settings.seo.titleSuffix}`,
      description: `Ask ${settings.storeName} about stock, part compatibility or trade pricing. WhatsApp or email us with your device model.`,
      jsonLd: seo.graph(settings, nodes),
      scripts: [],
    }));
  }

  /* 404 — a real file at the root, which is what DigitalOcean serves */
  writeFile('404.html', render('404.ejs', { categories }, {
    url: '/404.html',
    title: `Page not found | ${settings.seo.titleSuffix}`,
    description: 'That page could not be found. Search our catalogue of mobile phone parts or browse by category.',
    noindex: true,
    jsonLd: seo.graph(settings, baseNodes),
    scripts: [],
  }));

  /* ------------------------------------------------------------ */
  /* machine-readable outputs                                      */
  /* ------------------------------------------------------------ */
  buildFeeds({ settings, products, categories, brands, site, conn });

  /* ------------------------------------------------------------ */
  /* static assets                                                 */
  /* ------------------------------------------------------------ */
  for (const file of fs.readdirSync(ASSET_SRC)) {
    fs.copyFileSync(path.join(ASSET_SRC, file), path.join(WEB, 'assets', file));
  }
  copyFonts();

  log(`Wrote ${written.length} files`);

  /* ------------------------------------------------------------ */
  /* validate                                                      */
  /* ------------------------------------------------------------ */
  let ok = true;
  let message = `${written.length} files written`;
  if (!SKIP_VALIDATE) {
    const htmlPages = written.filter((f) => f.endsWith('.html'));
    const { errors, warnings } = validateSite(htmlPages, WEB);

    if (warnings.length) {
      log(`\n${warnings.length} warning(s):`);
      for (const w of warnings.slice(0, 25)) log(`  ! ${w}`);
      if (warnings.length > 25) log(`  … and ${warnings.length - 25} more`);
    }
    if (errors.length) {
      ok = false;
      message = `${errors.length} SEO/integrity error(s)`;
      console.error(`\n${errors.length} ERROR(S) — build is not publishable:`);
      for (const e of errors.slice(0, 40)) console.error(`  ✗ ${e}`);
      if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
    } else {
      log(`\nSEO validation passed across ${htmlPages.length} pages.`);
    }
  }

  conn.prepare(`INSERT INTO build_log (started_at, finished_at, pages_written, ok, message)
                VALUES (?, datetime('now'), ?, ?, ?)`)
    .run(startedAt, written.length, ok ? 1 : 0, message);
  conn.close();

  if (!ok) process.exitCode = 1;
  return { ok, written: written.length };
}

/** Inter variable font, self-hosted so there is no third-party request. */
function copyFonts() {
  const src = path.join(ROOT, 'node_modules');
  const dest = path.join(WEB, 'assets', 'fonts');
  fs.mkdirSync(dest, { recursive: true });
  const bundled = path.join(__dirname, 'fonts', 'inter-variable.woff2');
  if (fs.existsSync(bundled)) {
    fs.copyFileSync(bundled, path.join(dest, 'inter-variable.woff2'));
    written.push('assets/fonts/inter-variable.woff2');
  }
  void src;
}

/**
 * Map our condition grades onto Google's three allowed values, returning an
 * empty string when the condition is genuinely unknown rather than guessing.
 */
function merchantCondition(grade) {
  const g = String(grade || '');
  if (!g.trim()) return '';
  if (/refurbished/i.test(g)) return '      <g:condition>refurbished</g:condition>';
  if (/pulled|pre-owned|grade/i.test(g)) return '      <g:condition>used</g:condition>';
  if (/genuine|original|new/i.test(g)) return '      <g:condition>new</g:condition>';
  return '';
}

/* ------------------------------------------------------------------ */
/* feeds: sitemaps, robots, llms.txt, products.json, merchant feed     */
/* ------------------------------------------------------------------ */
function buildFeeds({ settings, products, categories, brands, site, conn }) {
  const abs = (p) => seo.abs(site, p);
  const xmlEscape = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const today = new Date().toISOString().slice(0, 10);
  const lastmod = (v) => (v ? String(v).slice(0, 10) : today);

  /* ---- sitemaps ---- */
  const urlNode = (loc, mod, priority, images) => {
    const imgs = (images || []).map((i) =>
      `\n    <image:image><image:loc>${xmlEscape(abs(i.large))}</image:loc><image:title>${xmlEscape(i.alt)}</image:title></image:image>`).join('');
    return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <lastmod>${mod}</lastmod>\n    <priority>${priority}</priority>${imgs}\n  </url>`;
  };
  const sitemapDoc = (nodes) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${nodes.join('\n')}\n</urlset>\n`;

  writeFile('sitemap-products.xml', sitemapDoc(products.map((p) =>
    urlNode(abs(p.url), lastmod(p.updatedAt), '0.8', p.images.filter((i) => !i.isPlaceholder)))));

  const collectionNodes = [urlNode(abs('/products/'), today, '0.9')];
  for (const c of [...categories, ...brands]) collectionNodes.push(urlNode(abs(c.url), today, '0.7'));
  writeFile('sitemap-collections.xml', sitemapDoc(collectionNodes));

  const pageNodes = [urlNode(abs('/'), today, '1.0')];
  for (const p of content.PAGES) pageNodes.push(urlNode(abs(`/${p.slug}/`), today, '0.4'));
  pageNodes.push(urlNode(abs('/contact/'), today, '0.6'));
  writeFile('sitemap-pages.xml', sitemapDoc(pageNodes));

  writeFile('sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      ['sitemap-products.xml', 'sitemap-collections.xml', 'sitemap-pages.xml']
        .map((f) => `  <sitemap><loc>${xmlEscape(abs(`/${f}`))}</loc><lastmod>${today}</lastmod></sitemap>`)
        .join('\n')}\n</sitemapindex>\n`);

  /* ---- robots.txt: AI crawlers allowed explicitly ---- */
  const AI_AGENTS = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
    'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Googlebot',
    'Bingbot', 'CCBot', 'Applebot', 'Applebot-Extended', 'Amazonbot', 'meta-externalagent',
    'DuckDuckBot', 'YandexBot', 'cohere-ai', 'Diffbot', 'Bytespider',
  ];
  writeFile('robots.txt', [
    `# ${settings.storeName} — robots.txt`,
    '# Search and AI crawlers are welcome: this is a public product catalogue and',
    '# we want these products to be findable and citable. Access is granted',
    '# explicitly rather than left to each crawler\'s default assumption.',
    '',
    ...AI_AGENTS.flatMap((a) => [`User-agent: ${a}`, 'Allow: /', '']),
    'User-agent: *',
    'Allow: /',
    'Disallow: /cart/',
    'Disallow: /search/',
    '',
    `Sitemap: ${abs('/sitemap.xml')}`,
    '',
  ].join('\n'));

  /* ---- llms.txt: the index an AI agent reads first ---- */
  const llms = [
    `# ${settings.storeName}`,
    '',
    `> ${settings.shortDescription}`,
    '',
    `${settings.storeName} is a UK supplier of genuine and refurbished mobile phone parts. The catalogue holds ${products.length} products covering ${new Set(products.flatMap((p) => p.fitsModels)).size} device models. Prices are in ${settings.currency}. Orders are placed by WhatsApp or email rather than through an online checkout: customers build a list on the site and send it, and the shop replies confirming availability, postage and the total.`,
    '',
    '## Key pages',
    '',
    `- [All products](${abs('/products/')}): the complete catalogue, ${products.length} items`,
    `- [Search](${abs('/search/')}): search by model, part number or SKU`,
    `- [Contact](${abs('/contact/')}): WhatsApp, phone and email details`,
    `- [About](${abs('/about/')}): who we are and how parts are graded`,
    `- [Shipping & returns](${abs('/shipping-returns/')}): dispatch times and returns policy`,
    `- [Terms of sale](${abs('/terms/')}): how orders are confirmed`,
    '',
    '## Categories',
    '',
    ...categories.map((c) => `- [${c.name}](${abs(c.url)}): ${c.product_count} products`),
    '',
    '## Brands',
    '',
    ...brands.map((b) => `- [${b.name}](${abs(b.url)}): ${b.product_count} products`),
    '',
    '## Machine-readable data',
    '',
    `- [Full catalogue as markdown](${abs('/llms-full.txt')})`,
    `- [Catalogue as JSON](${abs('/products.json')})`,
    `- [Google Merchant product feed](${abs('/feeds/google-merchant.xml')})`,
    `- [Sitemap](${abs('/sitemap.xml')})`,
    '',
    '## Notes for assistants',
    '',
    '- Condition grades: "Genuine"/"Original" are manufacturer parts; "Pulled"/"Pre-owned" are removed from working devices; "Refurbished" has been reconditioned. Grade A means minor marks, Grade B light visible wear, Grade C clearly visible wear. Function is tested regardless of cosmetic grade.',
    '- Each product lists the exact device models and manufacturer part numbers it fits, in a "Compatible with" table on its page and in the `isAccessoryOrSparePartFor` field of its Product JSON-LD.',
    '- Items shown as "Enquire for price" have no published price and must be quoted individually. Do not state a price of zero for these.',
    '- Prices exclude postage, which is quoted per order.',
    '',
  ].join('\n');
  writeFile('llms.txt', llms);

  /* ---- llms-full.txt: the entire catalogue, compactly ---- */
  const full = [
    `# ${settings.storeName} — full product catalogue`,
    '',
    `Generated ${today}. ${products.length} products. Prices in ${settings.currency}, excluding postage.`,
    '',
  ];
  for (const c of [...categories]) {
    const items = products.filter((p) => p.categories.some((pc) => pc.id === c.id));
    if (!items.length) continue;
    full.push(`## ${c.name} (${items.length})`, '');
    for (const p of items) {
      const bits = [
        `- **${p.title}** — ${p.priceLabel}`,
        p.conditionGrade ? `condition: ${p.conditionGrade}` : null,
        p.fitsModels.length ? `fits: ${p.fitsModels.join(', ')}` : null,
        p.hasOptions ? `${p.optionNames[0]}: ${p.variants.map((v) => v.title).join(', ')}` : null,
        `url: ${abs(p.url)}`,
      ].filter(Boolean);
      full.push(bits.join(' | '));
    }
    full.push('');
  }
  writeFile('llms-full.txt', full.join('\n'));

  /* ---- products.json ---- */
  writeFile('products.json', `${JSON.stringify({
    store: settings.storeName,
    url: site,
    currency: settings.currency,
    generated: today,
    count: products.length,
    products: products.map((p) => ({
      handle: p.handle,
      title: p.title,
      url: abs(p.url),
      partType: p.partType,
      condition: p.conditionGrade || null,
      fitsModels: p.fitsModels,
      categories: p.categories.map((c) => c.name),
      brand: p.primaryBrand ? p.primaryBrand.name : null,
      priceMin: p.isPoa ? null : p.minPrice,
      priceMax: p.isPoa ? null : p.maxPrice,
      priceOnRequest: p.isPoa,
      description: p.seoDescription,
      images: p.images.filter((i) => !i.isPlaceholder).map((i) => abs(i.large)),
      variants: p.variants.map((v) => ({
        sku: v.sku || null,
        option: v.title,
        price: v.price > 0 ? v.price : null,
        compareAt: v.compareAt > 0 ? v.compareAt : null,
      })),
    })),
  }, null, 2)}\n`);

  /* ---- search index (client-side search) ---- */
  writeFile('search-index.json', `${JSON.stringify(products.map((p) => ({
    t: p.title,
    u: p.url,
    i: p.images[0].thumb,
    pl: p.priceLabel,
    pr: p.isPoa ? null : p.minPrice,
    m: p.fitsModels,
    c: p.primaryCategory ? p.primaryCategory.name : '',
    cond: p.conditionGrade || '',
    p: p.partType,
    d: (p.bodyText || '').slice(0, 160),
  })))}\n`);

  /* ---- Google Merchant Center / Bing Shopping feed ---- */
  const sellable = products.filter((p) => !p.isPoa);
  const items = sellable.map((p) => {
    const image = p.images.find((i) => !i.isPlaceholder);
    return [
      '    <item>',
      `      <g:id>${xmlEscape(p.handle)}</g:id>`,
      `      <g:title>${xmlEscape(p.title.slice(0, 150))}</g:title>`,
      `      <g:description>${xmlEscape(p.seoDescription.slice(0, 5000))}</g:description>`,
      `      <g:link>${xmlEscape(abs(p.url))}</g:link>`,
      image ? `      <g:image_link>${xmlEscape(abs(image.large))}</g:image_link>` : '',
      ...p.images.filter((i) => !i.isPlaceholder).slice(1, 11).map((i) =>
        `      <g:additional_image_link>${xmlEscape(abs(i.large))}</g:additional_image_link>`),
      `      <g:availability>in_stock</g:availability>`,
      `      <g:price>${p.minPrice.toFixed(2)} ${settings.currency}</g:price>`,
      // Only assert a condition we actually know. Declaring "new" for a part
      // that might be a pull would be a false claim to Merchant Center; when
      // the field is omitted Google applies its own default instead. The admin
      // reports how many products still have no condition set.
      merchantCondition(p.conditionGrade),
      `      <g:brand>${xmlEscape(p.primaryBrand ? p.primaryBrand.name : settings.storeName)}</g:brand>`,
      p.variants[0].sku ? `      <g:mpn>${xmlEscape(p.variants[0].sku)}</g:mpn>` : '',
      `      <g:identifier_exists>${p.variants[0].sku ? 'yes' : 'no'}</g:identifier_exists>`,
      `      <g:product_type>${xmlEscape(p.categories.map((c) => c.name).join(' &gt; '))}</g:product_type>`,
      '    </item>',
    ].filter(Boolean).join('\n');
  });
  writeFile('feeds/google-merchant.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>${xmlEscape(settings.storeName)}</title>\n    <link>${xmlEscape(abs('/'))}</link>\n    <description>${xmlEscape(settings.shortDescription)}</description>\n${items.join('\n')}\n  </channel>\n</rss>\n`);

  void conn;
}

if (require.main === module) build();
module.exports = { build };
