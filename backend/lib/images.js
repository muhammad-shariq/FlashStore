'use strict';
/**
 * The single image-processing path, shared by the bulk CDN importer and by
 * admin uploads, so both produce identical derivatives.
 *
 * For each source image:
 *   web/assets/products/<handle>/<stem>-1200.webp   detail / gallery
 *   web/assets/products/<handle>/<stem>-500.webp    grid thumbnail
 *   web/assets/products/<handle>/<stem>-1200.jpg    fallback for old clients
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', '..');
const WEB_IMAGE_ROOT = path.join(ROOT, 'web', 'assets', 'products');
const ORIGINALS_ROOT = path.join(ROOT, 'data', 'originals');

const SIZES = [
  { width: 1200, format: 'webp', quality: 80 },
  { width: 500, format: 'webp', quality: 78 },
  { width: 1200, format: 'jpeg', quality: 82, optional: true },
];

/**
 * WebP is supported by every browser released since 2020, so the JPEG fallback
 * is off by default: it roughly doubles the size of the images committed to the
 * repository, and the repository is cloned on every deploy. Turn it on in the
 * admin (Settings → Images) if you need to serve pre-2020 browsers; the
 * templates then emit a <picture> with both sources.
 */
function jpegFallbackEnabled() {
  try {
    // Read lazily and defensively: the image pipeline must still work if the
    // database is mid-migration or the setting has never been written.
    const db = require('../db');
    const conn = db.open();
    const value = db.getSetting(conn, 'images.jpegFallback', 'false');
    conn.close();
    return String(value) === 'true';
  } catch {
    return false;
  }
}

const relPaths = (handle, stem) => ({
  large: `/assets/products/${handle}/${stem}-1200.webp`,
  thumb: `/assets/products/${handle}/${stem}-500.webp`,
  fallback: `/assets/products/${handle}/${stem}-1200.jpg`,
});

const outPaths = (handle, stem) => ({
  large: path.join(WEB_IMAGE_ROOT, handle, `${stem}-1200.webp`),
  thumb: path.join(WEB_IMAGE_ROOT, handle, `${stem}-500.webp`),
  fallback: path.join(WEB_IMAGE_ROOT, handle, `${stem}-1200.jpg`),
});

function derivativesExist(handle, stem) {
  const out = outPaths(handle, stem);
  const required = [out.large, out.thumb];
  if (jpegFallbackEnabled()) required.push(out.fallback);
  return required.every((p) => fs.existsSync(p));
}

/**
 * Write the three derivatives from a source buffer.
 * @returns {{width:number,height:number}} intrinsic size of the source, used to
 *   emit explicit width/height on every <img> (eliminating layout shift).
 */
async function processBuffer(buffer, handle, stem) {
  const dir = path.join(WEB_IMAGE_ROOT, handle);
  fs.mkdirSync(dir, { recursive: true });

  const meta = await sharp(buffer).metadata();
  const out = outPaths(handle, stem);
  const wantJpeg = jpegFallbackEnabled();

  for (const size of SIZES) {
    if (size.optional && !wantJpeg) continue;
    const target = size.format === 'jpeg' ? out.fallback : (size.width === 1200 ? out.large : out.thumb);
    let pipe = sharp(buffer)
      .rotate()                                     // honour EXIF orientation
      .resize({ width: size.width, withoutEnlargement: true, fit: 'inside' })
      .flatten({ background: '#ffffff' });          // transparent PNGs → white
    pipe = size.format === 'webp'
      ? pipe.webp({ quality: size.quality, effort: 4 })
      : pipe.jpeg({ quality: size.quality, mozjpeg: true, progressive: true });
    await pipe.toFile(target);
  }

  // Reported dimensions describe the largest derivative actually written.
  const scale = Math.min(1, 1200 / (meta.width || 1200));
  return {
    width: Math.round((meta.width || 1200) * scale),
    height: Math.round((meta.height || 1200) * scale),
  };
}

/** Keep the untouched source as an archive outside web/ (never deployed). */
function saveOriginal(buffer, handle, stem, ext) {
  const dir = path.join(ORIGINALS_ROOT, handle);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${stem}${ext || '.jpg'}`);
  fs.writeFileSync(target, buffer);
  return target;
}

function deleteDerivatives(handle, stem) {
  for (const p of Object.values(outPaths(handle, stem))) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

module.exports = {
  processBuffer, saveOriginal, derivativesExist, deleteDerivatives,
  relPaths, outPaths, jpegFallbackEnabled,
  WEB_IMAGE_ROOT, ORIGINALS_ROOT, SIZES,
};
