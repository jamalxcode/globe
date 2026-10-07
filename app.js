// Meridian: a live equal-area map of reported strikes, explosions, fires and environmental incidents.
// Runs entirely in the browser. Headlines come from news.sala.company's feed.json and local.json (Arabic,
// Russian, Ukrainian), rebuilt every ~5 min on GitHub and covering 48 hours, plus the feed's Bluesky accounts,
// polled live. extract.js turns each headline into a mention; events.js merges mentions into events.
// Hollow ring = one source. Solid dot = two or more independent sources.
"use strict";

const FEED_URL = "https://news.sala.company/feed.json";
const LOCAL_URL = "https://news.sala.company/local.json"; // non-English sources, built for this map
const ATLAS_URL = "vendor/countries-50m.json"; // world-atlas 2.0.2 (Natural Earth country shapes), kept in the repo
const FIRES_URL = "fires.json"; // satellite heat, NASA FIRMS, refreshed hourly by the deploy workflow
const POLL_S = 60;
const STALE_MIN = 20; // feed older than this shows "Delayed"
const { WEAK_HOURS, SAT_KM } = MeridianEvents;
// The feed keeps 48 hours, so that's the longest range.
const WINDOWS = [
  { h: 1, label: "1h", long: "hour" },
  { h: 6, label: "6h", long: "6 hours" },
  { h: 12, label: "12h", long: "12 hours" },
  { h: 24, label: "24h", long: "24 hours" },
  { h: 48, label: "48h", long: "48 hours" },
];
const DEFAULT_WINDOW_H = 24;

const EVENT_TYPES = ["airstrike", "missile", "explosion", "shelling", "drone", "fire", "wildfire", "environment", "other"];
const TYPE_LABEL = { airstrike: "Airstrike", missile: "Missile", explosion: "Explosion", shelling: "Shelling", drone: "Drone", fire: "Fire", wildfire: "Wildfire", environment: "Environmental", other: "Other" };

// "Drone" or, for a combined attack, "Drone + missile".
function typeLabel(ev) {
  if (!ev.combined) return TYPE_LABEL[ev.event_type];
  return ev.weapons.map((t, i) => (i ? TYPE_LABEL[t].toLowerCase() : TYPE_LABEL[t])).join(" + ");
}

// Icons for an event's kinds: one, or each weapon of a combined attack.
function typeIcons(ev) {
  return (ev.combined ? ev.weapons : [ev.event_type]).map((t) => typeIcon(t)).join("");
}

// What was hit (see TARGET_RULES in extract.js): label and a 24x24 line icon, adapted from Lucide (ISC).
const TARGETS = {
  airport: { label: "Airport / airfield", d: "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.3c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" },
  fuel: { label: "Oil / fuel", d: "M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" },
  power: { label: "Power / energy", d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" },
  rail: { label: "Railway", d: "M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM5 10h14M9 13.5h.01M15 13.5h.01M8 17l-2 4M16 17l2 4" },
  bridge: { label: "Bridge", d: "M3 17V9M21 17V9M3 9c4 5 14 5 18 0M3 14h18M8 14v-2.5M12 14v-1.5M16 14v-2.5" },
  ship: { label: "Port / ship", d: "M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6M12 10v4M12 2v3" },
  military: { label: "Military site", d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" },
  industry: { label: "Industry / warehouse", d: "M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM17 18h1M12 18h1M7 18h1" },
  hospital: { label: "Hospital / medical", d: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 7v10M7 12h10" },
  civilian: { label: "Homes / civilian", d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
};

// What happened: one icon per event type, also adapted from Lucide (bomb, rocket, crosshair, triangle-alert).
const TYPE_ICONS = {
  airstrike: "M20 13a9 9 0 1 1-18 0 9 9 0 1 1 18 0zM14.35 4.65 16.3 2.7a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-1.95 1.95M22 2l-1.5 1.5",
  missile: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
  explosion: "M12 2l2.2 5.3L20 6l-2.6 5.1L22 14l-5.6 1.2L17 21l-5-3.2L7 21l.6-5.8L2 14l4.6-2.9L4 6l5.8 1.3z",
  shelling: "M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0zM22 12h-4M6 12H2M12 6V2M12 22v-4",
  fire: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  wildfire: "M17 14l3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17zM12 22v-3",
  environment: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10zM2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12",
  drone: "M9 9 6.5 6.5M15 9l2.5-2.5M9 15l-2.5 2.5M15 15l2.5 2.5M9 9h6v6H9zM8 5a3 3 0 1 1-6 0 3 3 0 1 1 6 0zM22 5a3 3 0 1 1-6 0 3 3 0 1 1 6 0zM8 19a3 3 0 1 1-6 0 3 3 0 1 1 6 0zM22 19a3 3 0 1 1-6 0 3 3 0 1 1 6 0z",
  other: "M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4M12 17h.01",
};

const SATELLITE_ICON = "M13 7 9 3 5 7l4 4M17 11l4 4-4 4-4-4M8 12l4 4 6-6-4-4ZM16 8l3-3M9 21a6 6 0 0 0-6-6";

function svgIcon(d, cls = "ticon") {
  return d ? `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>` : "";
}

function targetIcon(target, cls) {
  return TARGETS[target] ? svgIcon(TARGETS[target].d, cls) : "";
}

function typeIcon(type, cls) {
  return svgIcon(TYPE_ICONS[type], cls);
}

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

function windowInfo(h) {
  return WINDOWS.find((w) => w.h === h) || WINDOWS[3];
}

function xSearchUrl(location, type) {
  return `https://x.com/search?q=${encodeURIComponent(`${location} ${type}`)}&src=typed_query&f=live`;
}

const ICON_EXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// ---------- mentions -> events ----------

// Main feed, non-English feed and live Bluesky posts, without duplicates.
function allItems() {
  const items = (state.data ? state.data.items || [] : []).concat(feeds.local.data ? feeds.local.data.items || [] : []);
  const ids = new Set(items.map((i) => i.id));
  const urls = new Set(items.map((i) => i.url));
  const extra = [...state.live.values()].filter((i) => !ids.has(i.id) && !urls.has(i.url));
  return items.concat(extra);
}

// Every mention in the chosen range, oldest first.
function windowMentions() {
  const start = Date.now() - state.windowH * 3600e3;
  const out = [];
  for (const raw of allItems()) {
    const m = MeridianExtract.toMention(matcher, raw);
    if (m && Date.parse(m.published) >= start) out.push(m);
  }
  return out.sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
}

// flash: animate events that are new since the last refresh (not when the range changes).
function rebuild(flash = true) {
  if (!matcher || !state.data) return;
  const events = MeridianEvents.buildEvents(windowMentions(), { fires: fires && fires.grid });
  const flashes = [];
  for (const ev of events) {
    const prev = state.prevStatus.get(ev.id);
    const fresh = prev === undefined;
    const promoted = prev === "unverified" && ev.status === "corroborated";
    if (flash && state.everLoaded && (fresh || promoted)) flashes.push(ev);
    state.prevStatus.set(ev.id, ev.status);
  }
  state.events = events;
  state.everLoaded = true;
  render();
  for (const ev of flashes) if (passes(ev)) burst(ev);
}

// ---------- loading ----------

const feeds = {
  main: { url: FEED_URL, data: null, lastModified: null, nextBust: 0 },
  local: { url: LOCAL_URL, data: null, lastModified: null, nextBust: 0 },
};
// Builds run every ~5 min and take a few; a copy older than this may be a CDN edge serving an old build.
const SUSPECT_AGE_MS = 12 * 60e3;
const BUST_EVERY_MS = 5 * 60e3;

// Fetches a feed only if it changed. "no-cache" makes the browser ask GitHub whether the file changed (it
// sends the ETag it has); an unchanged file comes back as a tiny "304 Not Modified" and the browser reuses its
// copy, so polling every minute costs almost nothing between builds. If the copy looks old, a request bypasses
// all caches, at most once every BUST_EVERY_MS (a build that's simply late shouldn't cost a download a minute).
// Returns true if there's new data.
async function fetchFeed(feed) {
  const old = feed.data && Date.now() - Date.parse(feed.data.generated_at) > SUSPECT_AGE_MS;
  const bust = old && Date.now() >= feed.nextBust;
  if (bust) feed.nextBust = Date.now() + BUST_EVERY_MS;
  const res = await fetch(bust ? `${feed.url}?t=${Date.now()}` : feed.url, { cache: bust ? "no-store" : "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const modified = res.headers.get("Last-Modified");
  if (feed.data && modified && modified === feed.lastModified) return false;
  feed.data = await res.json();
  feed.lastModified = modified;
  return true;
}

async function loadFeed() {
  let changed = false;
  try {
    changed = await fetchFeed(feeds.main);
    state.data = feeds.main.data;
    state.feedOk = true;
  } catch {
    state.feedOk = false;
  }
  try {
    changed = (await fetchFeed(feeds.local)) || changed;
  } catch { /* the map works without the non-English feed */ }
  updateStatus();
  if (changed) rebuild();
}

let fires = null; // { generated_at, grid } from fires.json

async function loadFires() {
  try {
    const res = await fetch(FIRES_URL, { cache: "no-cache" });
    if (!res.ok) return false;
    const data = await res.json();
    if (fires && fires.generated_at === data.generated_at) return false;
    fires = { generated_at: data.generated_at, grid: MeridianEvents.fireGrid(data.points) };
    return true;
  } catch {
    return false; // no file, or offline: no satellite notes
  }
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
  if (![...ev.types].some((t) => state.enabled[t])) return false;
  if (state.corroboratedOnly && ev.status !== "corroborated") return false;
  return ev.lastT >= Date.now() - state.windowH * 3600e3;
}

function filtered() {
  return state.events.filter(passes);
}

function fadeFor(ev, now) {
  const age = now - ev.lastT;
  const fade = Math.max(0.35, 1 - age / (state.windowH * 3600e3));
  // Weak reports are fainter, but not so faint they disappear: their dashed outline (style.css) marks them too.
  return ev.weak ? Math.max(0.4, fade * 0.75) : fade;
}

function offMap(ev, now = Date.now()) {
  return MeridianEvents.offMap(ev, now);
}

// ---------- map ----------

const mapEl = document.getElementById("map");
const svg = d3.select(mapEl).append("svg");
// Type icons (y-...) and target icons (t-...) as reusable symbols, drawn inside event markers.
svg.append("defs").selectAll("symbol")
  .data([...Object.entries(TYPE_ICONS).map(([k, d]) => [`y-${k}`, d]), ...Object.entries(TARGETS).map(([k, t]) => [`t-${k}`, t.d])])
  .join("symbol")
  .attr("id", ([id]) => id).attr("viewBox", "0 0 24 24")
  .append("path").attr("d", ([, d]) => d);
const root = svg.append("g");
const sphereEl = root.append("path").attr("class", "sphere");
const graticuleEl = root.append("path").attr("class", "graticule");
const countriesG = root.append("g");
const bordersEl = root.append("path").attr("class", "borders");
const discsG = root.append("g");
const dotsG = root.append("g");
const clustersG = root.append("g");
const burstsG = root.append("g");

// Grouping: markers closer than CLUSTER_PX on screen merge into a numbered bubble, up to CLUSTER_MAX_K zoom.
const CLUSTER_PX = 26;
const CLUSTER_MAX_K = 6;
let clusterK = 0; // zoom level the groups were last made for
let clusters = new Map(); // id -> { events, x, y }

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
    // Regroup once the zoom has changed enough for groups to split or merge.
    if (Math.abs(Math.log(k / (clusterK || k))) > 0.25) drawEvents();
    else rescale();
  })
  .on("end", () => { if (k !== clusterK) drawEvents(); });
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
  drawEvents();
}

function drawEvents() {
  const now = Date.now();
  const list = filtered().filter((d) => !offMap(d, now)).reverse(); // oldest first, so the newest draw on top
  // "one" = a single source (hollow, dashed), "multi" = two or more (solid): told apart by shape, not only color.
  const tone = (d) => (d.status === "corroborated" ? "multi" : "one");
  const hot = (d) => (state.hover === d.id || (state.selection && state.selection.id === d.id) ? " hot" : "");

  discsG.selectAll("path").data(list.filter((d) => d.precision !== "city"), (d) => d.id).join("path")
    .attr("data-kind", "event").attr("data-id", (d) => d.id)
    .attr("class", (d) => `disc ${tone(d)}${hot(d)}`)
    .attr("d", (d) => geoPath(d3.geoCircle().center([d.lng, d.lat]).radius(d.radius_km / 111.2)()))
    .style("opacity", (d) => fadeFor(d, now));

  // Group markers that would overlap at this zoom; the selected or hovered event always stays on its own.
  const { singles, groups } = groupMarkers(list);
  clustersG.selectAll("g.cluster").data(groups, (d) => d.id).join((enter) => {
    const g = enter.append("g").attr("data-kind", "cluster").attr("data-id", (d) => d.id);
    g.append("circle").attr("class", "core");
    g.append("text");
    g.append("circle").attr("class", "hit");
    g.append("title");
    return g;
  })
    .attr("class", (d) => `cluster ${d.events.some((e) => e.status === "corroborated") ? "multi" : "one"}`)
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .call((g) => g.select("text").text((d) => d.events.length))
    .call((g) => g.select("title").text((d) => clusterTitle(d)));

  // Every event gets a marker (at a disc's center for regions and countries): the event-type icon inside,
  // and a small badge with what was hit when the headlines say.
  dotsG.selectAll("g.dot").data(singles, (d) => d.id).join((enter) => {
    const g = enter.append("g").attr("data-kind", "event").attr("data-id", (d) => d.id);
    g.append("circle").attr("class", "halo");
    g.append("circle").attr("class", "core");
    g.append("use").attr("class", "glyph");
    g.append("circle").attr("class", "tbadge");
    g.append("use").attr("class", "tglyph");
    g.append("circle").attr("class", "hit");
    g.append("title");
    return g;
  })
    .attr("class", (d) => `dot ${tone(d)}${d.weak ? " weak" : ""}${hot(d)}`)
    .attr("transform", (d) => `translate(${projection([d.lng, d.lat])})`)
    .style("opacity", (d) => fadeFor(d, now))
    .call((g) => g.select(".glyph").attr("href", (d) => `#y-${d.event_type}`))
    .call((g) => g.select(".tglyph").attr("href", (d) => (d.target ? `#t-${d.target}` : null)))
    .call((g) => g.select("title").text((d) => `${d.location_name}: ${typeLabel(d)}${d.target ? ` · ${TARGETS[d.target].label}` : ""} · ${d.source_count} ${d.source_count === 1 ? "source" : "sources"}`))
    .order();
  rescale();
}

// Splits events into single markers and groups of markers that would overlap on screen at the current zoom.
function groupMarkers(list) {
  clusterK = k;
  clusters = new Map();
  if (k >= CLUSTER_MAX_K) return { singles: list, groups: [] };
  const size = CLUSTER_PX / k; // in map units, so the same on screen at any zoom
  const keep = (d) => state.hover === d.id || (state.selection && state.selection.id === d.id);
  const singles = [];
  // Each marker joins the nearest group whose center is closer than `size`, then groups that ended up
  // overlapping merge, until nothing is closer than `size`.
  let piles = [];
  for (const d of list) {
    if (keep(d)) { singles.push(d); continue; }
    const [x, y] = projection([d.lng, d.lat]);
    let near = null;
    let nearDist = size;
    for (const p of piles) {
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < nearDist) { near = p; nearDist = dist; }
    }
    if (near) {
      near.events.push(d);
      near.x += (x - near.x) / near.events.length;
      near.y += (y - near.y) / near.events.length;
    } else piles.push({ events: [d], x, y });
  }
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < piles.length && !merged; i++) {
      for (let j = i + 1; j < piles.length; j++) {
        const a = piles[i];
        const b = piles[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) >= size) continue;
        const n = a.events.length + b.events.length;
        a.x = (a.x * a.events.length + b.x * b.events.length) / n;
        a.y = (a.y * a.events.length + b.y * b.events.length) / n;
        a.events.push(...b.events);
        piles.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  const groups = [];
  for (const p of piles) {
    if (p.events.length === 1) { singles.push(p.events[0]); continue; }
    // Named after its members, so a group keeps its identity while it doesn't change.
    p.id = `c_${p.events.map((e) => e.id).sort()[0]}`;
    clusters.set(p.id, p);
    groups.push(p);
  }
  // Keep the oldest-first order for singles, so the newest draw on top.
  const order = new Map(list.map((d, i) => [d.id, i]));
  singles.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { singles, groups };
}

function clusterTitle(group) {
  const counts = new Map();
  for (const e of group.events) counts.set(typeLabel(e), (counts.get(typeLabel(e)) || 0) + 1);
  const kinds = [...counts].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n} ${label.toLowerCase()}`).join(", ");
  const places = [...new Set(group.events.map((e) => e.location_name))].slice(0, 4).join(", ");
  return `${group.events.length} events: ${kinds}. ${places}${group.events.length > 4 ? "…" : ""}. Click to zoom in.`;
}

// Zooms in on a group until its markers separate.
function zoomToCluster(id) {
  const group = clusters.get(id);
  if (!group) return;
  const pts = group.events.map((e) => projection([e.lng, e.lat]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-3);
  // Enough to spread the group over about 4 marker widths, at least 2.5x more than now.
  const kk = Math.min(60, Math.max(k * 2.5, (CLUSTER_PX * 4) / spread));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const t = d3.zoomIdentity.translate(W / 2 - cx * kk, H / 2 - cy * kk).scale(kk);
  svg.interrupt().transition().duration(reduceMotion ? 0 : 700).ease(d3.easeCubicInOut).call(zoom.transform, t);
}

// Markers keep the same size on screen at every zoom level.
function rescale() {
  const s = 1 / k;
  clustersG.selectAll("g.cluster").each(function (d) {
    const r = Math.min(22, 12 + Math.sqrt(d.events.length) * 2.5) * s;
    const g = d3.select(this);
    g.select(".core").attr("r", r);
    g.select(".hit").attr("r", r + 3 * s);
    g.select("text").attr("font-size", 11.5 * s).attr("dy", 4 * s);
  });
  dotsG.selectAll("g.dot").each(function (d) {
    const big = state.hover === d.id || (state.selection && state.selection.id === d.id) ? 1.4 : 1;
    const r = 10.5 * s * big;
    const icon = 13 * s * big;
    const g = d3.select(this);
    g.select(".halo").attr("r", r + 5 * s);
    g.select(".core").attr("r", r);
    g.select(".glyph").attr("x", -icon / 2).attr("y", -icon / 2).attr("width", icon).attr("height", icon);
    // Target badge sits on the marker's top-right edge.
    const bx = r * 0.85;
    const by = -r * 0.85;
    const br = 7.5 * s * big;
    const bi = 10 * s * big;
    g.select(".tbadge").attr("cx", bx).attr("cy", by).attr("r", br).style("display", d.target ? null : "none");
    g.select(".tglyph").attr("x", bx - bi / 2).attr("y", by - bi / 2).attr("width", bi).attr("height", bi).style("display", d.target ? null : "none");
    g.select(".hit").attr("r", Math.max(r + 3 * s, 11 * s));
  });
}

function burst(ev) {
  if (reduceMotion) return;
  const [x, y] = projection([ev.lng, ev.lat]);
  const color = ev.status === "corroborated" ? "var(--multi)" : "var(--one)";
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

// Back to the whole world: close the info card and the Key, clear the selection, slide away side panels that
// aren't pinned, then zoom out.
function resetView() {
  focusToken = null;
  state.cardOn = false;
  state.selection = null;
  setKeyOpen(false);
  if (autoHide.matches) {
    for (const panel of document.querySelectorAll(".panel.open:not(.pinned)")) setPanelOpen(panel, false);
  }
  render();
  const duration = reduceMotion ? 0 : 750;
  let settled = false;
  svg.interrupt().transition().duration(duration).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity)
    .on("end interrupt", () => { settled = true; });
  // Animations pause in background tabs; jump there instead (unless the user grabbed the map meanwhile).
  setTimeout(() => {
    if (settled) return;
    svg.interrupt();
    svg.call(zoom.transform, d3.zoomIdentity);
  }, duration + 150);
}

function pick(kind, id) {
  if (kind === "place") {
    const place = FEATURED_PLACES.find((p) => p.id === id);
    if (place) focusOn(place.lat, place.lng, { kind, id });
  } else {
    const ev = state.events.find((e) => e.id === id);
    if (ev) focusOn(ev.lat, ev.lng, { kind, id });
  }
}

let hoverPopped = false; // the hovered event was pulled out of a group to show it

function setHover(id) {
  if (state.hover === id) return;
  state.hover = id;
  discsG.selectAll("path").classed("hot", (d) => d.id === id || (state.selection && state.selection.id === d.id));
  // An event hidden inside a group (hovered in the list) is pulled out while hovered, then put back.
  const grouped = !!id && [...clusters.values()].some((g) => g.events.some((e) => e.id === id));
  if (grouped || hoverPopped) drawEvents();
  else rescale();
  hoverPopped = grouped;
  document.querySelectorAll("[data-row-id]").forEach((el) => {
    el.classList.toggle("active", el.dataset.rowId === id || (state.selection && state.selection.id === el.dataset.rowId));
  });
}

svg.on("click", (e) => {
  const target = e.target.closest("[data-kind]");
  if (!target) return;
  if (target.dataset.kind === "cluster") zoomToCluster(target.dataset.id);
  else pick(target.dataset.kind, target.dataset.id);
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
  const types = EVENT_TYPES.map((t) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${state.enabled[t]}">${typeIcon(t)}${TYPE_LABEL[t]}</button>`).join("");
  const corr = `<button type="button" class="chip corr" data-corr aria-pressed="${state.corroboratedOnly}" title="Only events reported by two or more independent sources">2+ sources only</button>`;
  const wins = WINDOWS.map((w) => `<button type="button" class="chip win" data-window="${w.h}" aria-pressed="${state.windowH === w.h}" title="Last ${w.long}">${w.label}</button>`).join("");
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
    html = `<li class="empty">No reports match these filters in the last ${windowInfo(state.windowH).long}.</li>`;
  } else {
    html = list.map((ev) => {
      const tone = ev.status === "corroborated" ? "multi" : "one";
      const active = state.hover === ev.id || (state.selection && state.selection.id === ev.id);
      // The tag spells out the source count (hollow for one, solid for several), so color isn't needed.
      const sat = ev.satellite ? `<span class="tag sat" title="Satellite heat detected ${ev.satellite.km.toFixed(1)} km away (NASA FIRMS)">${svgIcon(SATELLITE_ICON)}heat</span>` : "";
      const tag = `${sat}<span class="tag ${tone}">${ev.source_count} ${ev.source_count === 1 ? "source" : "sources"}</span>`;
      const target = ev.target ? `<span class="target" title="${esc(TARGETS[ev.target].label)}">${targetIcon(ev.target)}${esc(TARGETS[ev.target].label)}</span>` : "";
      const hidden = offMap(ev, now);
      const weakNote = hidden ? `<span class="weak-note">Not confirmed within ${WEAK_HOURS} h: off the map</span>` : ev.weak ? `<span class="weak-note">${weakReason(ev)}: shown faintly until a second source confirms</span>` : "";
      return `<li><button type="button" class="row ${tone}${active ? " active" : ""}${hidden ? " off-map" : ""}" data-row-kind="event" data-row-id="${ev.id}">
        <span class="line"><span class="type">${typeIcons(ev)}${typeLabel(ev)}${target}</span><span class="time">${relativeTime(ev.last_updated, now)}</span></span>
        <span class="line"><span class="where">${esc(ev.location_name)}<span> · ${esc(ev.country)}</span></span>${tag}</span>
        <span class="headline">${esc(ev.reports[0].title)}</span>${ev.when ? `<span class="when-note">Happened ${esc(ev.when.label)} (estimated)</span>` : ""}${weakNote}
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
      <span><span class="src">${esc(r.source)}${r.social ? " · social" : ""}${r.wire && r.wire !== r.source ? ` · credits ${esc(r.wire)}` : ""} · ${relativeTime(r.published, now)}</span><span class="ttl">${markTerms(r.title, r.why ? [r.why.type, r.why.place, r.why.target] : [])}</span></span></a></li>`).join("");
    const target = ev.target ? `<p class="hit-target">${targetIcon(ev.target)}<span>Hit: ${esc(TARGETS[ev.target].label)} <span class="muted">(from the headlines)</span></span></p>` : "";
    const sourcesLabel = ev.source_count === 1 ? "1 source" : `${ev.source_count} independent sources`;
    card.innerHTML = `<div class="top"><div><p class="kicker ${corroborated ? "multi" : "one"}">${typeIcons(ev)}${typeLabel(ev)}${ev.combined ? " (combined attack)" : ""} · ${sourcesLabel}</p><h2>${esc(ev.location_name)}</h2></div>${close}</div>
      <div class="body"><p class="muted">${esc(ev.country)}</p>${target}
      <p class="meta">${formatUtc(ev.last_updated)} · ${formatLocal(ev.last_updated)} <span class="muted">(when reported)</span></p>
      ${whyHtml(ev)}
      <ul class="reports">${reports}</ul>
      <a class="search" href="${esc(xSearchUrl(ev.location_name, ev.event_type))}" target="_blank" rel="noopener noreferrer">Latest posts on X →</a></div>`;
  }
  card.hidden = false;
}

// A headline with the words the rules matched highlighted (escaped; first match of each term).
function markTerms(title, terms) {
  const ranges = [];
  const lower = title.toLowerCase();
  for (const term of new Set(terms.filter(Boolean))) {
    const at = lower.indexOf(term.toLowerCase());
    if (at >= 0 && !ranges.some(([s, e]) => at < e && at + term.length > s)) ranges.push([at, at + term.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = 0;
  for (const [s, e] of ranges) {
    out += esc(title.slice(pos, s)) + `<mark>${esc(title.slice(s, e))}</mark>`;
    pos = e;
  }
  return out + esc(title.slice(pos));
}

function weakReason(ev) {
  return ev.reports.every((r) => r.social && !r.wire) ? "Single social-media source" : "Only a whole country is named";
}

const PRECISION_TEXT = { city: "city, ±10 km", region: "region, ±100 km", country: "whole country, ±300 km" };

// "Why this is on the map": the words behind the type, place, target and source count.
function whyHtml(ev) {
  const quote = (s) => `“${esc(s)}”`;
  const lines = [];
  // One line per kind: a combined attack explains each weapon.
  for (const type of ev.combined ? ev.weapons : [ev.event_type]) {
    const typeR = ev.reports.find((r) => r.type === type && r.why);
    if (typeR) lines.push(`<li><b>${typeIcon(type)}${TYPE_LABEL[type]}</b> <span>because ${esc(typeR.source)} wrote ${quote(typeR.why.type)}</span></li>`);
  }
  if (ev.combined) lines.push(`<li class="once">Different weapons reported in the same city within 3 hours count as one combined attack.</li>`);
  if (ev.when) {
    const w = ev.when;
    const r = ev.reports.find((x) => x.when && x.when.from === w.from);
    lines.push(`<li><b>When</b> <span>${esc(w.label)} (estimated from ${esc(r ? r.source : "a headline")}'s wording: between ${formatUtc(w.from)} and ${formatUtc(w.to)}${new Date(w.from).toISOString().slice(0, 10) !== new Date(w.to).toISOString().slice(0, 10) ? ", across two days" : ""})</span></li>`);
  }
  const placeR = ev.reports.find((r) => r.placeName === ev.location_name && r.why);
  if (placeR) {
    const words = placeR.why.cue === "'s" ? `${placeR.why.place}'s` : placeR.why.cue ? `${placeR.why.cue} ${placeR.why.place}` : placeR.why.place;
    lines.push(`<li><b>${esc(ev.location_name)}</b> <span>(${PRECISION_TEXT[ev.precision]}) because of ${quote(words)}</span></li>`);
  }
  const targetR = ev.target && ev.reports.find((r) => r.target === ev.target && r.why && r.why.target);
  if (targetR) lines.push(`<li><b>${targetIcon(ev.target)}${esc(TARGETS[ev.target].label)}</b> <span>because of ${quote(targetR.why.target)}</span></li>`);
  // Sources: how the headlines were counted.
  const headlines = ev.reports.length;
  let sources = `<b>${ev.source_count === 1 ? "1 source" : `${ev.source_count} independent sources`}</b> <span>from ${headlines} ${headlines === 1 ? "headline" : "headlines"}`;
  sources += ev.outlet_count !== headlines ? ` by ${ev.outlet_count} ${ev.outlet_count === 1 ? "outlet" : "outlets"}` : "";
  sources += "</span>";
  const once = ev.groups
    .filter((g) => g.reasons.size && new Set(g.reports.map((r) => r.source)).size > 1)
    .map((g) => `<li class="once">Counted once: ${esc([...new Set(g.reports.map((r) => r.source))].join(", "))} <span>(${esc([...g.reasons].join("; "))})</span></li>`);
  lines.push(`<li>${sources}</li>`, ...once);
  if (ev.satellite) {
    const s = ev.satellite;
    lines.push(`<li><b>${svgIcon(SATELLITE_ICON)}Satellite heat</b> <span>detected ${s.km.toFixed(1)} km away at ${formatUtc(s.time)} (NASA FIRMS). It may be unrelated: industry and farm fires show up too.</span></li>`);
  }
  if (ev.weak) {
    lines.push(offMap(ev)
      ? `<li class="once">${weakReason(ev)}, and no second source within ${WEAK_HOURS} hours, so it's off the map (still listed here).</li>`
      : `<li class="once">${weakReason(ev)}, so it's shown faintly; it leaves the map if no second source confirms within ${WEAK_HOURS} hours.</li>`);
  }
  return `<div class="why"><p class="why-title">Why this is on the map</p><ul>${lines.join("")}</ul></div>`;
}

// The Key popover: what the marker shapes, colors and icons mean.
function renderKey() {
  const item = (icon, label) => `<li>${icon}<span>${esc(label)}</span></li>`;
  document.getElementById("key").innerHTML = `
    <h2>Sources</h2>
    <ul>
      ${item('<i class="swatch one"></i>', "Hollow ring: 1 source")}
      ${item('<i class="swatch multi"></i>', "Solid dot: 2+ independent sources")}
    </ul>
    <p class="key-note">Reprints of one wire story, near-identical headlines and outlets with the same owner (RT and Sputnik, for example) count as one source. A report from a single social-media source, or naming only a whole country, is shown faintly and leaves the map if nothing confirms it within ${WEAK_HOURS} hours (it stays in the feed list).</p>
    <p class="key-note">${svgIcon(SATELLITE_ICON)} <b>heat</b>: a NASA satellite detected heat within ${SAT_KM} km around the time of the report. Supporting evidence, not proof: industry and farm fires show up too.</p>
    <h2>What happened</h2>
    <ul>${EVENT_TYPES.map((t) => item(typeIcon(t), TYPE_LABEL[t])).join("")}</ul>
    <h2>What was hit <span>(small badge, when the headline says)</span></h2>
    <ul>${Object.keys(TARGETS).map((t) => item(targetIcon(t), TARGETS[t].label)).join("")}</ul>
    <p>A numbered bubble groups nearby events; click it to zoom in. Different weapons reported in the same city within 3 hours show as one combined attack ("Missile + drone"). "Happened overnight (estimated)" comes from wording like "overnight" or "yesterday"; otherwise the time is when it was reported. Headlines in Arabic, Russian and Ukrainian are read too.</p>
    <p>Not every marker is an attack. Fire is a blaze at a facility (refinery, depot, plant, port…), Wildfire is a forest, bush or grass fire, and Environmental is a spill, leak, dam breach or mine accident; explosions and fires may be accidents. Cities are markers; regions and countries also get a 100 or 300 km disc. Markers fade as reports age.</p>`;
}

function setKeyOpen(open) {
  document.getElementById("key").hidden = !open;
  document.querySelector("[data-key-toggle]").setAttribute("aria-expanded", String(open));
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
  if (win) {
    state.windowH = Number(win.dataset.window);
    // Events are rebuilt per range, since reports merge differently over a longer window.
    if (matcher && state.data) rebuild(false); else render();
    return;
  }
  if (e.target.closest("[data-close]")) { state.cardOn = false; renderCard(); return; }
  if (e.target.closest("[data-reset]")) { resetView(); return; }
  if (e.target.closest("[data-key-toggle]")) { setKeyOpen(document.getElementById("key").hidden); return; }
  if (!e.target.closest("#key")) setKeyOpen(false);
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
  if (e.key === "Escape") { setKeyOpen(false); if (state.cardOn) { state.cardOn = false; renderCard(); } }
  if ((e.key === "0" || e.key === "Home") && !e.target.closest("input, textarea")) resetView();
});

// ---------- start ----------

async function start() {
  renderKey();
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
    matcher = MeridianExtract.buildMatcher(countries);
  } catch {
    document.getElementById("status").title = "The world map didn't load. Reload the page to try again.";
  }
  await Promise.all([feed, loadFires()]);
  rebuild();
  // Satellite data changes hourly at most.
  setInterval(() => loadFires().then((ok) => { if (ok) rebuild(false); }), 30 * 60 * 1000);
  pollLive();
  setInterval(loadFeed, POLL_S * 1000);
  setInterval(pollLive, POLL_S * 1000);
  setInterval(() => { renderFeed(); drawEvents(); updateStatus(); }, 10000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadFeed(); pollLive(); } });
}

start();
