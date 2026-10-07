// Meridian: a live equal-area map of reported strikes and explosions.
// Runs entirely in the browser. Headlines come from news.sala.company's feed.json (rebuilt every ~5 min
// on GitHub) plus the feed's Bluesky accounts, polled live. Each headline that names a kind of strike and a
// known place becomes a report; reports of the same kind within 50 km and 3 hours merge into one event.
// Amber = one source. Red = two or more independent sources.
"use strict";

const FEED_URL = "https://news.sala.company/feed.json";
const ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
const POLL_S = 60;
const MERGE_KM = 50;
const MERGE_MS = 3 * 3600e3;
const MAX_EVENTS = 200;
const STALE_MIN = 20; // feed older than this shows "Delayed"
const WINDOWS_H = [6, 24, 48];
const DEFAULT_WINDOW_H = 24;
const SKIP_CATEGORIES = new Set(["tech", "biz", "science"]);
// "Other" (a bare "strike" or "attack") is only trusted from conflict-focused sources.
const OTHER_CATEGORIES = new Set(["osint", "mideast", "defense"]);

const EVENT_TYPES = ["airstrike", "missile", "explosion", "shelling", "drone", "other"];
const TYPE_LABEL = { airstrike: "Airstrike", missile: "Missile", explosion: "Explosion", shelling: "Shelling", drone: "Drone", other: "Other" };

// First match wins, so the more specific kinds come first.
const TYPE_RULES = [
  ["drone", /\b(drones?|UAVs?|Shaheds?|Gerans?|loitering munitions?|kamikaze)\b/i],
  ["missile", /\b(missiles?|ballistic|Iskanders?|Kinzhals?|Kalibrs?|ATACMS|Storm Shadows?|HIMARS|rockets?|interceptors?|intercepted|interceptions?|projectiles?)\b/i],
  ["airstrike", /\b(air ?strikes?|air-strikes?|air ?raids?|warplanes?|fighter jets?|bombings?|bombed|bombard\w*|glide bombs?|guided bombs?)\b/i],
  ["shelling", /\b(shelling|shelled|artillery|mortars?|MLRS|howitzers?)\b/i],
  ["explosion", /\b(explosions?|(a|the|massive|huge|large|powerful|deadly|mine|bomb|twin) blasts?|blasts? (in|at|near|rocks?|rocked|kills?|killed|heard|hits?)|exploded|detonat\w+|car bombs?|IEDs?|blew up|blown up|suicide bomb\w*)\b/i],
  ["other", /\b(strikes?|struck|shot down|downed|attacks? on|attacked)\b/i],
];

// A weapon alone ("drone maker opens plant") isn't an event; the headline must also say something happened.
const ACTION = /\b(attack(s|ed|ing)?|strikes?|struck|hit(s|ting)?|shot down|downed|intercept(s|ed|ion|ions)?|explosions?|blasts?|explod\w+|detonat\w+|kill(s|ed|ing)?|injur\w+|wound\w+|damag\w+|destroy\w+|fires?|burn(s|ing|ed)?|ablaze|sank|sinks?|sinking|sunk|target(s|ed|ing)|land(ed|s)? (in|on|near)|impacts?|shelling|shelled|air ?strikes?|air ?raids?|bombed|bombing|bombard\w*|casualt\w+|dead|died|victims?|pounded|hammered)\b/i;

// Headlines that use strike words for something else, or talk about what might happen.
const NEGATIVE = /\b(on strike|strike action|strikers|workers'? strike|general strike|hunger strike|labou?r strike|walkouts?|explosive (growth|rise|increase|claims?|allegations?|report|interview|testimony)|population explosion|lawsuits?|films?|movies?|documentary|anniversary|years ago|missile tests?|tests?|tested|test[- ]?fir\w*|test[- ]?launch\w*|test flights?|acceptance firing|successfully launch\w*|first release|drills?|military exercises?|contest|parade|contracts?|arms deals?|arms sales?|sale|approved|procure\w*|budget|aid package|unveil\w*|presented|develop\w*|manufactur\w*|delivery|deliveries|supply chain|subsidiary|partnership|SpaceX|NASA|Starship|spacecraft|satellite launch|potential|possible|could|might|would|threat of|fears?|plot|prepar\w+|plans? to|expected|may be|risk of|projected)\b/i;

// A place right after one of these words is more likely where it happened than who did it.
const PLACE_CUES = new Set(["in", "on", "near", "at", "over", "into", "across", "outside", "inside", "of", "targeting", "targeted", "targets", "hit", "hits", "struck", "strikes", "strike", "attack", "attacks", "attacked", "pounds", "pounded", "bombed", "bombs", "shelled", "shells", "toward", "towards"]);

const RANK = { city: 3, region: 2, country: 1 };
const RADIUS_KM = { city: 10, region: 100, country: 300 };

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  data: null,          // last feed.json
  feedOk: null,        // did the last fetch work
  live: new Map(),     // Bluesky items polled from the browser
  liveAt: 0,
  events: [],
  everLoaded: false,
  prevStatus: new Map(),
  enabled: Object.fromEntries(EVENT_TYPES.map((t) => [t, true])),
  corroboratedOnly: false,
  windowH: DEFAULT_WINDOW_H,
  hover: null,
  selection: null,     // { kind: "place" | "event", id }
  cardOn: false,
  sheet: "feed",
  sheetOpen: true,
};

let matcher = null; // { regex, entries: Map(name -> entry) }

// ---------- helpers ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const s1 = Math.sin(((lat2 - lat1) * toRad) / 2);
  const s2 = Math.sin(((lng2 - lng1) * toRad) / 2);
  const a = s1 * s1 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * s2 * s2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function typesCompatible(a, b) {
  return a === b || a === "explosion" || b === "explosion" || a === "other" || b === "other";
}

function relativeTime(iso, now) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatUtc(iso) {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

function formatLocal(iso) {
  return `${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))} local`;
}

function xSearchUrl(location, type) {
  return `https://x.com/search?q=${encodeURIComponent(`${location} ${type}`)}&src=typed_query&f=live`;
}

const ICON_EXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// ---------- place matching ----------

function mainCentroid(feature) {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type !== "MultiPolygon") return d3.geoCentroid(feature);
  let best = null;
  let bestArea = -1;
  for (const coordinates of g.coordinates) {
    const poly = { type: "Polygon", coordinates };
    const area = d3.geoArea(poly);
    if (area > bestArea) { bestArea = area; best = poly; }
  }
  return d3.geoCentroid(best);
}

function buildMatcher(countries) {
  const entries = new Map();
  for (const feature of countries) {
    const mapName = feature.properties && feature.properties.name;
    if (!mapName) continue;
    const aliases = COUNTRY_ALIASES[mapName] || [mapName];
    const display = aliases[0];
    let lat, lng;
    if (COUNTRY_CENTER[mapName]) [lat, lng] = COUNTRY_CENTER[mapName];
    else {
      const c = mainCentroid(feature);
      if (!c) continue;
      [lng, lat] = c;
    }
    for (const name of new Set([...aliases, mapName])) {
      if (COUNTRY_SKIP.has(name) || name.includes(". ")) continue;
      entries.set(name, { display, country: display, lat, lng, precision: "country" });
    }
  }
  // Capitals and large cities first, so the hand-picked places in places.js win any shared name.
  const lines = (typeof CITY_LINES === "string" ? CITY_LINES : "") + "\n" + PLACE_LINES;
  for (const raw of lines.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [names, country, lat, lng, flag] = line.split("|");
    const list = names.split(";").map((n) => n.trim()).filter(Boolean);
    const entry = { display: list[0], country, lat: Number(lat), lng: Number(lng), precision: flag === "r" ? "region" : "city" };
    for (const name of list) entries.set(name, entry);
  }
  const alternation = [...entries.keys()]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return { regex: new RegExp(`(?<![\\p{L}\\p{N}])(${alternation})(?![\\p{L}\\p{N}])`, "gu"), entries };
}

// The most specific place wins; among equals, one after a cue word ("in", "hits"...), then the first.
function locate(text) {
  if (!text || !matcher) return null;
  let best = null;
  for (const m of text.matchAll(matcher.regex)) {
    const entry = matcher.entries.get(m[1]);
    if (!entry) continue;
    const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase().match(/([a-z]+)[\s,'’]*$/);
    const cued = before && PLACE_CUES.has(before[1]);
    const score = RANK[entry.precision] * 10 + (cued ? 4 : 0) - m.index / 10000;
    if (!best || score > best.score) best = { ...entry, score, term: m[1] };
  }
  return best;
}

function classify(title, category) {
  if (NEGATIVE.test(title) || !ACTION.test(title)) return null;
  for (const [type, re] of TYPE_RULES) {
    const m = title.match(re);
    if (!m) continue;
    if (type === "other" && !OTHER_CATEGORIES.has(category)) return null;
    return { type, term: m[0] };
  }
  return null;
}

// ---------- feed -> events ----------

function normalize(item) {
  let title = (item.title || "").replace(/\s+/g, " ").trim();
  let source = item.source || "Unknown";
  // Google News titles end in " - Outlet": count the outlet as the source.
  if (source === "Google News") {
    const m = title.match(/\s[-–—]\s([^-–—]{2,60})$/);
    if (m) { source = m[1].trim(); title = title.slice(0, m.index).trim(); }
  }
  return { ...item, title, source };
}

function allItems() {
  const items = state.data ? state.data.items || [] : [];
  const ids = new Set(items.map((i) => i.id));
  const urls = new Set(items.map((i) => i.url));
  const extra = [...state.live.values()].filter((i) => !ids.has(i.id) && !urls.has(i.url));
  return items.concat(extra);
}

function buildEvents() {
  const cutoff = Date.now() - 48 * 3600e3;
  const mentions = [];
  for (const raw of allItems()) {
    if (SKIP_CATEGORIES.has(raw.category)) continue;
    const t = Date.parse(raw.published);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const item = normalize(raw);
    const kind = classify(item.title, item.category);
    if (!kind) continue;
    // Telegram summaries often carry ads, so only news summaries help find the place, and only when they
    // name a city or region: a country in a summary is often a ship's flag or a side note.
    let place = locate(item.title);
    if (!place && !item.social) {
      const fromSummary = locate(item.summary || "");
      if (fromSummary && fromSummary.precision !== "country") place = fromSummary;
    }
    if (!place) continue;
    mentions.push({ item, t, type: kind.type, place, terms: [kind.term, place.term] });
  }
  mentions.sort((a, b) => a.t - b.t);

  const events = [];
  for (const m of mentions) {
    let best = null;
    let bestDist = Infinity;
    for (const ev of events) {
      if (!typesCompatible(ev.event_type, m.type)) continue;
      if (m.t - ev.lastT > MERGE_MS) continue;
      const d = haversineKm(ev.lat, ev.lng, m.place.lat, m.place.lng);
      if (d <= MERGE_KM && d < bestDist) { best = ev; bestDist = d; }
    }
    const report = { source: m.item.source, title: m.item.title, url: m.item.url, published: m.item.published, social: !!m.item.social, id: m.item.id };
    if (best) {
      if (!best.urls.has(report.url)) { best.urls.add(report.url); best.reports.push(report); }
      best.sources.add(report.source);
      best.lastT = m.t;
      best.last_updated = m.item.published;
      if ((best.event_type === "explosion" || best.event_type === "other") && m.type !== "explosion" && m.type !== "other") best.event_type = m.type;
      if (RANK[m.place.precision] > RANK[best.precision]) {
        Object.assign(best, { lat: m.place.lat, lng: m.place.lng, location_name: m.place.display, country: m.place.country, precision: m.place.precision, radius_km: RADIUS_KM[m.place.precision] });
      }
      continue;
    }
    events.push({
      id: "e_" + m.item.id,
      lat: m.place.lat,
      lng: m.place.lng,
      event_type: m.type,
      location_name: m.place.display,
      country: m.place.country,
      precision: m.place.precision,
      radius_km: RADIUS_KM[m.place.precision],
      first_seen: m.item.published,
      last_updated: m.item.published,
      lastT: m.t,
      reports: [report],
      urls: new Set([report.url]),
      sources: new Set([report.source]),
    });
  }
  for (const ev of events) {
    ev.source_count = ev.sources.size;
    ev.status = ev.source_count >= 2 ? "corroborated" : "unverified";
    ev.reports.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  }
  events.sort((a, b) => b.lastT - a.lastT);
  return events.slice(0, MAX_EVENTS);
}

function rebuild() {
  if (!matcher || !state.data) return;
  const events = buildEvents();
  const windowStart = Date.now() - state.windowH * 3600e3;
  const flashes = [];
  for (const ev of events) {
    const prev = state.prevStatus.get(ev.id);
    const fresh = prev === undefined;
    const promoted = prev === "unverified" && ev.status === "corroborated";
    if (state.everLoaded && (fresh || promoted) && ev.lastT >= windowStart) flashes.push(ev);
    state.prevStatus.set(ev.id, ev.status);
  }
  state.events = events;
  state.everLoaded = true;
  render();
  for (const ev of flashes) if (passes(ev)) burst(ev);
}

// ---------- loading ----------

async function loadFeed() {
  try {
    const res = await fetch(`${FEED_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.feedOk = true;
  } catch {
    state.feedOk = false;
  }
  updateStatus();
  rebuild();
}

// Bluesky's public API allows browser requests, so between feed builds the page asks the
// accounts the feed lists in data.live for their newest posts (same as news.sala.company).
let livePolling = false;
async function pollLive() {
  if (!state.data || !state.data.live || livePolling || document.hidden) return;
  livePolling = true;
  const cutoff = Date.now() - 48 * 3600e3;
  let added = 0;
  try {
    await Promise.all(state.data.live.map(async (src) => {
      try {
        const u = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?filter=posts_no_replies&limit=10&actor=" + encodeURIComponent(src.handle);
        const res = await fetch(u);
        if (!res.ok) return;
        const { feed } = await res.json();
        for (const it of feed || []) {
          if (it.reason) continue; // repost
          const p = it.post;
          const text = ((p.record && p.record.text) || "").trim();
          const rkey = p.uri.split("/").pop();
          const id = "bsky-" + rkey;
          const published = new Date(p.record.createdAt).toISOString();
          if (!text || state.live.has(id) || Date.parse(published) < cutoff) continue;
          let url = `https://bsky.app/profile/${src.handle}/post/${rkey}`;
          const ext = p.embed && p.embed.external;
          if (ext && /^https?:/.test(ext.uri)) url = ext.uri;
          const title = text.split("\n")[0].slice(0, 300);
          state.live.set(id, { id, title, url, source: src.name, category: src.category, published, social: true });
          added++;
        }
      } catch { /* one account failing shouldn't stop the rest */ }
    }));
  } finally {
    livePolling = false;
  }
  for (const [id, it] of state.live) if (Date.parse(it.published) < cutoff) state.live.delete(id);
  state.liveAt = Date.now();
  updateStatus();
  if (added) rebuild();
}

function updateStatus() {
  const el = document.getElementById("status");
  let cls = "";
  let label = "Loading";
  let detail = "Loading the news feed.";
  const generated = state.data && Date.parse(state.data.generated_at);
  const age = generated ? Math.round((Date.now() - generated) / 60000) : null;
  const live = state.liveAt ? ` Bluesky checked ${Math.round((Date.now() - state.liveAt) / 1000)}s ago.` : "";
  if (state.feedOk === false && !state.data) {
    cls = "offline"; label = "Offline"; detail = "Can't reach the news feed. Retrying every minute.";
  } else if (state.feedOk === false) {
    cls = "offline"; label = "Reconnecting"; detail = `Can't reach the news feed; showing the last copy (built ${age} min ago). Retrying every minute.${live}`;
  } else if (age !== null && age > STALE_MIN) {
    cls = "delayed"; label = "Delayed"; detail = `The news feed was last built ${age} min ago; it normally updates every 5 min.${live}`;
  } else if (age !== null) {
    cls = "live"; label = "Live"; detail = `News feed built ${age} min ago, checked every minute.${live}`;
  }
  el.className = `status ${cls}`;
  el.title = detail;
  el.querySelector(".label").textContent = label;
}

// ---------- filters ----------

function passes(ev) {
  if (!state.enabled[ev.event_type]) return false;
  if (state.corroboratedOnly && ev.status !== "corroborated") return false;
  return ev.lastT >= Date.now() - state.windowH * 3600e3;
}

function filtered() {
  return state.events.filter(passes);
}

function fadeFor(ev, now) {
  const age = now - ev.lastT;
  return Math.max(0.3, 1 - age / (state.windowH * 3600e3));
}

// ---------- map ----------

const mapEl = document.getElementById("map");
const svg = d3.select(mapEl).append("svg");
const root = svg.append("g");
const sphereEl = root.append("path").attr("class", "sphere");
const graticuleEl = root.append("path").attr("class", "graticule");
const countriesG = root.append("g");
const bordersEl = root.append("path").attr("class", "borders");
const discsG = root.append("g");
const placesG = root.append("g");
const dotsG = root.append("g");
const burstsG = root.append("g");

const projection = d3.geoEqualEarth();
const geoPath = d3.geoPath(projection);
let W = 1;
let H = 1;
let k = 1;
let world = null;

const zoom = d3.zoom()
  .scaleExtent([1, 60])
  .clickDistance(4)
  .on("zoom", (e) => {
    k = e.transform.k;
    root.attr("transform", e.transform);
    rescale();
  });
svg.call(zoom).on("dblclick.zoom", null);

function layout() {
  W = mapEl.clientWidth || 1;
  H = mapEl.clientHeight || 1;
  const mobile = W < 768;
  const top = 56;
  const bottom = mobile ? Math.min(H * 0.5, 320) : 48;
  projection.fitExtent([[12, top], [W - 12, Math.max(top + 100, H - bottom)]], { type: "Sphere" });
  zoom.extent([[0, 0], [W, H]]).translateExtent([[-W * 0.25, -H * 0.25], [W * 1.25, H * 1.25]]);
  sphereEl.attr("d", geoPath({ type: "Sphere" }));
  graticuleEl.attr("d", geoPath(d3.geoGraticule10()));
  if (world) {
    countriesG.selectAll("path").attr("d", geoPath);
    bordersEl.attr("d", geoPath(world.borders));
  }
  drawPlaces();
  drawEvents();
}

function drawPlaces() {
  const sel = placesG.selectAll("g.place").data(FEATURED_PLACES, (d) => d.id).join((enter) => {
    const g = enter.append("g").attr("class", "place").attr("data-kind", "place").attr("data-id", (d) => d.id);
    g.append("circle").attr("class", "halo");
    g.append("circle").attr("class", "core");
    g.append("text").text((d) => d.name);
    g.append("circle").attr("class", "hit");
    return g;
  });
  sel.attr("transform", (d) => `translate(${projection([d.lng, d.lat])})`);
  rescale();
}

function drawEvents() {
  const now = Date.now();
  const list = filtered().slice().reverse(); // oldest first, so the newest draw on top
  const tone = (d) => (d.status === "corroborated" ? "alert" : "amber");
  const hot = (d) => (state.hover === d.id || (state.selection && state.selection.id === d.id) ? " hot" : "");

  discsG.selectAll("path").data(list.filter((d) => d.precision !== "city"), (d) => d.id).join("path")
    .attr("data-kind", "event").attr("data-id", (d) => d.id)
    .attr("class", (d) => `disc ${tone(d)}${hot(d)}`)
    .attr("d", (d) => geoPath(d3.geoCircle().center([d.lng, d.lat]).radius(d.radius_km / 111.2)()))
    .style("opacity", (d) => fadeFor(d, now));

  dotsG.selectAll("g.dot").data(list.filter((d) => d.precision === "city"), (d) => d.id).join((enter) => {
    const g = enter.append("g").attr("data-kind", "event").attr("data-id", (d) => d.id);
    g.append("circle").attr("class", "halo");
    g.append("circle").attr("class", "core");
    g.append("circle").attr("class", "hit");
    return g;
  })
    .attr("class", (d) => `dot ${tone(d)}${hot(d)}`)
    .attr("transform", (d) => `translate(${projection([d.lng, d.lat])})`)
    .style("opacity", (d) => fadeFor(d, now))
    .order();
  rescale();
}

// Markers keep the same size on screen at every zoom level.
function rescale() {
  const s = 1 / k;
  dotsG.selectAll("g.dot").each(function (d) {
    const big = state.hover === d.id || (state.selection && state.selection.id === d.id) ? 1.5 : 1;
    const g = d3.select(this);
    g.select(".halo").attr("r", 9 * s * big);
    g.select(".core").attr("r", 3.5 * s * big);
    g.select(".hit").attr("r", 11 * s);
  });
  placesG.selectAll("g.place").each(function (d) {
    const big = state.hover === d.id || (state.selection && state.selection.id === d.id);
    const g = d3.select(this).classed("hot", big);
    g.select(".halo").attr("r", (big ? 11 : 7) * s);
    g.select(".core").attr("r", (big ? 4 : 2.75) * s);
    g.select(".hit").attr("r", 10 * s);
    // Labels crowd each other around the Levant until zoomed in, so show them from 3x or on hover.
    g.select("text").attr("x", 7 * s).attr("y", 4 * s).attr("font-size", 11 * s).style("display", big || k >= 3 ? null : "none");
  });
}

function burst(ev) {
  if (reduceMotion) return;
  const [x, y] = projection([ev.lng, ev.lat]);
  const color = ev.status === "corroborated" ? "var(--alert)" : "var(--amber)";
  const s = 1 / k;
  burstsG.append("circle").attr("class", "flash").attr("cx", x).attr("cy", y).attr("r", 4 * s)
    .style("fill", color).style("opacity", 0.9)
    .transition().duration(1200).ease(d3.easeCubicOut).attr("r", 22 * s).style("opacity", 0).remove();
  burstsG.append("circle").attr("class", "burst").attr("cx", x).attr("cy", y).attr("r", 3 * s)
    .style("stroke", color).style("opacity", 0.9)
    .transition().duration(2000).ease(d3.easeCubicOut).attr("r", 40 * s).style("opacity", 0).remove();
}

function focusOn(lat, lng, selection) {
  state.selection = selection;
  state.cardOn = false;
  render();
  const [x, y] = projection([lng, lat]);
  const current = d3.zoomTransform(svg.node());
  const kk = Math.max(current.k, 5);
  const mobile = W < 768;
  // Keep the marker clear of the info card: above it on phones, left of it on wide screens
  // (the card sits 22rem from the right edge and is 24rem wide; the left panel ends at 19rem).
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  let cx = W / 2;
  if (W >= 1100) {
    // With auto-hiding panels the card sits at the right edge unless the feed is out.
    const hiding = autoHide.matches;
    const placesOut = !hiding || document.getElementById("places-panel").classList.contains("open");
    const feedOut = !hiding || document.getElementById("feed-panel").classList.contains("open");
    const left = placesOut ? 14 * rem : 0;
    const cardLeft = W - (feedOut ? 46 : 25) * rem;
    cx = (left + cardLeft) / 2;
  }
  const cy = mobile ? H * 0.22 : W >= 1100 ? H / 2 : H * 0.3;
  const t = d3.zoomIdentity.translate(cx - x * kk, cy - y * kk).scale(kk);
  const duration = reduceMotion ? 0 : 900;
  const token = {};
  focusToken = token;
  const show = () => {
    if (focusToken !== token) return; // a newer pick took over
    focusToken = null;
    state.cardOn = true;
    renderCard();
  };
  svg.transition().duration(duration).ease(d3.easeCubicInOut).call(zoom.transform, t)
    .on("end", show).on("interrupt", show);
  // Animations pause in background tabs; open the card anyway.
  setTimeout(show, duration + 150);
}
let focusToken = null;

function pick(kind, id) {
  if (kind === "place") {
    const place = FEATURED_PLACES.find((p) => p.id === id);
    if (place) focusOn(place.lat, place.lng, { kind, id });
  } else {
    const ev = state.events.find((e) => e.id === id);
    if (ev) focusOn(ev.lat, ev.lng, { kind, id });
  }
}

function setHover(id) {
  if (state.hover === id) return;
  state.hover = id;
  discsG.selectAll("path").classed("hot", (d) => d.id === id || (state.selection && state.selection.id === d.id));
  rescale();
  document.querySelectorAll("[data-row-id]").forEach((el) => {
    el.classList.toggle("active", el.dataset.rowId === id || (state.selection && state.selection.id === el.dataset.rowId));
  });
}

svg.on("click", (e) => {
  const target = e.target.closest("[data-kind]");
  if (target) pick(target.dataset.kind, target.dataset.id);
});
svg.on("pointerover", (e) => {
  const target = e.target.closest("[data-kind]");
  setHover(target ? target.dataset.id : null);
});
svg.on("pointerleave", () => setHover(null));

// ---------- panels ----------

function renderPlaces() {
  const html = FEATURED_PLACES.map((p) => {
    const active = state.hover === p.id || (state.selection && state.selection.id === p.id);
    return `<li><button type="button" class="row place-row${active ? " active" : ""}" data-row-kind="place" data-row-id="${p.id}">
      <span class="pin" aria-hidden="true"></span>
      <span><span class="name">${esc(p.name)}</span><span class="coords">${p.lat.toFixed(1)}°, ${p.lng.toFixed(1)}°</span></span>
    </button></li>`;
  }).join("");
  document.querySelectorAll("[data-places]").forEach((el) => { el.innerHTML = html; });
}

function renderFilters() {
  const types = EVENT_TYPES.map((t) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${state.enabled[t]}">${TYPE_LABEL[t]}</button>`).join("");
  const corr = `<button type="button" class="chip corr" data-corr aria-pressed="${state.corroboratedOnly}">Corroborated only</button>`;
  const wins = WINDOWS_H.map((h) => `<button type="button" class="chip win" data-window="${h}" aria-pressed="${state.windowH === h}">${h}h</button>`).join("");
  const html = types + corr + '<span class="sep"></span>' + wins;
  document.querySelectorAll("[data-filters]").forEach((el) => { el.innerHTML = html; });
}

function renderFeed() {
  const now = Date.now();
  const list = filtered();
  let html;
  if (!state.data || !matcher) {
    html = `<li class="empty">${state.feedOk === false ? "Can't reach the news feed. Retrying every minute." : "Loading reports…"}</li>`;
  } else if (!list.length) {
    html = `<li class="empty">No reports match these filters in the last ${state.windowH} hours.</li>`;
  } else {
    html = list.map((ev) => {
      const tone = ev.status === "corroborated" ? "alert" : "amber";
      const active = state.hover === ev.id || (state.selection && state.selection.id === ev.id);
      return `<li><button type="button" class="row ${tone}${active ? " active" : ""}" data-row-kind="event" data-row-id="${ev.id}">
        <span class="line"><span class="type">${TYPE_LABEL[ev.event_type]}</span><span class="time">${relativeTime(ev.last_updated, now)}</span></span>
        <span class="line"><span class="where">${esc(ev.location_name)}<span> · ${esc(ev.country)}</span></span>${ev.source_count < 2 ? '<span class="tag">Unverified</span>' : ""}</span>
        <span class="headline">${esc(ev.reports[0].title)}</span>
      </button></li>`;
    }).join("");
  }
  document.querySelectorAll("[data-feed]").forEach((el) => { el.innerHTML = html; });
  const count = document.querySelector("[data-feed-count]");
  if (count) count.textContent = state.data && matcher ? `· ${list.length}` : "";
}

// ---------- auto-hiding side panels (mouse only) ----------

const autoHide = window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)");
const HIDE_DELAY_MS = 350;

function setPanelOpen(panel, open) {
  panel.classList.toggle("open", open);
  const edge = document.querySelector(`[data-edge="${panel.id}"]`);
  if (edge) edge.classList.toggle("hide-tab", open);
  if (panel.id === "feed-panel") document.body.classList.toggle("feed-open", open);
}

for (const panel of document.querySelectorAll(".panel")) {
  const edge = document.querySelector(`[data-edge="${panel.id}"]`);
  let timer = 0;
  const show = () => { clearTimeout(timer); if (autoHide.matches) setPanelOpen(panel, true); };
  const hideSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!autoHide.matches || panel.classList.contains("pinned")) return;
      if (panel.matches(":hover, :focus-within") || (edge && edge.matches(":hover"))) return;
      setPanelOpen(panel, false);
    }, HIDE_DELAY_MS);
  };
  for (const el of [panel, edge]) {
    if (!el) continue;
    el.addEventListener("pointerenter", show);
    el.addEventListener("pointerleave", hideSoon);
  }
  panel.addEventListener("focusin", show);
  panel.addEventListener("focusout", hideSoon);
}

function renderCard() {
  const card = document.getElementById("card");
  const sel = state.selection;
  if (!state.cardOn || !sel) { card.hidden = true; return; }
  const close = `<button type="button" class="icon-btn" data-close aria-label="Close">${ICON_X}</button>`;
  if (sel.kind === "place") {
    const p = FEATURED_PLACES.find((x) => x.id === sel.id);
    if (!p) { card.hidden = true; return; }
    card.innerHTML = `<div class="top"><div><p class="kicker">Featured location</p><h2>${esc(p.name)}</h2></div>${close}</div>
      <div class="body"><p class="muted">${esc(p.description)}</p>
      <p class="meta muted">${p.lat.toFixed(2)}°, ${p.lng.toFixed(2)}°</p></div>`;
  } else {
    const ev = state.events.find((x) => x.id === sel.id);
    if (!ev) { card.hidden = true; return; }
    const corroborated = ev.status === "corroborated";
    const now = Date.now();
    const reports = ev.reports.slice(0, 8).map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${ICON_EXT}
      <span><span class="src">${esc(r.source)}${r.social ? " · social" : ""} · ${relativeTime(r.published, now)}</span><span class="ttl">${esc(r.title)}</span></span></a></li>`).join("");
    card.innerHTML = `<div class="top"><div><p class="kicker ${corroborated ? "alert" : "amber"}">${TYPE_LABEL[ev.event_type]} · ${corroborated ? "Corroborated" : "Unverified"}</p><h2>${esc(ev.location_name)}</h2></div>${close}</div>
      <div class="body"><p class="muted">${esc(ev.country)}</p>
      <p class="meta">${formatUtc(ev.last_updated)} · ${formatLocal(ev.last_updated)}</p>
      <p class="meta muted">${ev.source_count} ${ev.source_count === 1 ? "source" : "independent sources"}${ev.precision !== "city" ? ` · ${ev.precision} ±${ev.radius_km} km` : ""}</p>
      <ul class="reports">${reports}</ul>
      <a class="search" href="${esc(xSearchUrl(ev.location_name, ev.event_type))}" target="_blank" rel="noopener noreferrer">Latest posts on X →</a></div>`;
  }
  card.hidden = false;
}

function renderSheet() {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.sheet));
  document.querySelectorAll("[data-sheet]").forEach((el) => { el.hidden = el.dataset.sheet !== state.sheet; });
  document.querySelector("[data-sheet-body]").hidden = !state.sheetOpen;
}

function render() {
  renderPlaces();
  renderFilters();
  renderFeed();
  renderSheet();
  renderCard();
  drawEvents();
}

document.addEventListener("click", (e) => {
  const row = e.target.closest("[data-row-kind]");
  if (row) { pick(row.dataset.rowKind, row.dataset.rowId); return; }
  const type = e.target.closest("[data-type]");
  if (type) { state.enabled[type.dataset.type] = !state.enabled[type.dataset.type]; render(); return; }
  if (e.target.closest("[data-corr]")) { state.corroboratedOnly = !state.corroboratedOnly; render(); return; }
  const win = e.target.closest("[data-window]");
  if (win) { state.windowH = Number(win.dataset.window); render(); return; }
  if (e.target.closest("[data-close]")) { state.cardOn = false; renderCard(); return; }
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    const panel = document.getElementById(toggle.dataset.toggle);
    const label = toggle.querySelector(".sr-only");
    const title = panel.querySelector("h2").textContent.toLowerCase();
    if (autoHide.matches) {
      // Auto-hiding panels: the button pins the panel open instead of collapsing it.
      const pinned = panel.classList.toggle("pinned");
      toggle.setAttribute("aria-pressed", String(pinned));
      toggle.title = pinned ? "Unpin (hide when the mouse leaves)" : "Pin open";
      if (label) label.textContent = pinned ? `Unpin ${title}` : `Pin ${title} open`;
      return;
    }
    const collapsed = panel.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (label) label.textContent = collapsed ? `Expand ${title}` : `Collapse ${title}`;
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    if (state.sheet === tab.dataset.tab) state.sheetOpen = !state.sheetOpen;
    else { state.sheet = tab.dataset.tab; state.sheetOpen = true; }
    renderSheet();
  }
});

document.addEventListener("pointerover", (e) => {
  if (e.target.closest("svg")) return;
  const row = e.target.closest("[data-row-id]");
  setHover(row ? row.dataset.rowId : null);
});
document.addEventListener("focusin", (e) => {
  const row = e.target.closest("[data-row-id]");
  if (row) setHover(row.dataset.rowId);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.cardOn) { state.cardOn = false; renderCard(); }
});

// ---------- start ----------

async function start() {
  render();
  layout();
  new ResizeObserver(() => layout()).observe(mapEl);
  const feed = loadFeed();
  try {
    const topo = await d3.json(ATLAS_URL);
    const countries = topojson.feature(topo, topo.objects.countries).features;
    world = { borders: topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b) };
    countriesG.selectAll("path").data(countries).join("path").attr("class", "country").attr("d", geoPath)
      .append("title").text((d) => (COUNTRY_ALIASES[d.properties.name] || [d.properties.name])[0]);
    bordersEl.attr("d", geoPath(world.borders));
    matcher = buildMatcher(countries);
  } catch {
    document.getElementById("status").title = "The world map didn't load. Reload the page to try again.";
  }
  await feed;
  rebuild();
  pollLive();
  setInterval(loadFeed, POLL_S * 1000);
  setInterval(pollLive, POLL_S * 1000);
  setInterval(() => { renderFeed(); drawEvents(); updateStatus(); }, 10000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadFeed(); pollLive(); } });
}

start();
