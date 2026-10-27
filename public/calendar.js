'use strict';
// PoGo Calendar page. Talks to server.js; works served by it or opened from disk.
// Last good API response is cached in localStorage so the calendar still shows when the server is down.
// Tiers, overseas detection and the cell layout are explained in design.md "Page".

// Owner mode when served by (or opened next to) the local server; static mode anywhere else (GitHub Pages).
// `?static` forces static mode, to preview the built site locally (tools/serve_static.js).
const STATIC = new URLSearchParams(location.search).has('static')
  || (location.protocol !== 'file:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname));
const API = location.protocol === 'file:' ? 'http://localhost:8642' : '';
const CACHE_KEY = 'pogoCalendarCache';
const MINE_KEY = 'pogoCalendarMine'; // static mode: the visitor's own changes
const CF_MINE_KEY = 'pogoCalendarCampfireMine'; // static mode: the visitor's attending / targets on Campfire meetups
const PREFS_KEY = 'pogoCalendarPrefs';

// Home: all times are shown in SGT. Leek Duck "local time" strings are read as home time,
// except for events in an overseas city, which are read in that city's zone.
const HOME = { name: 'Singapore', tz: 'Asia/Singapore', label: 'SGT' };
const CITIES = [
  ['Singapore', 'Asia/Singapore'], ['Sendai', 'Asia/Tokyo'], ['Tohoku', 'Asia/Tokyo'], ['Tokyo', 'Asia/Tokyo'],
  ['Osaka', 'Asia/Tokyo'], ['Yokohama', 'Asia/Tokyo'], ['Fukuoka', 'Asia/Tokyo'], ['Sapporo', 'Asia/Tokyo'],
  ['Seoul', 'Asia/Seoul'], ['Busan', 'Asia/Seoul'], ['Incheon', 'Asia/Seoul'], ['Taipei', 'Asia/Taipei'],
  ['Kaohsiung', 'Asia/Taipei'], ['Tainan', 'Asia/Taipei'], ['Hong Kong', 'Asia/Hong_Kong'], ['Bangkok', 'Asia/Bangkok'],
  ['Jakarta', 'Asia/Jakarta'], ['Bali', 'Asia/Makassar'], ['Surabaya', 'Asia/Jakarta'], ['Manila', 'Asia/Manila'],
  ['Kuala Lumpur', 'Asia/Kuala_Lumpur'], ['Mumbai', 'Asia/Kolkata'], ['New Delhi', 'Asia/Kolkata'],
  ['Sydney', 'Australia/Sydney'], ['Melbourne', 'Australia/Melbourne'], ['Auckland', 'Pacific/Auckland'],
  ['London', 'Europe/London'], ['Paris', 'Europe/Paris'], ['Madrid', 'Europe/Madrid'], ['Barcelona', 'Europe/Madrid'],
  ['Berlin', 'Europe/Berlin'], ['Amsterdam', 'Europe/Amsterdam'], ['Milan', 'Europe/Rome'], ['Rome', 'Europe/Rome'],
  ['Valencia', 'Europe/Madrid'], ['Seville', 'Europe/Madrid'], ['Lisbon', 'Europe/Lisbon'], ['Stockholm', 'Europe/Stockholm'],
  ['New York', 'America/New_York'], ['Boston', 'America/New_York'], ['Chicago', 'America/Chicago'],
  ['Los Angeles', 'America/Los_Angeles'], ['San Francisco', 'America/Los_Angeles'], ['Seattle', 'America/Los_Angeles'],
  ['Las Vegas', 'America/Los_Angeles'], ['Indianapolis', 'America/Indiana/Indianapolis'], ['Toronto', 'America/Toronto'],
  ['Vancouver', 'America/Vancouver'], ['Mexico City', 'America/Mexico_City'], ['Monterrey', 'America/Monterrey'],
  ['São Paulo', 'America/Sao_Paulo'], ['Sao Paulo', 'America/Sao_Paulo'], ['Rio de Janeiro', 'America/Sao_Paulo'],
  ['Santiago', 'America/Santiago'], ['Buenos Aires', 'America/Argentina/Buenos_Aires'], ['Bogotá', 'America/Bogota'],
  ['Lima', 'America/Lima'], ['Cape Town', 'Africa/Johannesburg'], ['Dubai', 'Asia/Dubai'],
];

// Region-locked Pokémon (keys match regionOf() in lib/scrape.js). Zones are sample places from the region's
// first to last time zone, used to show when a local-time event window is live there, in SGT.
const REGIONS = {
  apac: { label: 'Asia-Pacific', short: 'AP', zones: [['New Zealand', 'Pacific/Auckland'], ['Sydney', 'Australia/Sydney'],
    ['Japan', 'Asia/Tokyo'], ['Singapore', 'Asia/Singapore'], ['Thailand', 'Asia/Bangkok']] },
  emea: { label: 'Europe, Middle East, Africa & India', short: 'EU', zones: [['India', 'Asia/Kolkata'], ['Dubai', 'Asia/Dubai'],
    ['Moscow', 'Europe/Moscow'], ['Central Europe', 'Europe/Paris'], ['UK', 'Europe/London'], ['Cape Verde', 'Atlantic/Cape_Verde']] },
  americas: { label: 'Americas & Greenland', short: 'AM', zones: [['Greenland', 'America/Nuuk'], ['Brazil', 'America/Sao_Paulo'],
    ['US Eastern', 'America/New_York'], ['US Central', 'America/Chicago'], ['US Pacific', 'America/Los_Angeles'], ['Hawaii', 'Pacific/Honolulu']] },
  east: { label: 'Eastern Hemisphere', short: 'E', zones: [['New Zealand', 'Pacific/Auckland'], ['Japan', 'Asia/Tokyo'],
    ['Singapore', 'Asia/Singapore'], ['India', 'Asia/Kolkata'], ['Central Europe', 'Europe/Paris'], ['UK', 'Europe/London']] },
  west: { label: 'Western Hemisphere', short: 'W', zones: [['Brazil', 'America/Sao_Paulo'], ['US Eastern', 'America/New_York'],
    ['US Pacific', 'America/Los_Angeles'], ['Hawaii', 'Pacific/Honolulu']] },
};
const HOME_REGIONS = new Set(['apac', 'east']);

// Activity pins. Keys match classify() in lib/scrape.js.
const ACTIVITIES = {
  raid:      { label: '5★ / Raid',       glyph: '★',  color: '#c8402f' },
  mega:      { label: 'Mega Raid',       glyph: 'M',  color: '#a8327c' },
  supermega: { label: 'Super Mega Raid', glyph: 'M+', color: '#c98a00' },
  shadow:    { label: 'Shadow Raid',     glyph: 'Sh', color: '#5d3a96' },
  dmax:      { label: 'Dynamax',         glyph: 'D',  color: '#d23f6b' },
  gmax:      { label: 'Gigantamax',      glyph: 'G',  color: '#7d1d46' },
  cd:        { label: 'Community Day',   glyph: 'CD', color: '#2b8c52' },
  hatch:     { label: 'Hatch Day',       glyph: 'H',  color: '#b07a22' },
  spotlight: { label: 'Spotlight Hour',  glyph: 'SH', color: '#c26a12' },
  research:  { label: 'Research',        glyph: 'R',  color: '#2c68b3' },
  wild:      { label: 'Wild spawns',     glyph: 'W',  color: '#4f8034' },
  event:     { label: 'Other',           glyph: '•',  color: '#6b7a82' },
};
const RAID_ACTS = new Set(['raid', 'mega', 'supermega', 'shadow', 'dmax', 'gmax']);
const MAX_ACTS = new Set(['dmax', 'gmax']);

// Tiers: super = whole day highlighted, name on top; major = big icons; weekly = small corner icons
// plus a bar; minor = day panel only. An event's own `tier` overrides autoTier().
const TIERS = [['', 'Automatic'], ['super', 'Super major (day highlighted)'], ['major', 'Major (big icons)'],
  ['weekly', 'Weekly rotation (small icons, bar)'], ['minor', 'Minor (day panel only)']];
const SUPER_TYPES = /^(community-day|wild-area|pokémon-go-tour|pokémon-go-fest|go-fest|city-safari)$/;
const MAJOR_TYPES = /^(raid-hour|pokémon-spotlight-hour|raid-day|max-battles|max-mondays|hatch-day|research-day|community-day-classic)$/;
const SEASON_DAYS = 14; // longer events never put Pokémon on day cells

const EVENT_TYPES = [
  ['event', 'Event'], ['raid-battles', 'Raid Battles'], ['raid-hour', 'Raid Hour'], ['raid-day', 'Raid Day'],
  ['max-mondays', 'Max Mondays'], ['max-battles', 'Max Battles'], ['community-day', 'Community Day'],
  ['pokémon-spotlight-hour', 'Spotlight Hour'], ['research', 'Research'], ['research-day', 'Research Day'],
  ['hatch-day', 'Hatch Day'], ['go-battle-league', 'GO Battle League'], ['wild-area', 'Wild Area'],
  ['pokémon-go-tour', 'GO Tour'], ['pokémon-go-fest', 'GO Fest'], ['city-safari', 'City Safari'],
  ['season', 'Season'], ['go-pass', 'GO Pass'], ['other', 'Other'],
];
const TYPE_ACT = { 'raid-battles': 'raid', 'raid-hour': 'raid', 'raid-day': 'raid', 'max-mondays': 'dmax', 'max-battles': 'dmax',
  'community-day': 'cd', 'pokémon-spotlight-hour': 'spotlight', research: 'research', 'research-day': 'research', 'hatch-day': 'hatch' };

// ---------- state ----------
let data = { events: [], days: {}, lastRefresh: 0, lastError: '' };
let online = false;
let prefs = { month: null, bars: true, off: [], campfire: true };
let selected = null; // 'YYYY-MM-DD'
let editing = null;  // event being edited (copy)

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- pokédex ----------
const DEX = new Map(); // lower-case name -> {dex, name, cls, forms}
const DEX_BY_NO = new Map();
for (const [dex, name, cls, forms, temp] of window.POGO_DEX || []) {
  const e = { dex, name, cls: cls || '', forms: forms || [], temp: temp || {} };
  DEX.set(name.toLowerCase(), e);
  DEX_BY_NO.set(dex, e);
}
const PREFIX = /^(mega|primal|shadow|dynamax|gigantamax|apex|purified)\s+/i;
const REGION = /^(alolan|galarian|hisuian|paldean)\s+/i;
function lookup(name) {
  let n = String(name).trim();
  while (PREFIX.test(n)) n = n.replace(PREFIX, '');
  n = n.replace(/\s*\(.*\)$/, '').replace(/\s+[XY]$/, '').replace(/\s+wearing\s.*$/i, '').replace(REGION, '').toLowerCase();
  if (DEX.has(n)) return DEX.get(n);
  // Costume / form words around the species name ("Modern Jacket Machamp", "Orange Flower Flabébé").
  const words = n.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const tail = words.slice(i).join(' ');
    if (DEX.has(tail)) return DEX.get(tail);
  }
  return DEX.get(words[0]) || null;
}
const entryOf = (p) => (p.dex && DEX_BY_NO.get(p.dex)) || lookup(p.name);
const classOf = (p) => entryOf(p)?.cls || '';
const CLASS_NAME = { L: 'Legendary', M: 'Mythical', U: 'Ultra Beast' };
const isValuable = (p) => !!classOf(p) || ['mega', 'supermega', 'shadow', 'gmax'].includes(p.act);

// The pokédex form a name means: "(Origin)" in brackets, or a regional prefix, else the normal form.
function formOf(p, e) {
  const paren = (/\(([^)]*)\)/.exec(p.name)?.[1] || '').toLowerCase();
  const region = (REGION.exec(p.name.replace(PREFIX, ''))?.[1] || '').toLowerCase().slice(0, 5);
  return e.forms.find((f) => f[0] && paren && paren.includes(f[0].toLowerCase()))
    || e.forms.find((f) => f[0] && region && f[0].toLowerCase().startsWith(region))
    || e.forms.find((f) => f[0] === '' || f[0] === 'Normal') || e.forms[0];
}
// Mega / Primal key in the pokédex ("Mega Charizard X" -> MEGA_X), or '' for other names.
function tempKey(p) {
  const m = /^(mega|primal)\s/i.exec(p.name);
  if (!m) return '';
  const xy = /\s([XY])(\s*\(.*\))?$/.exec(p.name)?.[1];
  return m[1].toUpperCase() + (xy ? `_${xy}` : '');
}
function typesOf(p) {
  const e = entryOf(p);
  if (!e) return [];
  const k = tempKey(p);
  return (k && e.temp[k]) || (e.forms.length ? formOf(p, e)[4] || [] : []);
}
// Type colours (standard Pokémon GO palette).
const TYPE_COLORS = { Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c', Grass: '#7ac74c', Ice: '#96d9d6',
  Fighting: '#c22e28', Poison: '#a33ea1', Ground: '#e2bf65', Flying: '#a98ff3', Psychic: '#f95587', Bug: '#a6b91a', Rock: '#b6a136',
  Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746', Steel: '#b7b7ce', Fairy: '#d685ad' };
const LIGHT_TYPES = new Set(['Electric', 'Ice', 'Ground', 'Steel', 'Normal', 'Rock', 'Bug', 'Grass']);
// Megas that can reach Super Max Level (Mega Level 4), with the extra Charged Attack it unlocks.
// Source: pokemongo.fandom.com/wiki/Mega_Evolution, list checked 2026-10-26.
const SUPER_MAX = { 'Mega Beedrill': 'Fell Stinger+', 'Mega Raichu X': 'Volt Tackle+', 'Mega Raichu Y': 'Zap Cannon+',
  'Mega Victreebel': 'Acid Spray+', 'Mega Starmie': 'Liquidation+', 'Mega Dragonite': 'Outrage+', 'Mega Mewtwo X': 'Dynamic Punch+',
  'Mega Mewtwo Y': 'Future Sight+', 'Mega Skarmory': 'Drill Peck+', 'Mega Houndoom': 'Dark Pulse+', 'Mega Manectric': 'Discharge+',
  'Mega Staraptor': 'Brave Bird+', 'Mega Chesnaught': 'Seed Bomb+', 'Mega Delphox': 'Mystical Fire+', 'Mega Greninja': 'Surf+',
  'Mega Malamar': 'Psybeam+', 'Mega Falinks': 'Brick Break+' };
// Announced unlock days (SGT) for Megas not in that list yet. A Super Mega Raid Day also unlocks its featured Mega.
const SUPER_MAX_FROM = { 'Mega Sableye': '2026-11-01' };
const megaKey = (name) => name.replace(/\s*\(.*\)$/, '').replace(/^Super\s+/i, '');
// {move, from: 'YYYY-MM-DD' or '', state: 'yes' | 'during' | 'later' | 'no'} for the event's time (or now).
function superMaxInfo(p, ev) {
  const key = megaKey(p.name);
  const move = SUPER_MAX[key] || '';
  let from = '';
  if (!move) {
    const days = [SUPER_MAX_FROM[key], ...data.events.filter((e) => /super mega raid day/i.test(e.title)
      && (e.pokemon || []).some((q) => megaKey(q.name) === key)).map((e) => homeDay(evRange(e)[0]))].filter(Boolean).sort();
    from = days[0] || '';
  }
  if (move) return { move, from, state: 'yes' };
  if (!from) return { move, from, state: 'no' };
  const [s, e] = ev ? evRange(ev) : [Date.now(), Date.now() + 1];
  const t = dayStart(from);
  return { move, from, state: t <= s ? 'yes' : t < e ? 'during' : 'later' };
}

// Hundo (15/15/15) catch CP at level 20, and level 25 when weather boosted.
function hundo(p) {
  if (!RAID_ACTS.has(p.act) || !window.POGO_CPM) return null;
  const e = entryOf(p);
  if (!e || !e.forms.length) return null;
  const form = formOf(p, e);
  const [, a, d, s] = form;
  const cp = (cpm) => Math.max(10, Math.floor((a + 15) * Math.sqrt(d + 15) * Math.sqrt(s + 15) * cpm * cpm / 10));
  return { form: form[0], cp20: cp(window.POGO_CPM[20]), cp25: MAX_ACTS.has(p.act) ? null : cp(window.POGO_CPM[25]) };
}
// Icons: a chain of Leek Duck CDN candidates, tried in order until one loads:
//   1. the Pokémon's own icon (from Leek Duck);
//   2. the icon the same name has in any scraped event (e.g. a target "Gigantamax Duraludon");
//   3. the form sprite pm<dex>.f<FORM>.icon.png ("Zamazenta (Crowned Shield)" -> fCROWNED_SHIELD), from Leek Duck,
//      then from PokeMiners' copy of the game assets (same names, CORS-open);
//   4. the base species sprite pm<dex>.icon.png, then the older pokemon_icon_<dex>_00.png.
// Brand-new forms (e.g. Gigantamax Duraludon in 2026) may have no sprite anywhere yet; step 2 then uses the
// event art Leek Duck published, and step 4 the base species.
const SPRITES = 'https://cdn.leekduck.com/assets/img/pokemon_icons/';
const POGO_ASSETS = 'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/Pokemon/Addressable%20Assets/';
const FORM_PREFIX = { mega: 'MEGA', primal: 'PRIMAL', gigantamax: 'GIGANTAMAX', alolan: 'ALOLA', galarian: 'GALARIAN', hisuian: 'HISUIAN', paldean: 'PALDEA' };
let knownIcons = null;
let knownFor = null;
function knownIcon(name) {
  if (knownFor !== data) {
    knownFor = data;
    knownIcons = new Map();
    for (const ev of data.events) for (const q of ev.pokemon || []) if (q.icon && !knownIcons.has(q.name.toLowerCase())) knownIcons.set(q.name.toLowerCase(), q.icon);
  }
  return knownIcons.get(String(name).toLowerCase());
}
function cdnIcons(p) {
  const list = [];
  if (p.icon) list.push(p.icon);
  const known = knownIcon(p.name);
  if (known) list.push(known);
  const dex = p.dex || lookup(p.name)?.dex;
  if (dex) {
    const form = [];
    const prefix = FORM_PREFIX[(/^(\w+)\s/.exec(p.name)?.[1] || '').toLowerCase()];
    if (prefix) form.push(prefix + (prefix === 'MEGA' && /\s[XY]$/.test(p.name) ? `_${p.name.slice(-1)}` : ''));
    const paren = /\(([^)]*)\)/.exec(p.name)?.[1];
    if (paren && !paren.includes(',')) form.push(paren.replace(/\s+(formes?|forms?|cloak|style|mode|size)$/i, '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'));
    if (form.length) list.push(`${SPRITES}pm${dex}.f${form.join('_')}.icon.png`, `${POGO_ASSETS}pm${dex}.f${form.join('_')}.icon.png`);
    list.push(`${SPRITES}pm${dex}.icon.png`, `${SPRITES}pokemon_icon_${String(dex).padStart(3, '0')}_00.png`);
  }
  return [...new Set(list)];
}
// Same rule as lib/iconfile.js: the static site ships icons/<file>, built by tools/build_site.js.
const iconFile = (url) => url.replace(/^https:\/\/cdn\.leekduck\.com\//, '').replace(/[^\w.-]+/g, '_').slice(-180);
// Where the page loads an icon from: on the static site its own copy first, then the source itself (for icons
// the site doesn't ship, e.g. a Pokémon a visitor added); locally, Leek Duck icons via the server's caching
// proxy, PokeMiners ones directly (they allow cropping).
const viaPage = (u) => (STATIC ? [`icons/${iconFile(u)}`, u]
  : u.startsWith(POGO_ASSETS) ? [u] : [`${API}/icon?u=${encodeURIComponent(u)}`]);
const iconUrls = (p) => cdnIcons(p).flatMap(viaPage);
const iconUrl = (p) => iconUrls(p)[0] || '';

// ---------- time zones ----------
const pad = (n) => String(n).padStart(2, '0');
const HAS_ZONE = /([zZ]|[+-]\d\d:?\d\d)$/;
// Building an Intl.DateTimeFormat is slow and a month view converts thousands of times: keep one per
// zone (and per display format), and cache offsets per zone and hour.
const ZONE_FMT = new Map();
const OFFSETS = new Map();
function zoneOffsetMs(tz, utcMs) {
  const key = `${tz}|${Math.floor(utcMs / 1800e3)}`;
  if (OFFSETS.has(key)) return OFFSETS.get(key);
  if (!ZONE_FMT.has(tz)) {
    ZONE_FMT.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }
  const parts = Object.fromEntries(ZONE_FMT.get(tz).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const off = Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - utcMs;
  // Zone offsets only change on UTC half-hour boundaries, so one value holds for the whole half hour.
  OFFSETS.set(key, off);
  return off;
}
// A zone-less "YYYY-MM-DDTHH:MM[:SS]" read as wall-clock time in `tz`.
function wallToUtc(s, tz) {
  const [d, tm = '00:00'] = s.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, se = 0] = tm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi, se);
  let utc = guess - zoneOffsetMs(tz, guess);
  utc = guess - zoneOffsetMs(tz, utc); // second pass settles DST edges
  return utc;
}
function utcToWall(ms, tz) {
  const w = new Date(ms + zoneOffsetMs(tz, ms));
  return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}T${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
}
function cityOf(ev) {
  if (ev.tz) return CITIES.find(([, z]) => z === ev.tz) ? { name: CITIES.find(([, z]) => z === ev.tz)[0], tz: ev.tz } : { name: ev.tz, tz: ev.tz };
  if (/\bglobal\b/i.test(ev.title || '')) return null;
  const hit = CITIES.find(([c]) => new RegExp(`\\b${c}\\b`, 'i').test(ev.title || ''));
  return hit ? { name: hit[0], tz: hit[1] } : null;
}
const zoneOf = (ev) => cityOf(ev)?.tz || HOME.tz;
const isOverseas = (ev) => zoneOf(ev) !== HOME.tz;
const evTime = (ev, s) => (!s ? NaN : HAS_ZONE.test(s) ? Date.parse(s) : wallToUtc(s, zoneOf(ev)));

// ---------- dates (calendar days are SGT days) ----------
const homeDay = (ms) => utcToWall(ms, HOME.tz).slice(0, 10);
const dayStart = (day) => wallToUtc(`${day}T00:00`, HOME.tz);
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10); };
const weekday = (day) => { const [y, m, d] = day.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }; // Mon = 0
const RANGES = new WeakMap(); // event -> {key, range}; recomputed when its times, title or zone change
function evRange(ev) {
  const key = `${ev.start}|${ev.end}|${ev.tz}|${ev.title}`;
  const hit = RANGES.get(ev);
  if (hit && hit.key === key) return hit.range;
  const s = evTime(ev, ev.start);
  let e = evTime(ev, ev.end);
  if (Number.isNaN(e) || e < s) e = s + 3600e3;
  RANGES.set(ev, { key, range: [s, e] });
  return [s, e];
}
function onDay(ev, day) {
  const [s, e] = evRange(ev);
  const d0 = dayStart(day);
  return s < dayStart(addDays(day, 1)) && e > d0;
}
const spanDays = (ev) => { const [s, e] = evRange(ev); return (e - s) / 86400e3; };
const SHOW_FMT = new Map();
function fmt(ms, opts, tz = HOME.tz) {
  const key = `${tz}|${JSON.stringify(opts)}`;
  if (!SHOW_FMT.has(key)) SHOW_FMT.set(key, new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }));
  return SHOW_FMT.get(key).format(new Date(ms));
}
const fmtTime = (ms, tz) => fmt(ms, { hour: 'numeric', minute: '2-digit' }, tz);
const fmtDate = (ms, tz) => fmt(ms, { day: 'numeric', month: 'short' }, tz);
function fmtRange(ev, tz = HOME.tz) {
  const [s, e] = evRange(ev);
  if (Number.isNaN(s)) return 'No date';
  const sameDay = utcToWall(s, tz).slice(0, 10) === utcToWall(e - 1, tz).slice(0, 10);
  const end = ev.end ? (sameDay ? fmtTime(e, tz) : `${fmtDate(e, tz)} ${fmtTime(e, tz)}`) : '';
  return `${fmtDate(s, tz)} ${fmtTime(s, tz)}${end ? ` – ${end}` : ''}`;
}
function whenText(ev) {
  const sgt = `${fmtRange(ev)} ${HOME.label}`;
  const c = cityOf(ev);
  return c && c.tz !== HOME.tz ? `${sgt} (${fmtRange(ev, c.tz)} ${c.name} time)` : sgt;
}
// Editor inputs show times in the event's own zone (city time for overseas events).
function toInput(ev, s) {
  if (!s) return '';
  return HAS_ZONE.test(s) ? utcToWall(Date.parse(s), zoneOf(ev)) : s.slice(0, 16);
}
function ago(ms) {
  if (!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

// ---------- tiers ----------
function autoTier(ev) {
  const title = (ev.title || '').toLowerCase();
  const span = spanDays(ev);
  if (SUPER_TYPES.test(ev.type) || /go fest|go tour|wild area/.test(title)) return 'super';
  if (MAJOR_TYPES.test(ev.type) || /raid day|max battle day|hatch day|research day/.test(title)) return 'major';
  if (ev.type === 'raid-battles' || (span > 1.5 && (ev.pokemon || []).some((p) => RAID_ACTS.has(p.act)) && ev.type !== 'event')) return 'weekly';
  return 'minor';
}
const tierOf = (ev) => ev.tier || autoTier(ev);

// ---------- backends ----------
// Owner mode (served by server.js, or opened from disk): everything goes through the server's API.
// Static mode (e.g. GitHub Pages): events.json (Leek Duck snapshot) + public.json (the owner's published
// edits), with the visitor's own changes kept in localStorage (MINE_KEY) and merged on top, in memory only.
async function api(method, path, body) {
  // The server only accepts JSON writes, so a write without a body still sends {}.
  const write = method !== 'GET';
  const res = await fetch(API + path, {
    method,
    headers: write ? { 'Content-Type': 'application/json' } : {},
    body: write ? JSON.stringify(body || {}) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText}`);
  return json;
}
const serverBackend = {
  load: () => api('GET', '/api/events'),
  addEvent: (body) => api('POST', '/api/events', body),
  updateEvent: (id, body) => api('PUT', `/api/events/${id}`, body),
  revert: (id) => api('DELETE', `/api/events/${id}`),
  setDay: (day, body) => api('PUT', `/api/days/${day}`, body),
};

const FROM_LD = ['title', 'type', 'start', 'end', 'url', 'pokemon']; // fields an edit can override
const USER_FIELDS = ['note', 'hidden', 'tier', 'tz', 'starred', 'hosts'];
const isSet = (v) => (Array.isArray(v) ? v.length > 0 : !!v);
// Stars on Pokémon the user didn't add live in the event's `starred` keys, so the list itself stays Leek Duck's.
const starKey = (p) => `${p.name}|${p.act}`;
function markStars(ev) {
  if (!ev?.pokemon) return ev;
  const keys = new Set(ev.starred || []);
  ev.pokemon = ev.pokemon.map((p) => (p.mine ? p : keys.has(starKey(p)) ? { ...p, star: true } : (({ star: _s, ...q }) => q)(p)));
  return ev;
}
const markAllStars = (d) => { for (const ev of d.events || []) markStars(ev); return d; };
const emptyLayer = () => ({ events: {}, days: {} });
const clone = (x) => JSON.parse(JSON.stringify(x));
// One layer of edits over a map of events: a user event (source 'user') goes in whole, a Leek Duck one
// is a patch of fields; `edited` is worked out again against the Leek Duck copy.
function applyLayer(events, days, layer, mark) {
  for (const [id, patch] of Object.entries(layer.events || {})) {
    if (patch.deleted) { delete events[id]; continue; }
    const base = events[id];
    if (!base) { if (patch.source === 'user') events[id] = { ...clone(patch), id, [mark]: true }; continue; }
    const ev = { ...base, ...clone(patch), id, [mark]: true };
    if (ev.ld) ev.edited = FROM_LD.filter((f) => JSON.stringify(ev[f]) !== JSON.stringify(ev.ld[f]));
    events[id] = ev;
  }
  for (const [d, day] of Object.entries(layer.days || {})) {
    if (!day || (!day.rest && !day.note && !(day.pokemon || []).length)) delete days[d];
    else days[d] = { ...clone(day), [mark]: true };
  }
}
const mineLayer = () => ({ ...emptyLayer(), ...(store.get(MINE_KEY) || {}) });
let staticBase = null; // {events: {id: event}, days, generatedAt} after the public layer
const staticBackend = {
  async load() {
    if (!staticBase) {
      const get = async (f) => { const r = await fetch(f, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); };
      const [snap, pub, cf] = await Promise.all([get('events.json'), get('public.json').catch(() => emptyLayer()), get('campfire.json').catch(() => null)]);
      const events = {};
      for (const ld of snap.events || []) {
        events[ld.id] = { ...clone(ld), id: ld.id, source: 'leekduck', ld, edited: [], note: '', hidden: false, tier: '', tz: '' };
      }
      const days = {};
      applyLayer(events, days, pub, 'published');
      staticBase = { events, days, generatedAt: snap.generatedAt || 0, campfire: cf && { ...cf, published: pub.campfire || {} } };
    }
    const events = clone(staticBase.events);
    const days = clone(staticBase.days);
    applyLayer(events, days, mineLayer(), 'local');
    const cf = staticBase.campfire && { ...staticBase.campfire, mine: store.get(CF_MINE_KEY) || {} };
    return { events: Object.values(events), days, lastRefresh: staticBase.generatedAt, lastError: '', static: true, campfire: cf };
  },
  // Writes update the visitor's layer, then return the merged event like the server would.
  async save(fn) { const m = mineLayer(); fn(m); store.set(MINE_KEY, m); return this.load(); },
  async addEvent(body) {
    const id = `l-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const d = await this.save((m) => { m.events[id] = { ...body, id, source: 'user', edited: [], typeLabel: '', image: '' }; });
    return d.events.find((e) => e.id === id);
  },
  async updateEvent(id, body) {
    const cur = (await this.load()).events.find((e) => e.id === id);
    const d = await this.save((m) => {
      m.events[id] = cur?.source === 'user' ? { ...cur, ...body } : { ...(m.events[id] || {}), ...pick(body, [...FROM_LD, ...USER_FIELDS]) };
    });
    return d.events.find((e) => e.id === id);
  },
  async revert(id) {
    const base = staticBase.events[id];
    const d = await this.save((m) => {
      if (base?.source === 'user') m.events[id] = { deleted: true }; // an event the owner published: hide it here
      else delete m.events[id]; // the visitor's own event goes; a Leek Duck one is back to snapshot + published
    });
    return d.events.find((e) => e.id === id) || { deleted: true };
  },
  async setDay(day, body) {
    const { rest = false, note = '', pokemon = [] } = body;
    await this.save((m) => { m.days[day] = { rest, note, pokemon }; });
    return { rest, note, pokemon };
  },
};
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const backend = STATIC ? staticBackend : serverBackend;

async function load() {
  try {
    const fresh = markAllStars(await backend.load());
    if (!STATIC) fresh.campfire = await api('GET', '/api/campfire').catch(() => null);
    if (preview) { ownerData = fresh; data = publicView(fresh); } else data = fresh;
    online = true;
    if (!STATIC) store.set(CACHE_KEY, { savedAt: Date.now(), data: fresh });
  } catch (e) {
    online = false;
    const cached = !STATIC && store.get(CACHE_KEY);
    if (cached) data = cached.data;
    $('offline').hidden = false;
    $('offline').textContent = STATIC ? `Could not load the calendar data: ${e.message}`
      : cached ? `Server offline. Showing the copy saved ${ago(cached.savedAt)}; changes are disabled until it is back. Start it with start.bat.`
      : 'Server offline and nothing saved yet. Start it with start.bat, then reload.';
  }
  if (online) $('offline').hidden = true;
  render();
  if (data.refreshing || data.campfire?.refreshing) setTimeout(load, 4000);
}

// ---------- export / import of "my changes" ----------
// Same shape as public.json, so a visitor's suggestions can be shared, and imported by the owner or anyone.
// The file carries the author's name (typed in the Export dialog, not verified); Import tags what it adds
// with `from`, shown as a "from …" tag and in tooltips.
const AUTHOR_KEY = 'pogoCalendarAuthor';
// Owner mode: the layer of all the owner's changes, or (`publicOnly`) just the ones ticked public.
function ownerLayer(publicOnly) {
  const layer = emptyLayer();
  for (const ev of (ownerData || data).events) {
    // Meetups are published by default, even on a Leek Duck event that isn't public (as Store.publicSnapshot()).
    if (publicOnly && !ev.public) {
      if (ev.ld && ev.hosts?.length) layer.events[ev.id] = { edited: [], hosts: ev.hosts.map(({ going: _g, ...h }) => h), meetupsOnly: true };
      continue;
    }
    if (ev.source === 'user') layer.events[ev.id] = pick(ev, ['id', 'source', 'title', 'type', 'start', 'end', 'url', 'pokemon', 'from', ...USER_FIELDS]);
    else if (ev.edited?.length || USER_FIELDS.some((f) => isSet(ev[f]))) layer.events[ev.id] = pick(ev, ['edited', ...ev.edited, ...USER_FIELDS]);
    // Whether the owner attends a meetup stays private.
    const out = layer.events[ev.id];
    if (publicOnly && out?.hosts) out.hosts = out.hosts.map(({ going: _g, ...h }) => h);
  }
  for (const [d, day] of Object.entries((ownerData || data).days)) {
    if (!publicOnly || day.public) layer.days[d] = pick(day, ['rest', 'note', 'pokemon']);
  }
  return layer;
}
function openExport(scope = 'all') {
  $('expName').value = store.get(AUTHOR_KEY) || '';
  $('expScopeRow').hidden = STATIC;
  $('expScope').value = scope;
  $('expDlg').showModal();
}
function exportChanges() {
  const author = $('expName').value.trim().slice(0, 40);
  store.set(AUTHOR_KEY, author);
  const layer = STATIC ? mineLayer() : ownerLayer($('expScope').value === 'public');
  const text = JSON.stringify({ kind: 'pogo-calendar-changes', author, exportedAt: new Date().toISOString(), ...layer }, null, 1);
  const n = Object.keys(layer.events).length + Object.keys(layer.days).length;
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })),
    download: `pogo-calendar-${author ? `${author.replace(/[^\w-]+/g, '_')}-` : ''}${homeDay(Date.now())}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  $('expDlg').close();
  $('status').textContent = `Exported ${n} changes${author ? ` as ${author}` : ''}.`;
}
async function importChanges(file) {
  try {
    const layer = JSON.parse(await file.text());
    if (!layer || typeof layer !== 'object' || (!layer.events && !layer.days)) throw new Error('not a PoGo Calendar changes file');
    const from = String(layer.author || '').trim().slice(0, 40);
    const tag = (p) => ({ ...p, mine: true, ...(from ? { from } : {}) });
    const merge = (cur, add) => {
      const have = new Set((cur || []).map((p) => `${p.name}|${p.act}`));
      return [...(cur || []), ...(add || []).filter((p) => !have.has(`${p.name}|${p.act}`)).map(tag)];
    };
    let n = 0;
    const byId = new Map(data.events.map((e) => [e.id, e]));
    for (const [id, patch] of Object.entries(layer.events || {})) {
      if (patch.deleted) continue;
      if (patch.source === 'user') {
        await backend.addEvent({ ...pick(patch, ['title', 'type', 'start', 'end', 'url', ...USER_FIELDS]),
          pokemon: (patch.pokemon || []).map(tag), from: from || patch.from || '' });
        n++;
      } else if (byId.has(id)) {
        // Their Pokémon are added to the event's list; other edited fields replace ours.
        const body = pick(patch, [...FROM_LD.filter((f) => f !== 'pokemon'), ...USER_FIELDS]);
        if (patch.pokemon) body.pokemon = merge(byId.get(id).pokemon, patch.pokemon);
        if (patch.note && from) body.note = [byId.get(id).note, `${from}: ${patch.note}`].filter(Boolean).join('\n');
        await backend.updateEvent(id, body);
        n++;
      }
    }
    for (const [d, day] of Object.entries(layer.days || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const cur = data.days[d] || { rest: false, note: '', pokemon: [] };
      const note = day.note ? (from ? `${from}: ${day.note}` : day.note) : '';
      await backend.setDay(d, { ...cur, rest: cur.rest || !!day.rest, note: [cur.note, note].filter(Boolean).join('\n'),
        pokemon: merge(cur.pokemon, day.pokemon) });
      n++;
    }
    await load();
    $('status').textContent = `Imported ${n} changes from ${from || file.name}.`;
  } catch (e) {
    $('status').textContent = `Could not import ${file.name}: ${e.message}`;
  }
}

// ---------- owner: what's public, and the public preview ----------
let preview = false;
let ownerData = null; // the owner's own data while the preview shows the public view
const canEdit = () => online && !preview;
// What visitors see: the Leek Duck copies, plus only what is ticked public (same merge as the static site).
function publicView(d) {
  const events = {};
  for (const ev of d.events) if (ev.ld) events[ev.id] = { ...clone(ev.ld), id: ev.id, source: 'leekduck', ld: ev.ld, edited: [], note: '', hidden: false, tier: '', tz: '' };
  const days = {};
  applyLayer(events, days, ownerLayer(true), 'published');
  return markAllStars({ ...d, events: Object.values(events), days });
}
function setPreview(on) {
  if (on === preview) return;
  if (on) { ownerData = data; data = publicView(ownerData); } else { data = ownerData; ownerData = null; }
  preview = on;
  $('previewBar').hidden = !on;
  $('pubDlg').close();
  render();
}
async function openPublic() {
  const d = ownerData || data;
  const evs = d.events.filter((e) => e.public).sort((a, b) => evRange(a)[0] - evRange(b)[0]);
  const days = Object.entries(d.days).filter(([, x]) => x.public).sort(([a], [b]) => a.localeCompare(b));
  const unpublic = (fn) => async () => { await fn(); await load(); openPublic(); };
  $('pubEvents').replaceChildren(...(evs.length ? evs.map((ev) => el('div', { class: 'pub-row' },
    el('div', {}, el('b', { text: ev.title }), el('div', { class: 'what', text: `${fmtRange(ev)} · ${ev.source === 'user' ? 'your event'
      : ev.edited?.length ? `your changes: ${ev.edited.join(', ')}` : 'Leek Duck event'}${ev.note ? ' · note' : ''}${ev.tier ? ` · shown as ${ev.tier}` : ''}` })),
    el('button', { class: 'btn', text: 'Make private', onclick: unpublic(() => backend.updateEvent(ev.id, { public: false })) })))
    : [el('p', { class: 'muted', text: 'No events are public.' })]),
    // Published by default, whatever the ticks: meetups (without attending) and Campfire meetup targets.
    ...(() => {
      const meetEvs = d.events.filter((e) => !e.public && e.ld && e.hosts?.length).map((e) => e.title);
      const cfTargets = Object.values(d.campfire?.mine || {}).filter((m) => m.pokemon?.length).length;
      const parts = [meetEvs.length && `meetups on ${meetEvs.join(', ')}`, cfTargets && `your targets on ${cfTargets} Campfire meetup${cfTargets > 1 ? 's' : ''}`].filter(Boolean);
      return parts.length ? [el('p', { class: 'muted', text: `Also published (meetups are always public; attending isn't): ${parts.join('; ')}.` })] : [];
    })());
  $('pubDays').replaceChildren(...(days.length ? days.map(([k, x]) => el('div', { class: 'pub-row' },
    el('div', {}, el('b', { text: fmt(dayStart(k), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) }),
      el('div', { class: 'what', text: [x.rest && 'rest day', x.note && `note: ${x.note}`,
      (x.pokemon || []).length && `targets: ${x.pokemon.map((p) => p.name).join(', ')}`].filter(Boolean).join(' · ') })),
    el('button', { class: 'btn', text: 'Make private', onclick: unpublic(() => backend.setDay(k, { ...x, public: false })) })))
    : [el('p', { class: 'muted', text: 'No days are public.' })]));
  $('pubStatus').textContent = 'Checking…';
  if (!$('pubDlg').open) $('pubDlg').showModal();
  try {
    const r = await api('GET', '/api/public');
    $('pubStatus').replaceChildren(r.upToDate
      ? el('span', { class: 'pub-ok', text: `public/public.json is up to date (published ${new Date(r.publishedAt).toLocaleString()}).` })
      : el('span', { class: 'pub-warn', text: r.publishedAt ? 'You have changes that are not published yet: press Publish.' : 'Nothing published yet.' }),
      r.dropping?.length ? el('div', { class: 'pub-warn', text: `Publish will remove from the public site: ${r.dropping.join(', ')}.` }) : '');
  } catch (e) { $('pubStatus').textContent = `Could not check: ${e.message}`; }
}

// ---------- rendering helpers ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
}
function pin(act) {
  const a = ACTIVITIES[act] || ACTIVITIES.event;
  return el('span', { class: 'pin', style: `--pin:${a.color}`, title: a.label, text: a.glyph });
}
const SVGNS = 'http://www.w3.org/2000/svg';
function sparkle() {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('class', 'sparkle');
  svg.setAttribute('aria-label', 'Shiny available');
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', 'M6 0.5 L7.3 4.7 L11.5 6 L7.3 7.3 L6 11.5 L4.7 7.3 L0.5 6 L4.7 4.7 Z');
  svg.append(path);
  return svg;
}
// Leek Duck icons carry lots of transparent padding (most for small species such as Morelull), so each
// icon is cropped to its visible pixels once and reused as a data URL.
const CROPPED = new Map(); // icon url -> Promise<data url | url (loads, but can't be cropped) | null (missing)>
const TRIMMED = new Map(); // candidate chain -> Promise<first that loads, or ''>
function trimmed(urls) {
  const key = urls.join('|');
  if (!TRIMMED.has(key)) {
    TRIMMED.set(key, (async () => {
      for (const u of urls) { const r = await cropOne(u); if (r) return r; }
      return '';
    })());
  }
  return TRIMMED.get(key);
}
function cropOne(src) {
  if (!CROPPED.has(src)) {
    CROPPED.set(src, new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onerror = () => {
        // A CORS refusal looks like an error too: try once without CORS, uncropped.
        const plain = new Image();
        plain.onload = () => resolve(src);
        plain.onerror = () => resolve(null);
        plain.src = src;
      };
      im.onload = () => {
        try {
          const w = im.naturalWidth, h = im.naturalHeight;
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const g = c.getContext('2d');
          g.drawImage(im, 0, 0);
          const px = g.getImageData(0, 0, w, h).data;
          let x0 = w, y0 = h, x1 = -1, y1 = -1;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (px[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          if (x1 < 0) return resolve(src);
          // Square crop around the visible part, so the icon keeps its proportions.
          const side = Math.max(x1 - x0, y1 - y0) + 3;
          const out = document.createElement('canvas');
          out.width = out.height = side;
          out.getContext('2d').drawImage(c, (side - (x1 - x0)) / 2 - x0, (side - (y1 - y0)) / 2 - y0);
          resolve(out.toDataURL());
        } catch { resolve(src); } // canvas refused (e.g. no CORS): keep the padded icon
      };
      im.src = src;
    }));
  }
  return CROPPED.get(src);
}
// Padlock: teal when the lock is to the home region (catchable here), orange when elsewhere.
function lockPin(region) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 14');
  svg.setAttribute('class', `lock${HOME_REGIONS.has(region) ? ' home' : ''}`);
  svg.setAttribute('aria-label', `Region-locked: ${REGIONS[region].label}`);
  const shackle = document.createElementNS(SVGNS, 'path');
  shackle.setAttribute('d', 'M3 6.5V4.2a3 3 0 0 1 6 0v2.3');
  shackle.setAttribute('class', 'shackle');
  const body = document.createElementNS(SVGNS, 'rect');
  body.setAttribute('x', '1'); body.setAttribute('y', '6'); body.setAttribute('width', '10'); body.setAttribute('height', '7.5'); body.setAttribute('rx', '1.6');
  svg.append(shackle, body);
  return svg;
}
// Location Background mark: a wireframe globe (left edge). Special Backgrounds keep the "BG" tag.
function globePin(place) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('class', 'globe');
  svg.setAttribute('aria-label', `Location Background: ${place}`);
  for (const d of ['M6 1a5 5 0 1 0 0.001 0Z', 'M6 1c-2.6 2.6-2.6 7.4 0 10M6 1c2.6 2.6 2.6 7.4 0 10', 'M1 6h10M1.8 3.5h8.4M1.8 8.5h8.4']) {
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
// Meetup mark: a map pin, beside the date of a day with a trainer meetup.
function meetPin() {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 14');
  svg.setAttribute('class', 'meetpin');
  svg.setAttribute('aria-label', 'Trainer meetup');
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', 'M6 13.5C6 13.5 1 8.6 1 5.2a5 5 0 0 1 10 0C11 8.6 6 13.5 6 13.5ZM6 7.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}
// A meetup's days: start day through end day (an end at midnight doesn't count, at most 14 days);
// no start: its event's first day.
function onMeetDay(h, ev, day) {
  if (!h.start) return homeDay(evRange(ev)[0]) === day;
  const first = h.start.slice(0, 10);
  const end = h.end > h.start ? h.end : '';
  const last = !end ? first : end.slice(11) === '00:00' ? addDays(end.slice(0, 10), -1) : end.slice(0, 10);
  return day >= first && day <= (last < first ? first : last) && day <= addDays(first, 13);
}
const dayMeetups = (day) => [...visibleEvents().flatMap((ev) => (ev.hosts || []).filter((h) => onMeetDay(h, ev, day)).map((h) => ({ h, ev }))),
  ...CF.filter(({ h, ev }) => onMeetDay(h, ev, day))];

// ---------- Campfire meetups (owner mode only; fetched by the server, lib/campfire.js) ----------
// Each is shown like a meetup ({h, ev}): `h.campfire` holds the Campfire record, `h.going` / `h.pokemon` the
// user's own marks (data.campfire.mine, private). `ev` is the calendar event of the same name that day, else a
// stand-in named after Campfire's game event.
let CF = []; // rebuilt by render()
// Order of Campfire meetups in lists: attended first, then these hosts (display names, any case), then by start.
const CF_PRIORITY_HOSTS = ['Sreebha'];
const cfPriority = (h) => CF_PRIORITY_HOSTS.some((n) => n.toLowerCase() === String(h.host).toLowerCase());
const cfOrder = (a, b) => !!b.h.going - !!a.h.going || cfPriority(b.h) - cfPriority(a.h) || a.h.start.localeCompare(b.h.start);
const cfNorm = (s) => String(s || '').toLowerCase().replace(/\s+day\s*\d+\s*$/, '').replace(/[^a-z0-9]+/g, '');
function buildCampfire() {
  const cf = data.campfire;
  if (!prefs.campfire || !cf?.meetups) return [];
  return cf.meetups.map((m) => {
    // Targets: the viewer's own, else the owner's published ones (public site); the public preview shows the
    // owner's targets without attending, as published.
    const own = cf.mine?.[m.id];
    const mine = preview ? { pokemon: own?.pokemon } : own || { pokemon: cf.published?.[m.id]?.pokemon };
    const n = cfNorm(m.liveEvent);
    const same = (e) => { const t = cfNorm(e.title); return t.length > 3 && n.length > 3 && (t === n || t.includes(n) || n.includes(t)); };
    const ev = visibleEvents().find((e) => onDay(e, m.start.slice(0, 10)) && same(e))
      || { id: `cf-${m.id}`, title: m.liveEvent || m.name, start: m.start, end: m.end, tz: '', pokemon: [], campfireOnly: true };
    const h = { host: m.host, venue: m.address.replace(/,\s*Singapore$/, ''), start: m.start, end: m.end,
      map: `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`, going: !!mine.going, pokemon: mine.pokemon || [], campfire: m };
    return { h, ev };
  });
}
const debutBadge = (p) => el('span', { class: `newpin${p.debut === 'shiny' ? ' shiny' : ''}`, text: 'NEW' });
// When a local-time event window is live across a region, as SGT times per sample place.
function regionWindows(ev, region) {
  const R = REGIONS[region];
  if (!R || !ev || !ev.start || HAS_ZONE.test(ev.start)) return null; // absolute times are the same everywhere
  const rows = R.zones.map(([place, tz]) => {
    const s = wallToUtc(ev.start, tz);
    const e = ev.end && !HAS_ZONE.test(ev.end) ? wallToUtc(ev.end, tz) : s + 3600e3;
    return { place, s, e };
  });
  return { rows, s: Math.min(...rows.map((r) => r.s)), e: Math.max(...rows.map((r) => r.e)) };
}
const fmtDayTime = (ms) => fmt(ms, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const TIP = new WeakMap(); // icon element -> {p, ev}
function monIcon(p, ev, size = '') {
  const urls = iconUrls(p);
  const noimg = () => el('span', { class: 'noimg', text: p.name });
  const img = urls.length ? el('img', { alt: p.name, onerror: (e) => e.target.replaceWith(noimg()) }) : noimg();
  if (urls.length) trimmed(urls).then((u) => { if (u) img.src = u; else img.replaceWith(noimg()); });
  const n = el('span', { class: ['mon', size, p.star && 'star', p.mine && 'mine'].filter(Boolean).join(' '), 'aria-label': p.name },
    img, pin(p.act), p.shiny ? sparkle() : null, p.bg ? el('span', { class: 'bgpin', text: 'BG' }) : null,
    REGIONS[p.region] ? lockPin(p.region) : null, p.lbg ? globePin(p.lbg) : null, p.debut ? debutBadge(p) : null);
  TIP.set(n, { p, ev });
  return n;
}
const visibleEvents = () => data.events.filter((e) => !e.hidden);
// An event's Pokémon as shown everywhere: one listed both in a feature blurb ('event', e.g. a debut section) and
// with a real activity (e.g. wild spawn) appears once, as the latter.
function eventPokemon(ev) {
  const list = ev.pokemon || [];
  const acted = new Set(list.filter((p) => p.act !== 'event').map((p) => p.name));
  return list.filter((p) => !(p.act === 'event' && acted.has(p.name)));
}
// Order in event boxes and bar tooltips: the user's own, raid bosses, debuts, valuable ones.
const monRank = (p) => (p.star ? 16 : 0) + (p.mine ? 8 : 0) + (RAID_ACTS.has(p.act) ? 4 : 0) + (p.debut ? 2 : 0) + (isValuable(p) ? 1 : 0);
// The user's own events come before Leek Duck ones of the same tier (cell icons and day panel).
const mineFirst = (a, b) => (b.source === 'user') - (a.source === 'user');
const monKey = (p) => `${(p.dex || p.name).toString().toLowerCase()}|${p.act}`;
const shownAct = (p) => !prefs.off.includes(p.act);

// What one day holds: which events in which tier, and the icons for the cell.
function dayInfo(day) {
  const evs = visibleEvents().filter((ev) => onDay(ev, day)).sort(mineFirst);
  const by = { super: [], major: [], weekly: [], minor: [] };
  for (const ev of evs) by[tierOf(ev)].push(ev);
  const seen = new Set();
  const take = (list, out, p, ev) => { const k = monKey(p); if (seen.has(k) || !shownAct(p)) return; seen.add(k); out.push({ p, ev }); };

  const main = [];
  // A day target that is also an event's Pokémon that day takes that event, so its tooltip shows it.
  const evOf = (p) => evs.find((ev) => eventPokemon(ev).some((q) => monKey(q) === monKey(p))) || null;
  const dayTargets = data.days[day]?.pokemon || [];
  // Targets of that day's meetups (`meetup` names the meetup in the tooltip).
  const meetTargets = dayMeetups(day).flatMap(({ h, ev }) => (h.pokemon || []).map((p) => ({ p: { ...p, mine: true, meetup: h }, ev })));
  const short = (ev) => spanDays(ev) <= SEASON_DAYS;
  // Starred Pokémon come first, whichever event lists them: meetup targets, day targets, then events.
  for (const { p, ev } of meetTargets) if (p.star) take(null, main, p, ev);
  for (const p of dayTargets) if (p.star) take(null, main, p, evOf(p));
  for (const ev of evs) if (short(ev)) for (const p of eventPokemon(ev)) if (p.star) take(null, main, p, ev);
  for (const { p, ev } of meetTargets) take(null, main, p, ev);
  for (const p of dayTargets) take(null, main, p, evOf(p));
  // Super and overseas events list dozens of spawns: only raid bosses, valuable and user-added ones go on the cell.
  for (const ev of [...by.super, ...by.major]) {
    if (spanDays(ev) > SEASON_DAYS) continue;
    const big = by.super.includes(ev) || isOverseas(ev);
    const mons = eventPokemon(ev).filter((p) => !big || p.mine || p.star || isValuable(p) || RAID_ACTS.has(p.act) || p.act === 'cd' || p.debut)
      .sort((a, b) => !!b.star - !!a.star || !!b.mine - !!a.mine || !!b.debut - !!a.debut || isValuable(b) - isValuable(a));
    for (const p of mons) take(null, main, p, ev);
  }
  // Minor events stay off the cell, except Pokémon the user starred or added.
  let minorTargets = 0;
  for (const ev of by.minor) {
    if (spanDays(ev) > SEASON_DAYS) continue;
    for (const p of eventPokemon(ev)) if (p.star || p.mine) { take(null, main, p, ev); minorTargets++; }
  }
  const corner = [];
  for (const ev of by.weekly) for (const p of ev.pokemon || []) if (RAID_ACTS.has(p.act) || p.mine || p.star) take(null, corner, p, ev);

  const weeklyStar = corner.some(({ p }) => (p.act === 'shadow' && classOf(p)) || p.star);
  const userDay = data.days[day];
  return {
    evs, by, main, corner,
    super: by.super.filter((ev) => !isOverseas(ev)),
    overseas: [...by.super, ...by.major].filter(isOverseas),
    rest: !!userDay?.rest,
    mundane: !by.super.length && !by.major.length && !weeklyStar && !minorTargets && !meetTargets.length
      && !main.some(({ p }) => p.star) && !(userDay?.pokemon || []).length,
  };
}

// ---------- render ----------
function render() {
  const todayKey = homeDay(Date.now());
  const month = prefs.month || todayKey.slice(0, 7);
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  $('monthTitle').textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  $('bars').checked = prefs.bars;
  $('campfire').checked = prefs.campfire;
  CF = buildCampfire();
  const cf = data.campfire;
  const cfStatus = !cf || cf.off || !cf.fetchedAt ? '' : cf.refreshing ? ' · checking Campfire…'
    : ` · Campfire: ${cf.meetups.length} meetups, checked ${ago(cf.fetchedAt)}${cf.error ? `, last check failed: ${cf.error.replace(/^\S+: /, '')}` : ''}`;
  $('status').textContent = STATIC ? `Times in ${HOME.label}. Leek Duck snapshot from ${ago(data.lastRefresh)}${cfStatus}. Your changes are saved in this browser only.`
    : data.refreshing ? 'Checking Leek Duck…'
    : `Times in ${HOME.label}. Leek Duck checked ${ago(data.lastRefresh)}${data.lastError ? ` · last check failed: ${data.lastError.replace(/^\S+: /, '')}` : ''}${cfStatus}`;
  for (const id of ['refresh', 'addEvent', 'dayAddEvent']) $(id).disabled = !canEdit();

  renderLegend();
  renderRunning(first, addDays(first, new Date(Date.UTC(y, m, 0)).getUTCDate()));

  weekBars = prefs.bars ? maxWeekBars() : [];
  const grid = $('grid');
  grid.replaceChildren();
  let day = addDays(first, -weekday(first));
  for (let w = 0; w < 6; w++) {
    if (w > 0 && day.slice(0, 7) !== month) break;
    grid.append(renderWeek(day, month, todayKey));
    day = addDays(day, 7);
  }
  if (selected) renderDay();
}

const MAX_LANES = 4;
// Max Monday's Dynamax Pokémon stays in Max Battles for the rest of the week: a Mon–Sun bar per Max Monday.
let weekBars = []; // set by render()
// Lane order: a legendary Max Monday week bar on top, other bars by start, other Max Monday week bars at the bottom.
const barRank = (ev) => (!ev.of ? 1 : ev.pokemon.some((p) => classOf(p)) ? 0 : 2);
function maxWeekBars() {
  return visibleEvents().filter((ev) => ev.type === 'max-mondays' && (ev.pokemon || []).length).map((ev) => {
    const day = homeDay(evRange(ev)[0]);
    return { ...ev, of: ev, title: `${ev.pokemon.map((p) => p.name).join(', ')}: Dynamax all week`,
      tz: HOME.tz, start: `${day}T00:00`, end: `${addDays(day, 7 - weekday(day))}T00:00` };
  });
}
function renderWeek(monday, month, todayKey) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // Bars: weekly rotations, and multi-day in-game events (type "event") up to SEASON_DAYS long.
  const lanes = [];
  const bars = [];
  if (prefs.bars) {
    const evs = [...visibleEvents().filter((ev) => {
      const t = tierOf(ev);
      const span = spanDays(ev);
      return t === 'weekly' || (t === 'minor' && ev.type === 'event' && !isOverseas(ev) && span > 1.5 && span <= SEASON_DAYS);
    }), ...weekBars].filter((ev) => days.some((d) => onDay(ev, d)))
      .sort((a, b) => barRank(a) - barRank(b) || evRange(a)[0] - evRange(b)[0]);
    // Max Monday week bars always get a lane: other bars leave one free for each week bar still to come.
    let weekLeft = evs.filter((ev) => ev.of).length;
    for (const ev of evs) {
      if (ev.of) weekLeft--;
      const a = days.findIndex((d) => onDay(ev, d));
      let b = a;
      while (b + 1 < 7 && onDay(ev, days[b + 1])) b++;
      let lane = lanes.findIndex((end) => end < a);
      if (lane < 0) { if (lanes.length >= MAX_LANES - weekLeft) continue; lane = lanes.length; lanes.push(-1); }
      lanes[lane] = b;
      bars.push({ ev, a, b, lane });
    }
  }
  const week = el('div', { class: 'week', style: `--lanes:${lanes.length}` });
  days.forEach((d, i) => week.append(renderCell(d, i, month, todayKey)));
  for (const { ev, a, b, lane } of bars) {
    const act = (ev.pokemon || []).find((p) => RAID_ACTS.has(p.act))?.act || TYPE_ACT[ev.type] || 'event';
    const color = tierOf(ev) === 'weekly' || ev.of ? (ACTIVITIES[act] || ACTIVITIES.event).color : 'var(--muted)';
    const startsHere = onDay(ev, days[a]) && homeDay(evRange(ev)[0]) === days[a];
    const btn = el('button', {
      class: `bar${startsHere ? ' starts' : ''}${homeDay(evRange(ev)[1] - 1) === days[b] ? ' ends' : ''}`,
      style: `grid-column:${a + 1} / ${b + 2};grid-row:${lane + 2};--bar:${color}`,
      'aria-label': `${ev.title}, ${barWhen(ev)}`, onclick: () => openEditor(ev.of || ev),
    }, el('span', { text: ev.title }));
    BAR_TIP.set(btn, ev);
    week.append(btn);
  }
  return week;
}

function renderCell(key, col, month, todayKey) {
  const info = dayInfo(key);
  const max = 6;
  const cls = ['cell', col >= 5 && 'weekend', key.slice(0, 7) !== month && 'other', key === todayKey && 'today', key === selected && 'selected',
    info.rest ? 'rest' : info.super.length ? 'super' : info.overseas.length ? 'overseas' : info.mundane && 'mundane'];
  const majors = info.by.major.filter((ev) => !isOverseas(ev));
  const majorNames = majors.map((ev, i) => [i ? ' · ' : '', evTip(el('span', { text: `${fmtTime(evRange(ev)[0])} ${ev.title}` }), ev)]);
  const meets = dayMeetups(key);
  const going = meets.some(({ h }) => h.going);
  const meetMark = meets.length ? el('span', { class: `meet${going ? ' going' : ''}`,
    'aria-label': `${meets.length} trainer meetup${meets.length > 1 ? 's' : ''}${going ? ', attending' : ''}`,
    oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); goingFromPin(key, meets); } }, meetPin(),
    meets.length > 1 ? el('span', { text: meets.length }) : null) : null;
  if (meetMark) MEET_TIP.set(meetMark, meets);
  // Cell icons know their day, so their tooltip lists that day's meetups.
  const cellMon = (p, ev, size) => { const n = monIcon(p, ev, size); TIP.get(n).day = key; return n; };
  return el('button', {
    class: cls.filter(Boolean).join(' '), style: `grid-column:${col + 1}`, 'data-day': key,
    'aria-label': `${key}${info.rest ? ', rest day' : ''}`, onclick: () => (selected ? $('dayClose').click() : openDay(key)),
  },
  el('span', { class: 'date' }, el('span', { class: 'daynum' }, el('span', { text: +key.slice(8) }), meetMark),
    info.rest ? el('span', { class: 'badge', text: 'Rest' }) : null),
  info.super.map((ev) => evTip(el('span', { class: 'supername', text: ev.title }), ev)),
  info.overseas.map((ev) => evTip(el('span', { class: 'overseasname', text: `✈ ${ev.title}` }), ev)),
  el('span', { class: 'mons' }, info.main.slice(0, max).map(({ p, ev }) => cellMon(p, ev)),
    info.main.length > max ? el('span', { class: 'more', text: `+${info.main.length - max}` }) : null),
  majorNames.length ? el('span', { class: 'evcount' }, majorNames.flat()) : null,
  info.corner.length ? el('span', { class: 'corner' }, info.corner.slice(0, 5).map(({ p, ev }) => cellMon(p, ev, 'small'))) : null);
}

function renderLegend() {
  const box = $('legend');
  box.replaceChildren();
  for (const [key, a] of Object.entries(ACTIVITIES)) {
    const off = prefs.off.includes(key);
    box.append(el('button', { class: `pinbtn${off ? ' off' : ''}`, 'aria-pressed': String(!off), onclick: () => {
      prefs.off = off ? prefs.off.filter((k) => k !== key) : [...prefs.off, key];
      savePrefs(); render();
    } }, pin(key), a.label));
  }
}

function renderRunning(first, nextMonth) {
  const m0 = dayStart(first);
  const m1 = dayStart(nextMonth);
  const box = $('runningList');
  box.replaceChildren();
  const long = visibleEvents().filter((ev) => { const [s, e] = evRange(ev); return spanDays(ev) > SEASON_DAYS && s < m1 && e > m0; })
    .sort((a, b) => evRange(a)[0] - evRange(b)[0]);
  $('runningCount').textContent = long.length;
  $('running').hidden = !long.length;
  for (const ev of long) {
    const [s, e] = evRange(ev);
    const stars = (ev.pokemon || []).filter(isValuable);
    box.append(evTip(el('button', { class: 'chip', onclick: () => openEditor(ev) },
      pin(TYPE_ACT[ev.type] || stars[0]?.act || 'event'), el('span', { text: ev.title }),
      el('span', { class: 'when', text: `${fmtDate(s)}–${fmtDate(e)}` }),
      stars.length ? el('span', { class: 'mons' }, stars.slice(0, 4).map((p) => monIcon(p, ev, 'tiny'))) : null), ev));
  }
}

// ---------- rich tooltip ----------
function tipContent({ p, ev, day }) {
  const big = iconUrls(p).length > 0;
  const cls = classOf(p);
  const h = hundo(p);
  const rows = [];
  rows.push(el('div', { class: 'tip-name' }, el('b', { text: p.name }), p.shiny ? el('span', { class: 'tip-shiny', text: '✦ shiny' }) : null));
  rows.push(el('div', { class: 'tip-act' }, pin(p.act), (ACTIVITIES[p.act] || ACTIVITIES.event).label, cls ? ` · ${CLASS_NAME[cls]}` : ''));
  const types = typesOf(p);
  if (types.length) {
    rows.push(el('div', { class: 'tip-types' }, types.map((t) => el('span', { class: `type${LIGHT_TYPES.has(t) ? ' light' : ''}`,
      style: `--type:${TYPE_COLORS[t] || '#888'}`, text: t }))));
  }
  if (tempKey(p).startsWith('MEGA')) {
    const sm = superMaxInfo(p, ev);
    const on = sm.from && fmtDate(dayStart(sm.from));
    rows.push(el('div', { class: `tip-supermax${sm.state === 'yes' || sm.state === 'during' ? ' yes' : ''}`, text: {
      yes: `Can reach Super Max (Mega Level 4)${sm.move ? `: extra Charged Attack ${sm.move}` : on ? `, unlocked from ${on}` : ''}`,
      during: `Super Max (Mega Level 4) unlocks ${on}, during this event`,
      later: `Super Max (Mega Level 4) unlocks ${on}`,
      no: 'Mega Level 4 (Super Max): not available',
    }[sm.state] }));
  }
  const bonus = ev && (ev.bonus || ev.ld?.bonus);
  if (bonus) rows.push(el('div', { class: 'tip-bonus', text: `Bonus: ${bonus}` }));
  if (h) {
    rows.push(el('div', { class: 'tip-cp' }, el('span', { text: 'Hundo catch CP' }),
      el('b', { text: String(h.cp20) }), h.cp25 ? el('span', { class: 'muted', text: `· weather boosted ${h.cp25}` }) : null));
  }
  if (p.debut) rows.push(el('div', { class: 'tip-debut', text: p.debut === 'shiny' ? 'Shiny debut: first time it can be shiny' : 'Pokémon GO debut' }));
  if (p.bg) {
    rows.push(el('div', { class: 'tip-bg', text: ev && isOverseas(ev)
      ? 'Special background mentioned, but usually only for in-person catches, not remote raids'
      : 'Special background available (per Leek Duck)' }));
  }
  if (p.lbg) {
    rows.push(el('div', { class: 'tip-lbg' }, globePin(p.lbg), el('span', { text: `${p.lbg} Location Background: `
      + `${p.lbgTicket ? 'ticket holders only, from' : 'only from'} in-person raids and Max Battles; not for remote participants` })));
  }
  if (REGIONS[p.region]) {
    const R = REGIONS[p.region];
    const home = HOME_REGIONS.has(p.region);
    const w = regionWindows(ev, p.region);
    rows.push(el('div', { class: `tip-region${home ? ' home' : ''}` },
      el('b', { text: `Region-locked: ${R.label}` }),
      el('div', { text: home ? `Available in ${HOME.name}.` : `Not in ${HOME.name}: battle remotely with a host in the region.` }),
      w && !home ? el('div', { text: `Live there ${fmtDayTime(w.s)} – ${fmtDayTime(w.e)} ${HOME.label}:` }) : null,
      w && !home ? el('ul', {}, w.rows.map((r) => el('li', { text: `${r.place}: ${fmtTime(r.s)} – ${fmtTime(r.e)}` }))) : null));
  }
  if (ev) rows.push(el('div', { class: 'tip-ev' }, el('div', { text: ev.title }), el('div', { class: 'muted', text: whenText(ev) }),
    isOverseas(ev) ? el('div', { class: 'tip-remote', text: remoteNote(p, ev) }) : null, day ? null : meetLines(ev)));
  // On a calendar cell: every meetup that day, named by event when it's another one.
  // The user's own meetups and the Campfire ones they attend; other Campfire ones only as a count.
  const allMeets = day ? dayMeetups(day) : [];
  const dayMeets = allMeets.filter(({ h }) => !h.campfire || h.going);
  const cfOthers = allMeets.length - dayMeets.length;
  if (dayMeets.length || cfOthers) {
    rows.push(el('div', { class: 'tip-meet tip-ev' }, dayMeets.map(({ h, ev: e }) => el('div', {}, meetPin(),
      el('span', { text: `${meetText(h)}${e.id === ev?.id || e.title === ev?.title ? '' : ` (${e.title})`}` }))),
      cfOthers ? el('div', { class: 'muted' }, meetPin(), el('span', { text: `${cfOthers} ${dayMeets.length ? 'more ' : ''}Campfire meetup${cfOthers > 1 ? 's' : ''} that day` })) : null));
  }
  if (p.meetup) rows.push(el('div', { class: 'tip-meet' }, el('div', {}, meetPin(), el('span', { text: `Target for the meetup: ${[p.meetup.host, p.meetup.venue].filter(Boolean).join(' @ ')}` }))));
  if (p.from) rows.push(el('div', { class: 'muted', text: `Suggested by ${p.from}` }));
  else if (p.mine) rows.push(el('div', { class: 'muted', text: 'Added by you' })); // a star shows as the rainbow ring, not text
  if (p.comment) rows.push(el('div', { class: 'tip-comment', text: p.comment }));
  const bigImg = big ? el('img', { alt: '' }) : null;
  if (big) trimmed(iconUrls(p)).then((u) => { if (u) bigImg.src = u; else bigImg.remove(); });
  return el('div', { class: 'tip-body' }, bigImg, el('div', { class: 'tip-text' }, rows));
}
function remoteNote(p, ev) {
  const where = cityOf(ev)?.name || 'the event city';
  if (MAX_ACTS.has(p.act)) return `Overseas Max Battle: join remotely with a host in ${where}`;
  if (RAID_ACTS.has(p.act)) return 'Overseas raid: Remote Raid Pass needed';
  return `Overseas: in person in ${where} only`;
}
// Event bar tooltip: the event, its times, its Pokémon (raid bosses and valuable ones first), bonus and note.
const BAR_TIP = new WeakMap(); // bar element -> event (a Max Monday week bar carries the real event in `of`)
const barWhen = (ev) => (ev.of ? `${fmtDate(evRange(ev)[0])} – ${fmtDate(evRange(ev)[1] - 1)} (Mon–Sun)` : whenText(ev));
const TIER_LABEL = { super: 'super major', major: 'major', weekly: 'weekly', minor: 'minor' };
function barTipContent(ev) {
  const real = ev.of || ev;
  // A Max Monday week bar shows its Max Monday icon's tooltip, plus the week it stays in Max Battles.
  if (ev.of) {
    const box = tipContent({ p: real.pokemon[0], ev: real });
    box.querySelector('.tip-text').append(el('div', { class: 'tip-bonus', text: `In Max Battles all week: ${barWhen(ev)}` }));
    return box;
  }
  const act = (ev.pokemon || []).find((p) => RAID_ACTS.has(p.act))?.act || TYPE_ACT[real.type] || 'event';
  const rows = [el('div', { class: 'tip-name' }, pin(act), el('b', { text: ev.title }),
    el('span', { class: 'tag', text: ev.of ? 'Max Battles' : TIER_LABEL[tierOf(real)] }))];
  rows.push(el('div', { class: 'muted', text: barWhen(ev) }));
  if (ev.of) rows.push(el('div', { text: `${real.title}: ${whenText(real)}. Its Dynamax Pokémon stays in Max Battles until Sunday.` }));
  if (isOverseas(real)) rows.push(el('div', { class: 'tip-remote', text: `Overseas: ${cityOf(real)?.name || ''}` }));
  const mons = [...eventPokemon(ev)].sort((a, b) => monRank(b) - monRank(a));
  if (mons.length) {
    rows.push(el('div', { class: 'tipev-mons' }, mons.slice(0, 8).map((p) => el('div', { class: 'tipev-mon' },
      pin(p.act), el('span', { text: `${p.name}${p.shiny ? ' ✦' : ''}` }), p.debut ? debutBadge(p) : null,
      p.lbg ? globePin(p.lbg) : null,
      typesOf(p).map((t) => el('span', { class: `type${LIGHT_TYPES.has(t) ? ' light' : ''}`, style: `--type:${TYPE_COLORS[t] || '#888'}`, text: t })),
      classOf(p) ? el('span', { class: 'muted', text: CLASS_NAME[classOf(p)] }) : null)),
    mons.length > 8 ? el('div', { class: 'muted', text: `+${mons.length - 8} more in the day panel` }) : null));
  }
  const bonus = real.bonus || real.ld?.bonus;
  if (bonus) rows.push(el('div', { class: 'tip-bonus', text: `Bonus: ${bonus}` }));
  if (real.note) rows.push(el('div', { class: 'tip-comment', text: real.note }));
  rows.push(meetLines(real));
  if (real.from) rows.push(el('div', { class: 'muted', text: `Suggested by ${real.from}` }));
  // Big pictures of the top (up to 3) Pokémon on top, as in the Pokémon tooltip.
  const top = mons.slice(0, 3).filter((p) => iconUrls(p).length);
  const pics = top.map((p) => {
    const img = el('img', { alt: p.name, class: top.length > 1 ? 'mid' : '' });
    trimmed(iconUrls(p)).then((u) => { if (u) img.src = u; else img.remove(); });
    return img;
  });
  return el('div', { class: 'tip-bar' }, pics.length ? el('div', { class: 'tipev-pics' }, pics) : null,
    el('div', { class: 'tip-text' }, rows));
}
// Event names on the calendar (super / overseas names, major-event lines, "Running this month" chips): their day-panel box.
const EV_TIP = new WeakMap(); // element -> event
function evTip(node, ev) { node.classList.add('evtip'); EV_TIP.set(node, ev); return node; }
// An event's meetups as tooltip lines (null if none).
function meetLines(ev) {
  if (!(ev.hosts || []).length) return null;
  return el('div', { class: 'tip-meet' }, ev.hosts.map((h) => el('div', {}, meetPin(), el('span', { text: meetText(h) }))));
}
// The cell's meetup mark: that day's meetups, each with its event.
const MEET_TIP = new WeakMap(); // mark -> [{h, ev}]
// The user's own meetups in full; Campfire ones (attending first) one line each, at most CF_TIP_MAX.
const CF_TIP_MAX = 6;
function meetTipContent(list) {
  const own = list.filter(({ h }) => !h.campfire);
  const cf = list.filter(({ h }) => h.campfire).sort(cfOrder);
  return el('div', { class: 'tip-text' }, el('div', { class: 'tip-name' }, el('b', { text: list.length > 1 ? 'Trainer meetups' : 'Trainer meetup' })),
    own.map(({ h, ev }) => el('div', { class: 'tip-meet' }, el('div', {}, meetPin(), el('span', { text: meetText(h) })),
      meetMons(h, ev),
      el('div', { class: 'muted', text: `${ev.title} · ${whenText(ev)}` }))),
    cf.length ? el('div', { class: 'tip-meet tip-cf' }, el('div', { class: 'muted', text: `On Campfire (${cf.length}):` }),
      cf.slice(0, CF_TIP_MAX).map(({ h, ev }) => el('div', { class: 'tip-cfline' }, el('div', {}, meetPin(),
        el('span', { text: `${hostText(h)} · ${h.campfire.going} going${h.going ? ' · ✓ attending' : ''}` })), meetMons(h, ev))),
      cf.length > CF_TIP_MAX ? el('div', { class: 'muted', text: `+${cf.length - CF_TIP_MAX} more in the day panel` }) : null) : null);
}
// A meetup's own targets, starred first (★), with small icons.
function meetMons(h, ev) {
  const list = [...(h.pokemon || [])].sort((a, b) => !!b.star - !!a.star);
  if (!list.length) return null;
  return el('div', { class: 'tip-meetmons' }, list.map((p) => el('span', { class: `tip-meetmon${p.star ? ' starred' : ''}` },
    monIcon({ ...p, mine: true }, ev), el('span', { text: `${p.star ? '★ ' : ''}${p.name}` }))));
}
function showTip(target, x, y) {
  const info = TIP.get(target);
  const barEv = !info && BAR_TIP.get(target);
  const nameEv = !info && !barEv && EV_TIP.get(target);
  const meets = !info && !barEv && !nameEv && MEET_TIP.get(target);
  if (!info && !barEv && !nameEv && !meets) return;
  const tip = $('tip');
  tip.classList.toggle('tip-card', !!nameEv);
  tip.replaceChildren(info ? tipContent(info) : barEv ? barTipContent(barEv) : nameEv ? evCard(nameEv, true) : meetTipContent(meets));
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const left = Math.min(x + 14, window.innerWidth - r.width - 8);
  const top = y + 16 + r.height > window.innerHeight ? y - r.height - 12 : y + 16;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
document.addEventListener('mouseover', (e) => {
  const m = e.target.closest?.('.mon, .bar, .evtip, .meet');
  if (m) showTip(m, e.clientX, e.clientY); else $('tip').hidden = true;
});
document.addEventListener('scroll', () => { $('tip').hidden = true; }, true);

// ---------- day panel ----------
// Opening a day only moves the highlight and fills the panel; the grid is not rebuilt.
function openDay(key) {
  selected = key;
  $('day').hidden = false;
  for (const c of document.querySelectorAll('.cell.selected')) c.classList.remove('selected');
  document.querySelector(`.cell[data-day="${key}"]`)?.classList.add('selected');
  renderDay();
}
function renderDay() {
  const key = selected;
  const day = data.days[key] || { rest: false, note: '', pokemon: [] };
  const [y, m, d] = key.split('-').map(Number);
  $('dayTitle').textContent = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  $('dayRest').checked = !!day.rest;
  $('dayRest').disabled = !canEdit();
  $('dayPublic').checked = !!day.public;
  $('dayPublic').disabled = !canEdit();
  if (document.activeElement !== $('dayNote')) $('dayNote').value = day.note || '';
  $('dayNote').disabled = !canEdit();
  if (!$('dayPokemon').contains(document.activeElement)) {
    $('dayPokemon').replaceChildren(pokemonEditor(day.pokemon || [], (list) => saveDay({ pokemon: list }), !canEdit(), true));
  }

  const box = $('dayEvents');
  box.replaceChildren();
  const order = { super: 0, major: 1, weekly: 2, minor: 3 };
  const evs = data.events.filter((ev) => onDay(ev, key))
    .sort((a, b) => order[tierOf(a)] - order[tierOf(b)] || mineFirst(a, b) || evRange(a)[0] - evRange(b)[0]);
  if (!evs.length) box.append(el('p', { class: 'muted', text: 'No events on this day.' }));
  for (const ev of evs) box.append(evCard(ev, false));

  // Campfire meetups that day, attending first, then by start.
  const cfs = CF.filter(({ h, ev }) => onMeetDay(h, ev, key)).sort(cfOrder);
  $('dayCampfireHead').hidden = !cfs.length;
  $('dayCampfireHead').textContent = `Campfire meetups (${cfs.length})`;
  $('dayCampfire').replaceChildren(...cfs.map(({ h, ev }) => cfCard(h, ev)));
}
// A Campfire meetup in the day panel: its Campfire page, place, times, who hosts, the user's attending and targets.
function cfCard(h, ev) {
  const m = h.campfire;
  return el('div', { class: `evcard cfcard${h.going ? ' going' : ''}` },
    el('div', { class: 't' }, meetPin(), el('a', { href: m.url, target: '_blank', rel: 'noopener', text: m.name || ev.title }),
      el('span', { class: 'tag', text: `${m.going} going` })),
    el('div', { class: 'when', text: `${hostText({ start: h.start, end: h.end })} SGT · for ${ev.title}` }),
    el('div', {}, `${m.host}${m.club ? ` (${m.club})` : ''} @ `, el('a', { href: h.map, target: '_blank', rel: 'noopener', text: h.venue || 'map' })),
    m.details ? el('div', { class: 'evnote cfdetails', text: m.details }) : null,
    el('div', { class: 'links' },
      el('button', { class: `btn going-btn${h.going ? ' on' : ''}`, type: 'button', disabled: !canEdit(), 'aria-pressed': String(!!h.going),
        text: h.going ? '✓ Attending' : 'Attending?', onclick: () => toggleGoing(ev, h) })),
    el('details', { class: 'cftargets', ...(h.pokemon.length ? { open: true } : {}) }, el('summary', { text: `My targets for this meetup${h.pokemon.length ? ` (${h.pokemon.length})` : ''}` }),
      pokemonEditor(h.pokemon, (list) => saveCampfireMine(h, { pokemon: list }).catch((e) => { $('status').textContent = `Could not save: ${e.message}`; }),
        !canEdit(), true, 'Target for this meetup only, e.g. Zacian (Crowned Sword)')));
}
// An event's box: in the day panel, and (`inTip`, without buttons or links) as the tooltip of its name on the calendar.
function evCard(ev, inTip) {
  const tier = tierOf(ev);
  const bonus = ev.bonus || ev.ld?.bonus;
  return el('div', { class: `evcard tier-${tier}${isOverseas(ev) ? ' is-overseas' : ''}${ev.hidden ? ' hidden-ev' : ''}` },
      el('div', { class: 't' }, pin(TYPE_ACT[ev.type] || 'event'), el('b', { text: ev.title }),
        el('span', { class: 'tag', text: TIER_LABEL[tier] }),
        isOverseas(ev) ? el('span', { class: 'tag remote', text: 'remote' }) : null,
        ev.source === 'user' ? el('span', { class: 'tag', text: STATIC && ev.published && !ev.local ? 'owner' : 'mine' })
          : ev.edited?.length ? el('span', { class: 'tag', text: 'edited' }) : null,
        !STATIC && ev.public ? el('span', { class: 'tag public', text: 'public' }) : null,
        ev.from ? el('span', { class: 'tag', text: `from ${ev.from}` }) : null,
        ev.hidden ? el('span', { class: 'tag', text: 'hidden' }) : null),
      el('div', { class: 'when', text: whenText(ev) }),
      ev.pokemon?.length ? eventMons(ev, inTip) : null,
      ...(ev.pokemon || []).filter((p) => REGIONS[p.region] && !HOME_REGIONS.has(p.region)).map((p) => {
        const w = regionWindows(ev, p.region);
        return el('div', { class: 'region-line' }, lockPin(p.region),
          `${p.name} (${REGIONS[p.region].label})${w ? `: ${fmtDayTime(w.s)} – ${fmtDayTime(w.e)} ${HOME.label}` : ''}`);
      }),
      bonus ? el('div', { class: 'tip-bonus', text: `Bonus: ${bonus}` }) : null,
      ev.note ? el('div', { class: 'evnote', text: ev.note }) : null,
      ...(ev.hosts || []).map((h) => el('div', { class: 'evhost' }, meetPin(), el('span', { text: `Meetup: ${hostText(h)}` }),
        /^https?:\/\//.test(h.map || '') && !inTip ? el('a', { href: h.map, target: '_blank', rel: 'noopener', text: 'Map' }) : null,
        inTip ? null : el('button', { class: `btn going-btn${h.going ? ' on' : ''}`, type: 'button', disabled: !canEdit(), 'aria-pressed': String(!!h.going),
          title: h.going ? 'You are attending: click to undo' : 'Mark as attending', text: h.going ? '✓ Attending' : 'Attending?',
          onclick: () => toggleGoing(ev, h) }))),
      inTip ? null : el('div', { class: 'links' },
        el('button', { class: 'btn', disabled: !canEdit(), onclick: () => openEditor(ev), text: 'Edit' }),
        ev.url ? el('a', { href: ev.url, target: '_blank', rel: 'noopener', text: 'Info page' }) : null));
}
// Event card icons: raid bosses and valuable ones first; long lists (season spawns) folded after 12.
function eventMons(ev, inTip = false) {
  const list = [...eventPokemon(ev)].sort((a, b) => monRank(b) - monRank(a));
  const box = el('div', { class: 'mons' }, list.slice(0, 12).map((p) => monIcon(p, ev)));
  if (list.length > 12 && inTip) box.append(el('span', { class: 'more', text: `+${list.length - 12} more` }));
  else if (list.length > 12) {
    box.append(el('button', { class: 'btn more-btn', type: 'button', text: `+${list.length - 12} more`, onclick: (e) => {
      e.target.replaceWith(...list.slice(12).map((p) => monIcon(p, ev)));
    } }));
  }
  return box;
}
let daySaving = Promise.resolve();
function saveDay(patch) {
  const key = selected;
  daySaving = daySaving.then(async () => {
    const cur = data.days[key] || { rest: false, note: '', pokemon: [] };
    try {
      const saved = await backend.setDay(key, { ...cur, ...patch });
      if (!saved.rest && !saved.note && !saved.pokemon.length) delete data.days[key];
      else data.days[key] = saved;
      if (!STATIC) store.set(CACHE_KEY, { savedAt: Date.now(), data });
    } catch (e) {
      $('status').textContent = `Could not save the day: ${e.message}`;
    }
    render();
  });
}

// ---------- pokémon list editor ----------
function actSelect(value, onchange) {
  const s = el('select', { 'aria-label': 'Activity', onchange });
  for (const [k, a] of Object.entries(ACTIVITIES)) s.append(el('option', { value: k, selected: k === value, text: a.label }));
  return s;
}
function regionSelect(value, onchange) {
  const s = el('select', { 'aria-label': 'Region lock', title: 'Region lock', onchange, class: 'regionsel' });
  s.append(el('option', { value: '', text: 'All regions' }));
  for (const [k, r] of Object.entries(REGIONS)) s.append(el('option', { value: k, selected: k === value, text: `🔒 ${r.label}` }));
  return s;
}
// `allMine`: every row is the user's (day targets); otherwise every row can be starred, and rows the user added get a comment.
function pokemonEditor(list, onChange, disabled, allMine = false, placeholder = 'Add Pokémon, e.g. Mega Gengar') {
  const items = list.map((p) => ({ ...p, ...(allMine ? { mine: true } : {}) }));
  const wrap = el('div', { class: 'pkl' });
  const draw = () => {
    wrap.replaceChildren();
    items.forEach((p, i) => {
      const row = el('div', { class: 'pkrow' }, monIcon(p, null), el('span', { class: 'name', text: p.name }),
        el('button', { class: `btn icon starbtn${p.star ? ' on' : ''}`, type: 'button', disabled, 'aria-pressed': String(!!p.star),
          title: p.star ? 'Starred: shown with a rainbow ring' : 'Star this target', text: p.star ? '★' : '☆',
          onclick: () => { p.star = !p.star; onChange(items); draw(); } }),
        actSelect(p.act, (e) => { p.act = e.target.value; onChange(items); draw(); }),
        regionSelect(p.region, (e) => { p.region = e.target.value; onChange(items); draw(); }),
        el('button', { class: 'btn icon', type: 'button', 'aria-label': `Remove ${p.name}`, disabled, onclick: () => { items.splice(i, 1); onChange(items); draw(); }, text: '×' }));
      const wrapRow = el('div', { class: 'pkitem' }, row);
      if (p.mine) {
        wrapRow.append(el('input', { class: 'pkcomment', placeholder: 'Tooltip comment, e.g. need 2 more for a hundo', value: p.comment || '',
          'aria-label': `Comment on ${p.name}`, disabled, maxlength: '500',
          onchange: (e) => { p.comment = e.target.value; onChange(items); } }));
      }
      wrap.append(wrapRow);
    });
    const input = el('input', { list: 'dexNames', placeholder, 'aria-label': 'Pokémon name', disabled });
    const act = actSelect('raid');
    const add = () => {
      const name = input.value.trim();
      if (!name) return;
      const hit = lookup(name);
      items.push({ name: hit && hit.name.toLowerCase() === name.toLowerCase() ? hit.name : name, dex: hit ? hit.dex : 0,
        icon: '', act: act.value, shiny: false, mine: true, star: false, comment: '' });
      onChange(items);
      draw();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    wrap.append(el('div', { class: 'pkadd' }, input, act, el('button', { class: 'btn', type: 'button', disabled, onclick: add, text: 'Add' })));
  };
  draw();
  return wrap;
}

// Trainer meetups for an event: host, venue and times (wall time in HOME.tz), edited in place on `ev.hosts`.
function hostsEditor(ev) {
  const wrap = el('div', { class: 'hosts' });
  // The event's start / end as now in the form, as SGT wall time (the form shows city time for overseas events).
  const formTime = (id) => {
    const v = $(id).value;
    const z = zoneOf({ ...ev, tz: $('evTz').value });
    return !v ? '' : z === HOME.tz ? v : utcToWall(wallToUtc(v, z), HOME.tz);
  };
  const fill = (h) => { h.start ||= formTime('evStart'); h.end ||= formTime('evEnd'); return h; };
  ev.hosts.forEach(fill);
  // Venues used in other meetups, with their map links: offered as suggestions, and an empty map link
  // is filled in when the venue matches one (case and spacing ignored).
  const venueKey = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const known = new Map();
  for (const e of (ownerData || data).events) {
    for (const h of e.hosts || []) if (h.venue?.trim() && (!known.has(venueKey(h.venue)) || h.map)) known.set(venueKey(h.venue), { venue: h.venue.trim(), map: h.map || known.get(venueKey(h.venue))?.map || '' });
  }
  const venues = el('datalist', { id: 'venueNames' }, [...known.values()].map((k) => el('option', { value: k.venue })));
  const draw = () => {
    wrap.replaceChildren(venues, ...ev.hosts.map((h, i) => {
      const map = el('input', { type: 'url', class: 'hostmap', placeholder: 'Map link for the venue (optional), e.g. https://maps.app.goo.gl/…', 'aria-label': 'Venue map link',
        value: h.map || '', maxlength: '400', oninput: (e) => { h.map = e.target.value.trim(); } });
      const suggestMap = () => {
        const k = known.get(venueKey(h.venue));
        if (!h.map && k?.map) { h.map = k.map; map.value = k.map; }
      };
      return el('div', { class: 'hostrow' },
        el('input', { placeholder: 'Host trainer', 'aria-label': 'Host', value: h.host, maxlength: '60', oninput: (e) => { h.host = e.target.value; } }),
        el('input', { placeholder: 'Venue, e.g. VivoCity', 'aria-label': 'Venue', value: h.venue, maxlength: '120', list: 'venueNames',
          oninput: (e) => { h.venue = e.target.value; }, onchange: suggestMap }),
        el('button', { class: 'btn icon', type: 'button', 'aria-label': 'Remove this meetup', text: '×', onclick: () => { ev.hosts.splice(i, 1); draw(); } }),
        el('input', { type: 'datetime-local', 'aria-label': 'Meetup starts', value: h.start, onchange: (e) => { h.start = e.target.value; } }),
        el('input', { type: 'datetime-local', 'aria-label': 'Meetup ends', value: h.end, onchange: (e) => { h.end = e.target.value; } }),
        map,
        // The meetup's own targets: shown on its days only (☆ to star).
        el('div', { class: 'hostmons' }, pokemonEditor(h.pokemon || [], (list) => { h.pokemon = list; }, false, true, 'Target for this meetup only, e.g. Zacian (Crowned Sword)')));
    }),
    el('button', { class: 'btn', type: 'button', text: 'Add a meetup', onclick: () => {
      ev.hosts.push(fill({ host: '', venue: '', start: '', end: '' })); draw();
    } }));
  };
  draw();
  return wrap;
}
// "Ash @ VivoCity, Sat 31 Oct 1:45 pm – 5:30 pm"
// In tooltips, a meetup the user attends is marked.
const meetText = (h) => `${hostText(h)}${h.campfire ? ` · ${h.campfire.going} going (Campfire)` : ''}${h.going ? ' · ✓ attending' : ''}`;
// A Campfire meetup's own marks (attending, targets): saved by the server in the private store.
// On the public site they stay in the visitor's browser (CF_MINE_KEY).
async function saveCampfireMine(h, patch) {
  const id = h.campfire.id;
  const body = { going: h.going, pokemon: h.pokemon, ...patch };
  const mine = STATIC ? { going: !!body.going, pokemon: body.pokemon || [] } : await api('PUT', `/api/campfire/${id}`, body);
  const all = (data.campfire.mine ||= {});
  if (!mine.going && !mine.pokemon.length) delete all[id]; else all[id] = mine;
  if (STATIC) store.set(CF_MINE_KEY, all); else store.set(CACHE_KEY, { savedAt: Date.now(), data });
  render();
  if (selected) renderDay();
}
// Attending a meetup: saved on the event's `hosts` (private: not published).
async function toggleGoing(ev, h) {
  if (!canEdit()) return;
  if (h.campfire) {
    try { await saveCampfireMine(h, { going: !h.going }); } catch (e) { $('status').textContent = `Could not save: ${e.message}`; }
    return;
  }
  const i = ev.hosts.indexOf(h);
  const hosts = ev.hosts.map((x, j) => (j === i ? { ...x, going: !x.going } : x));
  try {
    const saved = markStars(await backend.updateEvent(ev.id, { hosts }));
    const k = data.events.findIndex((x) => x.id === saved.id);
    if (k >= 0) data.events[k] = saved;
    if (!STATIC) store.set(CACHE_KEY, { savedAt: Date.now(), data });
    render();
    if (selected) renderDay();
  } catch (e) { $('status').textContent = `Could not save: ${e.message}`; }
}
// Right-click on a day's meetup pin: one meetup is marked directly; several open the day to choose.
function goingFromPin(day, meets) {
  if (!canEdit()) return;
  $('tip').hidden = true;
  if (meets.length === 1) return toggleGoing(meets[0].ev, meets[0].h);
  openDay(day);
  $('status').textContent = 'Several meetups that day: press "Attending?" on the one you\'re going to.';
}
function hostText(h) {
  const s = h.start ? wallToUtc(h.start, HOME.tz) : NaN;
  const e = h.end ? wallToUtc(h.end, HOME.tz) : NaN;
  const full = (ms) => `${fmt(ms, { weekday: 'short' })} ${fmtDate(ms)} ${fmtTime(ms)}`;
  const when = Number.isNaN(s) ? '' : `${full(s)}${Number.isNaN(e) ? ''
    : ` – ${h.end.slice(0, 10) === h.start.slice(0, 10) ? fmtTime(e) : full(e)}`}`;
  return [[h.host, h.venue].filter(Boolean).join(' @ '), when].filter(Boolean).join(', ');
}

// ---------- event editor ----------
function openEditor(ev) {
  if (!canEdit()) return;
  const isNew = !ev.id;
  editing = { ...ev, pokemon: (ev.pokemon || []).map((p) => ({ ...p })) };
  $('editorTitle').textContent = isNew ? 'Add event' : 'Edit event';
  const where = STATIC ? ' Your changes are saved in this browser only.' : '';
  $('editorSource').textContent = (isNew || (ev.source === 'user' && !ev.published) ? 'Your own event.'
    : ev.source === 'user' ? 'Added by the calendar owner.'
    : ev.edited?.length ? `From Leek Duck; changed: ${ev.edited.join(', ')}. Changes are kept when Leek Duck updates.`
    : 'From Leek Duck. Anything you change here is kept when Leek Duck updates.') + where;
  $('evTitle').value = editing.title || '';
  const typeSel = $('evType');
  typeSel.replaceChildren(...EVENT_TYPES.map(([k, l]) => el('option', { value: k, text: l })));
  if (editing.type && !EVENT_TYPES.some(([k]) => k === editing.type)) typeSel.append(el('option', { value: editing.type, text: editing.typeLabel || editing.type }));
  typeSel.value = editing.type || 'event';
  $('evTier').replaceChildren(...TIERS.map(([k, l]) => el('option', { value: k, text: k ? l : `${l}: ${TIERS.find(([t]) => t === autoTier(editing))[1]}` })));
  $('evTier').value = editing.tier || '';
  const zones = [['', `Automatic: ${cityOf({ ...editing, tz: '' })?.name || HOME.name}`], ...CITIES.map(([c, z]) => [z, c])];
  const seenZ = new Set();
  $('evTz').replaceChildren(...zones.filter(([z]) => (seenZ.has(z) ? false : seenZ.add(z))).map(([z, c]) => el('option', { value: z, text: c })));
  $('evTz').value = editing.tz || '';
  $('evUrl').value = editing.url || '';
  $('evStart').value = toInput(editing, editing.start);
  $('evEnd').value = toInput(editing, editing.end);
  $('evNote').value = editing.note || '';
  $('evHidden').checked = !!editing.hidden;
  $('evPublic').checked = !!editing.public;
  $('evPublicRow').hidden = STATIC;
  updateZoneHint();
  $('evPokemon').replaceChildren(pokemonEditor(editing.pokemon, (list) => { editing.pokemon = list; }, false));
  editing.hosts = (ev.hosts || []).map((h) => ({ ...h }));
  $('evHosts').replaceChildren(hostsEditor(editing));
  const ownChanges = STATIC ? !!ev.local : (ev.edited?.length > 0);
  $('evRevert').hidden = isNew || (ev.source !== 'user' && !ownChanges);
  $('evRevert').textContent = ev.source === 'user' ? (STATIC && ev.published ? 'Hide from my view' : 'Delete') : 'Undo my changes';
  $('editorError').hidden = true;
  $('editor').showModal();
}
function updateZoneHint() {
  const c = cityOf({ ...editing, tz: $('evTz').value });
  $('evZoneHint').textContent = c && c.tz !== HOME.tz
    ? `Times below are ${c.name} local time; the calendar shows them in ${HOME.label}.`
    : `Times below are ${HOME.label}.`;
}

async function saveEditor(e) {
  e.preventDefault();
  const body = {
    title: $('evTitle').value.trim(),
    type: $('evType').value,
    tier: $('evTier').value,
    tz: $('evTz').value,
    url: $('evUrl').value.trim(),
    // Keep Leek Duck's original string when the user did not touch the time.
    start: $('evStart').value === toInput(editing, editing.start) ? editing.start : $('evStart').value,
    end: $('evEnd').value === toInput(editing, editing.end) ? (editing.end || '') : $('evEnd').value,
    note: $('evNote').value,
    hidden: $('evHidden').checked,
    pokemon: editing.pokemon.map((p) => (p.mine ? p : (({ star: _s, ...q }) => q)(p))),
    starred: editing.pokemon.filter((p) => !p.mine && p.star).map(starKey),
    hosts: editing.hosts.filter((h) => h.host.trim() || h.venue.trim()),
    ...(STATIC ? {} : { public: $('evPublic').checked }),
  };
  try {
    const saved = markStars(editing.id ? await backend.updateEvent(editing.id, body) : await backend.addEvent(body));
    const i = data.events.findIndex((x) => x.id === saved.id);
    if (i >= 0) data.events[i] = saved; else data.events.push(saved);
    if (!STATIC) store.set(CACHE_KEY, { savedAt: Date.now(), data });
    $('editor').close();
    render();
  } catch (err) {
    $('editorError').hidden = false;
    $('editorError').textContent = `Not saved: ${err.message}`;
  }
}

async function revertEditor() {
  const btn = $('evRevert');
  // Two-step confirm built into the button (no browser dialogs).
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = editing.source === 'user' ? 'Click again to delete' : 'Click again to undo';
    setTimeout(() => { delete btn.dataset.armed; }, 4000);
    return;
  }
  delete btn.dataset.armed;
  try {
    const r = await backend.revert(editing.id);
    if (r.deleted) data.events = data.events.filter((x) => x.id !== editing.id);
    else data.events[data.events.findIndex((x) => x.id === r.id)] = markStars(r);
    $('editor').close();
    render();
  } catch (err) {
    $('editorError').hidden = false;
    $('editorError').textContent = err.message;
  }
}

function newEventOn(day) {
  const d = day || homeDay(Date.now());
  openEditor({ title: '', type: 'event', start: `${d}T10:00`, end: `${d}T18:00`, pokemon: [], source: 'user' });
}

// ---------- prefs & wiring ----------
function savePrefs() { store.set(PREFS_KEY, prefs); }
function shiftMonth(n) {
  const [y, m] = (prefs.month || homeDay(Date.now()).slice(0, 7)).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  prefs.month = d.toISOString().slice(0, 7);
  savePrefs(); render();
}

prefs = { ...prefs, ...(store.get(PREFS_KEY) || {}) };
// A link like calendar.html#2026-11 opens that month.
if (/^#\d{4}-\d{2}$/.test(location.hash)) prefs.month = location.hash.slice(1);
// Species, plus "Name (Form)" for species with several forms, so a target can be e.g. Giratina (Origin).
$('dexNames').append(...[...DEX.values()].flatMap((e) => [e.name,
  ...(e.forms.length > 1 ? e.forms.filter((f) => f[0]).map((f) => `${e.name} (${f[0]})`) : [])]).map((v) => el('option', { value: v })));
$('prev').onclick = () => shiftMonth(-1);
$('next').onclick = () => shiftMonth(1);
$('today').onclick = () => { prefs.month = null; savePrefs(); render(); };
$('bars').onchange = (e) => { prefs.bars = e.target.checked; savePrefs(); render(); };
$('campfire').onchange = (e) => { prefs.campfire = e.target.checked; savePrefs(); render(); if (selected) renderDay(); };
$('refresh').onclick = async () => {
  try { await api('POST', '/api/refresh'); data.refreshing = true; render(); setTimeout(load, 3000); }
  catch (e) { $('status').textContent = `Could not start a check: ${e.message}`; }
};
$('publish').onclick = async () => {
  try {
    const r = await api('POST', '/api/publish');
    const msg = `Published ${r.events} events and ${r.days} days to ${r.file}. Commit and push it to update the public site.`;
    $('status').textContent = msg;
    await openPublic();
    $('pubStatus').append(el('div', { class: 'pub-ok', text: msg }));
  } catch (e) {
    $('status').textContent = `Could not publish: ${e.message}`;
    $('pubStatus').replaceChildren(el('span', { class: 'pub-warn', text: `Could not publish: ${e.message}` }));
  }
};
$('pubBtn').onclick = openPublic;
$('pubClose').onclick = () => $('pubDlg').close();
$('pubPreview').onclick = () => setPreview(true);
$('previewExit').onclick = () => setPreview(false);
$('pubExport').onclick = () => { $('pubDlg').close(); openExport('public'); };
$('exportBtn').onclick = () => openExport('all');
$('expDo').onclick = exportChanges;
$('expCancel').onclick = () => $('expDlg').close();
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importChanges(f); };
$('dayPublic').onchange = (e) => saveDay({ public: e.target.checked });
for (const id of ['refresh', 'pubBtn']) $(id).hidden = STATIC;
// Help, and a one-time welcome for visitors of the public site.
const WELCOME_KEY = 'pogoCalendarWelcomed';
$('helpStatic').hidden = !STATIC;
$('helpPins').append(...Object.entries(ACTIVITIES).map(([k, a]) => el('span', { class: 'help-pin' }, pin(k), a.label)));
$('helpExtras').append(
  el('span', { class: 'help-pin' }, el('span', { class: 'help-mark' }, sparkle()), 'shiny available (top-right)'),
  el('span', { class: 'help-pin' }, el('span', { class: 'bg-key', text: 'BG' }), 'special background (bottom-left)'),
  el('span', { class: 'help-pin' }, el('span', { class: 'help-mark' }, globePin('event location')),
    'Location Background: a photo of the event city, in-person raids / Max Battles only (left)'),
  el('span', { class: 'help-pin' }, debutBadge({ debut: 'new' }), 'Pokémon GO debut (gold: shiny debut)'),
  el('span', { class: 'help-pin' }, el('span', { class: 'help-mark' }, meetPin()), 'trainer meetup that day (beside the date; hover for host, venue and time; right-click to mark it as attending, which circles the pin)'),
  el('span', { class: 'help-pin' }, el('span', { class: 'help-mark' }, lockPin('emea')), 'region-locked, another region (top-left)'),
  el('span', { class: 'help-pin' }, el('span', { class: 'help-mark' }, lockPin('apac')), 'region-locked, your region'));
$('helpBtn').onclick = () => $('help').showModal();
$('helpClose').onclick = () => $('help').close();
$('welcomeHelp').onclick = () => $('help').showModal();
$('welcomeClose').onclick = () => { $('welcome').hidden = true; store.set(WELCOME_KEY, true); };
$('welcome').hidden = !STATIC || !!store.get(WELCOME_KEY);
$('dayPublicRow').hidden = STATIC;
$('addEvent').onclick = () => newEventOn(selected);
$('dayAddEvent').onclick = () => newEventOn(selected);
$('dayClose').onclick = () => {
  selected = null;
  $('day').hidden = true;
  for (const c of document.querySelectorAll('.cell.selected')) c.classList.remove('selected');
};
$('dayRest').onchange = (e) => saveDay({ rest: e.target.checked });
$('dayNote').onchange = (e) => saveDay({ note: e.target.value });
$('evTz').onchange = updateZoneHint;
$('editorForm').addEventListener('submit', saveEditor);
$('evCancel').onclick = () => $('editor').close();
$('evRevert').onclick = revertEditor;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('editor').open && selected) $('dayClose').click(); });

const cached = store.get(CACHE_KEY);
if (cached) { data = cached.data; render(); }
load();
