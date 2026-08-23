'use strict';
/**
 * Everything that makes the catalogue legible to search engines and AI answer
 * engines: JSON-LD graphs, deterministic summary sentences, and the
 * machine-readable feeds (llms.txt, products.json, merchant feed).
 */

const abs = (site, p) => `${String(site).replace(/\/$/, '')}${p}`;

/** Pluralise a part type for prose: "LCD Screen" -> "LCD screen". */
const lower = (s) => String(s || '').replace(/\b([A-Z])([a-z]+)/g, (m, a, b) =>
  (/^(LCD|OLED|USB)$/i.test(m) ? m : a.toLowerCase() + b)).trim();

/**
 * A single deterministic sentence stating what the product is, what it fits and
 * what condition it is in. Answer engines quote short factual claims like this
 * far more readily than they quote a marketing paragraph.
 */
function summarySentence(product, settings) {
  const part = lower(product.partType || 'part');
  const cond = product.conditionGrade
    ? product.conditionGrade.replace(/ · /g, ', ').toLowerCase()
    : '';
  const models = product.fitsModels;

  let fits;
  if (models.length === 0) fits = '';
  else if (models.length === 1) fits = ` for the ${models[0]}`;
  else if (models.length <= 3) fits = ` for the ${models.slice(0, -1).join(', ')} and ${models.at(-1)}`;
  else fits = ` for the ${models.slice(0, 3).join(', ')} and ${models.length - 3} more model${models.length - 3 === 1 ? '' : 's'}`;

  const variantCount = product.variants.filter((v) => !v.optionless).length;
  const optionName = (product.optionNames[0] || '').toLowerCase();
  const choice = variantCount > 1 && optionName
    ? `, available in ${variantCount} ${optionName === 'color' ? 'colour' : optionName} options`
    : '';

  const price = product.isPoa
    ? 'Contact us for pricing'
    : `Priced from ${product.priceLabel.split(' – ')[0]}`;

  const lead = [cond, part].filter(Boolean).join(' ');
  return `${cap(lead)}${fits}${choice}. ${price}, dispatched from the UK by ${settings.storeName}.`;
}

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/* ------------------------------------------------------------------ *
 * JSON-LD
 * ------------------------------------------------------------------ */

function organisation(settings) {
  const site = settings.siteUrl;
  const sameAs = Object.values(settings.social || {}).filter((u) => u && u.startsWith('http'));
  const node = {
    '@type': 'Organization',
    '@id': abs(site, '/#organization'),
    name: settings.storeName,
    url: abs(site, '/'),
    description: settings.shortDescription,
  };
  if (sameAs.length) node.sameAs = sameAs;
  if (hasPhone(settings) || hasEmail(settings)) {
    const point = {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      areaServed: 'GB',
      availableLanguage: 'English',
    };
    if (hasPhone(settings)) point.telephone = settings.contact.phoneDisplay;
    if (hasEmail(settings)) point.email = settings.contact.supportEmail || settings.contact.orderEmail;
    node.contactPoint = point;
  }
  return node;
}

/**
 * Contact details ship as placeholders until the shop owner fills them in, and
 * publishing a placeholder as structured data would assert something false.
 *
 * Each channel is checked independently: the WhatsApp button must not depend on
 * the postal address being filled in, and the address must not depend on the
 * phone number. They are separate facts and each becomes usable on its own.
 */
const isPlaceholder = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s === '' || /placeholder/i.test(s) || /X{3,}/i.test(s);
};

/** A dialable E.164-ish number: 8–15 digits once punctuation is stripped. */
function hasWhatsApp(settings) {
  const raw = (settings.contact || {}).whatsapp;
  if (isPlaceholder(raw)) return false;
  const digits = String(raw).replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

function whatsappNumber(settings) {
  return String((settings.contact || {}).whatsapp || '').replace(/[^0-9]/g, '');
}

function hasPhone(settings) {
  return !isPlaceholder((settings.contact || {}).phoneDisplay);
}

function hasAddress(settings) {
  const c = settings.contact || {};
  return !isPlaceholder(c.addressLine1) && !isPlaceholder(c.city) && !isPlaceholder(c.postcode);
}

function hasEmail(settings) {
  const c = settings.contact || {};
  return /@/.test(String(c.supportEmail || '')) || /@/.test(String(c.orderEmail || ''));
}

/** True only when every channel is real — used for the LocalBusiness node. */
function isRealContact(settings) {
  return hasPhone(settings) && hasAddress(settings);
}

function website(settings) {
  const site = settings.siteUrl;
  return {
    '@type': 'WebSite',
    '@id': abs(site, '/#website'),
    url: abs(site, '/'),
    name: settings.storeName,
    inLanguage: settings.locale || 'en-GB',
    publisher: { '@id': abs(site, '/#organization') },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: abs(site, '/search/?q={search_term_string}') },
      'query-input': 'required name=search_term_string',
    },
  };
}

function breadcrumbs(settings, trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: abs(settings.siteUrl, item.url),
    })),
  };
}

function productNode(product, settings) {
  const site = settings.siteUrl;
  const currency = settings.currency || 'GBP';
  const node = {
    '@type': 'Product',
    '@id': abs(site, `${product.url}#product`),
    name: product.title,
    description: product.seoDescription,
    url: abs(site, product.url),
    image: product.images.filter((i) => !i.isPlaceholder).map((i) => abs(site, i.large)),
    brand: { '@type': 'Brand', name: product.primaryBrand ? product.primaryBrand.name : (product.vendor || settings.storeName) },
    category: product.primaryCategory ? product.primaryCategory.name : product.partType,
  };
  if (!node.image.length) delete node.image;

  const skus = product.variants.map((v) => v.sku).filter(Boolean);
  if (skus.length === 1) node.sku = skus[0];
  else if (skus.length > 1) node.sku = skus[0];
  if (skus.length) node.mpn = skus[0];

  if (product.schemaCondition) node.itemCondition = product.schemaCondition;

  // Compatibility as structured data — this is what lets an assistant answer
  // "does this fit an SM-G970F?" without reading prose.
  if (product.fitsModels.length) {
    node.isAccessoryOrSparePartFor = product.fitsModels.map((m) => ({
      '@type': 'Product', name: m,
    }));
    node.additionalProperty = [{
      '@type': 'PropertyValue',
      name: 'Compatible models',
      value: product.fitsModels.join(', '),
    }];
  }
  if (product.conditionGrade) {
    node.additionalProperty = (node.additionalProperty || []).concat({
      '@type': 'PropertyValue', name: 'Condition', value: product.conditionGrade,
    });
  }

  // Price-on-application products get no Offer at all: publishing a £0 offer
  // would be a false price and Google flags it.
  if (!product.isPoa) {
    const availability = 'https://schema.org/InStock';
    if (product.minPrice === product.maxPrice) {
      node.offers = {
        '@type': 'Offer',
        price: product.minPrice.toFixed(2),
        priceCurrency: currency,
        availability,
        itemCondition: product.schemaCondition || undefined,
        url: abs(site, product.url),
        seller: { '@id': abs(site, '/#organization') },
      };
    } else {
      node.offers = {
        '@type': 'AggregateOffer',
        lowPrice: product.minPrice.toFixed(2),
        highPrice: product.maxPrice.toFixed(2),
        priceCurrency: currency,
        offerCount: product.variants.filter((v) => v.price > 0).length,
        availability,
        url: abs(site, product.url),
        seller: { '@id': abs(site, '/#organization') },
      };
    }
  }
  return node;
}

function faqNode(faq) {
  if (!faq || !faq.length) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

function itemListNode(products, settings, startPosition = 1) {
  return {
    '@type': 'ItemList',
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: startPosition + i,
      url: abs(settings.siteUrl, p.url),
      name: p.title,
    })),
  };
}

/** Wrap nodes into a single @graph — one script tag per page. */
function graph(settings, nodes) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': nodes.filter(Boolean),
  });
}

module.exports = {
  abs, summarySentence, organisation, website, breadcrumbs,
  productNode, faqNode, itemListNode, graph,
  isRealContact, hasWhatsApp, whatsappNumber, hasPhone, hasAddress, hasEmail,
};
