/* Client-side search over /search-index.json.
   Powers both the header suggestions and the /search/ results page. The index
   is small (196 products) so this stays instant without a search service. */
(function () {
  'use strict';

  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch('/search-index.json')
        .then(function (r) { return r.json(); })
        .catch(function () { return []; });
    }
    return indexPromise;
  }

  function normalise(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9+.]+/g, ' ').trim();
  }

  /**
   * Score a product against the query terms. Matching the title beats matching
   * a compatible model, which beats matching the body — so "S21 back cover"
   * ranks a titled S21 cover above a product that merely lists S21 as fitting.
   */
  function score(item, terms) {
    var title = normalise(item.t);
    var models = normalise((item.m || []).join(' '));
    var extra = normalise((item.c || '') + ' ' + (item.p || '') + ' ' + (item.d || ''));
    var total = 0;

    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var hit = 0;
      if (title.indexOf(term) === 0) hit = 12;
      else if (title.indexOf(' ' + term) !== -1) hit = 10;
      else if (title.indexOf(term) !== -1) hit = 7;
      else if (models.indexOf(term) !== -1) hit = 5;
      else if (extra.indexOf(term) !== -1) hit = 2;
      if (!hit) return 0;                     // every term must match somewhere
      total += hit;
    }
    return total;
  }

  function search(items, query) {
    var terms = normalise(query).split(' ').filter(Boolean);
    if (!terms.length) return [];
    return items
      .map(function (it) { return { item: it, s: score(it, terms) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s || a.item.t.localeCompare(b.item.t); })
      .map(function (r) { return r.item; });
  }

  /* ---------------- header suggestions ---------------- */

  var forms = document.querySelectorAll('[data-search-form]');
  forms.forEach(function (form) {
    var input = form.querySelector('input[type="search"]');
    var panel = form.querySelector('[data-suggest]');
    if (!input || !panel) return;
    var timer;

    function close() { panel.setAttribute('data-open', 'false'); panel.textContent = ''; }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { close(); return; }
      timer = setTimeout(function () {
        loadIndex().then(function (items) {
          var results = search(items, q).slice(0, 6);
          panel.textContent = '';
          if (!results.length) { close(); return; }
          results.forEach(function (it) {
            var a = document.createElement('a');
            a.href = it.u;
            var img = document.createElement('img');
            img.src = it.i; img.alt = ''; img.width = 40; img.height = 40; img.loading = 'lazy';
            var span = document.createElement('span');
            span.textContent = it.t;
            var price = document.createElement('span');
            price.className = 'suggest__price';
            price.textContent = it.pl;
            a.appendChild(img); a.appendChild(span); a.appendChild(price);
            panel.appendChild(a);
          });
          panel.setAttribute('data-open', 'true');
        });
      }, 120);
    });

    input.addEventListener('blur', function () { setTimeout(close, 150); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); input.blur(); }
    });
  });

  /* ---------------- /search/ results page ---------------- */

  var page = document.querySelector('[data-search-results]');
  if (!page) return;

  var input = document.querySelector('[data-search-page-input]');
  var summary = document.querySelector('[data-search-summary]');
  var template = document.querySelector('#search-card-template');

  function paramQuery() {
    return new URLSearchParams(window.location.search).get('q') || '';
  }

  function renderResults(query) {
    loadIndex().then(function (items) {
      var results = query ? search(items, query) : [];
      page.textContent = '';

      if (!query) {
        summary.textContent = 'Enter a model, part or SKU above to search all ' + items.length + ' products.';
        return;
      }
      summary.textContent = results.length
        ? results.length + (results.length === 1 ? ' result' : ' results') + ' for “' + query + '”'
        : 'Nothing matched “' + query + '”. Try a model number such as SM-G970F, or browse the categories below.';

      results.forEach(function (it) {
        var node = template.content.cloneNode(true);
        var link = node.querySelectorAll('a');
        link.forEach(function (a) { a.href = it.u; });
        node.querySelector('[data-title]').textContent = it.t;
        node.querySelector('[data-price]').textContent = it.pl;
        var meta = node.querySelector('[data-meta]');
        if (meta) meta.textContent = [it.c, it.cond].filter(Boolean).join(' · ');
        var img = node.querySelector('img');
        img.src = it.i;
        img.alt = it.t;
        page.appendChild(node);
      });
    });
  }

  if (input) {
    input.value = paramQuery();
    var form = input.closest('form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var q = input.value.trim();
        history.replaceState({}, '', q ? '/search/?q=' + encodeURIComponent(q) : '/search/');
        renderResults(q);
      });
    }
  }
  renderResults(paramQuery());
  window.addEventListener('popstate', function () {
    if (input) input.value = paramQuery();
    renderResults(paramQuery());
  });
})();
