'use strict';
const express = require('express');
const { scoreProduct } = require('../lib/seo-score');

module.exports = (conn) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    const counts = conn.prepare(`SELECT
      (SELECT COUNT(*) FROM products) products,
      (SELECT COUNT(*) FROM products WHERE status='active') active,
      (SELECT COUNT(*) FROM variants) variants,
      (SELECT COUNT(*) FROM images) images,
      (SELECT COUNT(*) FROM categories WHERE kind='category') categories,
      (SELECT COUNT(*) FROM categories WHERE kind='brand') brands`).get();

    const lastBuild = conn.prepare('SELECT * FROM build_log ORDER BY id DESC LIMIT 1').get();

    /* Catalogue health: the products most worth improving, and why. */
    const products = conn.prepare('SELECT * FROM products').all();
    const imagesBy = new Map();
    for (const i of conn.prepare('SELECT product_id, alt FROM images').all()) {
      if (!imagesBy.has(i.product_id)) imagesBy.set(i.product_id, []);
      imagesBy.get(i.product_id).push(i);
    }
    const variantsBy = new Map();
    for (const v of conn.prepare('SELECT product_id, price, sku FROM variants').all()) {
      if (!variantsBy.has(v.product_id)) variantsBy.set(v.product_id, []);
      variantsBy.get(v.product_id).push(v);
    }

    const scored = products.map((p) => ({
      product: p,
      ...scoreProduct(p, imagesBy.get(p.id) || [], variantsBy.get(p.id) || []),
    }));
    const avgScore = Math.round(scored.reduce((n, s) => n + s.score, 0) / (scored.length || 1));
    const worst = [...scored].sort((a, b) => a.score - b.score).slice(0, 8);

    const gaps = {
      noModels: scored.filter((s) => s.issues.some((i) => i.label === 'Compatible models listed')).length,
      noImages: scored.filter((s) => s.issues.some((i) => i.label === 'Has at least one image')).length,
      noAlt: scored.filter((s) => s.issues.some((i) => i.label === 'Every image has alt text')).length,
      noPrice: scored.filter((s) => s.issues.some((i) => i.label === 'Has a price')).length,
      thinBody: scored.filter((s) => s.issues.some((i) => i.label === 'Description has real content')).length,
      noCondition: scored.filter((s) => s.issues.some((i) => i.label === 'Condition stated')).length,
    };

    // Duplicate titles are worth surfacing: the generator has to canonicalise
    // them, which is a workaround rather than a fix.
    const duplicates = conn.prepare(`
      SELECT title, COUNT(*) n, GROUP_CONCAT(handle, ' | ') handles
      FROM products GROUP BY LOWER(TRIM(title)) HAVING n > 1 ORDER BY title`).all();

    const uncategorised = conn.prepare(`SELECT COUNT(*) n FROM products p
      WHERE NOT EXISTS (SELECT 1 FROM product_categories pc
        JOIN categories c ON c.id = pc.category_id
        WHERE pc.product_id = p.id AND c.kind = 'category')`).get().n;

    res.render('dashboard', {
      title: 'Dashboard',
      counts, lastBuild, avgScore, worst, gaps, duplicates, uncategorised,
    });
  });

  return router;
};
