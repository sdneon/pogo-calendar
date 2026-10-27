'use strict';
// Build the static site (site/) for GitHub Pages: the page from public/ (with public.json, the owner's
// published edits), events.json (the Leek Duck snapshot), campfire.json (Singapore Campfire meetups) and
// icons/ (Leek Duck icons, same-origin so the page can crop them).
// Usage:
//   node tools/build_site.js --from-store          snapshot from the local store (no scraping)
//   node tools/build_site.js [--known <file|url>]  scrape Leek Duck; <known> is the previous events.json,
//                                                  so only new or stale detail pages are fetched

const fs = require('fs');
const path = require('path');
const { scrape } = require('../lib/scrape');
const { CDN, iconFile } = require('../lib/iconfile');
const { fetchCampfire } = require('../lib/campfire');

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

// Campfire meetups (lib/campfire.js) for site/campfire.json. From the store: the server's data/campfire.json.
// Otherwise fetched, starting from the previous site's campfire.json (next to --known's events.json); if the
// fetch fails, or NO_CAMPFIRE is set, the previous list is kept as it is.
async function buildCampfire() {
  const empty = { fetchedAt: 0, meetups: [] };
  if (process.argv.includes('--from-store')) {
    try { const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'campfire.json'), 'utf8')); return { fetchedAt: c.fetchedAt, meetups: c.meetups }; }
    catch { return empty; }
  }
  const src = (arg('--known') || '').replace(/events\.json$/, 'campfire.json');
  let prev = empty;
  if (/campfire\.json$/.test(src)) {
    try { prev = /^https?:/.test(src) ? await (await fetch(src)).json() : JSON.parse(fs.readFileSync(src, 'utf8')); }
    catch (e) { console.log(`no previous campfire.json (${e.message})`); }
  }
  if (process.env.NO_CAMPFIRE) return prev;
  try {
    const meetups = await fetchCampfire(Object.fromEntries((prev.meetups || []).map((m) => [m.id, m])), { log: (m) => console.log(`campfire: ${m}`) });
    console.log(`campfire: ${meetups.length} meetups`);
    return { fetchedAt: Date.now(), meetups };
  } catch (e) {
    console.log(`campfire failed (${e.message}); keeping the previous ${(prev.meetups || []).length}`);
    return prev;
  }
}

async function main() {
  let events;
  if (process.argv.includes('--from-store')) {
    const { Store } = require('../lib/store');
    const store = new Store(path.join(ROOT, 'data', 'store.json'));
    events = Object.values(store.data.events).filter((e) => e.ld).map((e) => e.ld);
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
  const campfire = await buildCampfire();

  fs.mkdirSync(ICONS, { recursive: true });
  // Start clean, except the icons (a cache between builds).
  for (const f of fs.readdirSync(SITE)) if (f !== 'icons') fs.rmSync(path.join(SITE, f), { recursive: true, force: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'public'))) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(SITE, f));
  if (!fs.existsSync(path.join(SITE, 'public.json'))) fs.writeFileSync(path.join(SITE, 'public.json'), '{"events":{},"days":{}}\n');
  fs.writeFileSync(path.join(SITE, 'events.json'), JSON.stringify({ generatedAt: Date.now(), events }));
  fs.writeFileSync(path.join(SITE, 'campfire.json'), JSON.stringify(campfire));
  fs.writeFileSync(path.join(SITE, '.nojekyll'), '');
  fs.copyFileSync(path.join(SITE, 'calendar.html'), path.join(SITE, 'index.html'));

  // Icons for every featured Pokémon, plus base species sprites (pm<dex>.icon.png): the page's fallback for
  // forms without their own sprite. Also every legendary / mythical / Ultra Beast, the likely targets visitors
  // add themselves.
  const SPRITES = 'https://cdn.leekduck.com/assets/img/pokemon_icons/';
  const urls = new Set();
  for (const ev of events) {
    for (const p of ev.pokemon || []) {
      if (p.icon && CDN.test(p.icon)) urls.add(p.icon);
      if (p.dex) urls.add(`${SPRITES}pm${p.dex}.icon.png`);
    }
  }
  global.window = {};
  require(path.join(ROOT, 'public', 'pokedex.js'));
  for (const [dex, , cls] of window.POGO_DEX) if (cls) urls.add(`${SPRITES}pm${dex}.icon.png`);
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
