'use strict';
// Singapore trainer meetups from Campfire (campfire.scopely.com/discover), read through the GraphQL API its web
// page uses without signing in. Unofficial: it can change or stop working. See design.md "Campfire".

const API = 'https://niantic-social-api.nianticlabs.com/graphql';
const WEB = 'https://campfire.scopely.com/discover/meetup/';
const HEADERS = { 'Content-Type': 'application/json', Origin: 'https://campfire.scopely.com', Referer: 'https://campfire.scopely.com/discover' };
const SG = { sw: { lat: 1.2, lng: 103.6 }, ne: { lat: 1.48, lng: 104.05 } };
const KEEP_DAYS = 90;

// Game events Campfire groups meetups by ("Chandelure Super Mega Raid Day", "Into the Wild Day 1"…).
const LIVE = `query($input: MarketableCampfireLiveEventsInput!) { marketableCampfireLiveEvents(input: $input) { id eventName } }`;
const MEETUPS = `query($input: MeetupMapObjectsByLiveEventIdInLatLngBoundsInput!) {
  meetupMapObjectsByLiveEventIdInLatLngBounds(input: $input) { mapObjects { event { id } } } }`;
// Only what the calendar shows: no attendee list, no comments.
const DETAIL = `query($id: ID!) { event(id: $id) { id name address details eventTime eventEndTime location visibility
  creator { displayName } club { name } campfireLiveEvent { eventName } members { totalCount } } }`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gql(query, variables) {
  const r = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error(`Campfire ${r.status}`);
  const j = await r.json();
  if (j.errors) throw new Error(`Campfire: ${j.errors.map((e) => e.message).join('; ').slice(0, 200)}`);
  return j.data;
}
// Singapore has no DST: UTC+8 wall time, as the store keeps meetup times.
const sgt = (iso) => (iso ? new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 16) : '');
const inSg = ([lng, lat]) => lat >= SG.sw.lat && lat <= SG.ne.lat && lng >= SG.sw.lng && lng <= SG.ne.lng;

// `known`: id -> previous record (details reused for detailMaxAgeMs). Returns the full list: what Campfire lists
// now, plus earlier ones that dropped off and ended less than KEEP_DAYS ago.
async function fetchCampfire(known = {}, { now = Date.now(), delayMs = 1000, detailMaxAgeMs = 12 * 3600e3, log = () => {} } = {}) {
  const live = (await gql(LIVE, { input: { game: 'PGO' } })).marketableCampfireLiveEvents.filter(Boolean);
  const ids = new Set();
  for (const ev of live) {
    await sleep(delayMs);
    const d = await gql(MEETUPS, { input: { liveEventId: ev.id, bounds: SG, zoomLevel: 12 } });
    for (const o of d.meetupMapObjectsByLiveEventIdInLatLngBounds?.mapObjects || []) if (o?.event?.id) ids.add(o.event.id);
  }
  log(`${live.length} game events, ${ids.size} Singapore meetups`);
  const out = [];
  for (const id of ids) {
    const prev = known[id];
    if (prev && now - prev.fetchedAt < detailMaxAgeMs) { out.push(prev); continue; }
    await sleep(delayMs);
    try {
      const e = (await gql(DETAIL, { id })).event;
      const loc = JSON.parse(e?.location || '[]');
      if (!e || e.visibility !== 'public' || loc.length !== 2 || !inSg(loc)) continue;
      out.push({ id, name: String(e.name || '').slice(0, 120), liveEvent: e.campfireLiveEvent?.eventName || '',
        start: sgt(e.eventTime), end: sgt(e.eventEndTime), address: String(e.address || '').slice(0, 200),
        lat: loc[1], lng: loc[0], host: e.creator?.displayName || '', club: e.club?.name || '',
        going: e.members?.totalCount || 0, details: String(e.details || '').slice(0, 400), url: WEB + id, fetchedAt: now });
    } catch (err) {
      log(`detail failed: ${id}: ${err.message}`);
      if (prev) out.push(prev);
    }
  }
  const listed = new Set(out.map((m) => m.id));
  const cutoff = now - KEEP_DAYS * 86400e3;
  for (const m of Object.values(known)) if (!listed.has(m.id) && Date.parse(`${m.end || m.start}:00+08:00`) > cutoff && Date.parse(`${m.end || m.start}:00+08:00`) < now) out.push(m);
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

module.exports = { fetchCampfire };
