# Meridian

A live world map of reported strikes and explosions. A hollow orange ring marks a report from one source; a solid pink dot marks two or more independent sources. Reports are news headlines and social posts, not confirmed facts.

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
- **What happened:** the icon inside the marker: airstrike (bomb), missile (rocket), explosion (burst), shelling (crosshair), drone, other (warning sign).
- **What was hit:** a small badge on the marker when the headline names it: airport, oil/fuel, power, railway, bridge, port/ship, military site, industry/warehouse, hospital, homes/civilian. Read from the headline only, and an event shows the target most of its headlines name. The rules are `TARGET_RULES` in [`extract.js`](extract.js).

## How a headline becomes a dot

1. **Sources.** The page reads [news.sala.company](https://news.sala.company)'s `feed.json`, the same collection of ~120 public news sites, Telegram channels and Bluesky accounts, and polls the feed's Bluesky accounts directly every minute. Tech, business and science stories are skipped.
2. **Kind of event.** The headline must name a kind of strike (drone, missile, airstrike, shelling, explosion, or a bare "strike" / "attack" from conflict-focused sources) *and* say something happened (hit, killed, intercepted, shot down…). Headlines about tests, arms deals, drone makers or what *might* happen are dropped. The word lists are at the top of [`extract.js`](extract.js).
3. **Place.** The headline is matched against about 2,700 place names: every country on the map, every capital plus each country's 10 largest other cities ([`cities.js`](cities.js), from GeoNames), and ~400 hand-picked conflict-zone towns and regions ([`places.js`](places.js)). The most specific place wins (a city beats a region beats a country), preferring a place right after words like "in", "on" or "hits".
4. **Merging.** Reports of compatible kinds within 50 km and 3 hours of each other become one event. Each outlet counts once, so an event becomes "corroborated" (solid) when two different outlets report it. Google News items count as the outlet named at the end of the headline.

Every event gets a marker; regions and whole countries also get a disc of 100 km or 300 km. Markers fade as they age, and the **1h / 6h / 12h / 24h / 48h** buttons set how far back the map goes (48 hours is everything the feed keeps). Only reports are drawn on the map; the featured locations in the left panel are shortcuts and have no marker.

This is keyword matching, not reading comprehension, so expect some misses and the odd wrong pin. Click any event to see the headlines behind it.

## Status pill

- **Live**: the feed was rebuilt in the last 20 minutes.
- **Delayed**: the feed is older than that (its timer may have stalled; see news.sala.company's README).
- **Reconnecting / Offline**: the feed couldn't be fetched; the page retries every minute.

Hover over the pill for the feed's age and when Bluesky was last checked.

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
| `scripts/` | The generator for `cities.js` and its skip list |

Libraries load from public CDNs: [d3](https://d3js.org) (map drawing), [topojson](https://github.com/topojson/topojson) and [world-atlas](https://github.com/topojson/world-atlas) (country shapes, from Natural Earth). Icons adapted from [Lucide](https://lucide.dev) (ISC license). City data © [GeoNames](https://www.geonames.org), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Run locally

Any static file server works, for example `python -m http.server 8000` in this folder, then open http://localhost:8000. Opening `index.html` straight from disk also works in most browsers.
