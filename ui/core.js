// Meridian: a live equal-area map of reported strikes, explosions, fires and environmental incidents.
// Runs entirely in the browser. Headlines come from news.sala.company's feed.json and local.json (Arabic,
// Russian, Ukrainian), rebuilt every ~5 min on GitHub and covering 48 hours, plus the feed's Bluesky accounts,
// polled live. extract.js turns each headline into a mention; events.js merges mentions into events.
// Hollow ring = one source. Solid dot = two or more independent sources.
//
// The page's own code is split into ui/ (this file: constants, state and helpers). They're plain scripts that
// share one global scope and load in order (see index.html): core, feed, map, panels, sanctions-view, main.
"use strict";

const FEED_URL = "https://news.sala.company/feed.json";
const LOCAL_URL = "https://news.sala.company/local.json"; // non-English sources, built for this map
const ATLAS_URL = "vendor/countries-50m.json"; // world-atlas 2.0.2 (Natural Earth country shapes), kept in the repo
const FIRES_URL = "fires.json"; // satellite heat, NASA FIRMS, refreshed hourly by the deploy workflow
const SANCTIONS_URL = "sanctions-data.json"; // OFAC's list, counted per country, refreshed daily by the deploy workflow
const OFAC_PROGRAMS_URL = "https://ofac.treasury.gov/sanctions-programs-and-country-information";
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
  view: "strikes",     // "strikes" | "sanctions"
  sColor: "severity",  // Sanctions view colors: "severity" | "reason"
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

// Only web links are clickable: a feed item with a javascript: or data: address gets no link at all.
function safeUrl(u) {
  return /^https?:\/\//i.test(String(u || "")) ? String(u) : null;
}

// Replaces a list's contents only when they changed, and puts keyboard focus back on the same row or chip
// afterwards, so the 10-second refresh doesn't throw a keyboard or screen-reader user back to the top.
const lastHtml = new WeakMap();
function setHTML(el, html) {
  if (lastHtml.get(el) === html) return;
  const active = document.activeElement;
  const key = active && el.contains(active) ? focusKey(active) : null;
  el.innerHTML = html;
  lastHtml.set(el, html);
  if (key) {
    const again = el.querySelector(key);
    if (again) again.focus({ preventScroll: true });
  }
}
function focusKey(node) {
  const b = node.closest("[data-row-id], [data-type], [data-window], [data-corr]");
  if (!b) return null;
  for (const a of ["data-row-id", "data-type", "data-window"]) {
    if (b.hasAttribute(a)) return `[${a}="${CSS.escape(b.getAttribute(a))}"]`;
  }
  return "[data-corr]";
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

function formatDay(iso) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

function windowInfo(h) {
  return WINDOWS.find((w) => w.h === h) || WINDOWS[3];
}

function xSearchUrl(location, type) {
  return `https://x.com/search?q=${encodeURIComponent(`${location} ${type}`)}&src=typed_query&f=live`;
}

const ICON_EXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
