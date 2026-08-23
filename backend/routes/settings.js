'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');

const db = require('../db');
const { cleanHtml } = require('../lib/sanitize');
const content = require('../../generator/lib/content');
const seo = require('../../generator/lib/seo');
const { loadSettings } = require('../../generator/lib/data');

const multer = require('multer');
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\/(jpeg|png|webp|gif|avif|svg\+xml)$/.test(file.mimetype));
  },
});

/* The settings the admin exposes, grouped for the form. Anything not listed
   here can still live in the settings table but is not editable in the UI. */
const GROUPS = [
  {
    title: 'Store',
    hint: 'Shown in the header, footer and page titles.',
    fields: [
      ['storeName', 'Store name', 'text'],
      ['tagline', 'Tagline', 'text', 'Used as the homepage headline.'],
      ['shortDescription', 'Short description', 'textarea', 'Used in the footer, homepage intro and llms.txt.'],
      ['siteUrl', 'Site URL', 'url', 'The live domain. Used for canonical URLs, sitemaps and structured data — must be correct before going live.'],
      ['announcement', 'Announcement bar', 'text', 'Leave empty to hide the bar.'],
    ],
  },
  {
    title: 'Contact & ordering',
    hint: 'The WhatsApp number powers the "Send order" button. Until these are real, the contact page shows a setup notice and no address is published as structured data.',
    fields: [
      ['contact.whatsapp', 'WhatsApp number', 'text', 'Digits only, including country code — e.g. 447700900123.'],
      ['contact.phoneDisplay', 'Phone (as displayed)', 'text', 'e.g. +44 7700 900123'],
      ['contact.orderEmail', 'Order email', 'email'],
      ['contact.supportEmail', 'Support email', 'email'],
      ['contact.addressLine1', 'Address line 1', 'text'],
      ['contact.addressLine2', 'Address line 2', 'text'],
      ['contact.city', 'City', 'text'],
      ['contact.postcode', 'Postcode', 'text'],
      ['contact.country', 'Country', 'text'],
      ['contact.countryCode', 'Country code', 'text', 'Two letters, e.g. GB.'],
      ['contact.openingHours', 'Opening hours', 'text'],
    ],
  },
  {
    title: 'Shop',
    fields: [
      ['currency', 'Currency code', 'text', 'e.g. GBP'],
      ['currencySymbol', 'Currency symbol', 'text'],
      ['shop.perPage', 'Products per page', 'number', 'Set high enough to hold a whole category on one page — client-side filters only apply to the page they are on.'],
      ['shop.poaLabel', 'Label for products with no price', 'text'],
    ],
  },
  {
    title: 'SEO',
    fields: [
      ['seo.titleSuffix', 'Title suffix', 'text', 'Appended to page titles after a pipe.'],
      ['seo.defaultDescription', 'Default meta description', 'textarea', 'Used on the homepage.'],
      ['seo.twitterHandle', 'X / Twitter handle', 'text', 'Including the @.'],
    ],
  },
  {
    title: 'Social links',
    hint: 'Full URLs only. These become the Organization sameAs links in structured data, which is how search engines connect the site to your profiles.',
    fields: [
      ['social.facebook', 'Facebook', 'url'],
      ['social.instagram', 'Instagram', 'url'],
      ['social.twitter', 'X / Twitter', 'url'],
      ['social.youtube', 'YouTube', 'url'],
      ['social.tiktok', 'TikTok', 'url'],
      ['social.ebay', 'eBay shop', 'url'],
    ],
  },
  {
    title: 'Images',
    fields: [
      ['images.jpegFallback', 'Write JPEG fallbacks', 'checkbox', 'WebP is supported by every current browser. Turning this off halves the size of the images committed to the repository; existing JPEGs are left on disk until you re-run the image pipeline.'],
    ],
  },
];

module.exports = (conn, app) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    const values = db.allSettings(conn);
    const nested = loadSettings(conn);
    const contact = {
      whatsapp: seo.hasWhatsApp(nested),
      phone: seo.hasPhone(nested),
      address: seo.hasAddress(nested),
      email: seo.hasEmail(nested),
    };
    const pages = content.PAGES.map((p) => ({
      slug: p.slug,
      heading: p.heading,
      body: db.getSetting(conn, `page.${p.slug}.body`) || p.body,
      isDefault: db.getSetting(conn, `page.${p.slug}.body`) === null,
    }));
    pages.push({
      slug: 'contact',
      heading: 'Contact page copy',
      body: db.getSetting(conn, 'page.contact.body') || content.CONTACT_BODY,
      isDefault: db.getSetting(conn, 'page.contact.body') === null,
    });

    res.render('settings/index', { title: 'Settings', groups: GROUPS, values, pages, contact });
  });

  /* Main settings form — plain urlencoded, no file upload here */
  router.post('/', (req, res) => {
    const save = conn.transaction(() => {
      for (const group of GROUPS) {
        for (const [key, , type] of group.fields) {
          const raw = req.body[key];
          const value = type === 'checkbox' ? (raw ? 'true' : 'false') : String(raw ?? '').trim();
          db.setSetting(conn, key, value);
        }
      }
    });
    save();

    // Mirror back to site.config.json so the checked-in defaults track the
    // admin, and a fresh clone starts from the same values.
    try {
      const cfgPath = path.join(db.ROOT, 'site.config.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      for (const group of GROUPS) {
        for (const [key, , type] of group.fields) {
          const parts = key.split('.');
          let node = cfg;
          while (parts.length > 1) {
            const p = parts.shift();
            if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
            node = node[p];
          }
          const raw = db.getSetting(conn, key, '');
          node[parts[0]] = type === 'number' ? Number(raw) || 0
            : type === 'checkbox' ? raw === 'true'
              : raw;
        }
      }
      fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
    } catch (err) {
      app.setFlash('error', `Settings saved, but site.config.json could not be updated: ${err.message}`);
      return res.redirect('/settings');
    }

    app.setFlash('success', 'Settings saved. Publish to apply them to the live site.');
    res.redirect('/settings');
  });

  /* Dedicated logo upload route — separate form, multipart only */
  router.post('/logo', logoUpload.single('storeLogo'), (req, res) => {
    if (!req.file) {
      app.setFlash('error', 'No image file received. Please choose an image and try again.');
      return res.redirect('/settings');
    }

    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const filename = 'logo' + ext;
    const assetDir = path.join(db.ROOT, 'generator', 'assets');

    // Remove any old logo files before saving the new one
    fs.readdirSync(assetDir).forEach((f) => {
      if (f.startsWith('logo.')) fs.unlinkSync(path.join(assetDir, f));
    });

    fs.writeFileSync(path.join(assetDir, filename), req.file.buffer);
    const logoPath = '/assets/' + filename;
    db.setSetting(conn, 'storeLogo', logoPath);

    // Mirror to site.config.json
    try {
      const cfgPath = path.join(db.ROOT, 'site.config.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      cfg.storeLogo = logoPath;
      fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
    } catch { /* non-fatal */ }

    app.setFlash('success', 'Logo uploaded. Publish to apply it to the live site.');
    res.redirect('/settings');
  });

  /* Remove logo */
  router.post('/logo/remove', (req, res) => {
    const assetDir = path.join(db.ROOT, 'generator', 'assets');
    fs.readdirSync(assetDir).forEach((f) => {
      if (f.startsWith('logo.')) fs.unlinkSync(path.join(assetDir, f));
    });
    db.setSetting(conn, 'storeLogo', '');

    try {
      const cfgPath = path.join(db.ROOT, 'site.config.json');
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      cfg.storeLogo = '';
      fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
    } catch { /* non-fatal */ }

    app.setFlash('success', 'Logo removed.');
    res.redirect('/settings');
  });

  router.post('/pages/:slug', (req, res) => {
    const slug = String(req.params.slug);
    const known = content.PAGES.map((p) => p.slug).concat('contact');
    if (!known.includes(slug)) {
      app.setFlash('error', `Unknown page "${slug}".`);
      return res.redirect('/settings');
    }
    if (req.body.reset) {
      conn.prepare('DELETE FROM settings WHERE key = ?').run(`page.${slug}.body`);
      app.setFlash('success', `Reset the ${slug} page to its default copy.`);
    } else {
      db.setSetting(conn, `page.${slug}.body`, cleanHtml(req.body.body));
      app.setFlash('success', `Saved the ${slug} page copy. Publish to apply it.`);
    }
    res.redirect('/settings#pages');
  });

  return router;
};
