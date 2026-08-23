#!/usr/bin/env node
'use strict';
/**
 * Downloads every product image from the Shopify CDN and generates the web
 * derivatives. Resumable: anything already on disk is skipped, so a failed or
 * interrupted run just needs re-running.
 *
 *   node scripts/download-images.js [--concurrency 6] [--force]
 */
const fs = require('fs');
const path = require('path');
const { request } = require('undici');

const db = require('../backend/db');
const img = require('../backend/lib/images');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const cIdx = argv.indexOf('--concurrency');
const CONCURRENCY = cIdx !== -1 ? Math.max(1, Number(argv[cIdx + 1]) || 6) : 6;
const MAX_RETRIES = 3;

/** Ask the CDN for a sensible max width instead of pulling multi-MB originals. */
function sourceUrl(src) {
  try {
    const u = new URL(src);
    u.searchParams.set('width', '1600');
    return u.toString();
  } catch {
    return src;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBuffer(url) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await request(url, {
        maxRedirections: 3,
        headers: { 'user-agent': 'FlashStore-migration/1.0' },
      });
      if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}`);
      return Buffer.from(await res.body.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}

async function run() {
  const conn = db.open();
  const rows = conn.prepare(`
    SELECT i.id, i.src_original, i.base_filename, i.width, i.height, p.handle
    FROM images i JOIN products p ON p.id = i.product_id
    WHERE i.src_original <> ''
    ORDER BY p.handle, i.position`).all();

  const updateSize = conn.prepare('UPDATE images SET width=?, height=? WHERE id=?');

  const todo = rows.filter((r) =>
    FORCE || !img.derivativesExist(r.handle, r.base_filename) || !r.width);

  console.log(`${rows.length} images in database; ${todo.length} need work (concurrency ${CONCURRENCY}).`);
  if (!todo.length) { conn.close(); return; }

  const failures = [];
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < todo.length) {
      const row = todo[cursor++];
      const label = `${row.handle}/${row.base_filename}`;
      try {
        const ext = (path.extname(String(row.src_original).split('?')[0]) || '.jpg').toLowerCase();
        const originalPath = path.join(img.ORIGINALS_ROOT, row.handle, `${row.base_filename}${ext}`);

        let buffer;
        if (!FORCE && fs.existsSync(originalPath)) {
          buffer = fs.readFileSync(originalPath);          // reuse the archive
        } else {
          buffer = await fetchBuffer(sourceUrl(row.src_original));
          img.saveOriginal(buffer, row.handle, row.base_filename, ext);
        }

        const { width, height } = await img.processBuffer(buffer, row.handle, row.base_filename);
        updateSize.run(width, height, row.id);
      } catch (err) {
        failures.push({ label, src: row.src_original, error: err.message });
      }
      done++;
      if (done % 25 === 0 || done === todo.length) {
        process.stdout.write(`  ${done}/${todo.length} processed (${failures.length} failed)\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nDone. ${done - failures.length} succeeded, ${failures.length} failed.`);
  if (failures.length) {
    console.log('\nFailures (re-run to retry):');
    for (const f of failures) console.log(`  ${f.label}  ${f.error}\n    ${f.src}`);
  }
  conn.close();
}

run().catch((err) => { console.error(err); process.exit(1); });
