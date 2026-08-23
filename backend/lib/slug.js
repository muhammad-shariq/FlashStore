'use strict';

/** URL-safe slug, matching Shopify's handle style. */
function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'item';
}

/** slugify, then suffix -2, -3 … until `isTaken(slug)` returns false. */
function uniqueSlug(input, isTaken) {
  const base = slugify(input);
  if (!isTaken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`could not build a unique slug for "${input}"`);
}

module.exports = { slugify, uniqueSlug };
