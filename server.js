'use strict';
// PoGo Calendar server: serves public/, a JSON API over data/store.json, a cached
// Leek Duck icon proxy, and a periodic Leek Duck refresh. No dependencies.
// Usage: node server.js   (env PORT, default 8642; REFRESH_HOURS, default 6; NO_REFRESH=1)
// The public static site is built separately by tools/build_site.js (see design.md "Static site").

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const { scrape, SCRAPE_VERSION } = require('./lib/scrape');
const { iconFile } = require('./lib/iconfile');

const PORT = +process.env.PORT || 8642;
const REFRESH_MS = (+process.env.REFRESH_HOURS || 6) * 3600e3;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const ICONS = path.join(ROOT, 'data', 'icons');
const store = new Store(path.join(ROOT, 'data', 'store.json'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);

// ---- refresh ----
let refreshing = null;
function refresh() {
  if (refreshing) return refreshing;
  log('refresh: start');
  refreshing = scrape(store.scrapedKnown(), { log: (m) => log('refresh:', m) })
    .then((list) => { store.mergeScrape(list); log(`refresh: done, ${list.length} events`); })
    .catch((e) => { store.data.lastError = `${new Date().toISOString()}: ${e.message}`; store.save(); log('refresh failed:', e.message); })
    .finally(() => { refreshing = null; });
  return refreshing;
}

// ---- http helpers ----
// The page may be opened from disk (Origin "null") or served here; nothing else may call the API.
function allowedOrigin(origin) {
  return !origin || origin === 'null' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8', ...headers });
  res.end(isBuf || typeof body === 'string' ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// The page tries several candidate icons in turn; remember CDN misses for a day instead of asking again.
const MISSING = new Map(); // url -> time of the 404
async function icon(res, url) {
  if (!/^https:\/\/cdn\.leekduck\.com\/[\w\-./%@=,]+(\?[\w=&.-]*)?$/.test(url)) return send(res, 400, { error: 'not a Leek Duck CDN image' });
  if (Date.now() - (MISSING.get(url) || 0) < 86400e3) return send(res, 404, { error: 'not on the CDN' });
  const name = iconFile(url);
  const file = path.join(ICONS, name);
  const type = TYPES[path.extname(name).toLowerCase()] || 'image/png';
  const cache = { 'Content-Type': type, 'Cache-Control': 'max-age=2592000' };
  if (fs.existsSync(file)) return send(res, 200, fs.readFileSync(file), cache);
  try {
    const r = await fetch(url);
    if (r.status === 404) { MISSING.set(url, Date.now()); return send(res, 404, { error: 'not on the CDN' }); }
    if (!r.ok) return send(res, 502, { error: `CDN ${r.status}` });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(ICONS, { recursive: true });
    fs.writeFileSync(file, buf);
    send(res, 200, buf, cache);
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'calendar.html' : decodeURIComponent(pathname.slice(1));
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'not found' });
  send(res, 200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
}

// ---- routes ----
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) return send(res, 403, { error: 'origin not allowed' });
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !/application\/json/.test(req.headers['content-type'] || '')) {
      return send(res, 415, { error: 'send JSON' });
    }
    if (p === '/api/events' && req.method === 'GET') return send(res, 200, { ...store.snapshot(), refreshing: !!refreshing });
    if (p === '/api/events' && req.method === 'POST') return send(res, 201, store.addEvent(await readJson(req)));
    let m = /^\/api\/events\/([\w.:@+-]+)$/.exec(p);
    if (m && req.method === 'PUT') { const ev = store.updateEvent(m[1], await readJson(req)); return ev ? send(res, 200, ev) : send(res, 404, { error: 'no such event' }); }
    if (m && req.method === 'DELETE') { const r = store.revertOrDelete(m[1]); return r ? send(res, 200, r) : send(res, 404, { error: 'no such event' }); }
    m = /^\/api\/days\/(\d{4}-\d{2}-\d{2})$/.exec(p);
    if (m && req.method === 'PUT') { const d = store.setDay(m[1], await readJson(req)); return d ? send(res, 200, d) : send(res, 400, { error: 'bad date' }); }
    if (p === '/api/refresh' && req.method === 'POST') { refresh(); return send(res, 202, { refreshing: true }); }
    if (p === '/api/public' && req.method === 'GET') {
      // What would be published now vs what public/public.json holds, so the page can say if Publish is needed.
      const { publishedAt: _a, ...current } = store.publicSnapshot();
      let published = null;
      try { published = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'public.json'), 'utf8')); } catch { /* never published */ }
      const { publishedAt = 0, ...pubBody } = published || {};
      return send(res, 200, { current, publishedAt, upToDate: !!published && JSON.stringify(pubBody) === JSON.stringify(current) });
    }
    if (p === '/api/publish' && req.method === 'POST') {
      const snap = store.publicSnapshot();
      fs.writeFileSync(path.join(PUBLIC, 'public.json'), JSON.stringify(snap, null, 1));
      log(`publish: ${Object.keys(snap.events).length} events, ${Object.keys(snap.days).length} days`);
      return send(res, 200, { events: Object.keys(snap.events).length, days: Object.keys(snap.days).length, file: 'public/public.json' });
    }
    if (p === '/icon' && req.method === 'GET') return icon(res, url.searchParams.get('u') || '');
    if (req.method === 'GET') return serveStatic(res, p);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    log('error', req.method, p, e.message);
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`PoGo Calendar on http://localhost:${PORT}/  (data: ${store.file})`);
  if (process.env.NO_REFRESH) return;
  // Also check now when an unfinished event was read by an older scraper (SCRAPE_VERSION bumped since).
  const outdated = Object.values(store.data.events).some((ev) => ev.ld && ev.ld.v !== SCRAPE_VERSION
    && !(Date.parse(ev.ld.end) < Date.now()));
  if (Date.now() - store.data.lastRefresh > REFRESH_MS || outdated) refresh();
  setInterval(refresh, REFRESH_MS).unref?.();
});
