/* Collection-page facet filtering and sorting.
   Every product node is already rendered in the HTML — this only toggles
   `hidden` and reorders, so crawlers (which mostly do not run JS) still see
   the complete listing. No URL state is produced, so no duplicate-content
   variants are created for search engines to index. */
(function () {
  'use strict';

  var root = document.querySelector('[data-filters]');
  var grid = document.querySelector('[data-product-grid]');
  if (!root || !grid) return;

  var items = Array.prototype.slice.call(grid.querySelectorAll('[data-product-item]'));
  var countEl = document.querySelector('[data-filter-count]');
  var emptyEl = document.querySelector('[data-filter-empty]');
  var sortEl = document.querySelector('[data-sort]');
  var active = {};

  function matches(item) {
    return Object.keys(active).every(function (facet) {
      var wanted = active[facet];
      if (!wanted.length) return true;
      var values = (item.getAttribute('data-' + facet) || '').split('|').filter(Boolean);
      return wanted.some(function (w) { return values.indexOf(w) !== -1; });
    });
  }

  function apply() {
    var shown = 0;
    items.forEach(function (item) {
      var ok = matches(item);
      item.hidden = !ok;
      if (ok) shown++;
    });
    if (countEl) countEl.textContent = shown + (shown === 1 ? ' product' : ' products');
    if (emptyEl) emptyEl.hidden = shown > 0;
  }

  root.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-facet]');
    if (!chip) return;
    var facet = chip.getAttribute('data-facet');
    var value = chip.getAttribute('data-value');
    active[facet] = active[facet] || [];

    var i = active[facet].indexOf(value);
    if (i === -1) { active[facet].push(value); chip.setAttribute('aria-pressed', 'true'); }
    else { active[facet].splice(i, 1); chip.setAttribute('aria-pressed', 'false'); }
    apply();
  });

  var clearBtn = root.querySelector('[data-filter-clear]');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      active = {};
      root.querySelectorAll('[data-facet]').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
      apply();
    });
  }

  if (sortEl) {
    var originalOrder = items.slice();
    sortEl.addEventListener('change', function () {
      var mode = sortEl.value;
      var sorted = originalOrder.slice();
      var priceOf = function (el) { return Number(el.getAttribute('data-price')) || 0; };

      if (mode === 'price-asc') {
        // Price-on-application items have no price; keep them last either way.
        sorted.sort(function (a, b) {
          var pa = priceOf(a), pb = priceOf(b);
          if (!pa) return 1;
          if (!pb) return -1;
          return pa - pb;
        });
      } else if (mode === 'price-desc') {
        sorted.sort(function (a, b) { return priceOf(b) - priceOf(a); });
      } else if (mode === 'title') {
        sorted.sort(function (a, b) {
          return (a.getAttribute('data-title') || '').localeCompare(b.getAttribute('data-title') || '');
        });
      }
      sorted.forEach(function (el) { grid.appendChild(el); });
    });
  }
})();
