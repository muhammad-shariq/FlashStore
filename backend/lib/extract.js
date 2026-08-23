'use strict';
/**
 * Derives structured, machine-readable attributes from the free-text product
 * titles and descriptions in the Shopify export.
 *
 * This is what makes the catalogue answerable by search engines and AI
 * assistants: a query like "genuine back cover for Galaxy S21 Ultra" can only
 * be matched confidently if compatibility is a list of models rather than a
 * sentence. The results seed the DB once and stay editable in the admin.
 */

/* ------------------------------------------------------------------ *
 * part_type — ordered, first match wins. Order is load-bearing:
 *   "screen protector" before "screen", "battery cover" before "battery",
 *   "empty box" before "box", "camera flex" before "flex".
 * ------------------------------------------------------------------ */
const PART_TYPE_RULES = [
  ['Screen Protector', /\b(?:screen\s*protector|privacy\s*glass|matt\s*finish\s*protector|tempered|protector)\b/i],
  ['Empty Box',        /\bempty\s*box(?:ed)?\b/i],
  ['Repair Tool',      /\b(?:tester|programmer|separating\s*machine|laser\s*marking|remover|test\s*ic)\b/i],
  ['Rear Housing',     /\bhousing\b/i],
  // "Rear Back Replacement Cover" and "battery back cover" both land here.
  ['Back Cover',       /\b(?:back|rear)\b[\w\s%]{0,24}\bcover(?:s)?\b|\bback\s+glass\b|\brear\s+glass\b|\bcover\s+with\s+small\s+lcd\b/i],
  ['Camera',           /\bcamera\b|\bcam\s+lens\b/i],
  ['Charging Port',    /\b(?:charging|charge)\s*port\b|\bdock\s*flex\b/i],
  ['LCD Screen',       /\b(?:lcd|oled|display)\b|\bscreen\b/i],
  ['Battery',          /\bbatter(?:y|ies)\b/i],
  ['Stylus',           /\b(?:stylus|s\s*pen)\b/i],
  ['Audio',            /\b(?:earpods|airpods|handsfree|headphone|earphone|buds|speaker)\b/i],
  ['Charger',          /\b(?:charger|power\s*adapter|wireless\s*charg|magsafe)\b/i],
  ['Cable',            /\b(?:cable|lightning\s*to|type\s*c|usb)\b/i],
  ['Adapter',          /\badapter\b/i],
  ['Computer Accessory', /\b(?:magic\s*(?:keyboard|mouse)|keyboard|mouse)\b/i],
  ['Case',             /\b(?:silicon(?:e)?\s*cases?|leather\s*cases?|smart\s*covers?|folio|cases?|covers?)\b/i],
  ['Phone',            /\b(?:refurbished|refurbshed)\b/i],
  ['Flex Cable',       /\bflex\b/i],
];

function detectPartType(title) {
  for (const [name, re] of PART_TYPE_RULES) if (re.test(title)) return name;
  return 'Accessory';
}

/* ------------------------------------------------------------------ *
 * condition_grade — the title is authoritative; the body is only a
 * fallback, because bodies often mention other conditions in passing
 * ("for parts or refurbished", "grade B available on request").
 * ------------------------------------------------------------------ */
function conditionFrom(text) {
  const t = String(text || '');
  const parts = [];

  if (/\brefurb(?:ished|shed)\b/i.test(t)) parts.push('Refurbished');
  else if (/\bpre[\s-]*owned\b/i.test(t)) parts.push('Pre-owned');
  else if (/\bpulled\b/i.test(t)) parts.push('Pulled');
  else if (/\b(?:100%\s*)?genuine\b/i.test(t)) parts.push('Genuine');
  else if (/\b(?:100%\s*)?original\b/i.test(t)) parts.push('Original');
  else if (/\bbrand\s*new\b/i.test(t)) parts.push('New');

  const grade = t.match(/\bgrade\s*([ABC])\s*(?:\/\s*([ABC]))?\b/i);
  if (grade) parts.push(`Grade ${[grade[1], grade[2]].filter(Boolean).map((g) => g.toUpperCase()).join('/')}`);

  return parts.join(' · ');
}

function detectCondition(title, bodyText = '') {
  return conditionFrom(title) || conditionFrom(bodyText);
}

/** Schema.org itemCondition mapping. Returns '' when genuinely unknown. */
function schemaCondition(grade) {
  const g = String(grade || '').toLowerCase();
  if (/refurbished/.test(g)) return 'https://schema.org/RefurbishedCondition';
  if (/pre-owned|pulled|grade/.test(g)) return 'https://schema.org/UsedCondition';
  if (/\bnew\b/.test(g)) return 'https://schema.org/NewCondition';
  return '';
}

/* ------------------------------------------------------------------ *
 * fits_models — the compatibility list.
 * ------------------------------------------------------------------ */

/**
 * The screen-protector listings are sized by display diagonal rather than
 * model ("iPhone 6.5 Privacy Glass"). Mapping the diagonal to the handsets it
 * actually fits is the difference between those 10 products being findable and
 * being invisible.
 */
const INCH_TO_IPHONE = {
  '5.8': ['iPhone X', 'iPhone XS', 'iPhone 11 Pro'],
  '6.1': ['iPhone XR', 'iPhone 11', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 13', 'iPhone 13 Pro', 'iPhone 14'],
  '6.5': ['iPhone XS Max', 'iPhone 11 Pro Max'],
};

const SAMSUNG_CODE = /\b(?:SM-)?([GNFAJMT]\d{3,4}[A-Z]{0,3})\b/g;
const APPLE_TIER = '(?:\\s+(?:Pro\\s+Max|Pro|Plus|Max|Mini))?';
const IPHONE_NUM = new RegExp(`\\biPhone\\s*(\\d{1,2}s?)(?!\\s*\\.\\d)${APPLE_TIER}`, 'gi');
const IPHONE_LTR = /\biPhone\s*(X[SR]?|SE)(?:\s+(Max|Plus))?\b/gi;
const GALAXY = /\b(?:Galaxy\s+)?(S\d{1,2}(?:\s*(?:e|FE))?|Note\s*\d{1,2}|A\d{1,3}[a-z]{0,2}|J\d{3}|Z\s*Fold\s*\d?|Z\s*Flip\s*\d?)\b\s*(Ultra|Plus|Lite|edge|\+)?/gi;
const HUAWEI = /\b(P\s?(?:smart|\d{1,2})(?:\s+(?:Pro|Lite|Plus))?|Mate\s*\d{1,2}(?:\s+Lite)?|Honor\s*\d{1,2}[a-z]?(?:\s+Lite)?)\b/gi;
const IPAD = /\biPad(?:\s+(?:mini|Pro|Air))?(?:\s*\d{1,2}(?:\.\d)?)?/gi;

const WORD_CASE = {
  note: 'Note', plus: 'Plus', ultra: 'Ultra', lite: 'Lite', edge: 'edge',
  pro: 'Pro', max: 'Max', mini: 'mini', fe: 'FE', se: 'SE', air: 'Air',
  xr: 'XR', xs: 'XS', x: 'X', fold: 'Fold', flip: 'Flip', z: 'Z',
  smart: 'smart', honor: 'Honor', mate: 'Mate', iphone: 'iPhone', ipad: 'iPad',
  galaxy: 'Galaxy', and: 'and', inch: 'inch',
};

/** "s10e" -> "S10e", "g970f" -> "G970F", "note" -> "Note". */
function tidy(str) {
  return String(str).replace(/\s+/g, ' ').trim().split(' ').map((w) => {
    const lower = w.toLowerCase();
    if (WORD_CASE[lower]) return WORD_CASE[lower];
    // model codes: letters+digits. Trailing lowercase suffix letters (s10e,
    // a20e, 6s) are conventionally lowercase; leading letters uppercase.
    if (/^[a-z]+\d/i.test(w)) {
      return w.replace(/^([a-z]+)/i, (p) => p.toUpperCase());
    }
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/** Expand "S8/S8+/S9/S9+" and "G980F/G981F" into separate tokens. */
function expandSlashes(text) {
  return String(text).replace(/([A-Za-z]*\d+[A-Za-z+]*)(?:\s*\/\s*([A-Za-z]*\d*[A-Za-z+]*))+/g,
    (m) => m.split('/').map((s) => s.trim()).join(' , '));
}

function collect(re, text, fmt) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = fmt(m);
    if (Array.isArray(v)) out.push(...v);
    else if (v) out.push(v);
    if (m.index === re.lastIndex) re.lastIndex++;   // guard zero-length matches
  }
  return out;
}

function extractModels(title, bodyText = '') {
  const rawTitle = String(title || '').replace(/ /g, ' ');
  const t = expandSlashes(rawTitle);
  const body = String(bodyText || '');
  const found = [];

  // Part codes are unambiguous, so the body is safe to mine for them.
  found.push(...collect(SAMSUNG_CODE, `${t} ${body}`, (m) => `SM-${m[1].toUpperCase()}`));

  // Display-diagonal listings (screen protectors).
  found.push(...collect(/\biPhone\s*(5\.8|6\.1|6\.5)\b/gi, rawTitle, (m) => INCH_TO_IPHONE[m[1]] || null));

  found.push(...collect(IPHONE_NUM, t, (m) => tidy(m[0].replace(/^iphone\s*/i, 'iPhone '))));
  found.push(...collect(IPHONE_LTR, t, (m) => tidy(m[0].replace(/^iphone\s*/i, 'iPhone '))));
  found.push(...collect(IPAD, t, (m) => tidy(m[0].replace(/^ipad\s*/i, 'iPad '))));
  found.push(...collect(HUAWEI, t, (m) => tidy(m[0])));

  // Galaxy names only fire on Samsung-ish titles, otherwise bare "S9"-style
  // tokens match unrelated text such as sizes and pack counts.
  if (/samsung|galaxy|\bnote\s*\d|\bs\d{1,2}\b|\bz\s*(?:fold|flip)|\bsm-/i.test(t)) {
    found.push(...collect(GALAXY, t, (m) => {
      const base = tidy(m[1]);
      if (/^A\d$/.test(base)) return null;                 // "A5 (17)" handled below
      const suffix = m[2] ? tidy(m[2].replace('+', 'Plus')) : '';
      return `Galaxy ${[base, suffix].filter(Boolean).join(' ')}`.trim();
    }));
    // "Samsung A5 (17)" / "A3 (16)" — year-qualified Galaxy A models.
    found.push(...collect(/\b(A\d)\s*\((\d{2})\)/gi, t, (m) => `Galaxy ${m[1].toUpperCase()} (20${m[2]})`));
  }

  // De-duplicate case-insensitively, then drop entries that are a strict
  // prefix of a longer one ("iPhone 13" when "iPhone 13 Pro" is also present).
  const seen = new Map();
  for (const f of found) {
    const key = f.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) seen.set(key, f);
  }
  const list = [...seen.values()];
  return list
    .filter((a) => !list.some((b) => b !== a && b.toLowerCase().startsWith(`${a.toLowerCase()} `)))
    .slice(0, 24);
}

/** Brand facet, derived independently of the model list. */
function detectBrand(title, vendor = '') {
  const t = `${title} ${vendor}`;
  if (/iphone|ipad|apple|airpods|earpods|magsafe|lightning|magic\s*(?:mouse|keyboard)/i.test(t)) return 'Apple';
  if (/samsung|galaxy|sm-[gnfajmt]|\bnote\s*\d/i.test(t)) return 'Samsung';
  if (/huawei|honor|mate\s*\d|\bp\s?\d{1,2}\s*(?:pro|lite)|p\s?smart/i.test(t)) return 'Huawei & Honor';
  return 'Other Brands';
}

module.exports = {
  detectPartType, detectCondition, schemaCondition,
  extractModels, detectBrand, tidyModel: tidy,
  PART_TYPE_RULES, INCH_TO_IPHONE,
};
