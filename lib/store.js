'use strict';
// JSON-file store: events (scraped + user-added) and per-day notes.
// A scraped event keeps the Leek Duck copy in `ld`; fields the user edited are listed in
// `edited` and survive later scrapes. See design.md "Store".

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EDITABLE = ['title', 'type', 'start', 'end', 'url', 'note', 'pokemon', 'hidden', 'tier', 'tz', 'public', 'from'];
// User-only fields: never in the Leek Duck copy, never marked as edited. tz = IANA zone of the event's city;
// public = include this event (or day) in public/public.json on Publish; from = who suggested an imported event.
const USER_ONLY = ['note', 'hidden', 'tier', 'tz', 'public', 'from'];
// What a published Leek Duck event carries besides its edited fields.
const PUBLISHED_USER_FIELDS = ['note', 'hidden', 'tier', 'tz'];
const TIERS = ['', 'super', 'major', 'weekly', 'minor'];
const FROM_LD = ['title', 'type', 'typeLabel', 'start', 'end', 'url', 'image', 'pokemon'];

class Store {
  constructor(file) {
    this.file = file;
    this.data = { version: 1, lastRefresh: 0, lastError: '', events: {}, days: {} };
    if (fs.existsSync(file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  snapshot() {
    const { lastRefresh, lastError, events, days } = this.data;
    return { lastRefresh, lastError, events: Object.values(events), days };
  }

  scrapedKnown() {
    const known = {};
    for (const ev of Object.values(this.data.events)) if (ev.ld) known[ev.id] = ev.ld;
    return known;
  }

  mergeScrape(list) {
    for (const s of list) {
      const ev = this.data.events[s.id] || { id: s.id, source: 'leekduck', edited: [], note: '', hidden: false };
      ev.ld = s;
      for (const f of FROM_LD) if (!ev.edited.includes(f)) ev[f] = s[f];
      this.data.events[s.id] = ev;
    }
    this.data.lastRefresh = Date.now();
    this.data.lastError = '';
    this.save();
  }

  addEvent(body) {
    const id = `u-${crypto.randomUUID()}`;
    const ev = { id, source: 'user', edited: [], note: '', hidden: false, pokemon: [], typeLabel: '', image: '' };
    for (const f of EDITABLE) if (f in body) ev[f] = clean(f, body[f]);
    this.data.events[id] = ev;
    this.save();
    return ev;
  }

  updateEvent(id, body) {
    const ev = this.data.events[id];
    if (!ev) return null;
    for (const f of EDITABLE) {
      if (!(f in body)) continue;
      ev[f] = clean(f, body[f]);
      if (ev.ld && !USER_ONLY.includes(f)) {
        ev.edited = ev.edited.filter((x) => x !== f);
        if (JSON.stringify(ev[f]) !== JSON.stringify(ev.ld[f])) ev.edited.push(f);
      }
    }
    this.save();
    return ev;
  }

  // Scraped: back to the Leek Duck copy (note and hidden kept). User-added: deleted.
  revertOrDelete(id) {
    const ev = this.data.events[id];
    if (!ev) return null;
    if (!ev.ld) {
      delete this.data.events[id];
      this.save();
      return { deleted: true };
    }
    for (const f of FROM_LD) ev[f] = ev.ld[f];
    ev.edited = [];
    this.save();
    return ev;
  }

  setDay(date, body) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const day = { rest: !!body.rest, note: String(body.note || '').slice(0, 2000), pokemon: clean('pokemon', body.pokemon || []),
      public: !!body.public };
    if (!day.rest && !day.note && !day.pokemon.length) delete this.data.days[date];
    else this.data.days[date] = day;
    this.save();
    return day;
  }

  // The companion file for the static site: only events and days flagged public. A Leek Duck event
  // contributes just the fields the user changed (merged over the snapshot by the page); a user event goes whole.
  publicSnapshot() {
    const events = {};
    for (const ev of Object.values(this.data.events)) {
      if (!ev.public) continue;
      if (!ev.ld) {
        const { public: _p, ld: _l, ...rest } = ev;
        events[ev.id] = rest;
      } else {
        const patch = { edited: ev.edited };
        for (const f of [...ev.edited, ...PUBLISHED_USER_FIELDS]) patch[f] = ev[f];
        events[ev.id] = patch;
      }
    }
    const days = {};
    for (const [d, day] of Object.entries(this.data.days)) if (day.public) { const { public: _p, ...rest } = day; days[d] = rest; }
    return { publishedAt: Date.now(), events, days };
  }
}

function clean(field, v) {
  if (field === 'hidden' || field === 'public') return !!v;
  if (field === 'tier') return TIERS.includes(v) ? v : '';
  if (field === 'from') return String(v || '').slice(0, 40);
  if (field === 'tz') return /^[A-Za-z_]+(\/[A-Za-z_]+){0,2}$/.test(v || '') ? v : '';
  if (field === 'pokemon') {
    return (Array.isArray(v) ? v : []).slice(0, 60).map((p) => ({
      name: String(p.name || '').slice(0, 60),
      dex: Number.isInteger(p.dex) ? p.dex : 0,
      icon: /^https:\/\/cdn\.leekduck\.com\//.test(p.icon || '') ? p.icon : '',
      act: String(p.act || 'event').slice(0, 20),
      shiny: !!p.shiny,
      bg: !!p.bg,
      region: ['apac', 'emea', 'americas', 'east', 'west'].includes(p.region) ? p.region : '',
      ...(p.fromTitle ? { fromTitle: true } : {}),
      // Added by the user (not Leek Duck); only these can be starred or carry a comment.
      ...(p.mine ? { mine: true, star: !!p.star, comment: String(p.comment || '').slice(0, 500) } : {}),
      ...(p.mine && p.from ? { from: String(p.from).slice(0, 40) } : {}),
    })).filter((p) => p.name);
  }
  return String(v ?? '').slice(0, field === 'note' ? 4000 : 400);
}

module.exports = { Store };
