'use strict';
// Leek Duck scraper: events list + per-event detail pages (times, featured Pokémon).
// Markup notes and the activity mapping are explained in design.md.

const BASE = 'https://leekduck.com';
const UA = 'pogo-calendar (personal planner; one request per second)';

// Bump when parsing or classification changes, so stored details are fetched again once.
const SCRAPE_VERSION = 7;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

function decode(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : '';
}

// One entry per occurrence on https://leekduck.com/events/
function parseList(html) {
  const out = new Map();
  const re = /<span class="event-header-item-wrapper"([^>]*)>([\s\S]*?)<\/a><\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1];
    const body = m[2];
    const id = attr(tag, 'data-event-occurrence-id');
    if (!id || out.has(id)) continue;
    const href = (body.match(/href="([^"]+)"/) || [])[1] || '';
    const img = (body.match(/<img[^>]*src="([^"]+)"/) || [])[1] || '';
    const title = (body.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || id;
    const badge = (body.match(/class="event-tag-badge">([\s\S]*?)<\/span>/) || [])[1] || '';
    out.set(id, {
      id,
      type: decode(attr(tag, 'data-event-type')),
      typeLabel: decode(badge),
      title: decode(title),
      url: href ? BASE + href : '',
      image: img,
      start: attr(tag, 'data-event-start-date') || attr(tag, 'data-event-start-date-check') || '',
      end: attr(tag, 'data-event-end-date') || '',
    });
  }
  return [...out.values()];
}

// Featured Pokémon by section, plus the schedule's overall start/end.
function parseDetail(html) {
  const segments = [];
  // Rows are data-kind "single" (start + end), or a "start" row followed by an "end" row
  // whose time is also in data-start.
  for (const row of html.match(/<div class="schedule-row"[^>]*>/g) || []) {
    const kind = attr(row, 'data-kind');
    const t = attr(row, 'data-start');
    if (!t) continue;
    if (kind === 'end') {
      const open = segments[segments.length - 1];
      if (open && !open.end) open.end = t;
      else segments.push({ start: '', end: t });
    } else segments.push({ start: t, end: attr(row, 'data-end') });
  }
  segments.sort((a, b) => a.start.localeCompare(b.start));
  const ends = segments.map((s) => s.end).filter(Boolean).sort();

  const sections = [];
  // Main sections are <h2 id class="event-section-header">; plain <h2 id> inside one is a sub-section,
  // named "main/sub" (e.g. "raids/max-battles"). parts: [before, id1, cls1, body1, ...].
  const parts = html.split(/<h2 id="([^"]+)"( class="event-section-header)?/);
  const chunks = [['intro', parts[0]]];
  let main = '';
  for (let i = 1; i < parts.length; i += 3) {
    if (parts[i + 1] || !main) main = parts[i];
    chunks.push([main === parts[i] ? main : `${main}/${parts[i]}`, parts[i + 2] || '']);
  }
  for (const [sid, body] of chunks) {
    const items = [];
    const liRe = /<li class="pkmn-list-item"[^>]*>([\s\S]*?)<\/li>/g;
    let li;
    while ((li = liRe.exec(body))) {
      const icon = (li[1].match(/class="pkmn-list-img[^"]*">\s*<img src="([^"]+)"/) || [])[1] || '';
      const name = decode((li[1].match(/class="pkmn-name">([\s\S]*?)<\/div>/) || [])[1] || '');
      if (!name) continue;
      items.push({ name, icon, shiny: /shiny-icon/.test(li[1]) });
    }
    if (items.length) sections.push({ id: sid, items });
  }
  // Special backgrounds are only mentioned in prose ("… Reshiram, Zekrom … have a chance to have a new
  // Special Background"); keep those sentences to match names against.
  const text = decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' '));
  const bgText = text.split(/(?<=[.!?])\s+/).filter((s) => /special background/i.test(s)).join(' ');
  // Spotlight Hour: "… and the special bonus is 2× Evolution XP."
  const bonus = (/special bonus is ([^.]{2,60}?)\s*\./i.exec(text) || [])[1] || '';
  // Prose sentences: Pokémon lists left out, and headings / paragraphs end a sentence (they have no full stop).
  const prose = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<li class="pkmn-list-item"[\s\S]*?<\/li>/g, ' ')
    .replace(/<\/(h\d|p|li|div)>|<br\s*\/?>/g, ' ¶ ').replace(/<[^>]+>/g, ' ');
  const sentences = decode(prose).split(/(?<=[.!?])\s+|\s*¶\s*/).filter(Boolean);
  // Location Backgrounds (a photo of the place, e.g. "a Sendai Location Background"), unlike clip-art special ones.
  const lbgText = sentences.filter((s) => /location background/i.test(s)).join(' ');
  const lbgPlace = (/\ban?\s+([A-Z][\w'-]*(?: [A-Z][\w'-]*){0,3}) Location Backgrounds?\b/.exec(lbgText) || [])[1] || '';
  const debutText = sentences.filter((s) => /\bdebut/i.test(s) && !/\bwill debut\b/i.test(s)).join(' ');
  return { start: segments[0]?.start || '', end: ends[ends.length - 1] || '', segments, sections, bgText, text, bonus,
    lbgText, lbgPlace, debutText };
}

function dexFromIcon(icon) {
  const m = /(?:pokemon_icon_(?:pm)?|\/pm|poke_capture_)0*(\d+)[_.]/.exec(icon || '');
  return m ? +m[1] : 0;
}

// Activity pin for one featured Pokémon. Keys match ACTIVITIES in public/calendar.js.
function classify(ev, sectionId, name) {
  const t = `${ev.type} ${ev.title}`.toLowerCase();
  const n = name.toLowerCase();
  const raidSection = /raid/.test(sectionId);
  if (/gigantamax/.test(sectionId) && !/^dynamax/.test(n)) return 'gmax';
  if (/dynamax/.test(sectionId)) return 'dmax';
  if (n.startsWith('gigantamax') || (/gigantamax/.test(t) && !raidSection && !/spawn|wild|egg/.test(sectionId))) return 'gmax';
  if (n.startsWith('dynamax') || /max-battle/.test(sectionId) || (!raidSection && /max-mondays|max-battles|max battle|dynamax/.test(t))) return 'dmax';
  if (n.startsWith('mega ') || n.startsWith('primal ')) return /super mega/.test(t) ? 'supermega' : 'mega';
  if (n.startsWith('shadow ') || (raidSection && /shadow/.test(t))) return 'shadow';
  if (/community-day/.test(ev.type) && !/research|ticket|box|store/.test(sectionId)) return 'cd';
  if (/spotlight/.test(ev.type)) return 'spotlight';
  if (/hatch/.test(t) || /egg/.test(sectionId)) return 'hatch';
  if (raidSection || /raid/.test(ev.type)) return 'raid';
  if (/research/.test(sectionId)) return 'research';
  if (/wild|spawn/.test(sectionId)) return 'wild';
  return 'event';
}

function pokemonFrom(ev, detail) {
  const shiny = new Set();
  for (const s of detail.sections) if (s.id === 'shiny') for (const p of s.items) shiny.add(p.name);
  const seen = new Set();
  const list = [];
  for (const s of detail.sections) {
    if (s.id === 'shiny') continue;
    for (const p of s.items) {
      const act = classify(ev, s.id, p.name);
      const key = `${p.name}|${act}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lbg = BG_ACTS.has(act) && mentions(detail.lbgText, p.name, act);
      const debut = debutKind(ev, detail.debutText, p.name, act) || (/debut/.test(s.id) ? 'new' : '');
      list.push({ name: p.name, dex: dexFromIcon(p.icon), icon: p.icon, act, shiny: p.shiny || shiny.has(p.name),
        bg: hasBackground(detail.bgText, p.name, act), region: regionOf(detail.text, p.name),
        ...(lbg ? { lbg: detail.lbgPlace || 'event location', ...(/ticket[- ]holders?/i.test(detail.lbgText) ? { lbgTicket: true } : {}) } : {}),
        ...(debut ? { debut } : {}) });
    }
  }
  dropUndebuted(ev, detail.text, list);
  if (!list.length) {
    for (const name of titleMons(ev)) list.push({ name, dex: speciesDex(name), icon: '', act: classify(ev, 'raids', name), shiny: false, fromTitle: true });
  }
  return list;
}

// Minior Showers list all seven cores, but each shower debuts one ("Green Core Minior debuts during the
// Orionids."). Keep only the cores debuting in this event's shower; none while unannounced.
function dropUndebuted(ev, text, list) {
  if (!list.some((p) => /\(\w+ Core\)$/.test(p.name))) return;
  const debut = new Set();
  const re = /\b(\w+) Core (\w+) (?:will )?debuts? during the ([A-Z][\w ]*?)(?=[.,;]| in | and |$)/g;
  let m;
  while ((m = re.exec(text || ''))) {
    if (new RegExp(`\\b${m[3]}\\b`, 'i').test(ev.title)) debut.add(`${m[2]} (${m[1]} Core)`.toLowerCase());
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (/\(\w+ Core\)$/.test(list[i].name) && !debut.has(list[i].name.toLowerCase())) list.splice(i, 1);
  }
}

// Title-derived Pokémon (Raid Hour) carry no shiny flag: take it from an overlapping event that lists
// the same species and form, e.g. "Palkia Raid Hour" from "Palkia in 5-star Raid Battles".
function monKey(p) {
  const form = (/\(([A-Za-z]+)/.exec(p.name)?.[1] || '').toLowerCase();
  return `${p.dex || speciesDex(p.name)}|${form}`;
}
function shareShiny(events) {
  const range = (e) => [Date.parse(e.start), Date.parse(e.end) || Date.parse(e.start) + 3600e3];
  for (const ev of events) {
    for (const p of ev.pokemon) {
      if (!p.fromTitle || p.shiny) continue;
      const [s, e] = range(ev);
      p.shiny = events.some((o) => o !== ev && (() => { const [os, oe] = range(o); return os < e && oe > s; })()
        && o.pokemon.some((q) => !q.fromTitle && q.shiny && monKey(q) === monKey(p)));
    }
  }
}

// Backgrounds come with raid / Max Battle / research catches. "Dynamax Dialga" in the text only
// counts for the Dynamax one, not for a plain Dialga raid.
const BG_ACTS = new Set(['raid', 'mega', 'supermega', 'shadow', 'dmax', 'gmax', 'research']);
const hasBackground = (bgText, name, act) => BG_ACTS.has(act) && mentions(bgText, name, act);

// Whether prose names this Pokémon. "Dynamax Dialga" counts only for the Dynamax one, "Hisuian Goodra" only for
// the Hisuian one, and a form in brackets must be named too ("Minior (Green Core)" needs "Green Core").
const REGIONAL = /^(alolan|galarian|hisuian|paldean)\s+/i;
function mentions(text, name, act, { needForm = false } = {}) {
  if (!text) return false;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const base = name.replace(/^((mega|primal|shadow|dynamax|gigantamax)\s+)+/i, '').replace(/\s*\(.*\)$/, '')
    .replace(/\s+wearing\s.*$/i, '').trim();
  // The species word ("Modern Jacket Machamp" -> Machamp, "Unown S" -> Unown), else the last word.
  const words = base.split(/\s+/);
  const species = [...words].reverse().find((w) => speciesDex(w)) || words[words.length - 1];
  const form = (/\(([^)]*)\)/.exec(name)?.[1] || '').replace(/\s+formes?$/i, '').trim();
  if (!species || (needForm && form && !new RegExp(`\\b${esc(form)}\\b`, 'i').test(text))) return false;
  const max = act === 'dmax' ? 'Dynamax' : act === 'gmax' ? 'Gigantamax' : '';
  let t = max ? text : text.replace(new RegExp(`\\b(Dynamax|Gigantamax)\\s+${esc(species)}\\b`, 'gi'), '');
  const regional = REGIONAL.test(base);
  if (!regional) t = t.replace(new RegExp(`\\b(Alolan|Galarian|Hisuian|Paldean)\\s+${esc(species)}\\b`, 'gi'), '');
  const re = (s) => new RegExp(`\\b${max ? `${max}\\s+` : ''}${esc(s)}\\b`, 'i');
  return re(base).test(t) || (!regional && re(species).test(t));
}
// Debut clauses about this event. Drops "… debuts during the Orionids" on another shower's page, "See … Part I"
// pointers, and clauses joined by ", and" that aren't about a debut ("…, and Zacian … take over five-star raids").
function debutClauses(ev, debutText) {
  return (debutText || '').split(/(?<=[.!?])\s+/).filter((s) => {
    const m = /\bdebuts? during the ([A-Z][\w ]*?)(?=[.,;]| in | and |$)/.exec(s);
    return !/^See\b/.test(s) && (!m || new RegExp(`\\b${m[1]}\\b`, 'i').test(ev.title));
  }).flatMap((s) => s.split(/,\s+and\s+|;\s*/)).filter((c) => /\bdebut/i.test(c));
}
// 'new' (a Pokémon GO debut), 'shiny' ("Shiny Greavard makes its debut"), or ''.
function debutKind(ev, debutText, name, act) {
  for (const c of debutClauses(ev, debutText)) {
    if (!mentions(c, name, act, { needForm: true })) continue;
    const species = name.replace(/\s*\(.*\)$/, '').split(/\s+/).pop();
    return new RegExp(`\\bShiny\\s+(\\w+\\s+)?${species}\\b`, 'i').test(c) ? 'shiny' : 'new';
  }
  return '';
}

// Region-locked Pokémon, from prose such as "Mesprit: Europe, the Middle East, Africa, and India." or
// "Volbeat … in the Western Hemisphere". Keys match REGIONS in public/calendar.js; '' = everywhere.
function regionOf(text, name) {
  if (!text) return '';
  const base = name.replace(/^((mega|primal|shadow|dynamax|gigantamax)\s+)+/i, '').replace(/\s*\(.*\)$/, '').trim();
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`\\b${esc}:\\s*([^.]{3,120})\\.`, 'i').exec(text)
    || new RegExp(`\\b${esc}\\b[^.]{0,80}\\b((?:Eastern|Western) Hemisphere)`, 'i').exec(text);
  if (!m) return '';
  const r = m[1].toLowerCase();
  if (/eastern hemisphere/.test(r)) return 'east';
  if (/western hemisphere/.test(r)) return 'west';
  if (/americas|greenland/.test(r)) return 'americas';
  if (/europe|middle east|africa|india/.test(r)) return 'emea';
  if (/asia|pacific|oceania/.test(r)) return 'apac';
  return '';
}

// Raid Hour and similar pages have no Pokémon list; the title names them,
// e.g. "Cresselia and Darkrai Raid Hour", "Dialga in 5-star Raid Battles", "Dynamax Sneasel during Max Monday".
function titleMons(ev) {
  if (!/raid|max-mondays|max-battles|community-day/.test(ev.type) || /announced/i.test(ev.title)) return [];
  const head = ev.title
    .replace(/\s+(Raid Hour|Raid Day|Super Mega Raid Day|Community Day.*|Max Battle Day.*)$/i, '')
    .replace(/\s+(in|during)\s+.*$/i, '')
    .replace(/^Dynamax\s+/i, '');
  if (!head || /raid|community day|max monday/i.test(head)) return [];
  // Split on ", " and " and " outside parentheses: "Deoxys (Normal, Defense…)" stays whole.
  const names = [];
  let depth = 0, cur = '';
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (!depth && (head.startsWith(', ', i) || head.startsWith(' and ', i))) {
      names.push(cur);
      cur = '';
      i += head.startsWith(', ', i) ? 1 : 4;
      if (head.startsWith(' and ', i)) i += 4; // ", and "
      continue;
    }
    cur += c;
  }
  names.push(cur);
  return names.map((s) => s.trim()).filter((s) => speciesDex(s));
}

// Species number for a display name ("Mega Charizard X", "Giratina (Origin Forme)"), 0 if not a species.
let dexByName = null;
function speciesDex(name) {
  if (!dexByName) {
    dexByName = new Map();
    try {
      const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'pokedex.js'), 'utf8');
      for (const [dex, n] of JSON.parse(src.slice(src.indexOf('= [') + 2, src.lastIndexOf(']') + 1))) dexByName.set(n.toLowerCase(), dex);
    } catch { /* no pokedex: accept nothing */ }
  }
  const base = name.replace(/^((mega|primal|shadow|dynamax|gigantamax)\s+)+/i, '').replace(/\s*\(.*\)$/, '').replace(/\s+[XY]$/, '');
  return dexByName.get(base.toLowerCase()) || 0;
}

// Scrape the list, then detail pages for events that are new, unfinished and stale.
// `known` maps id -> previous scraped record (with detailAt), to skip fresh details.
async function scrape(known, { now = Date.now(), detailMaxAgeMs = 24 * 3600e3, delayMs = 1000, log = () => {} } = {}) {
  const list = parseList(await get(`${BASE}/events/`));
  log(`list: ${list.length} events`);
  const detailCache = new Map();
  const results = [];
  for (const ev of list) {
    const prev = known[ev.id];
    const ended = ev.end && Date.parse(ev.end) < now;
    const current = prev && prev.detailAt && prev.v === SCRAPE_VERSION;
    const fresh = current && now - prev.detailAt < detailMaxAgeMs;
    // Ended events still get one detail fetch, so the past days of the month are filled in.
    if ((ended && current) || fresh || !ev.url) {
      results.push({ ...ev, start: prev?.start || ev.start, end: prev?.end || ev.end,
        pokemon: prev?.pokemon || [], bonus: prev?.bonus || '', detailAt: prev?.detailAt || 0, v: prev?.v || 0 });
      continue;
    }
    try {
      let detail = detailCache.get(ev.url);
      if (!detail) {
        await sleep(delayMs);
        detail = parseDetail(await get(ev.url));
        detailCache.set(ev.url, detail);
      }
      // Repeating events: the occurrence's own segment, not the article's whole range.
      const seg = detail.segments.find((s) => s.start === ev.start);
      results.push({ ...ev, start: ev.start || detail.start,
        end: ev.end || seg?.end || (detail.segments.length > 1 ? '' : detail.end),
        pokemon: pokemonFrom(ev, detail), bonus: detail.bonus, detailAt: now, v: SCRAPE_VERSION });
    } catch (e) {
      log(`detail failed: ${ev.url}: ${e.message}`);
      results.push({ ...ev, pokemon: prev?.pokemon || [], bonus: prev?.bonus || '', detailAt: prev?.detailAt || 0, v: prev?.v || 0 });
    }
  }
  shareShiny(results);
  return results;
}

module.exports = { scrape, SCRAPE_VERSION, parseList, parseDetail, pokemonFrom, classify, dexFromIcon, titleMons };
