/*FlashStore — cart.
   The site is static, so the cart lives entirely in localStorage and the order
   is handed to the shop over WhatsApp or email rather than being processed
   here. Nothing on the page depends on this script for its content. */
(function () {
  'use strict';

  var KEY = 'gsmw.cart.v1';
  var cfg = window.GSMW || {};
  var SYMBOL = cfg.currencySymbol || '£';

  /* ---------------- store ---------------- */

  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(validLine) : [];
    } catch (e) { return []; }
  }

  function validLine(l) {
    return l && typeof l.handle === 'string' && typeof l.vid !== 'undefined' && l.qty > 0;
  }

  function write(lines) {
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (e) { /* private mode */ }
    render();
    document.dispatchEvent(new CustomEvent('cart:change', { detail: { lines: lines } }));
  }

  function money(n) { return SYMBOL + Number(n || 0).toFixed(2); }

  function subtotal(lines) {
    return lines.reduce(function (sum, l) { return sum + (Number(l.price) || 0) * l.qty; }, 0);
  }

  function countItems(lines) {
    return lines.reduce(function (n, l) { return n + l.qty; }, 0);
  }

  /* ---------------- mutations ---------------- */

  function add(line) {
    var lines = read();
    var found = null;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].handle === line.handle && String(lines[i].vid) === String(line.vid)) { found = lines[i]; break; }
    }
    if (found) found.qty = Math.min(999, found.qty + line.qty);
    else lines.push(line);
    write(lines);
    toast(line.qty + ' × ' + line.title + ' added to your order');
  }

  function setQty(handle, vid, qty) {
    var lines = read().map(function (l) {
      if (l.handle === handle && String(l.vid) === String(vid)) l.qty = Math.max(0, Math.min(999, qty));
      return l;
    }).filter(function (l) { return l.qty > 0; });
    write(lines);
  }

  function remove(handle, vid) { setQty(handle, vid, 0); }
  function clear() { write([]); }

  /* ---------------- order message ---------------- */

  function orderText(lines) {
    var out = ['Hello ' + (cfg.storeName || 'FlashStore Plus') + ', I would like to order:', ''];
    lines.forEach(function (l, i) {
      var name = l.title + (l.variant ? ' (' + l.variant + ')' : '');
      var price = l.price > 0
        ? money(l.price) + ' each = ' + money(l.price * l.qty)
        : 'price on request';
      out.push((i + 1) + '. ' + name);
      out.push('   Qty ' + l.qty + ' — ' + price);
      if (l.sku) out.push('   SKU ' + l.sku);
      out.push('   ' + (cfg.siteUrl || '') + l.url);
      out.push('');
    });

    var poa = lines.some(function (l) { return !(l.price > 0); });
    out.push('Subtotal: ' + money(subtotal(lines)) + (poa ? ' (excludes items priced on request)' : ''));
    out.push('');
    out.push('Please confirm availability, postage and total. Thank you.');
    return out.join('\n');
  }

  function whatsappUrl(lines) {
    var num = String(cfg.whatsapp || '').replace(/[^0-9]/g, '');
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(orderText(lines));
  }

  function mailtoUrl(lines) {
    return 'mailto:' + (cfg.orderEmail || '') +
      '?subject=' + encodeURIComponent('Order enquiry — ' + countItems(lines) + ' item(s)') +
      '&body=' + encodeURIComponent(orderText(lines));
  }

  /* ---------------- rendering ---------------- */

  function render() {
    var lines = read();
    var n = countItems(lines);

    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.setAttribute('data-count', String(n));
      el.textContent = n > 99 ? '99+' : String(n);
    });

    document.querySelectorAll('[data-cart-lines]').forEach(function (el) { renderLines(el, lines); });
    document.querySelectorAll('[data-cart-subtotal]').forEach(function (el) { el.textContent = money(subtotal(lines)); });
    document.querySelectorAll('[data-cart-itemcount]').forEach(function (el) {
      el.textContent = n === 1 ? '1 item' : n + ' items';
    });
    document.querySelectorAll('[data-cart-empty]').forEach(function (el) { el.hidden = n > 0; });
    document.querySelectorAll('[data-cart-filled]').forEach(function (el) { el.hidden = n === 0; });
    document.querySelectorAll('[data-cart-poa-note]').forEach(function (el) {
      el.hidden = !lines.some(function (l) { return !(l.price > 0); });
    });

    var preview = document.querySelector('[data-order-preview]');
    if (preview) preview.value = lines.length ? orderText(lines) : '';

    document.querySelectorAll('[data-whatsapp-order]').forEach(function (a) {
      if (lines.length) { a.href = whatsappUrl(lines); a.removeAttribute('aria-disabled'); }
      else { a.href = '#'; a.setAttribute('aria-disabled', 'true'); }
    });
    document.querySelectorAll('[data-email-order]').forEach(function (a) {
      if (lines.length) { a.href = mailtoUrl(lines); a.removeAttribute('aria-disabled'); }
      else { a.href = '#'; a.setAttribute('aria-disabled', 'true'); }
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderLines(container, lines) {
    container.textContent = '';
    lines.forEach(function (l) {
      var li = el('li', 'cart-line');

      var media = el('div', 'cart-line__media');
      if (l.image) {
        var im = document.createElement('img');
        im.src = l.image; im.alt = ''; im.width = 72; im.height = 72;
        im.loading = 'lazy'; im.decoding = 'async';
        media.appendChild(im);
      }
      li.appendChild(media);

      var body = el('div');
      var titleWrap = el('div', 'cart-line__title');
      var a = el('a', null, l.title);
      a.href = l.url;
      titleWrap.appendChild(a);
      body.appendChild(titleWrap);
      if (l.variant) body.appendChild(el('div', 'cart-line__opt', l.variant));
      if (l.sku) body.appendChild(el('div', 'cart-line__opt', 'SKU ' + l.sku));

      var ctl = el('div', 'cart-line__ctl');
      var qty = el('div', 'qty');
      var minus = el('button', null, '−');
      minus.type = 'button';
      minus.setAttribute('aria-label', 'Decrease quantity of ' + l.title);
      var input = document.createElement('input');
      input.type = 'number'; input.min = '1'; input.max = '999'; input.value = String(l.qty);
      input.setAttribute('aria-label', 'Quantity of ' + l.title);
      var plus = el('button', null, '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', 'Increase quantity of ' + l.title);

      minus.addEventListener('click', function () { setQty(l.handle, l.vid, l.qty - 1); });
      plus.addEventListener('click', function () { setQty(l.handle, l.vid, l.qty + 1); });
      input.addEventListener('change', function () { setQty(l.handle, l.vid, parseInt(input.value, 10) || 1); });

      qty.appendChild(minus); qty.appendChild(input); qty.appendChild(plus);
      ctl.appendChild(qty);

      var rm = el('button', 'cart-line__remove', 'Remove');
      rm.type = 'button';
      rm.addEventListener('click', function () { remove(l.handle, l.vid); });
      ctl.appendChild(rm);
      body.appendChild(ctl);
      li.appendChild(body);

      var price = el('div', 'cart-line__price');
      if (l.price > 0) {
        price.appendChild(el('span', null, money(l.price * l.qty)));
        if (l.qty > 1) price.appendChild(el('small', null, money(l.price) + ' each'));
      } else {
        price.appendChild(el('span', null, cfg.poaLabel || 'On request'));
      }
      li.appendChild(price);

      container.appendChild(li);
    });
  }

  /* ---------------- toast ---------------- */

  var toastTimer;
  function toast(message) {
    var host = document.querySelector('[data-toast]');
    if (!host) return;
    host.querySelector('.toast__inner').textContent = message;
    host.setAttribute('data-show', 'true');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { host.setAttribute('data-show', 'false'); }, 3200);
  }

  /* ---------------- drawer ---------------- */

  function openDrawer(id) {
    var d = document.getElementById(id);
    if (!d) return;
    d.setAttribute('data-open', 'true');
    document.body.style.overflow = 'hidden';
    var focusable = d.querySelector('button, a[href], input');
    if (focusable) focusable.focus();
  }

  function closeDrawer(d) {
    d.setAttribute('data-open', 'false');
    if (!document.querySelector('.drawer[data-open="true"]')) document.body.style.overflow = '';
  }

  document.addEventListener('click', function (e) {
    var open = e.target.closest('[data-drawer-open]');
    if (open) { e.preventDefault(); openDrawer(open.getAttribute('data-drawer-open')); return; }

    var close = e.target.closest('[data-drawer-close]');
    if (close) {
      var d = close.closest('.drawer');
      if (d) { e.preventDefault(); closeDrawer(d); }
      return;
    }
    if (e.target.classList && e.target.classList.contains('drawer__scrim')) {
      closeDrawer(e.target.closest('.drawer'));
    }

    var disabled = e.target.closest('[aria-disabled="true"]');
    if (disabled) e.preventDefault();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var d = document.querySelector('.drawer[data-open="true"]');
    if (d) closeDrawer(d);
  });

  /* ---------------- add-to-cart wiring ---------------- */

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-add-to-cart]');
    if (!form) return;
    e.preventDefault();

    var selected = form.querySelector('input[name="variant"]:checked') || form.querySelector('input[name="variant"]');
    if (!selected) return;
    var qtyInput = form.querySelector('input[name="quantity"]');
    var qty = Math.max(1, parseInt(qtyInput && qtyInput.value, 10) || 1);
    var data = JSON.parse(selected.getAttribute('data-variant'));

    add({
      handle: form.getAttribute('data-handle'),
      vid: data.id,
      title: form.getAttribute('data-title'),
      variant: data.title || '',
      sku: data.sku || '',
      price: Number(data.price) || 0,
      image: data.image || form.getAttribute('data-image') || '',
      url: form.getAttribute('data-url'),
      qty: qty,
    });
    openDrawer('cart-drawer');
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cart-clear]');
    if (btn) { e.preventDefault(); clear(); }

    var copy = e.target.closest('[data-copy-order]');
    if (copy) {
      e.preventDefault();
      var lines = read();
      if (!lines.length) return;
      var text = orderText(lines);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { toast('Order details copied'); });
      } else {
        var ta = document.querySelector('[data-order-preview]');
        if (ta) { ta.select(); document.execCommand('copy'); toast('Order details copied'); }
      }
    }
  });

  window.addEventListener('storage', function (e) { if (e.key === KEY) render(); });

  document.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();

  window.GSMWCart = { read: read, add: add, setQty: setQty, remove: remove, clear: clear, orderText: orderText, toast: toast };
})();

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
