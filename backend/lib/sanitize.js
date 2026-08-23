'use strict';
/**
 * The Shopify bodies are legacy WYSIWYG output: <font size="4" face="Arial">,
 * inline font-family styles, one-line-per-<div> soup and &nbsp; padding. Left
 * alone it fights the new stylesheet, so it is reduced to semantic markup on
 * import and on every admin save.
 *
 * The source divs act as line breaks rather than paragraphs (each holds a
 * single line), so they are normalised to <br> before sanitising. Mapping them
 * to <p> instead would produce invalid nesting such as <p><ul>...</ul></p>.
 */
const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

const OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ['href', 'title'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  transformTags: {
    b: 'strong',
    i: 'em',
    strike: 's',
    // Legacy bodies use heading levels decoratively (an h4 with no h3 above
    // it). Flatten them all to h3 so the outline is valid wherever the body is
    // embedded, rather than importing a broken hierarchy.
    h1: 'h3',
    h2: 'h3',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
    a: (tagName, attribs) => ({
      tagName: 'a',
      attribs: { href: attribs.href || '#', rel: 'nofollow noopener', target: '_blank' },
    }),
  },
};

/** Strip purely-presentational wrappers and turn block closers into <br>. */
function preNormalise(html) {
  return String(html)
    .replace(/<\/?(?:font|span|center)\b[^>]*>/gi, '')
    .replace(/<\/(?:div|p)>/gi, '<br>')
    .replace(/<(?:div|p)\b[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ');
}

/** Remove <br> that would end up as an invalid child of a list or table. */
function tidyBreaks(html) {
  return html
    .replace(/(<br\s*\/?>\s*)+(<\/?(?:ul|ol|li|table|thead|tbody|tr|th|td|h2|h3|h4)\b[^>]*>)/gi, '$2')
    .replace(/(<\/?(?:ul|ol|li|table|thead|tbody|tr|th|td|h2|h3|h4)\b[^>]*>)(\s*<br\s*\/?>)+/gi, '$1')
    .replace(/^(\s*<br\s*\/?>)+/i, '')
    .replace(/(<br\s*\/?>\s*)+$/i, '');
}

const BLOCK_TAGS = ['ul', 'ol', 'table', 'h2', 'h3', 'h4', 'blockquote'];

/**
 * Split sanitised HTML into top-level segments, keeping block elements intact
 * and wrapping the inline runs between them in <p>. Without this, an inline run
 * that happens to contain a <ul> would be wrapped into an invalid <p><ul>.
 */
function wrapBlocks(html) {
  const tagRe = /<(\/?)([a-z0-9]+)\b[^>]*>/gi;
  const out = [];
  let inlineStart = 0;
  let blockStart = -1;
  let blockTag = null;
  let depth = 0;
  let m;

  const flushInline = (end) => {
    const chunk = html.slice(inlineStart, end);
    for (const part of chunk.split(/(?:<br\s*\/?>\s*){2,}/i)) {
      const t = tidyBreaks(part).trim();
      if (t) out.push(`<p>${t}</p>`);
    }
  };

  while ((m = tagRe.exec(html)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (blockTag === null) {
      if (!closing && BLOCK_TAGS.includes(tag)) {
        flushInline(m.index);
        blockTag = tag;
        blockStart = m.index;
        depth = 1;
      }
    } else if (tag === blockTag) {
      depth += closing ? -1 : 1;
      if (depth === 0) {
        out.push(html.slice(blockStart, m.index + m[0].length));
        blockTag = null;
        inlineStart = m.index + m[0].length;
      }
    }
  }
  if (blockTag !== null) out.push(html.slice(blockStart));   // unbalanced: keep as-is
  else flushInline(html.length);

  return out.join('\n');
}

function cleanHtml(dirty) {
  if (!dirty) return '';
  const sanitised = sanitizeHtml(preNormalise(dirty), OPTIONS)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .trim();

  return wrapBlocks(sanitised)
    .replace(/<p>\s*(<br\s*\/?>\s*)*<\/p>/gi, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Plain text for meta descriptions and the search index. */
function toText(dirty) {
  if (!dirty) return '';
  const spaced = String(dirty).replace(/<\/(?:div|p|li|br|h[1-6]|tr)>|<br\s*\/?>/gi, ' ');
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clamp to `max` chars on a word boundary — used for meta descriptions. */
function truncate(text, max = 155) {
  const t = toText(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[,;:.\s-]+$/, '')}…`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = { cleanHtml, toText, truncate, escapeHtml, ALLOWED_TAGS };

/**
 * Compose a page title that fits `max` characters while keeping the brand
 * suffix intact, trimming the descriptive part on a word boundary rather than
 * slicing mid-word. Shared by the importer and the generator so they cannot
 * produce different titles for the same product.
 */
function composeTitle(name, suffix = '', max = 70) {
  const tail = suffix ? ` | ${suffix}` : '';
  const full = `${String(name).trim()}${tail}`;
  if (full.length <= max) return full;

  const room = max - tail.length - 1;             // -1 for the ellipsis
  if (room <= 8) return full.slice(0, max);       // suffix alone is too long
  const cut = String(name).trim().slice(0, room);
  const space = cut.lastIndexOf(' ');
  const base = (space > room * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—*+/]+$/, '');
  return `${base}…${tail}`;
}

module.exports.composeTitle = composeTitle;
