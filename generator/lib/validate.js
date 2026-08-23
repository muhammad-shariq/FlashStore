'use strict';
/**
 * Build-time SEO and integrity linter.
 *
 * Runs over the generated HTML and fails the build on anything that would
 * quietly degrade search or AI visibility. The point is that a well-meaning
 * edit in the admin six months from now cannot silently ship a page with a
 * duplicate title, a missing alt attribute or a broken internal link.
 */
const fs = require('fs');
const path = require('path');

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
};

function lintPage(rel, html, opts) {
  const errors = [];
  const warnings = [];
  const add = (list, msg) => list.push(`${rel}: ${msg}`);

  /* ---- title ---- */
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  if (!title || !title.trim()) add(errors, 'missing <title>');
  else if (title.length > 70) add(warnings, `<title> is ${title.length} chars (aim for <=70): "${title.slice(0, 60)}…"`);

  /* ---- meta description ---- */
  const descTag = (html.match(/<meta\s+name=["']description["'][^>]*>/i) || [])[0];
  const desc = descTag ? attr(descTag, 'content') : null;
  if (!desc || !desc.trim()) add(errors, 'missing meta description');
  else if (desc.length > 165) add(warnings, `meta description is ${desc.length} chars (aim for <=160)`);
  else if (desc.length < 50) add(warnings, `meta description is only ${desc.length} chars`);

  /* ---- canonical ---- */
  if (!/<link\s+rel=["']canonical["']/i.test(html)) add(errors, 'missing canonical link');

  /* ---- exactly one h1 ---- */
  const h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length === 0) add(errors, 'no <h1>');
  else if (h1s.length > 1) add(errors, `${h1s.length} <h1> elements (must be exactly 1)`);

  /* ---- heading order ---- */
  const levels = [...html.matchAll(/<h([1-4])[\s>]/gi)].map((m) => Number(m[1]));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      add(warnings, `heading level jumps from h${levels[i - 1]} to h${levels[i]}`);
      break;
    }
  }

  /* ---- images: alt + intrinsic size ---- */
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    if (attr(tag, 'alt') === null) add(errors, `<img> without alt: ${tag.slice(0, 90)}`);
    const src = attr(tag, 'src');
    // A decorative image inside a link already labelled elsewhere may use
    // alt="", but every image still needs dimensions to avoid layout shift.
    if (src && !src.startsWith('data:') && (!attr(tag, 'width') || !attr(tag, 'height'))) {
      add(warnings, `<img> without width/height: ${src}`);
    }
    if (src && src.startsWith('/') && !src.includes('{')) {
      const abs = path.join(opts.webRoot, src);
      if (!fs.existsSync(abs)) add(errors, `image not found on disk: ${src}`);
    }
  }

  /* ---- JSON-LD parses ---- */
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]);
      if (!parsed['@context']) add(errors, 'JSON-LD missing @context');
      const nodes = parsed['@graph'] || [parsed];
      for (const node of nodes) {
        if (!node['@type']) add(errors, 'JSON-LD node missing @type');
        if (node['@type'] === 'Product') {
          if (!node.name) add(errors, 'Product JSON-LD missing name');
          const offers = node.offers;
          if (offers) {
            const price = offers.price ?? offers.lowPrice;
            if (price !== undefined && Number(price) <= 0) {
              add(errors, `Product JSON-LD publishes a non-positive price (${price})`);
            }
            if (!offers.priceCurrency) add(errors, 'Product offer missing priceCurrency');
          }
        }
      }
    } catch (err) {
      add(errors, `invalid JSON-LD: ${err.message}`);
    }
  }

  /* ---- unreviewed placeholder copy ---- */
  const placeholders = html.match(/\[\[[^\]]{3,60}\]\]/g) || [];
  if (placeholders.length) {
    add(warnings, `${placeholders.length} unreviewed placeholder(s), e.g. ${placeholders[0]}`);
  }
  if (/PLACEHOLDER/.test(html)) add(warnings, 'contains the literal word PLACEHOLDER');

  /* ---- internal links resolve ---- */
  const links = new Set();
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href');
    if (!href || !href.startsWith('/')) continue;
    links.add(href.split('#')[0].split('?')[0]);
  }
  for (const href of links) {
    if (!href) continue;
    const candidates = href.endsWith('/')
      ? [path.join(opts.webRoot, href, 'index.html')]
      : [path.join(opts.webRoot, href), path.join(opts.webRoot, `${href}.html`)];
    if (!candidates.some((c) => fs.existsSync(c))) {
      add(errors, `broken internal link: ${href}`);
    }
  }

  return { errors, warnings, title, desc };
}

/** Lint every generated page and report duplicates across the whole site. */
function validateSite(pages, webRoot) {
  const errors = [];
  const warnings = [];
  const titles = new Map();
  const descs = new Map();

  for (const rel of pages) {
    const file = path.join(webRoot, rel);
    if (!fs.existsSync(file)) { errors.push(`${rel}: expected file was not written`); continue; }
    const html = fs.readFileSync(file, 'utf8');
    const res = lintPage(rel, html, { webRoot });
    errors.push(...res.errors);
    warnings.push(...res.warnings);

    // Pages excluded from the index (or canonicalised elsewhere) cannot
    // compete for a query, so they are exempt from the duplicate checks.
    const indexable = !/<meta\s+name=["']robots["'][^>]*noindex/i.test(html);
    if (res.title && indexable) {
      if (!titles.has(res.title)) titles.set(res.title, []);
      titles.get(res.title).push(rel);
    }
    if (res.desc && indexable) {
      if (!descs.has(res.desc)) descs.set(res.desc, []);
      descs.get(res.desc).push(rel);
    }
  }

  for (const [title, where] of titles) {
    if (where.length > 1) errors.push(`duplicate <title> "${title.slice(0, 55)}…" on ${where.length} pages: ${where.slice(0, 3).join(', ')}`);
  }
  for (const [, where] of descs) {
    if (where.length > 1) warnings.push(`duplicate meta description on ${where.length} pages: ${where.slice(0, 3).join(', ')}`);
  }

  return { errors, warnings };
}

module.exports = { validateSite, lintPage };
