/* Product page: image gallery and variant → image/price syncing.
   All content is already in the HTML; this only adds interaction. */
(function () {
  'use strict';

  var gallery = document.querySelector('[data-gallery]');
  var main = gallery && gallery.querySelector('[data-gallery-main]');
  var thumbs = gallery ? Array.prototype.slice.call(gallery.querySelectorAll('[data-gallery-thumb]')) : [];

  function show(index) {
    if (!main || !thumbs.length) return;
    var thumb = thumbs[index];
    if (!thumb) return;
    main.src = thumb.getAttribute('data-large');
    main.alt = thumb.getAttribute('data-alt') || '';
    // Keep the swapped-in image responsive: without a matching srcset the
    // browser would fall back to the 1200 px file on every screen. The <source>
    // used for the JPEG fallback still has to go, hence the else branch.
    var srcset = thumb.getAttribute('data-srcset');
    if (srcset) main.setAttribute('srcset', srcset);
    else main.removeAttribute('srcset');
    thumbs.forEach(function (t, i) { t.setAttribute('aria-current', i === index ? 'true' : 'false'); });
  }

  thumbs.forEach(function (t, i) {
    t.addEventListener('click', function () { show(i); });
  });

  if (gallery) {
    gallery.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var current = thumbs.findIndex(function (t) { return t.getAttribute('aria-current') === 'true'; });
      if (current < 0) current = 0;
      var next = e.key === 'ArrowRight'
        ? (current + 1) % thumbs.length
        : (current - 1 + thumbs.length) % thumbs.length;
      e.preventDefault();
      show(next);
      thumbs[next].focus();
    });
  }

  /* ---- variant selection ---- */
  var form = document.querySelector('[data-add-to-cart]');
  if (!form) return;

  var priceEl = document.querySelector('[data-variant-price]');
  var compareEl = document.querySelector('[data-variant-compare]');
  var saveEl = document.querySelector('[data-variant-save]');
  var skuEl = document.querySelector('[data-variant-sku]');

  function sync() {
    var checked = form.querySelector('input[name="variant"]:checked');
    if (!checked) return;
    var v = JSON.parse(checked.getAttribute('data-variant'));

    if (priceEl) priceEl.textContent = v.priceLabel;
    if (compareEl) {
      compareEl.textContent = v.compareAtLabel || '';
      compareEl.hidden = !v.compareAtLabel;
    }
    if (saveEl) {
      if (v.compareAt > v.price && v.price > 0) {
        saveEl.textContent = 'Save ' + Math.round((1 - v.price / v.compareAt) * 100) + '%';
        saveEl.hidden = false;
      } else { saveEl.hidden = true; }
    }
    if (skuEl) {
      skuEl.textContent = v.sku || '—';
      var row = skuEl.closest('tr');
      if (row) row.hidden = !v.sku;
    }
    if (typeof v.imageIndex === 'number') show(v.imageIndex);
  }

  form.addEventListener('change', function (e) {
    if (e.target.name === 'variant') sync();
  });

  var qty = form.querySelector('input[name="quantity"]');
  form.querySelectorAll('[data-qty-step]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var step = Number(btn.getAttribute('data-qty-step'));
      qty.value = Math.max(1, Math.min(999, (parseInt(qty.value, 10) || 1) + step));
    });
  });

  sync();
})();
