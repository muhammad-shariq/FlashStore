#!/usr/bin/env node
'use strict';
/**
 * Local admin for theFlashStore catalogue.
 *
 * Binds to 127.0.0.1 only: this is a single-operator tool that runs on the
 * shop owner's own machine, so it has no login. Binding to loopback is what
 * keeps it private — do not change that without adding authentication.
 *
 * The database is the source of truth. Nothing here writes to web/ directly;
 * publishing runs the generator, which is the only writer.
 */
const path = require('path');
const express = require('express');

const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const HOST = '127.0.0.1';

const conn = db.open();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));
app.use('/admin-assets', express.static(path.join(__dirname, 'public')));
// Serve the generated site so images and previews resolve in the admin UI.
app.use('/site', express.static(path.join(__dirname, '..', 'web')));

/* Flash messages via a short-lived in-process queue (single user, single tab). */
let flash = null;
app.use((req, res, next) => {
  res.locals.flash = flash;
  flash = null;
  res.locals.currentPath = req.path;
  res.locals.settings = db.allSettings(conn);
  next();
});
app.setFlash = (type, message) => { flash = { type, message }; };

/* Express has no built-in layout support, so wrap render: the view is rendered
   to a string and passed to layout.ejs as `body`. */
app.use((req, res, next) => {
  const render = res.render.bind(res);
  res.render = (view, locals = {}, cb) => {
    if (view === 'layout') return render(view, locals, cb);
    render(view, locals, (err, html) => {
      if (err) return next(err);
      return render('layout', { ...locals, body: html }, cb);
    });
  };
  next();
});

/* Routes */
app.use('/', require('./routes/dashboard')(conn, app));
app.use('/products', require('./routes/products')(conn, app));
app.use('/categories', require('./routes/categories')(conn, app));
app.use('/settings', require('./routes/settings')(conn, app));
app.use('/publish', require('./routes/publish')(conn, app));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: `No admin page at ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Something went wrong', message: err.message });
});

const server = app.listen(PORT, HOST);

server.on('listening', () => {
  const counts = conn.prepare(`SELECT
    (SELECT COUNT(*) FROM products) p,
    (SELECT COUNT(*) FROM categories) c,
    (SELECT COUNT(*) FROM images) i`).get();
  console.log(`\n FlashStore admin`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  ${counts.p} products · ${counts.c} categories · ${counts.i} images`);
  console.log(`  Bound to ${HOST} only — not reachable from other machines.\n`);
});

/**
 * Deliberately refuse to move to another port, unlike the preview server: two
 * admin instances would be writing to the same SQLite file, and editing in one
 * window while looking at another is a good way to lose work. Say what is
 * happening and what to do about it.
 */
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`\n  Port ${PORT} is already in use.`);
  console.error('\n  The admin is most likely already running — open http://localhost:'
    + `${PORT} before starting another copy.`);
  console.error('\n  If it is something else, find it with:');
  console.error(`    lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
  console.error('\n  Or run the admin on a different port:');
  console.error(`    PORT=4001 npm run admin\n`);
  process.exit(1);
});
