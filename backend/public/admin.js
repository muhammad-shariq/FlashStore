/* Small admin conveniences: character counters, slug suggestions, repeaters. */
(function () {
  'use strict';

  /* live character counters for SEO fields */
  document.querySelectorAll('[data-counter]').forEach(function (input) {
    var max = Number(input.getAttribute('data-counter'));
    var out = document.querySelector('[data-counter-for="' + input.id + '"]');
    if (!out) return;
    function update() {
      var n = input.value.length;
      out.textContent = n + ' / ' + max;
      out.classList.toggle('counter--over', n > max);
    }
    input.addEventListener('input', update);
    update();
  });

  /* live Google-result preview */
  var serp = document.querySelector('[data-serp]');
  if (serp) {
    var t = document.getElementById('seo_title');
    var d = document.getElementById('seo_description');
    var titleOut = serp.querySelector('[data-serp-title]');
    var descOut = serp.querySelector('[data-serp-desc]');
    function sync() {
      if (t) titleOut.textContent = t.value || '(no page title)';
      if (d) descOut.textContent = d.value || '(no meta description)';
    }
    if (t) t.addEventListener('input', sync);
    if (d) d.addEventListener('input', sync);
    sync();
  }

  /* repeatable FAQ rows */
  document.querySelectorAll('[data-repeater]').forEach(function (root) {
    var list = root.querySelector('[data-repeater-list]');
    var template = root.querySelector('template');
    var addBtn = root.querySelector('[data-repeater-add]');
    if (addBtn && list && template) {
      addBtn.addEventListener('click', function () {
        list.appendChild(template.content.cloneNode(true));
      });
    }
    root.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-repeater-remove]');
      if (rm) { e.preventDefault(); rm.closest('[data-repeater-row]').remove(); }
    });
  });

  /* confirm destructive submits */
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  /* select-all in the category assignment panel */
  document.querySelectorAll('[data-toggle-all]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var scope = document.querySelector(btn.getAttribute('data-toggle-all'));
      if (!scope) return;
      var boxes = scope.querySelectorAll('input[type=checkbox]');
      var anyUnchecked = Array.prototype.some.call(boxes, function (b) { return !b.checked; });
      boxes.forEach(function (b) { b.checked = anyUnchecked; });
    });
  });
})();
