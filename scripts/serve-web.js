#!/usr/bin/env node
'use strict';
/**
 * Serves web/ locally the way DigitalOcean App Platform will: directory
 * index.html resolution, a real 404 document, and no rewrites. Useful for
 * checking the built site before pushing.
 *
 *   node scripts/serve-web.js [--port 4300]
 *
 * Port 4300 rather than the conventional 5000: on macOS, Control Center's
 * AirPlay Receiver listens on *:5000 and answers with a 403, which looks
 * exactly like a broken site. If the chosen port is busy this falls forward to
 * the next few and tells you which one it used.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..', 'web');
const argv = process.argv.slice(2);
const pIdx = argv.indexOf('--port');
const PORT = pIdx !== -1 ? Number(argv[pIdx + 1]) || 4300 : 4300;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // Reject traversal before touching the filesystem.
  const target = path.normalize(path.join(WEB, url));
  if (!target.startsWith(WEB)) { res.writeHead(403).end('Forbidden'); return; }

  const candidates = url.endsWith('/')
    ? [path.join(target, 'index.html')]
    : [target, `${target}.html`, path.join(target, 'index.html')];

  for (const file of candidates) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const cache = /\/assets\//.test(url) ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'content-type': type, 'cache-control': cache });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }

  const notFound = path.join(WEB, '404.html');
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found');
});

/**
 * Bind to localhost, stepping forward if the port is taken. Explicitly report
 * the port actually used — silently landing somewhere unexpected is worse than
 * failing.
 */
function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    if (attemptsLeft <= 0) {
      console.error(`Ports ${PORT}-${port} are all in use. Pass --port <n> to pick one.`);
      process.exit(1);
    }
    console.log(`Port ${port} is in use, trying ${port + 1}…`);
    listen(port + 1, attemptsLeft - 1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Serving web/ at http://localhost:${port}\n`);
  });
}

listen(PORT, 8);
