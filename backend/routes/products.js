'use strict';
const express = require('express');
const multer = require('multer');

const { cleanHtml, toText, truncate } = require('../lib/sanitize');
const { slugify, uniqueSlug } = require('../lib/slug');
const { detectPartType, detectCondition, extractModels } = require('../lib/extract');
const { scoreProduct } = require('../lib/seo-score');
const images = require('../lib/images');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype));
  },
});

const PER_PAGE = 40;

module.exports = (conn, app) => {
  const router = express.Router();

  const loadProduct = (id) => conn.prepare('SELECT * FROM products WHERE id = ?').get(id);
  const loadImages = (id) => conn.prepare('SELECT * FROM images WHERE product_id = ? ORDER BY position').all(id);
  const loadVariants = (id) => conn.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY position').all(id);
  const allCategories = () => conn.prepare("SELECT * FROM categories ORDER BY kind DESC, position, name").all();

  const parseJson = (v, fallback) => {
    try { const p = JSON.parse(v || 'null'); return p == null ? fallback : p; } catch { return fallback; }
  };

  /* ---------------- list ---------------- */
  router.get('/', (req, res) => {
    const q = String(req.query.q || '').trim();
    const categoryId = req.query.category ? Number(req.query.category) : null;
    const status = String(req.query.status || '');
    const page = Math.max(1, Number(req.query.page) || 1);

    const where = [];
    const params = {};
    if (q) {
      where.push('(p.title LIKE :q OR p.handle LIKE :q OR p.fits_models LIKE :q OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.sku LIKE :q))');
      params.q = `%${q}%`;
    }
    if (categoryId) {
      where.push('EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = :cat)');
      params.cat = categoryId;
    }
    if (status) { where.push('p.status = :status'); params.status = status; }

    /* Gap filters, so the dashboard's catalogue-gap rows can link straight to
       the products that need work. */
    const GAP_SQL = {
      'no-models': "(p.fits_models IS NULL OR p.fits_models = '' OR p.fits_models = '[]')",
      'no-images': 'NOT EXISTS (SELECT 1 FROM images i WHERE i.product_id = p.id)',
      'no-alt': "EXISTS (SELECT 1 FROM images i WHERE i.product_id = p.id AND TRIM(COALESCE(i.alt, '')) = '')",
      'no-price': 'NOT EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.price > 0)',
      'thin-body': 'LENGTH(COALESCE(p.body_text, \'\')) < 120',
      'no-condition': "TRIM(COALESCE(p.condition_grade, '')) = ''",
      uncategorised: `NOT EXISTS (SELECT 1 FROM product_categories pc
        JOIN categories c ON c.id = pc.category_id
        WHERE pc.product_id = p.id AND c.kind = 'category')`,
    };
    const gap = String(req.query.gap || '');
    if (GAP_SQL[gap]) where.push(GAP_SQL[gap]);

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = conn.prepare(`SELECT COUNT(*) n FROM products p ${clause}`).get(params).n;
    const rows = conn.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM images i WHERE i.product_id = p.id) image_count,
        (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id) variant_count,
        (SELECT MIN(v.price) FROM variants v WHERE v.product_id = p.id AND v.price > 0) min_price,
        (SELECT i.base_filename FROM images i WHERE i.product_id = p.id ORDER BY i.position LIMIT 1) thumb_file
      FROM products p ${clause}
      ORDER BY p.position LIMIT :limit OFFSET :offset`)
      .all({ ...params, limit: PER_PAGE, offset: (page - 1) * PER_PAGE });

    const withScore = rows.map((p) => ({
      ...p,
      thumb: p.thumb_file ? images.relPaths(p.handle, p.thumb_file).thumb : null,
      ...scoreProduct(p, loadImages(p.id), loadVariants(p.id)),
    }));

    res.render('products/list', {
      title: 'Products',
      products: withScore,
      categories: allCategories(),
      q, categoryId, status, gap,
      page, perPage: PER_PAGE, total,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
    });
  });

  /* ---------------- new ---------------- */
  router.get('/new', (req, res) => {
    res.render('products/edit', {
      title: 'New product',
      product: {
        id: null, handle: '', title: '', body_html: '', vendor: '', status: 'active',
        seo_title: '', seo_description: '', fits_models: '[]', condition_grade: '',
        part_type: '', faq: '[]',
      },
      images: [], variants: [], categories: allCategories(), assigned: new Set(),
      score: null, models: [], faq: [],
    });
  });

  router.post('/new', (req, res) => {
    const title = String(req.body.title || '').trim();
    if (!title) { app.setFlash('error', 'A title is required.'); return res.redirect('/products/new'); }

    const handle = uniqueSlug(req.body.handle || title,
      (s) => !!conn.prepare('SELECT 1 FROM products WHERE handle = ?').get(s));
    const bodyHtml = cleanHtml(req.body.body_html);
    const bodyText = toText(req.body.body_html);
    const maxPos = conn.prepare('SELECT COALESCE(MAX(position), 0) n FROM products').get().n;

    const info = conn.prepare(`
      INSERT INTO products (handle, title, body_html, body_text, vendor, status,
        seo_title, seo_description, fits_models, condition_grade, part_type, position)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      handle, title, bodyHtml, bodyText,
      String(req.body.vendor || '').trim(),
      req.body.status === 'hidden' ? 'hidden' : 'active',
      `${title} |FlashStore`.slice(0, 70),
      truncate(bodyText || title, 155),
      JSON.stringify(extractModels(title, bodyText)),
      detectCondition(title, bodyText),
      detectPartType(title),
      maxPos + 1,
    );
    // A product with no variant has no price, so seed one.
    conn.prepare('INSERT INTO variants (product_id, position, optionless) VALUES (?,1,1)')
      .run(info.lastInsertRowid);

    app.setFlash('success', `Created “${title}”. Add images and a price, then publish.`);
    res.redirect(`/products/${info.lastInsertRowid}`);
  });

  /* ---------------- edit ---------------- */
  router.get('/:id', (req, res, next) => {
    const product = loadProduct(req.params.id);
    if (!product) return next();

    const imgs = loadImages(product.id).map((i) => ({ ...i, ...images.relPaths(product.handle, i.base_filename) }));
    const variants = loadVariants(product.id);
    const assigned = new Set(conn.prepare('SELECT category_id FROM product_categories WHERE product_id = ?')
      .all(product.id).map((r) => r.category_id));

    res.render('products/edit', {
      title: product.title,
      product,
      images: imgs,
      variants,
      categories: allCategories(),
      assigned,
      models: parseJson(product.fits_models, []),
      faq: parseJson(product.faq, []),
      score: scoreProduct(product, imgs, variants),
    });
  });

  router.post('/:id', (req, res, next) => {
    const product = loadProduct(req.params.id);
    if (!product) return next();

    const title = String(req.body.title || '').trim() || product.title;
    const bodyHtml = cleanHtml(req.body.body_html);
    const bodyText = toText(req.body.body_html);

    let handle = String(req.body.handle || '').trim();
    handle = handle ? slugify(handle) : product.handle;
    if (handle !== product.handle) {
      handle = uniqueSlug(handle, (s) => s !== product.handle
        && !!conn.prepare('SELECT 1 FROM products WHERE handle = ?').get(s));
    }

    // fits_models arrives as a comma/newline separated list of chips.
    const models = String(req.body.fits_models || '')
      .split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

    // FAQ arrives as parallel arrays of questions and answers.
    const qs = [].concat(req.body.faq_q || []);
    const as = [].concat(req.body.faq_a || []);
    const faq = qs.map((q, i) => ({ q: String(q).trim(), a: String(as[i] || '').trim() }))
      .filter((f) => f.q && f.a);

    // Every page must ship a title and description, so an empty field falls
    // back to a generated one rather than publishing a blank meta tag.
    const seoTitle = String(req.body.seo_title || '').trim()
      || `${title} |FlashStore`.slice(0, 70);
    const seoDescription = String(req.body.seo_description || '').trim()
      || truncate(bodyText || `${title}. In stock now, dispatched from the UK.`, 155);

    const save = conn.transaction(() => {
      conn.prepare(`
        UPDATE products SET handle=?, title=?, body_html=?, body_text=?, vendor=?, status=?,
          seo_title=?, seo_description=?, fits_models=?, condition_grade=?, part_type=?, faq=?,
          updated_at=datetime('now')
        WHERE id=?`).run(
        handle, title, bodyHtml, bodyText,
        String(req.body.vendor || '').trim(),
        req.body.status === 'hidden' ? 'hidden' : 'active',
        seoTitle,
        seoDescription,
        JSON.stringify(models),
        String(req.body.condition_grade || '').trim(),
        String(req.body.part_type || '').trim(),
        JSON.stringify(faq),
        product.id,
      );

      /* categories */
      conn.prepare('DELETE FROM product_categories WHERE product_id = ?').run(product.id);
      for (const raw of [].concat(req.body.categories || [])) {
        const cid = Number(raw);
        if (cid) {
          conn.prepare('INSERT INTO product_categories (product_id, category_id) VALUES (?,?) ON CONFLICT DO NOTHING')
            .run(product.id, cid);
        }
      }

      /* variants (existing rows only; ids come back as hidden fields) */
      const ids = [].concat(req.body.variant_id || []);
      const skus = [].concat(req.body.variant_sku || []);
      const values = [].concat(req.body.variant_value || []);
      const prices = [].concat(req.body.variant_price || []);
      const compares = [].concat(req.body.variant_compare || []);
      const optionName = String(req.body.option_name || '').trim();

      ids.forEach((rawId, i) => {
        const vid = Number(rawId);
        if (!vid) return;
        const price = Math.max(0, Number(prices[i]) || 0);
        const compare = Math.max(0, Number(compares[i]) || 0);
        const value = String(values[i] || '').trim();
        conn.prepare(`UPDATE variants SET sku=?, opt1_name=?, opt1_value=?, price=?,
                        compare_at_price=?, optionless=?, position=? WHERE id=? AND product_id=?`)
          .run(String(skus[i] || '').trim(), value ? optionName : '', value, price,
            compare > price ? compare : 0, value ? 0 : 1, i + 1, vid, product.id);
      });

    });

    save();
    app.setFlash('success', `Saved “${title}”. Publish to update the live site.`);
    res.redirect(`/products/${product.id}`);
  });

  /* ---------------- re-derive attributes from the title ---------------- */
  router.post('/:id/rederive', (req, res, next) => {
    const product = loadProduct(req.params.id);
    if (!product) return next();
    conn.prepare('UPDATE products SET fits_models=?, condition_grade=?, part_type=? WHERE id=?').run(
      JSON.stringify(extractModels(product.title, product.body_text)),
      detectCondition(product.title, product.body_text),
      detectPartType(product.title),
      product.id,
    );
    app.setFlash('success', 'Re-derived compatibility, condition and part type from the title.');
    res.redirect(`/products/${product.id}`);
  });

  /* ---------------- variants ---------------- */
  router.post('/:id/variants/add', (req, res, next) => {
    const product = loadProduct(req.params.id);
    if (!product) return next();
    const max = conn.prepare('SELECT COALESCE(MAX(position),0) n FROM variants WHERE product_id=?').get(product.id).n;
    conn.prepare('INSERT INTO variants (product_id, position, optionless) VALUES (?,?,1)').run(product.id, max + 1);
    res.redirect(`/products/${product.id}#variants`);
  });

  router.post('/:id/variants/:vid/delete', (req, res, next) => {
    const product = loadProduct(req.params.id);
    if (!product) return next();
    const count = conn.prepare('SELECT COUNT(*) n FROM variants WHERE product_id=?').get(product.id).n;
    if (count <= 1) {
      app.setFlash('error', 'A product needs at least one variant to carry its price.');
    } else {
      conn.prepare('DELETE FROM variants WHERE id=? AND product_id=?').run(req.params.vid, product.id);
    }
    res.redirect(`/products/${product.id}#variants`);
  });

  /* ---------------- images ---------------- */
  router.post('/:id/images', upload.array('files', 12), async (req, res, next) => {
    const product = loadProduct(req.params.id);
    if (!product) return next();
    if (!req.files || !req.files.length) {
      app.setFlash('error', 'No image files were accepted (JPEG, PNG, WebP, GIF or AVIF only).');
      return res.redirect(`/products/${product.id}#images`);
    }

    let position = conn.prepare('SELECT COALESCE(MAX(position),0) n FROM images WHERE product_id=?')
      .get(product.id).n;
    let added = 0;
    for (const file of req.files) {
      position += 1;
      const stem = `${String(position).padStart(2, '0')}-${slugify(
        file.originalname.replace(/\.[^.]+$/, '')) || 'upload'}`.slice(0, 80);
      try {
        // Same Sharp pipeline as the bulk importer, so uploads and migrated
        // images produce identical derivatives.
        const { width, height } = await images.processBuffer(file.buffer, product.handle, stem);
        images.saveOriginal(file.buffer, product.handle, stem, '.jpg');
        conn.prepare(`INSERT INTO images (product_id, position, src_original, base_filename, alt, width, height)
                      VALUES (?,?,'',?,?,?,?)`)
          .run(product.id, position, stem, `${product.title} — image ${position}`, width, height);
        added += 1;
      } catch (err) {
        app.setFlash('error', `Could not process ${file.originalname}: ${err.message}`);
      }
    }
    if (added) app.setFlash('success', `Added ${added} image${added === 1 ? '' : 's'}.`);
    res.redirect(`/products/${product.id}#images`);
  });

  router.post('/:id/images/save', (req, res, next) => {
    const product = loadProduct(req.params.id);
    if (!product) return next();
    const ids = [].concat(req.body.image_id || []);
    const alts = [].concat(req.body.image_alt || []);
    const positions = [].concat(req.body.image_position || []);

    const save = conn.transaction(() => {
      ids.forEach((rawId, i) => {
        const iid = Number(rawId);
        if (!iid) return;
        conn.prepare('UPDATE images SET alt=?, position=? WHERE id=? AND product_id=?')
          .run(String(alts[i] || '').trim(), Number(positions[i]) || i + 1, iid, product.id);
      });
      // Normalise to a contiguous 1..n ordering so the gallery is predictable.
      const ordered = conn.prepare('SELECT id FROM images WHERE product_id=? ORDER BY position, id').all(product.id);
      ordered.forEach((r, i) => conn.prepare('UPDATE images SET position=? WHERE id=?').run(i + 1, r.id));
    });
    save();
    app.setFlash('success', 'Image alt text and order saved.');
    res.redirect(`/products/${product.id}#images`);
  });

  router.post('/:id/images/:imgId/delete', (req, res, next) => {
    const product = loadProduct(req.params.id);
    if (!product) return next();
    const img = conn.prepare('SELECT * FROM images WHERE id=? AND product_id=?').get(req.params.imgId, product.id);
    if (img) {
      images.deleteDerivatives(product.handle, img.base_filename);
      conn.prepare('DELETE FROM images WHERE id=?').run(img.id);
      // Close the gap left in the ordering.
      const rest = conn.prepare('SELECT id FROM images WHERE product_id=? ORDER BY position').all(product.id);
      rest.forEach((r, i) => conn.prepare('UPDATE images SET position=? WHERE id=?').run(i + 1, r.id));
      app.setFlash('success', 'Image removed.');
    }
    res.redirect(`/products/${product.id}#images`);
  });

  /* ---------------- delete ---------------- */
  router.post('/:id/delete', (req, res, next) => {
    const product = loadProduct(req.params.id);
    if (!product) return next();
    if (String(req.body.confirm || '') !== product.handle) {
      app.setFlash('error', 'Type the product handle exactly to confirm deletion.');
      return res.redirect(`/products/${product.id}`);
    }
    for (const img of loadImages(product.id)) images.deleteDerivatives(product.handle, img.base_filename);
    conn.prepare('DELETE FROM products WHERE id=?').run(product.id);
    app.setFlash('success', `Deleted “${product.title}”. Publish to remove it from the live site.`);
    res.redirect('/products');
  });

  return router;
};
