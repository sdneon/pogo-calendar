'use strict';
// Preview the built static site (site/) the way GitHub Pages serves it.
// Usage: node tools/serve_static.js   then open http://localhost:8643/?static
const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'site');
const PORT = +process.env.PORT || 8643;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(SITE, rel));
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`site/ on http://localhost:${PORT}/?static`));
