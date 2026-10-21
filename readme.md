# PoGo Calendar (SG)

A monthly calendar of Pokémon GO events, filled automatically from [Leek Duck](https://leekduck.com/events/), for event planning (from raid hours to Community Days and major events…). All times are Singapore time (SGT).

**Open the calendar: [Live Page](https://sdneon.github.io/pogo-calendar/)**

Unofficial fan tool. Event data and Pokémon icons: Leek Duck. Pokémon GO is a trademark of Niantic; Pokémon of Nintendo, Creatures and Game Freak.

## Using the calendar

Open the [calendar page](https://sdneon.github.io/pogo-calendar/). The **?** button on the page explains everything below as well.

### Reading it

- **Big icons** are the Pokémon of events that draw crowds: Raid Hour, Spotlight Hour, Raid Days, Max Battle Days, Max Monday, Community Day and global GO Fest / Tour / Wild Area days. **Small icons in a day's bottom-right corner** are the week's raid bosses, and thin **bars** show how long each rotation runs. Smaller events (GO Battle League, passes, research…) appear when you click a day.
- **Pins** on an icon:
  - bottom-right: the activity (★: raid, M: Mega, M+: Super Mega, Sh: Shadow, D: Dynamax, G: Gigantamax, CD: Community Day, H: Hatch, SH: Spotlight Hour, R: Research, W: Wild spawn);
  - top-right: ✦ when shiny is available;
  - bottom-left: BG when a special background is mentioned;
  - top-left: a padlock when the Pokémon is region-locked. It's teal for Asia-Pacific and orange for another region.

  Tap a pin in the legend to hide that activity.
- **Hover an icon** for a bigger picture with details:
  - shiny and legendary status;
  - the hundo catch CP, normal and weather boosted;
  - the event and its times;
  - for an orange padlock, when the event is live in that region, in SGT, for remote battles.
- **Day colours:**
  - orange: super major event, with its name on top;
  - periwinkle: overseas event (✈). Times are converted to SGT, and raids need a Remote Raid Pass;
  - pale green: a rest day;
  - pale grey: nothing major, so a good day to rest.

  Seasons and other events longer than 14 days are under "Running this month".

### Making it your own

- **Click a day** to add **target Pokémon**, write a note or tick **Rest day**. You can pick a form, e.g. "Giratina (Origin)". ☆ stars a target, which shows a rainbow ring, and you can give it a comment that shows when you hover it.
- **Edit** any event: title, times, Pokémon, how it's shown (super major / major / weekly / minor), and its location (time zone). **+ Add event** adds your own. **Undo my changes** puts an event back as it was.
- **On the public site, your changes are saved only in your browser** on that device. Nobody else sees them, and they're not sent anywhere. Clearing your browser data removes them, so keep a copy with Export.
- **Export** saves your changes (rest days, targets, stars, comments, event edits) as a small file, to keep or share. You can add your name, so whoever imports it sees who suggested what. **Import** adds such a file, from another device or a friend, to your calendar. Nothing already there is removed: rest days are combined, notes are appended, and targets are added, marked with the sender's name.

## Running your own copy (owner)

### Local server

Double-click `start.bat`. It starts the server and opens <http://localhost:8642/>. It uses `node` on PATH. To use another `node.exe`, set `NODE_EXE` in a `start.local.bat` next to it, which is git-ignored because it holds this PC's paths:

    set "NODE_EXE=<full path of node.exe>"

- **Opening from disk:** you can also open `public/calendar.html` directly. It talks to the server on port 8642 when that's running, and shows its last saved copy (read only) when it isn't.
- **Refreshing:** the server checks Leek Duck every 6 hours; **Check Leek Duck** checks now. Your edits to a Leek Duck event are kept field by field when it updates.
- **Server settings** (environment variables): `PORT` (default 8642), `REFRESH_HOURS` (default 6), `NO_REFRESH=1` (never contact Leek Duck).
- **Opening a given month:** `http://localhost:8642/#2026-11`.

### Public site (GitHub Pages)

Visitors see the Leek Duck snapshot plus anything you published. Their own changes stay in their browser.

- **Make something public:** tick *Show … on the public site* on an event or a day. Everything you don't tick stays private, on your PC.
- **Review and publish:** **Public…** lists everything you've ticked, each with **Make private**, and says whether the published file is up to date. **Preview public site** shows exactly what visitors will see, with editing off. **Publish** writes the list to `public/public.json`; commit and push it, and the next site build includes it.
- **Export choices:** as the owner, **Export** asks whether to save all your changes (private and public) or only the public ones.
- **Suggestions from visitors:** importing a visitor's exported file adds it to your *private* store, tagged with their name if they gave one. Review it there, then tick and publish the good parts.
- **Build locally:** `node tools/build_site.js --from-store` writes `site/`. Preview it with `node tools/serve_static.js` at http://localhost:8643/?static.
- **Before every push:** run `node tools/check_public.js`. It scans everything that would be published, plus the built `site/`, for drive paths, user folders and e-mail addresses. It also checks your own patterns (names, e-mail, folders) listed in the git-ignored `private-patterns.txt`, and fails if private files such as `handover.md` stop being git-ignored. Exit code 1 means something was found.
- **On GitHub:**
  1. Push this folder to a repository.
  2. Set Settings > Pages > Source to "GitHub Actions". The workflow `.github/workflows/pages.yml` then scrapes Leek Duck every 6 hours and deploys, without committing anything.
  3. Optionally, set the repository variable `SITE_URL` to the site's address, ending in `/` (here `https://sdneon.github.io/pogo-calendar/`), so each run only fetches new or changed Leek Duck pages and keeps past events.

  `data/` (your store) and `site/` are git-ignored.

### Data

- **Your data:** everything is saved in `data/store.json`, and Leek Duck icons are cached in `data/icons/`. Back up `store.json` if your edits matter.
- **`public/pokedex.js`** (names, forms, base stats, legendary/mythical class) is generated:

      node tools/build_pokedex.js [game_master.json]

  It reads names and stats from the companion stats project's `data.js` (`../pogo-stats-comp`) and classes from the PokeMiners game master, which is downloaded if no file is given.
