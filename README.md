# Meridian

A live world map of reported strikes, explosions, industrial fires, wildfires and environmental incidents. A hollow orange ring marks a report from one source; a solid pink dot marks two or more independent sources. Reports are news headlines and social posts, not confirmed facts.

**Beta, for testing only:** events are matched automatically from real news headlines and may be wrong, incomplete or out of date. The page says so at the top left.

It's a static page: no server, build step, API keys or sign-up. GitHub Pages serves the files and everything else happens in the visitor's browser.

```
 news.sala.company/feed.json          your browser
 (rebuilt every ~5 min on GitHub)     ┌─────────────────────────────────────────────┐
 ~120 news, Telegram, Bluesky ──────▶ │ every 60 s: fetch feed.json + poll Bluesky  │
 sources                              │ → keep headlines that name a strike + place │
                                      │ → merge reports within 50 km and 3 hours    │
                                      │ → draw on an Equal Earth map                │
                                      └─────────────────────────────────────────────┘
```

## The map

The map uses the **Equal Earth** projection, which keeps every country at its true relative size. On the usual Mercator map Europe, Russia and Greenland are stretched and Africa, South America and South Asia are shrunk. Drag to pan, scroll or pinch to zoom; **Full view** (or the `0` key) goes back to the whole world. **Key** explains every symbol.

### Markers

- **Sources:** one source is a hollow ring (and a dashed disc); two or more independent sources is a solid dot (and a solid disc). Shape carries the meaning, so it reads without color. The colors, orange and pink from the [Okabe-Ito palette](https://jfly.uni-koeln.de/color/), also stay distinct with red-green color blindness. The feed spells out the count ("1 source", "3 sources").
- **What happened:** the icon inside the marker: airstrike (bomb), missile (rocket), explosion (burst), shelling (crosshair), drone, fire (flame), wildfire (tree), environmental (leaf), other (warning sign). Not every marker is an attack: explosions and fires may be accidents or covert action. **Fire** counts only at a facility (refinery, fuel depot, factory, power plant, port or ship, airport, railway, military site), so house fires stay out. **Wildfire** covers forest, bush, grass and peat fires. **Environmental** covers oil and chemical spills, gas, pipeline and radiation leaks, dam breaches, mine accidents and polluted rivers or seas.
- **What was hit:** a small badge on the marker when the headline names it: airport, oil/fuel, power, railway, bridge, port/ship, military site, industry/warehouse, hospital, homes/civilian. Read from the headline only, and an event shows the target most of its headlines name. The rules are `TARGET_RULES` in [`extract.js`](extract.js).

## How a headline becomes a dot

1. **Sources.** The page reads [news.sala.company](https://news.sala.company)'s `feed.json`, the same collection of ~120 public news sites, Telegram channels and Bluesky accounts, and polls the feed's Bluesky accounts directly every minute. Tech, business and science stories are skipped.
2. **Kind of event.** The headline must name a kind of strike (drone, missile, airstrike, shelling, explosion, or a bare "strike" / "attack" from conflict-focused sources) *and* say something happened (hit, killed, intercepted, shot down…). Headlines about tests, arms deals, drone makers or what *might* happen are dropped. So are stories that look back at an older attack, since their publish time is new but the event isn't: wording like "were warned… Then a drone hit", "months ago", "investigation", "how the…", or a month other than the current one ("in March"). The word lists are at the top of [`extract.js`](extract.js).
3. **Place.** The headline is matched against about 4,500 place names: every country on the map, every capital plus each country's 10 largest other cities ([`cities.js`](cities.js), from GeoNames), the provinces of 21 countries common in conflict and disaster news ([`provinces.js`](provinces.js), from Natural Earth: Ukraine, Russia, Iran, Iraq, Syria, Yemen, Sudan, Israel, Palestine, Lebanon, Nigeria, Ethiopia, Somalia, DR Congo, Pakistan, India, Myanmar, Turkey, Mexico, Brazil, China), and ~500 hand-picked towns and regions ([`places.js`](places.js)). The most specific place wins (a city beats a region beats a country), preferring a place right after words like "in", "on" or "hits". "Kursk region", "Zaporizhzhia Oblast" or "Rivers State" pick the province even when the name is also a city; province names that are common words ("Rivers", "Delta", "Fars") only count with such a suffix. A place that is the speaker ("Russia says", "Moscow warns") isn't used, and a whole country needs a cue ("in Russia", "Russia's").
4. **Merging.** Reports of compatible kinds within 50 km and 3 hours of each other become one event. Google News items count as the outlet named at the end of the headline.
5. **Independent sources.** An event turns solid when **two or more independent sources** report it. Headlines count as one source when they come from the same outlet, credit the same wire story (Reuters, AP or AFP: "Source: Reuters", "according to AP", "Reuters reports"), are near-identical reprints (70% of their words shared), or come from outlets with the same owner (`OWNER_GROUPS` in [`app.js`](app.js): RT and Sputnik, Anadolu and TRT World, Al Jazeera's channels…).

6. **Weak reports correct themselves.** An event with one source that is only social posts (and doesn't credit a wire agency), or that only names a whole country, is drawn faintly. If no second independent source confirms it within 6 hours (`WEAK_HOURS` in `app.js`), it leaves the map; it stays in the feed list, dimmed, with a note.

7. **Satellite heat.** Every hour the deploy workflow downloads NASA FIRMS detections (VIIRS on S-NPP and NOAA-20, last 48 hours) near known cities into `fires.json` ([`scripts/fires.mjs`](scripts/fires.mjs)). A city event with a detection within 10 km, from 12 hours before its first report to 24 hours after its last, gets a **heat** tag and a line in its card, and is never treated as weak. It's supporting evidence, not proof: industry, gas flares and farm fires show up too. This needs a free NASA key stored as the repository secret `FIRMS_MAP_KEY`; without it the map works the same, with no satellite notes.

Every info card has a **Why this is on the map** box: the words that set the type, the place (with how precise it is), the target, and how the headlines were counted ("3 headlines by 3 outlets → 2 independent sources", with what was counted once and why). The matched words are highlighted in each headline, so a wrong pin shows exactly what the rules misread.

Every event gets a marker; regions and whole countries also get a disc of 100 km or 300 km. Markers fade as they age, and the **1h / 6h / 12h / 24h / 48h** buttons set how far back the map goes (48 hours is everything the feed keeps). Only reports are drawn on the map; the featured locations in the left panel are shortcuts and have no marker.

This is keyword matching, not reading comprehension, so expect some misses and the odd wrong pin. Click any event to see the headlines behind it.

## Status pill

- **Live**: the feed was rebuilt in the last 20 minutes.
- **Delayed**: the feed is older than that (its timer may have stalled; see news.sala.company's README).
- **Reconnecting / Offline**: the feed couldn't be fetched; the page retries every minute.

Hover over the pill for the feed's age and when Bluesky was last checked.

## Tests and publishing

[`tests/headlines.json`](tests/headlines.json) holds real and typical headlines with the right answer: what kind of event, where, what was hit, or "not an event". It includes every mistake that has been fixed (the old Kuwait story, "Russia says…", the Cardón refinery fire…), so they can't come back. On every push, [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs `node tests/run.mjs`; only if every case passes does it publish the site to GitHub Pages. If a case fails, the last good version stays live and GitHub emails the failure. When a rule is fixed, add its headline as a new case.

### Satellite key

1. Request a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/ (email only; it arrives by email).
2. Add it to this repository: **Settings → Secrets and variables → Actions → New repository secret**, name `FIRMS_MAP_KEY`. Or run `gh secret set FIRMS_MAP_KEY -R jamalxcode/globe` and paste the key when asked.

The next hourly run (or **Actions → Test and deploy → Run workflow**) publishes `fires.json`. GitHub pauses scheduled workflows in a repository with no commits for 60 days; if that happens, the satellite data stops refreshing until the next push or a manual run.

## Editing

- **Add a place:** add a line to `PLACE_LINES` in `places.js` (`Name;Alias|Country|lat|lng`, with `|r` at the end for a region). Names match case-sensitively on whole words, so leave out places whose names are common words. `places.js` wins when a name is also in `cities.js`.
- **Capitals and large cities:** `cities.js` is generated, so don't edit it by hand. To regenerate it, download `cities15000.zip` (unzipped) and `countryInfo.txt` from [GeoNames](https://download.geonames.org/export/dump/) into a folder and run `powershell -File scripts\build-cities.ps1 -Data <that folder>`. Names that are common words or people's names (Nice, Split, Male, David, Kanye…) or better known as somewhere else (Washington, Waterloo, Valencia…) are listed in [`scripts/city-skip.txt`](scripts/city-skip.txt). When two countries share a city name, the bigger city keeps it.
- **Add a source:** add it to `sources.json` in the [the-world-now](https://github.com/jamalxcode/the-world-now) repo. Meridian picks it up on the next feed build.
- **Featured locations:** `FEATURED_PLACES` at the bottom of `places.js`.

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout |
| `style.css` | Look (same palette and fonts as the original Meridian) |
| `app.js` | Loads the feed, merges reports into events, draws the map and panels |
| `extract.js` | The rules that turn a headline into a report: kind of strike, place, source |
| `places.js` | Hand-picked places, country aliases and featured locations |
| `cities.js` | Every capital plus each country's 10 largest other cities (generated) |
| `provinces.js` | Provinces of 21 countries (generated) |
| `scripts/` | The generators for `cities.js` and `provinces.js`, and the city skip list |

To regenerate `provinces.js`, download `ne_10m_admin_1_label_points_details.geojson` from [Natural Earth's repository](https://github.com/nvkelso/natural-earth-vector/tree/master/geojson) and run `powershell -File scripts\build-provinces.ps1 -Points <that file>`. The country list and the suffix-only names are at the top of the script.

Libraries are kept in [`vendor/`](vendor), so the map doesn't depend on a CDN: [d3](https://d3js.org) 7.9.0 (map drawing), [topojson](https://github.com/topojson/topojson) 3.0.2 and [world-atlas](https://github.com/topojson/world-atlas) 2.0.2 (country shapes, from Natural Earth). Only the fonts still come from Google Fonts; without them the page falls back to system fonts. Icons adapted from [Lucide](https://lucide.dev) (ISC license). City data © [GeoNames](https://www.geonames.org), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Province data from [Natural Earth](https://www.naturalearthdata.com) (public domain).

## Run locally

Any static file server works, for example `python -m http.server 8000` in this folder, then open http://localhost:8000. Opening `index.html` straight from disk also works in most browsers.
