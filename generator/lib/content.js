'use strict';
/**
 * Default copy for the non-product pages and the shared FAQ pool.
 *
 * These are real, usable defaults rather than lorem ipsum, but they are
 * deliberately conservative about anything the shop owner must confirm
 * (delivery times, returns window, company registration). Every value here is
 * overridable from the admin Settings page — the DB wins when a value exists.
 *
 * Placeholders that MUST be reviewed are wrapped in [[ ]] so they are easy to
 * find both on the page and in the admin, and the SEO validator counts them.
 */

const PAGES = [
  {
    slug: 'about',
    nav: 'About us',
    heading: 'AboutFlashStore',
    intro: 'A UK supplier of genuine mobile phone parts, screens and accessories for repair shops and individual customers.',
    body: `
<p>FlashStore Plus supplies genuine and refurbished mobile phone parts across the United Kingdom. Our catalogue covers replacement LCD and OLED screens, rear housings and back covers, batteries, charging ports, camera modules, original retail boxes, cases and charging accessories for Apple iPhone, Samsung Galaxy, Huawei and Honor devices.</p>

<h2>Genuine parts, described honestly</h2>
<p>Almost everything we sell is a genuine manufacturer part rather than an aftermarket copy. That matters more than it sounds: a genuine screen keeps the correct colour calibration and touch response, a genuine back cover keeps the wireless charging coil and camera cut-outs aligned, and a genuine charger negotiates power correctly instead of triggering "accessory not supported" warnings.</p>
<p>Many of our parts are pulled from working devices. Where that is the case the listing says so, and gives the grade. We would rather describe a screen as Grade B and have you buy it knowingly than sell it as perfect and have it come back.</p>

<h2>Who we supply</h2>
<p>Our customers are mostly independent repair shops buying screens, housings and screen protectors in volume, alongside individual customers replacing a single part or looking for an original retail box before selling a handset. Trade pricing is available on bulk orders — ask us.</p>

<h2>How compatibility is listed</h2>
<p>Every product page lists the exact device models and manufacturer part numbers the item fits, so you can match a part to your handset with certainty. If a Samsung part was pulled from an SM-G970F, the page says SM-G970F as well as Galaxy S10e. If you are unsure, send us your model number and we will confirm before you order.</p>

<h2>Ordering</h2>
<p>This site is a catalogue rather than a checkout. Add the parts you need to your order, send the list to us in a single WhatsApp message or email, and we reply confirming availability, postage and the total before any payment is taken. It is a deliberate choice: it means we can check stock and confirm compatibility before you commit.</p>
`,
    faqKeys: ['genuine', 'grades', 'compatibility', 'trade'],
  },
  {
    slug: 'shipping-returns',
    nav: 'Shipping & returns',
    heading: 'Shipping & returns',
    intro: 'How orders are dispatched, and what happens if a part is not right.',
    body: `
<p class="notice"><strong>Please review before publishing:</strong> the delivery services, prices and returns window below are placeholders and must be confirmed by the shop owner. Edit them on the admin Settings page.</p>

<h2>Dispatch</h2>
<p>Orders confirmed before [[DAILY CUT-OFF TIME]] on a working day are dispatched the same day. Orders confirmed after that, or at a weekend, are dispatched the next working day. Because orders are confirmed by message before payment, dispatch is counted from the point your payment clears rather than from when you built the list on this site.</p>

<h2>Delivery within the UK</h2>
<ul>
  <li><strong>Standard delivery</strong> — [[CARRIER AND SERVICE]], typically [[X–Y]] working days, [[PRICE]].</li>
  <li><strong>Tracked delivery</strong> — [[CARRIER AND SERVICE]], typically [[X]] working days, [[PRICE]].</li>
  <li>Postage is quoted for your specific order when we confirm it, so you are never charged a flat rate that does not reflect what you actually bought.</li>
</ul>

<h2>International delivery</h2>
<p>[[CONFIRM WHETHER YOU SHIP OUTSIDE THE UK, TO WHERE, AND AT WHAT COST.]]</p>

<h2>Returns</h2>
<p>If a part arrives faulty or is not what the listing described, contact us within [[RETURNS WINDOW, e.g. 14 days]] of delivery and we will arrange a replacement or a refund. Please keep the original packaging where you can.</p>
<p>Graded parts are sold as described. A Grade B screen with the light cosmetic marks stated in its listing is not a fault, and we cannot accept a return on that basis — this is exactly why the grade is stated up front. If you are unsure what a grade means for a specific item, ask before ordering.</p>
<p>Parts damaged during fitting cannot be returned. Screen and housing replacement is skilled work; if you are not confident, use a repair shop.</p>

<h2>Statutory rights</h2>
<p>Nothing here affects your statutory rights under UK consumer law, including the right to a refund for goods that are faulty, not as described or unfit for purpose.</p>
`,
    faqKeys: ['dispatch', 'postage', 'returns', 'grades'],
  },
  {
    slug: 'privacy',
    nav: 'Privacy policy',
    heading: 'Privacy policy',
    intro: 'What data this website collects, and what it does not.',
    body: `
<p class="notice"><strong>Please review before publishing:</strong> confirm the company details and contact address below, and have this checked if you are unsure of your UK GDPR obligations.</p>

<h2>Who we are</h2>
<p>This website is operated byFlashStore, [[REGISTERED COMPANY NAME AND NUMBER IF APPLICABLE]], [[BUSINESS ADDRESS]]. For any privacy question, contact us using the details on our contact page.</p>

<h2>What this website stores</h2>
<p>This is a static catalogue. It has no user accounts, no login, and no server-side database recording who visits.</p>
<ul>
  <li><strong>Your order list</strong> is stored only in your own browser, using local storage on your device. It is never transmitted to us until you choose to send it, and clearing your browser data deletes it.</li>
  <li><strong>No tracking cookies</strong> are set by this site, and no advertising or analytics scripts run on it by default.</li>
</ul>

<h2>When you contact us</h2>
<p>When you send an order or enquiry by WhatsApp or email, we receive the message you send — typically your name, your contact details, and the items you are asking about. We use that solely to answer you, quote you, and fulfil your order. We keep order correspondence for as long as we need it for accounting and warranty purposes, and we do not sell it or pass it to anyone for marketing.</p>
<p>WhatsApp messages are handled by WhatsApp (Meta Platforms) under their own privacy policy, and email by our email provider. Using those channels is your choice; email us directly if you would rather not use WhatsApp.</p>

<h2>Your rights</h2>
<p>Under UK GDPR you can ask us for a copy of the personal data we hold about you, ask us to correct it, or ask us to delete it. Contact us and we will respond within one month. You can also complain to the Information Commissioner's Office at ico.org.uk.</p>

<h2>Changes</h2>
<p>If this policy changes we will update this page. It was last reviewed on [[DATE OF LAST REVIEW]].</p>
`,
    faqKeys: [],
  },
  {
    slug: 'terms',
    nav: 'Terms of sale',
    heading: 'Terms of sale',
    intro: 'The basis on which we sell parts, and what you agree to when you order.',
    body: `
<p class="notice"><strong>Please review before publishing:</strong> these terms are a reasonable starting point for a UK parts business but they are not legal advice. Have them reviewed before you rely on them.</p>

<h2>This site is a catalogue, not a checkout</h2>
<p>Prices and stock shown here are an invitation to enquire, not a binding offer. Adding items to an order and sending it to us is a request; a contract of sale is formed only when we confirm your order and the total in writing. This protects both sides against pricing errors and items that sold out between listing and ordering.</p>

<h2>Prices</h2>
<p>Prices are shown in <strong>GBP</strong> per item and exclude postage, which is quoted with your order confirmation. Items marked "Enquire for price" are quoted individually. We correct pricing errors rather than honour them, and we will always tell you before taking payment.</p>

<h2>Condition and grading</h2>
<p>Many parts are genuine pulls from working devices and are graded. Where a grade or condition is stated on a listing, that is the condition you are buying. Grade A means minor marks that are hard to notice; Grade B and C mean progressively more visible cosmetic wear. Function is tested regardless of cosmetic grade.</p>

<h2>Fitting</h2>
<p>Parts are sold for fitting by someone competent to fit them. We cannot accept liability for damage caused during installation, for a device damaged by incorrect fitting, or for consequential loss such as data loss. Back up your device before any repair.</p>

<h2>Warranty</h2>
<p>Parts are warranted against being faulty on arrival or not as described, for [[WARRANTY PERIOD]] from delivery. The warranty does not cover physical damage, water damage, or damage caused during fitting.</p>

<h2>Liability</h2>
<p>Our liability for any order is limited to the value of that order. Nothing in these terms excludes liability that cannot lawfully be excluded, including for death or personal injury caused by negligence, or your statutory rights as a consumer.</p>

<h2>Governing law</h2>
<p>These terms are governed by the law of England and Wales.</p>
`,
    faqKeys: [],
  },
];

/** Shared FAQ pool. Products and categories draw from this by key. */
const FAQ = {
  genuine: {
    q: 'Are these parts genuine?',
    a: 'Almost everything we sell is a genuine manufacturer part, and most are pulled from working devices rather than being aftermarket copies. Each listing states the condition — Genuine, Original, Pulled, Pre-owned or Refurbished — and where a part is graded, the grade is stated too. If a listing does not say a part is genuine, ask us before ordering.',
  },
  grades: {
    q: 'What do the condition grades mean?',
    a: 'Grade A means minor cosmetic marks that are hard to notice, such as fine hairline scratches. Grade B means visible but light wear. Grade C means clearly visible marks, and is usually sold for parts or refurbishment. Function is tested regardless of cosmetic grade, so a Grade C screen still works — it just does not look new.',
  },
  compatibility: {
    q: 'How do I know a part fits my phone?',
    a: 'Every product page lists the device models and manufacturer part numbers the item fits, in a compatibility table. Match the part number printed on your existing component, or your handset model (for example SM-G970F rather than just "Galaxy S10e"), against that list. If you are still unsure, message us your model number and we will confirm before you order.',
  },
  dispatch: {
    q: 'How quickly is my order dispatched?',
    a: 'Orders confirmed and paid before the daily cut-off on a working day are dispatched the same day. Because we confirm availability and postage by message before payment, dispatch is counted from when your payment clears rather than from when you built your list on the site.',
  },
  postage: {
    q: 'How much is postage?',
    a: 'Postage is quoted for your specific order when we confirm it, rather than applied as a flat rate. That way a single small part is not charged the same as a bulk order of screens. The total including postage is confirmed before you pay.',
  },
  returns: {
    q: 'Can I return a part?',
    a: 'Yes — if a part arrives faulty or is not as described, contact us and we will arrange a replacement or refund. Graded parts are sold as described, so cosmetic wear that was stated in the listing is not a fault. Parts damaged during fitting cannot be returned.',
  },
  trade: {
    q: 'Do you offer trade pricing?',
    a: 'Yes. We supply repair shops across the UK with screens, housings and screen protectors in volume, and screen protectors are already listed in packs of ten. Message us with the quantities you need and we will quote trade pricing.',
  },
  poa: {
    q: 'Why does this item say "Enquire for price"?',
    a: 'Some items change in price frequently, or vary by grade and specification, so a fixed price on the page would be misleading. Add the item to your order and send it to us, and we will reply with a current price.',
  },
  payment: {
    q: 'How do I pay?',
    a: 'We confirm your order, availability and the full total including postage by WhatsApp or email first, then send payment details. Nothing is charged through this website.',
  },
};

/** FAQs shown on category pages, chosen to suit the category. */
const CATEGORY_FAQ_KEYS = {
  'lcd-screens-and-displays': ['genuine', 'grades', 'compatibility', 'returns'],
  'back-covers-and-housings': ['genuine', 'compatibility', 'grades', 'trade'],
  'empty-boxes': ['genuine', 'dispatch', 'postage'],
  batteries: ['genuine', 'grades', 'compatibility'],
  'charging-ports-and-flex-cables': ['genuine', 'compatibility', 'returns'],
  'cameras-and-lenses': ['genuine', 'compatibility', 'returns'],
  'screen-protectors': ['compatibility', 'trade', 'postage'],
  'cases-and-covers': ['genuine', 'compatibility', 'dispatch'],
  'cables-and-chargers': ['genuine', 'dispatch', 'postage'],
  'audio-and-headphones': ['genuine', 'dispatch'],
  'phones-and-tablets': ['grades', 'returns', 'payment'],
  'repair-tools-and-equipment': ['trade', 'postage', 'returns'],
  'other-accessories': ['genuine', 'dispatch', 'compatibility'],
};

/** Per-product FAQ, assembled from the pool based on the product's attributes. */
function productFaqKeys(product) {
  const keys = [];
  if (product.isPoa) keys.push('poa');
  if (/genuine|original|pulled/i.test(product.conditionGrade || '')) keys.push('genuine');
  if (/grade/i.test(product.conditionGrade || '')) keys.push('grades');
  if (product.fitsModels && product.fitsModels.length) keys.push('compatibility');
  keys.push('dispatch');
  if (!keys.includes('genuine')) keys.push('payment');
  return [...new Set(keys)].slice(0, 4);
}

function resolveFaq(keys) {
  return (keys || []).map((k) => FAQ[k]).filter(Boolean);
}

const CONTACT_BODY = `
<h2>Which part do you need?</h2>
<p>The quickest way to get an answer is to send us the model number of your device, or the part number printed on the component you are replacing. Samsung part numbers look like SM-G970F or SM-N986B; iPhone models are easiest given as the marketing name, such as iPhone 13 Pro Max.</p>
<p>If you already know what you want, build your list on the site and send it in one message — you will get availability, postage and a total back in a single reply.</p>

<h2>Trade enquiries</h2>
<p>We supply repair shops across the UK. If you buy screens, housings or protectors regularly, tell us the models and volumes you go through and we will quote trade pricing.</p>

<h2>Something not listed?</h2>
<p>Stock moves faster than the website does, so it is always worth asking about a part you cannot find here. We may have it, or be able to source it.</p>
`;

module.exports = { PAGES, FAQ, CATEGORY_FAQ_KEYS, productFaqKeys, resolveFaq, CONTACT_BODY };
