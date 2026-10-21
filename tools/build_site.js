'use strict';
// Build the static site (site/) for GitHub Pages: the page from public/ (with public.json, the owner's
// published edits), events.json (the Leek Duck snapshot) and icons/ (Leek Duck icons, same-origin so the
// page can crop them).
// Usage:
//   node tools/build_site.js --from-store          snapshot from the local data/store.json (no scraping)
//   node tools/build_site.js [--known <file|url>]  scrape Leek Duck; <known> is the previous events.json,
//                                                  so only new or stale detail pages are fetched

const fs = require('fs');
const path = require('path');
const { scrape } = require('../lib/scrape');
const { CDN, iconFile } = require('../lib/iconfile');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const ICONS = path.join(SITE, 'icons');
const LOCAL_ICON_CACHE = path.join(ROOT, 'data', 'icons'); // the server's cache, reused when present
const KEEP_DAYS = 90;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] || '' : null; };

async function readKnown(src) {
  if (!src) return {};
  try {
    const json = /^https?:/.test(src) ? await (await fetch(src)).json() : JSON.parse(fs.readFileSync(src, 'utf8'));
    return Object.fromEntries((json.events || []).map((e) => [e.id, e]));
  } catch (e) {
    console.log(`no previous snapshot (${e.message}); fetching every detail page`);
    return {};
  }
}

async function main() {
  let events;
  if (process.argv.includes('--from-store')) {
    const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'store.json'), 'utf8'));
    events = Object.values(store.events).filter((e) => e.ld).map((e) => e.ld);
  } else {
    const known = await readKnown(arg('--known'));
    events = await scrape(known, { log: (m) => console.log(m) });
    // Leek Duck lists only current and upcoming events: keep ones that dropped off, from the previous
    // snapshot, for KEEP_DAYS after they ended, so past days of the month stay filled in.
    const listed = new Set(events.map((e) => e.id));
    const cutoff = Date.now() - KEEP_DAYS * 86400e3;
    const kept = Object.values(known).filter((e) => !listed.has(e.id) && (Date.parse(e.end || e.start) || 0) > cutoff);
    events.push(...kept);
    console.log(`kept ${kept.length} past events from the previous snapshot`);
  }

  fs.mkdirSync(ICONS, { recursive: true });
  // Start clean, except the icons (a cache between builds).
  for (const f of fs.readdirSync(SITE)) if (f !== 'icons') fs.rmSync(path.join(SITE, f), { recursive: true, force: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'public'))) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(SITE, f));
  if (!fs.existsSync(path.join(SITE, 'public.json'))) fs.writeFileSync(path.join(SITE, 'public.json'), '{"events":{},"days":{}}\n');
  fs.writeFileSync(path.join(SITE, 'events.json'), JSON.stringify({ generatedAt: Date.now(), events }));
  fs.writeFileSync(path.join(SITE, '.nojekyll'), '');
  fs.copyFileSync(path.join(SITE, 'calendar.html'), path.join(SITE, 'index.html'));

  // Icons for every featured Pokémon, plus the plain species icon for title-derived ones.
  const urls = new Set();
  for (const ev of events) {
    for (const p of ev.pokemon || []) {
      if (p.icon && CDN.test(p.icon)) urls.add(p.icon);
      else if (p.dex) urls.add(`https://cdn.leekduck.com/assets/img/pokemon_icons/pokemon_icon_${String(p.dex).padStart(3, '0')}_00.png`);
    }
  }
  let fetched = 0;
  for (const url of urls) {
    const file = path.join(ICONS, iconFile(url));
    if (fs.existsSync(file)) continue;
    const cached = path.join(LOCAL_ICON_CACHE, iconFile(url));
    if (fs.existsSync(cached)) { fs.copyFileSync(cached, file); continue; }
    try {
      await sleep(200);
      const r = await fetch(url);
      if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); fetched++; }
    } catch (e) { console.log(`icon failed: ${url}: ${e.message}`); }
  }
  console.log(`site/: ${events.length} events, ${urls.size} icons (${fetched} downloaded)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
