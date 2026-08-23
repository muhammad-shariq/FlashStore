'use strict';
/**
 * Per-product SEO scoring for the admin. The point is not the number — it is
 * the list of specific, actionable gaps, so the catalogue can be improved a
 * few products at a time instead of all at once.
 */

function scoreProduct(product, images, variants) {
  const checks = [];
  const add = (ok, weight, label, hint) => checks.push({ ok, weight, label, hint });

  const title = String(product.title || '');
  const seoTitle = String(product.seo_title || '');
  const desc = String(product.seo_description || '');
  const body = String(product.body_text || '');
  let models = [];
  try { models = JSON.parse(product.fits_models || '[]'); } catch { models = []; }

  add(title.length >= 15 && title.length <= 110, 2, 'Title length',
    'Aim for 15–110 characters so it reads well as a heading and in search.');
  add(seoTitle.length > 0 && seoTitle.length <= 70, 2, 'Page title set and under 70 characters',
    'Longer titles get truncated in search results.');
  add(desc.length >= 70 && desc.length <= 160, 3, 'Meta description 70–160 characters',
    'This is the snippet shown in search results.');
  add(body.length >= 120, 3, 'Description has real content',
    'A short description gives search engines and AI assistants little to work with. Aim for 120+ characters.');
  add(models.length > 0, 4, 'Compatible models listed',
    'This is the single most valuable field: it lets a customer or an AI assistant confirm the part fits a specific handset.');
  add(Boolean(product.condition_grade), 2, 'Condition stated',
    'Buyers filter on condition, and it maps to itemCondition in structured data.');
  add(Boolean(product.part_type), 1, 'Part type set', 'Drives the category and the summary sentence.');
  add(images.length > 0, 4, 'Has at least one image', 'Products without an image show a placeholder.');
  add(images.length >= 3, 1, 'Has three or more images', 'More angles reduce enquiries and returns.');
  add(images.every((i) => String(i.alt || '').trim().length > 0), 2, 'Every image has alt text',
    'Alt text is required for accessibility and helps image search.');
  add(variants.some((v) => v.price > 0), 3, 'Has a price',
    'Price-on-application products cannot appear in Google Shopping or carry an Offer in structured data.');
  add(variants.every((v) => v.sku), 1, 'Every variant has a SKU',
    'SKUs become mpn in structured data and the merchant feed.');

  const max = checks.reduce((n, c) => n + c.weight, 0);
  const got = checks.reduce((n, c) => n + (c.ok ? c.weight : 0), 0);
  const score = Math.round((got / max) * 100);

  return {
    score,
    grade: score >= 90 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor',
    checks,
    issues: checks.filter((c) => !c.ok),
  };
}

module.exports = { scoreProduct };
