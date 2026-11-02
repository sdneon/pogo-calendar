'use strict';
// Local file name for a Leek Duck CDN icon. Same rule as iconFile() in public/calendar.js.
const CDN = /^https:\/\/cdn\.leekduck\.com\//;
const iconFile = (url) => url.replace(CDN, '').replace(/[^\w.-]+/g, '_').slice(-180);
// Leek Duck icons named in public.json: the owner's published events, meetup targets, day targets and Campfire targets.
function publishedIcons(pub) {
  const mons = [...Object.values(pub?.events || {}).flatMap((e) => [...(e.pokemon || []), ...(e.hosts || []).flatMap((h) => h.pokemon || [])]),
    ...Object.values(pub?.days || {}).flatMap((d) => d.pokemon || []),
    ...Object.values(pub?.campfire || {}).flatMap((c) => c.pokemon || [])];
  return [...new Set(mons.map((p) => p.icon).filter((u) => u && CDN.test(u)))];
}
module.exports = { CDN, iconFile, publishedIcons };
