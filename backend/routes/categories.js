'use strict';
const express = require('express');
const { slugify, uniqueSlug } = require('../lib/slug');

module.exports = (conn, app) => {
  const router = express.Router();

  const parseJson = (v, f) => {
    try { const p = JSON.parse(v || 'null'); return p == null ? f : p; } catch { return f; }
  };

  router.get('/', (req, res) => {
    const rows = conn.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM product_categories pc WHERE pc.category_id = c.id) product_count
      FROM categories c ORDER BY c.kind DESC, c.position, c.name`).all();
    res.render('categories/list', {
      title: 'Categories & brands',
      categories: rows.filter((c) => c.kind === 'category'),
      brands: rows.filter((c) => c.kind === 'brand'),
    });
  });

  router.get('/new', (req, res) => {
    res.render('categories/edit', {
      title: 'New category',
      category: {
        id: null, slug: '', name: '', kind: 'category', description: '',
        seo_title: '', seo_description: '', faq: '[]', position: 0, featured: 0,
      },
      faq: [], products: [], assigned: new Set(),
    });
  });

  router.get('/:id', (req, res, next) => {
    const category = conn.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!category) return next();
    const assigned = new Set(conn.prepare('SELECT product_id FROM product_categories WHERE category_id = ?')
      .all(category.id).map((r) => r.product_id));
    const products = conn.prepare('SELECT id, title, handle, part_type FROM products ORDER BY title').all();
    res.render('categories/edit', {
      title: category.name,
      category,
      faq: parseJson(category.faq, []),
      products,
      assigned,
    });
  });

  const readForm = (body) => {
    const qs = [].concat(body.faq_q || []);
    const as = [].concat(body.faq_a || []);
    return {
      name: String(body.name || '').trim(),
      kind: body.kind === 'brand' ? 'brand' : 'category',
      description: String(body.description || '').trim(),
      seo_title: String(body.seo_title || '').trim(),
      seo_description: String(body.seo_description || '').trim(),
      position: Number(body.position) || 0,
      featured: body.featured ? 1 : 0,
      faq: JSON.stringify(qs.map((q, i) => ({ q: String(q).trim(), a: String(as[i] || '').trim() }))
        .filter((f) => f.q && f.a)),
    };
  };

  router.post('/new', (req, res) => {
    const form = readForm(req.body);
    if (!form.name) { app.setFlash('error', 'A name is required.'); return res.redirect('/categories/new'); }
    const slug = uniqueSlug(req.body.slug || form.name,
      (s) => !!conn.prepare('SELECT 1 FROM categories WHERE slug = ?').get(s));
    const info = conn.prepare(`INSERT INTO categories
      (slug, name, kind, description, seo_title, seo_description, position, featured, faq)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      slug, form.name, form.kind, form.description, form.seo_title,
      form.seo_description, form.position, form.featured, form.faq);
    app.setFlash('success', `Created “${form.name}”.`);
    res.redirect(`/categories/${info.lastInsertRowid}`);
  });

  router.post('/:id', (req, res, next) => {
    const category = conn.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!category) return next();
    const form = readForm(req.body);

    let slug = String(req.body.slug || '').trim();
    slug = slug ? slugify(slug) : category.slug;
    if (slug !== category.slug) {
      slug = uniqueSlug(slug, (s) => s !== category.slug
        && !!conn.prepare('SELECT 1 FROM categories WHERE slug = ?').get(s));
    }

    const save = conn.transaction(() => {
      conn.prepare(`UPDATE categories SET slug=?, name=?, kind=?, description=?, seo_title=?,
                      seo_description=?, position=?, featured=?, faq=? WHERE id=?`).run(
        slug, form.name || category.name, form.kind, form.description, form.seo_title,
        form.seo_description, form.position, form.featured, form.faq, category.id);

      // The product list is only submitted from the assignment panel; without
      // it a plain "save details" must not wipe the assignments.
      if (req.body.manage_products) {
        conn.prepare('DELETE FROM product_categories WHERE category_id = ?').run(category.id);
        for (const raw of [].concat(req.body.products || [])) {
          const pid = Number(raw);
          if (pid) {
            conn.prepare('INSERT INTO product_categories (product_id, category_id) VALUES (?,?) ON CONFLICT DO NOTHING')
              .run(pid, category.id);
          }
        }
      }
    });
    save();
    app.setFlash('success', `Saved “${form.name || category.name}”.`);
    res.redirect(`/categories/${category.id}`);
  });

  router.post('/:id/delete', (req, res, next) => {
    const category = conn.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!category) return next();
    const count = conn.prepare('SELECT COUNT(*) n FROM product_categories WHERE category_id=?').get(category.id).n;
    if (count > 0 && !req.body.force) {
      app.setFlash('error', `“${category.name}” still has ${count} products. Reassign them first, or tick the confirmation.`);
      return res.redirect(`/categories/${category.id}`);
    }
    conn.prepare('DELETE FROM categories WHERE id=?').run(category.id);
    app.setFlash('success', `Deleted “${category.name}”.`);
    res.redirect('/categories');
  });

  return router;
};
