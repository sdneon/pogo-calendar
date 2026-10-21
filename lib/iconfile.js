'use strict';
// Local file name for a Leek Duck CDN icon. Same rule as iconFile() in public/calendar.js.
const CDN = /^https:\/\/cdn\.leekduck\.com\//;
const iconFile = (url) => url.replace(CDN, '').replace(/[^\w.-]+/g, '_').slice(-180);
module.exports = { CDN, iconFile };
