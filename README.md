<!-- HEADER & SEO BADGES -->
<div align="center">

# 🛒 FlashStore

### **The Free, Ultra-Fast, Open-Source Static E-Commerce Engine**

*A zero-subscription, zero-hosting, Jamstack alternative to Shopify, WooCommerce, and Magento.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Lighthouse Score](https://img.shields.io/badge/Lighthouse-100%2F100-brightgreen.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Build Status](https://img.shields.io/badge/Build-Passing-success.svg)]()

[Live Demo](https://FlashStore.digitalocean.app) • [Documentation](#quick-start) • [Report Bug](https://github.com/muhammad-shariq/FlashStore/issues)

</div>

---

## 🚀 Overview

**FlashStore** is an open-source static site e-commerce generator designed to eliminate recurring SaaS fees while delivering sub-second load times and production-ready SEO. Built on a modern Jamstack architecture, it lets merchants host fully functional online stores on free static edge networks like DigitalOcean, Vercel, Netlify, or GitHub Pages.

### Why FlashStore?
* **💰 $0 Lifetime Hosting:** No monthly subscriptions, database servers, or plugin fees.
* **⚡ 100/100 Lighthouse Performance:** Pre-rendered HTML pages yield faster response times and improved conversion rates.
* **🔍 Built-in E-Commerce SEO:** Dynamic Schema.org structured data, XML sitemap generation, Open Graph tags, and SSR routing.
* **🔒 Zero Server Vulnerabilities:** No PHP backend or database connections means immune to SQL injections and backend exploits.

---

## 📊 Feature Comparison Matrix

| Feature | **FlashStore** | **Shopify** | **WooCommerce** |
| :--- | :--- | :--- | :--- |
| **Monthly Cost** | **$0** (Free Hosting) | $39+/month | $15–$50/month |
| **Hosting Requirement** | Static / Edge | SaaS (Locked) | Node/PHP + MySQL |
| **Lighthouse Speed Score** | **98–100** | ~65–80 | ~40–70 |
| **SEO Optimization** | Pre-rendered Static JSON-LD | Basic / App-dependent | Plugin-dependent |
| **Database Needed** | ❌ No | Hosted | ✅ Yes |

---

## ⚡ Quick Start

### Prerequisites
Make sure you have **Node.js 18+** installed on your system.

### Installation & Local Setup

The Shopify store migrated to a static site, plus a local admin for running it.

- **`web/`** — the generated static site. Committed to the repository and served
  as-is by DigitalOcean App Platform. No cloud build step, so `git push` is the
  entire deployment.
- **`data/store.db`** — SQLite, and the **source of truth** for the catalogue.
  Also committed, so the repository is a complete backup.
- **`backend/`** — the admin, which runs on your own machine only.
- **`generator/`** — turns the database into `web/`. The only thing that writes
  `web/`, apart from the image pipeline, which owns `web/assets/products/`.

Nothing in `web/` should ever be edited by hand: the next publish overwrites it.

---

## Getting started

```bash
npm install          # Node 20 or newer
npm run admin        # http://localhost:4000
```

The catalogue is already imported, so the admin works immediately.

To preview the generated site:

```bash
npm run serve        # http://localhost:4300
```

> **Not port 5000.** On macOS, Control Center's AirPlay Receiver listens on
> `*:5000` and answers every request with **HTTP 403**, which looks exactly like
> a broken site. `npm run serve` uses 4300 and steps forward if that is busy,
> printing the port it settled on. (You can also free 5000 via System Settings →
> General → AirDrop & Handoff → AirPlay Receiver, but there is no need.)

The two servers are independent — run them in separate terminals and leave them
running. If `npm run admin` reports that port 4000 is in use, the admin is
already running: open it rather than starting a second copy, since both would be
writing to the same database. To run it elsewhere, use `PORT=4001 npm run admin`.

| Command | What it does |
|---|---|
| `npm run admin` | The admin UI on `localhost:4000`. |
| `npm run build` | Regenerate `web/` from the database, then run the SEO checks. |
| `npm run serve` | Serve `web/` on `localhost:4300` the way DigitalOcean will. |
| `npm run import` | Re-read the Shopify CSV. Keeps your edits (see below). |
| `npm run images` | Download and process any images not yet on disk. Resumable. |
| `npm run categorize` | Re-derive category assignments. Additive — never removes your changes. |
| `npm run setup` | All of the above, in order. Only needed on a fresh clone. |

## The daily loop

1. **Edit** in the admin — products, categories, settings, page copy.
2. **Publish** (`/publish` → *Generate*) rewrites `web/` and runs the SEO checks.
   This is local; the live site has not changed yet.
3. **Push** (`/publish` → *Commit & push*) commits and pushes, which triggers the
   DigitalOcean deploy.

Generate and push are separate on purpose: saving a product can never deploy the
site by accident.

## First-time deployment

```bash
git init && git add -A && git commit -m "Initial import from Shopify"
git branch -M main
git remote add origin git@github.com:<you>/FlashStore.git
git push -u origin main
```

Then in DigitalOcean: **Apps → Create App → GitHub**, pick the repository, and
choose **Static Site** with output directory `web`. Or edit
`.do/app.yaml` (replace `<YOUR-GITHUB-USERNAME>`) and run
`doctl apps create --spec .do/app.yaml`.

After the domain is live, set **Site URL** in the admin Settings to the real
domain and publish again — canonical URLs, sitemaps and structured data all
derive from it.

---

## Before you go live

The site is complete and correct, but four things need your input. The publish
step warns about each of them until they are done.

1. **Contact details** — Settings → *Contact & ordering*. The WhatsApp number is
   `44XXXXXXXXXX` until you change it, and until then the "Send order on
   WhatsApp" button cannot work. No phone number or address is published as
   structured data while the placeholders are in place, because publishing
   invented contact details as machine-readable facts is worse than publishing
   none.
2. **Shipping, returns and warranty terms** — Settings → *Page copy*. Anything in
   `[[double brackets]]` is a placeholder awaiting a real answer: dispatch
   cut-off, carriers and prices, returns window, warranty period, company
   details.
3. **Site URL** — Settings → *Store*. Must be the real domain before launch.
4. **Social links** — Settings → *Social links*. These become the
   `Organization.sameAs` links, which is how search engines connect the site to
   your profiles.

---

## How ordering works

The site is a catalogue, not a checkout. A visitor builds an order in their
browser (`localStorage` only — nothing is sent anywhere), then sends the whole
list to you in one WhatsApp message or email. You reply confirming availability,
postage and the total before any payment.

This is why a static site is viable at all: there is no server to take payments,
and none is needed.

## SEO and AI discoverability

Everything is rendered at build time. No content anywhere on the site depends on
JavaScript, because most AI crawlers do not run it — JS only powers the cart,
search and gallery.

- **Structured data** on every page: `Organization`, `WebSite` + `SearchAction`,
  `BreadcrumbList`, and per product a `Product` with `Offer`/`AggregateOffer`,
  `itemCondition`, and `isAccessoryOrSparePartFor` listing every compatible
  model. Products with no price publish **no** `Offer`, so no page ever claims
  £0.00.
- **Compatibility as data.** Each product lists the exact handsets and
  manufacturer part numbers it fits (`SM-G970F` as well as `Galaxy S10e`), in a
  table on the page and in the structured data. This is the single most valuable
  field in the catalogue — it is what lets a customer or an assistant confirm a
  part fits.
- **AI-facing files**: `robots.txt` explicitly allows the AI crawlers,
  `llms.txt` indexes the site, `llms-full.txt` is the whole catalogue as
  markdown, `products.json` is the machine-readable catalogue, and
  `feeds/google-merchant.xml` can be submitted to Google Merchant Center for
  free Shopping listings.
- **A build-time linter** fails the build on a duplicate title, a missing
  description, an image without `alt`, more than one `h1`, a broken internal
  link or invalid JSON-LD. It is there so a well-meaning edit a year from now
  cannot quietly undo any of this.

Each product also carries an **SEO score** in the admin listing the specific
gaps, so the catalogue can be improved a few products at a time.

---

## 🛠️ Need Customization or Professional Deployment?

Need help tailoring **FlashStore** to your business, setting up payment gateways, or migrating from Shopify/WooCommerce? I am available for freelance work and technical consultation!

### 💼 Services Offered:
* **Custom Store Setup & Deployment:** Full deployment to DigitalOcean, Vercel, Netlify, or custom domain.
* **Custom Features & Integrations:** Payment gateway setup (Stripe, PayPal), custom UI design, or CRM integrations.
* **Store Migration:** Exporting and converting your existing Shopify or WooCommerce product catalogs.

### 📬 Get in Touch:
* **Email:** [shariq2k@yahoo.com](mailto:shariq2k@yahoo.com)
* **LinkedIn:** [linkedin.com/in/muhammadshariqshaikh](https://linkedin.com/in/muhammadshariqshaikh)
* **Website / Portfolio:** [techvisionar.com](https://techvisionar.com)

> 💡 *Open for freelance projects, contract roles, custom e-commerce builds and system integrations.*