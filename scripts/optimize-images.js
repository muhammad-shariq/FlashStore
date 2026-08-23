#!/usr/bin/env node
'use strict';
/**
 * Backfills any missing image derivatives without touching the network.
 *
 * `download-images.js` needs either the CDN or the data/originals archive; on a
 * checkout that only has web/assets/products (the committed derivatives) it
 * would re-download everything just to add a new size. This script instead
 * re-derives from the largest derivative already on disk, which is exactly what
 * is needed after a new entry is added to SIZES in backend/lib/images.js.
 *
 *   node scripts/optimize-images.js [--force] [--concurrency 6]
 *
 * --force rewrites every derivative rather than only the missing ones.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const img = require('../backend/lib/images');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const cIdx = argv.indexOf('--concurrency');
const CONCURRENCY = cIdx !== -1 ? Math.max(1, Number(argv[cIdx + 1]) || 6) : 6;

/** Every (handle, stem) pair that has at least one derivative on disk. */
function discover() {
  const root = img.WEB_IMAGE_ROOT;
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const handle of fs.readdirSync(root).sort()) {
    const dir = path.join(root, handle);
    if (!fs.statSync(dir).isDirectory()) continue;
    const stems = new Set();
    for (const file of fs.readdirSync(dir)) {
      const m = /^(.*)-(\d+)\.(webp|jpg)$/.exec(file);
      if (m) stems.add(m[1]);
    }
    for (const stem of [...stems].sort()) out.push({ handle, stem });
  }
  return out;
}

/**
 * Prefer the untouched archive; fall back to the biggest derivative. Going
 * webp→webp loses a little quality, but only for sizes strictly smaller than
 * the source, which is where the loss is least visible.
 */
function sourceFor(handle, stem) {
  const archiveDir = path.join(img.ORIGINALS_ROOT, handle);
  if (fs.existsSync(archiveDir)) {
    const match = fs.readdirSync(archiveDir).find((f) => path.parse(f).name === stem);
    if (match) return path.join(archiveDir, match);
  }
  const out = img.outPaths(handle, stem);
  for (const candidate of [out.large, out.fallback, out.thumb]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function run() {
  const all = discover();
  const todo = FORCE ? all : all.filter((r) => !img.derivativesExist(r.handle, r.stem));

  console.log(`${all.length} images on disk; ${todo.length} need derivatives (concurrency ${CONCURRENCY}).`);
  if (!todo.length) return;

  const failures = [];
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < todo.length) {
      const { handle, stem } = todo[cursor++];
      try {
        const source = sourceFor(handle, stem);
        if (!source) throw new Error('no source image on disk');
        // Read once: processBuffer resizes the same buffer for every size.
        await img.processBuffer(fs.readFileSync(source), handle, stem, { onlyMissing: !FORCE });
      } catch (err) {
        failures.push({ label: `${handle}/${stem}`, error: err.message });
      }
      done++;
      if (done % 50 === 0 || done === todo.length) {
        process.stdout.write(`  ${done}/${todo.length} processed (${failures.length} failed)\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nDone. ${done - failures.length} succeeded, ${failures.length} failed.`);
  for (const f of failures) console.log(`  ${f.label}  ${f.error}`);
}

// sharp keeps a thread pool; cap it so this does not starve a laptop.
sharp.concurrency(Math.max(1, Math.min(4, require('os').cpus().length - 1)));

run().catch((err) => { console.error(err); process.exit(1); });
