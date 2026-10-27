'use strict';
// JSON-file store: events (scraped + user-added) and per-day notes.
// A scraped event keeps the Leek Duck copy in `ld`; fields the user edited are listed in
// `edited` and survive later scrapes. On disk: Leek Duck copies in store-public.json, the user's own
// events, edits and days in store.json. See design.md "Store".

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EDITABLE = ['title', 'type', 'start', 'end', 'url', 'note', 'pokemon', 'hidden', 'tier', 'tz', 'public', 'from', 'starred', 'hosts'];
// User-only fields: never in the Leek Duck copy, never marked as edited. tz = IANA zone of the event's city;
// public = include this event (or day) in public/public.json on Publish; from = who suggested an imported event;
// starred = "name|act" keys of starred Pokémon the user didn't add; hosts = trainer meetups for the event.
const USER_ONLY = ['note', 'hidden', 'tier', 'tz', 'public', 'from', 'starred', 'hosts'];
// What a published Leek Duck event carries besides its edited fields.
const PUBLISHED_USER_FIELDS = ['note', 'hidden', 'tier', 'tz', 'starred', 'hosts'];
const isSet = (v) => (Array.isArray(v) ? v.length > 0 : !!v);
const TIERS = ['', 'super', 'major', 'weekly', 'minor'];
const FROM_LD = ['title', 'type', 'typeLabel', 'start', 'end', 'url', 'image', 'pokemon'];

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
function writeJson(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(obj, null, 1));
  fs.renameSync(`${f}.tmp`, f);
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const touched = (ev) => ev.edited.length > 0 || USER_ONLY.some((f) => isSet(ev[f]));

class Store {
  constructor(file, pubFile = file.replace(/\.json$/, '-public.json')) {
    this.file = file;
    this.pubFile = pubFile;
    this.data = { version: 2, lastRefresh: 0, lastError: '', events: {}, days: {}, dropped: [] };
    this.orphans = {}; // overlays for Leek Duck events not in store-public.json (yet): kept as they are
    const priv = readJson(file);
    const pub = readJson(pubFile);
    if (priv && priv.version !== 2) {
      // Version 1: one file with the Leek Duck copies inside. Kept as a backup, split on the next save.
      const backup = file.replace(/\.json$/, '-v1-backup.json');
      if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
      this.legacy = true;
      this.data = { ...this.data, campfire: {}, ...priv, version: 2 };
      for (const [id, rec] of Object.entries(pub?.events || {})) if (!this.data.events[id]) this.addLd(rec);
      return;
    }
    if (pub) {
      this.data.lastRefresh = pub.lastRefresh || 0;
      this.data.lastError = pub.lastError || '';
      for (const rec of Object.values(pub.events || {})) this.addLd(rec);
    }
    for (const [id, ov] of Object.entries(priv?.events || {})) {
      if (ov.source === 'user') this.data.events[id] = ov;
      else if (this.data.events[id]) this.applyOverlay(this.data.events[id], ov);
      else this.orphans[id] = ov;
    }
    this.data.days = priv?.days || {};
    this.data.dropped = priv?.dropped || [];
    this.data.campfire = priv?.campfire || {};
  }

  // The user's own marks on a Campfire meetup (lib/campfire.js): {going, pokemon}. Private, never published.
  setCampfire(id, body) {
    if (!/^[\w-]{8,64}$/.test(id)) return null;
    const mine = { going: !!body.going, pokemon: clean('pokemon', body.pokemon || []) };
    if (!mine.going && !mine.pokemon.length) delete this.data.campfire[id];
    else this.data.campfire[id] = mine;
    this.save();
    return mine;
  }

  // A Leek Duck event from its scraped record, with the user's overlay if one is waiting.
  addLd(rec) {
    const ev = { id: rec.id, source: 'leekduck', edited: [], note: '', hidden: false, ld: rec };
    for (const f of FROM_LD) ev[f] = rec[f];
    this.data.events[rec.id] = ev;
    if (this.orphans[rec.id]) { this.applyOverlay(ev, this.orphans[rec.id]); delete this.orphans[rec.id]; }
    return ev;
  }

  applyOverlay(ev, ov) {
    for (const [f, v] of Object.entries(ov)) if (f !== 'id' && f !== 'source' && f !== 'ld') ev[f] = v;
    ev.edited = ov.edited || [];
  }

  save() {
    const pub = { version: 2, lastRefresh: this.data.lastRefresh, lastError: this.data.lastError, events: {} };
    const priv = { version: 2, events: { ...this.orphans }, days: this.data.days, dropped: this.data.dropped || [],
      ...(Object.keys(this.data.campfire || {}).length ? { campfire: this.data.campfire } : {}) };
    for (const ev of Object.values(this.data.events)) {
      if (!ev.ld) { priv.events[ev.id] = ev; continue; }
      pub.events[ev.id] = ev.ld;
      if (touched(ev)) {
        priv.events[ev.id] = { id: ev.id, source: 'leekduck', edited: ev.edited, ...pick(ev, ev.edited),
          ...pick(ev, USER_ONLY.filter((f) => isSet(ev[f]))) };
      }
    }
    writeJson(this.pubFile, pub);
    writeJson(this.file, priv);
  }

  // Leek Duck records from elsewhere (the live site's events.json) for events this store lacks, e.g. past
  // ones a fresh copy never scraped. Records already here are left alone. Returns the number added.
  seedFrom(list) {
    let n = 0;
    for (const rec of list || []) if (rec?.id && !this.data.events[rec.id]) { this.addLd(rec); n++; }
    if (n && this.published) this.adoptPublished(this.published);
    return n;
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
      const ev = this.data.events[s.id];
      if (!ev) { this.addLd(s); continue; }
      ev.ld = s;
      for (const f of FROM_LD) if (!ev.edited.includes(f)) ev[f] = s[f];
    }
    this.data.lastRefresh = Date.now();
    this.data.lastError = '';
    if (this.published) this.adoptPublished(this.published);
    this.save();
  }

  // Takes in what public/public.json holds but this store lacks (a fresh or older store), so the page shows it
  // and the next Publish keeps it. Never overwrites the owner's own changes. Returns the number taken in.
  adoptPublished(pub) {
    this.published = pub;
    const dropped = new Set(this.data.dropped || []);
    let n = 0;
    for (const [id, patch] of Object.entries(pub.events || {})) {
      const ev = this.data.events[id];
      if (patch.source === 'user') {
        if (ev || dropped.has(id)) continue;
        const add = { id, source: 'user', edited: [], note: '', hidden: false, pokemon: [], typeLabel: '', image: '' };
        for (const f of EDITABLE) if (f in patch) add[f] = clean(f, patch[f]);
        for (const f of ['typeLabel', 'image']) if (patch[f]) add[f] = String(patch[f]);
        this.data.events[id] = { ...add, public: true };
        n++;
      } else if (ev?.ld && !ev.public && !ev.edited.length && !USER_ONLY.some((f) => isSet(ev[f]))) {
        for (const f of [...(patch.edited || []), ...PUBLISHED_USER_FIELDS]) {
          if (f in patch && EDITABLE.includes(f)) ev[f] = clean(f, patch[f]);
        }
        ev.edited = FROM_LD.filter((f) => JSON.stringify(ev[f]) !== JSON.stringify(ev.ld[f]));
        ev.public = !patch.meetupsOnly; // meetups alone don't make the event public
        n++;
      }
    }
    for (const [id, m] of Object.entries(pub.campfire || {})) {
      if (this.data.campfire?.[id] || !/^[\w-]{8,64}$/.test(id)) continue;
      (this.data.campfire ||= {})[id] = { going: false, pokemon: clean('pokemon', m.pokemon || []) };
      n++;
    }
    for (const [d, day] of Object.entries(pub.days || {})) {
      if (this.data.days[d] || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      this.data.days[d] = { rest: !!day.rest, note: String(day.note || '').slice(0, 2000), pokemon: clean('pokemon', day.pokemon || []), public: true };
      n++;
    }
    return n;
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
      // Not taken back in from public.json before the next Publish.
      this.data.dropped = [...new Set([...(this.data.dropped || []), id])].slice(-200);
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

  // The companion file for the static site: events and days flagged public. A Leek Duck event
  // contributes just the fields the user changed (merged over the snapshot by the page); a user event goes whole.
  // Meetups are published by default: a Leek Duck event that isn't public still contributes its meetups alone
  // (`meetupsOnly`), and so do the owner's targets on Campfire meetups. `going` (attending) stays private.
  publicSnapshot() {
    const events = {};
    for (const ev of Object.values(this.data.events)) {
      const hosts = (ev.hosts || []).map(({ going: _g, ...h }) => h);
      if (!ev.public) {
        if (ev.ld && hosts.length) events[ev.id] = { edited: [], hosts, meetupsOnly: true };
        continue;
      }
      if (!ev.ld) {
        const { public: _p, ld: _l, ...rest } = ev;
        events[ev.id] = { ...rest, ...(ev.hosts ? { hosts } : {}) };
      } else {
        const patch = { edited: ev.edited };
        for (const f of [...ev.edited, ...PUBLISHED_USER_FIELDS]) patch[f] = f === 'hosts' && ev.hosts ? hosts : ev[f];
        events[ev.id] = patch;
      }
    }
    const days = {};
    for (const [d, day] of Object.entries(this.data.days)) if (day.public) { const { public: _p, ...rest } = day; days[d] = rest; }
    const campfire = {};
    for (const [id, m] of Object.entries(this.data.campfire || {})) if (m.pokemon?.length) campfire[id] = { pokemon: m.pokemon };
    return { publishedAt: Date.now(), events, days, ...(Object.keys(campfire).length ? { campfire } : {}) };
  }
}

function clean(field, v) {
  if (field === 'hidden' || field === 'public') return !!v;
  if (field === 'tier') return TIERS.includes(v) ? v : '';
  if (field === 'from') return String(v || '').slice(0, 40);
  if (field === 'tz') return /^[A-Za-z_]+(\/[A-Za-z_]+){0,2}$/.test(v || '') ? v : '';
  if (field === 'starred') return [...new Set((Array.isArray(v) ? v : []).map((k) => String(k).slice(0, 90)))].slice(0, 60);
  if (field === 'hosts') {
    const time = (t) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t || '') ? t : '');
    return (Array.isArray(v) ? v : []).slice(0, 20).map((h) => ({ host: String(h.host || '').slice(0, 60),
      venue: String(h.venue || '').slice(0, 120), start: time(h.start), end: time(h.end),
      ...(/^https?:\/\/\S+$/.test(h.map || '') ? { map: String(h.map).slice(0, 400) } : {}),
      ...(h.going ? { going: true } : {}),
      ...((h.pokemon || []).length ? { pokemon: clean('pokemon', h.pokemon) } : {}) })).filter((h) => h.host || h.venue);
  }
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
      // Location Background (place name; lbgTicket: ticket holders only) and debut ('new' or 'shiny').
      ...(p.lbg ? { lbg: String(p.lbg).slice(0, 60), ...(p.lbgTicket ? { lbgTicket: true } : {}) } : {}),
      ...(['new', 'shiny'].includes(p.debut) ? { debut: p.debut } : p.debut === true ? { debut: 'new' } : {}),
      // Added by the user (not Leek Duck); only these can be starred or carry a comment.
      ...(p.mine ? { mine: true, star: !!p.star, comment: String(p.comment || '').slice(0, 500) } : {}),
      ...(p.mine && p.from ? { from: String(p.from).slice(0, 40) } : {}),
    })).filter((p) => p.name);
  }
  return String(v ?? '').slice(0, field === 'note' ? 4000 : 400);
}

module.exports = { Store };
