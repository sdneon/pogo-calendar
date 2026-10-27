# PoGo Calendar (SG)

A monthly calendar of Pokémon GO events, filled automatically from [Leek Duck](https://leekduck.com/events/), for event planning (from raid hours to Community Days and major events…). All times are Singapore time (SGT).

**Open the calendar: [Live Page](https://sdneon.github.io/pogo-calendar/)**

Unofficial fan tool. Event data and Pokémon icons: Leek Duck. Pokémon GO is a trademark of Niantic; Pokémon of Nintendo, Creatures and Game Freak.

## Using the calendar

Open the [calendar page](https://sdneon.github.io/pogo-calendar/). The **?** button on the page explains everything below as well.

### Reading it

- **Big icons** are the Pokémon of events that draw crowds: Raid Hour, Spotlight Hour, Raid Days, Max Battle Days, Max Monday, Community Day and global GO Fest / Tour / Wild Area days. **Small icons in a day's bottom-right corner** are the week's raid bosses, and thin **bars** show how long each rotation runs. Each Max Monday also gets a Monday–Sunday bar, because its Dynamax Pokémon stays in Max Battles all week. Smaller events (GO Battle League, passes, research…) appear when you click a day; Pokémon you've starred or added in them still show as big icons.
- **Pins** on an icon:
  - bottom-right: the activity (★: raid, M: Mega, M+: Super Mega, Sh: Shadow, D: Dynamax, G: Gigantamax, CD: Community Day, H: Hatch, SH: Spotlight Hour, R: Research, W: Wild spawn);
  - top-right: ✦ when shiny is available;
  - bottom-left: BG when a special background is mentioned;
  - left edge: a wireframe globe 🌐 for a **Location Background** (a photo of the event's city, e.g. Sendai). These usually come only from in-person raids and Max Battles at that event, sometimes for ticket holders only, and never to remote players;
  - top: **NEW** for a Pokémon GO debut, gold for a shiny debut;
  - top-left: a padlock when the Pokémon is region-locked. It's teal for Asia-Pacific and orange for another region.

  Tap a pin in the legend to hide that activity.
- **Hover an icon** for a bigger picture with details:
  - shiny and legendary status;
  - its type(s), in type colours;
  - for a Mega, whether it can reach Super Max (Mega Level 4), and the extra Charged Attack that brings. Newly unlocked ones show their unlock day (a Super Mega Raid Day unlocks its Mega from that day);
  - for Spotlight Hours, the special bonus (e.g. 2× Catch Stardust);
  - the hundo catch CP, normal and weather boosted;
  - the event and its times;
  - for an orange padlock, when the event is live in that region, in SGT, for remote battles.

  Hovering an event bar shows the event's times and its Pokémon, with types. Hovering an event's name (an orange or ✈ day's title, a major event's time line, a "Running this month" chip) shows the same box as in the day panel.
- **Meetups:** a 📍 pin beside a day's date means a trainer is hosting a meetup that day; hover it for the host, venue, time and event. Event, bar and Pokémon tooltips list the event's meetups too. **Right-click the pin** to mark that you're attending (the pin gets a circle); with several meetups that day, it opens the day so you can press **Attending?** on the right one. Whether you attend is never published.
- **Day colours:**
  - orange: super major event, with its name on top;
  - periwinkle: overseas event (✈). Times are converted to SGT, and raids need a Remote Raid Pass;
  - pale green: a rest day;
  - pale grey: nothing major, so a good day to rest.

  Seasons and other events longer than 14 days are under "Running this month".

### Making it your own

- **Click a day** to add **target Pokémon**, write a note or tick **Rest day**. While a day is open, clicking any date closes it. You can pick a form, e.g. "Giratina (Origin)". ☆ stars a target, which shows a rainbow ring, and you can give it a comment that shows when you hover it.
- **Edit** any event: title, times, Pokémon, how it's shown (super major / major / weekly / minor), and its location (time zone). **+ Add event** adds your own. Your own events come first among events of the same kind; to make one stand out, set **Shown as** to *Super major* (orange day, name on top) or *Major* (big icons). **Undo my changes** puts an event back as it was.
- **Star** any of an event's Pokémon (☆ in its editor) to make it a target, without adding it again. It then shows on the calendar with a rainbow ring, even for a smaller event, and starred Pokémon always come first on a day.
- **Meetups:** in an event's editor, **Add a meetup** records a trainer hosting a get-together for it: host, venue, start and end time (SGT, filled in from the event), and optionally a map link for the venue (a venue you've used before is suggested, with its map link filled in). Each meetup can also have its own **targets**: Pokémon shown (and starrable) only on that meetup's days, handy when a multi-day event has different meetups with different targets. Meetups show on the event's box, with a **Map** link in the day panel. As the owner, your meetups and their targets go on the public site with the next **Publish**, even if the event itself isn't ticked public (except meetups on your own private events); whether you attend is never published.
- **On the public site, your changes are saved only in your browser** on that device. Nobody else sees them, and they're not sent anywhere. Clearing your browser data removes them, so keep a copy with Export.
- **Export** saves your changes (rest days, targets, stars, comments, event edits) as a small file, to keep or share. You can add your name, so whoever imports it sees who suggested what. **Import** adds such a file, from another device or a friend, to your calendar. Nothing already there is removed: rest days are combined, notes are appended, and targets are added, marked with the sender's name.
  - Share with site admin if you want it published for all.

## Running your own copy (owner)

### Local server

Double-click `start.bat`. It starts the server and opens <http://localhost:8642/>. It uses `node` on PATH. To use another `node.exe`, set `NODE_EXE` in a `start.local.bat` next to it, which is git-ignored because it holds this PC's paths:

    set "NODE_EXE=<full path of node.exe>"

- **Without opening a browser:** run `start.bat nobrowser`, or add `set "NO_BROWSER=1"` to `start.local.bat`.
- **A new copy** (e.g. a fresh clone) fills itself in at startup: Leek Duck events, past ones included, come from the public site's `events.json`, and what `public/public.json` already publishes is taken in, so a later Publish keeps it. Your private changes don't travel this way; move them with Export / Import.
- **Stopping:** close the server's window, or double-click `stop.bat`. It ends whatever is listening on the server's port (`PORT`, default 8642).
- **Opening from disk:** you can also open `public/calendar.html` directly. It talks to the server on port 8642 when that's running, and shows its last saved copy (read only) when it isn't.
- **Refreshing:** the server checks Leek Duck every 6 hours; **Check Leek Duck** checks now. Your edits to a Leek Duck event are kept field by field when it updates.
- **Server settings** (environment variables): `PORT` (default 8642), `REFRESH_HOURS` (default 6), `NO_REFRESH=1` (never contact Leek Duck), `SITE_URL` (the public site, normally worked out from the GitHub remote), `NO_SEED=1` (don't fetch from it), `NO_CAMPFIRE=1` (don't fetch Campfire meetups).
- **Campfire meetups:** the server also fetches Singapore trainer meetups from [Campfire](https://campfire.scopely.com/discover) every 6 hours. They get the same 📍 pin as your own meetups, and the day panel lists them with links to Campfire and a map; you can mark one as attending and give it your own targets. The **Campfire meetups** switch hides them. The public site shows them too (refreshed with each site build), with the owner's targets once published (attending stays private); visitors' own attending marks and targets stay in their browser. This uses the API behind Campfire's web page, which isn't official and may change.
- **Opening a given month:** `http://localhost:8642/#2026-11`.

### Public site (GitHub Pages)

Visitors see the Leek Duck snapshot plus anything you published. Their own changes stay in their browser.

- **Make something public:** on the local server (not the public site, which has no server to publish from), tick *Show … on the public site* on an event or a day. Everything you don't tick stays private, on your PC.
- **Review and publish:** **Public…** lists everything you've ticked, each with **Make private**, and says whether the published file is up to date. **Preview public site** shows exactly what visitors will see, with editing off. **Publish** writes the list to `public/public.json`; commit and push it, and the next site build includes it.
- **Export choices:** as the owner, **Export** asks whether to save all your changes (private and public) or only the public ones.
- **Suggestions from visitors:** importing a visitor's exported file adds it to your *private* store, tagged with their name if they gave one. Review it there, then tick and publish the good parts.
- **Build locally:** `node tools/build_site.js --from-store` writes `site/`. Preview it with `node tools/serve_static.js` at http://localhost:8643/?static.
- **Before every push:** run `node tools/check_public.js`. It scans everything that would be published, plus the built `site/`, for drive paths, user folders and e-mail addresses. It also checks your own patterns (names, e-mail, folders) listed in the git-ignored `private-patterns.txt`, and fails if private files such as `handover.md` stop being git-ignored. Exit code 1 means something was found.
- **On GitHub:**
  1. Push this folder to a repository.
  2. Set Settings > Pages > Source to "GitHub Actions". The workflow `.github/workflows/pages.yml` then scrapes Leek Duck every 6 hours and deploys, without committing anything.
  3. Optionally, set the repository variable `SITE_URL` to the site's address, ending in `/` (like: `https://<username>.github.io/pogo-calendar/`), so each run only fetches new or changed Leek Duck pages and keeps past events.

  `data/` (your store) and `site/` are git-ignored.

### Data

- **Your data:** your own events, edits, days, stars and meetups are in `data/store.json`, a small file worth backing up. Leek Duck's events are in `data/store-public.json`, which can always be rebuilt. Icons are cached in `data/icons/`. An older single-file `store.json` is split on the first start and kept as `store-v1-backup.json`.
- **`public/pokedex.js`** (names, forms, base stats, types, Mega/Primal types, legendary/mythical class) is generated:

      node tools/build_pokedex.js [game_master.json]

  It reads names, stats and types from the companion stats project's `data.js` (`../pogo-stats-comp`), and classes and Mega types from the PokeMiners game master, which is downloaded if no file is given.
