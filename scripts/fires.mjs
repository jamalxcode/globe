// Writes fires.json: NASA FIRMS satellite heat detections (VIIRS, last 48 hours) near known cities, so the map
// can note "heat detected" next to a reported strike, explosion or fire. Run hourly by
// .github/workflows/deploy.yml:  FIRMS_MAP_KEY=... node scripts/fires.mjs > _site/fires.json
// Without FIRMS_MAP_KEY it writes nothing and exits 0 (the map then simply shows no satellite notes).
// Free key: https://firms.modaps.eosdis.nasa.gov/api/map_key/
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const KEY = (process.env.FIRMS_MAP_KEY || "").trim();
if (!KEY) {
  console.error("FIRMS_MAP_KEY not set: no fires.json");
  process.exit(0);
}

// Two satellites with the same sensor, each passing about twice a day.
const PRODUCTS = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT"];
const DAYS = 2;
const NEAR_KM = 15; // keep detections this close to a known city (the page matches within 10 km)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
for (const f of ["cities.js", "places.js"]) vm.runInContext(readFileSync(path.join(root, f), "utf8"), context, { filename: f });
const lines = vm.runInContext("CITY_LINES + '\\n' + PLACE_LINES", context);

// City points (not regions), on a 1-degree grid for quick lookups.
const grid = new Map();
for (const raw of lines.split("\n")) {
  const parts = raw.trim().split("|");
  if (parts.length < 4 || parts[4] === "r") continue;
  const lat = Number(parts[2]);
  const lng = Number(parts[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const key = `${Math.floor(lat)},${Math.floor(lng)}`;
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push([lat, lng]);
}

function km(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function nearCity(lat, lng) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const [clat, clng] of grid.get(`${Math.floor(lat) + dy},${Math.floor(lng) + dx}`) || []) {
        if (km(lat, lng, clat, clng) <= NEAR_KM) return true;
      }
    }
  }
  return false;
}

const points = [];
let read = 0;
for (const product of PRODUCTS) {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/${product}/world/${DAYS}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`${product}: HTTP ${res.status}`);
    continue;
  }
  const text = await res.text();
  const rows = text.trim().split("\n");
  const head = rows.shift().split(",");
  const col = (name) => head.indexOf(name);
  const [iLat, iLng, iDate, iTime, iConf, iFrp] = ["latitude", "longitude", "acq_date", "acq_time", "confidence", "frp"].map(col);
  if (iLat < 0 || iDate < 0) {
    console.error(`${product}: unexpected response: ${text.slice(0, 120)}`);
    continue;
  }
  for (const row of rows) {
    const f = row.split(",");
    read++;
    if (f[iConf] === "l" || f[iConf] === "low") continue; // low-confidence detections
    const lat = Number(f[iLat]);
    const lng = Number(f[iLng]);
    if (!nearCity(lat, lng)) continue;
    const hhmm = f[iTime].padStart(4, "0");
    const t = Date.parse(`${f[iDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    points.push([Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000, Math.round(t / 60000), Math.round(Number(f[iFrp]) || 0)]);
  }
}

console.error(`read ${read} detections, kept ${points.length} near cities`);
process.stdout.write(JSON.stringify({
  generated_at: new Date().toISOString(),
  source: "NASA FIRMS, VIIRS S-NPP and NOAA-20, near-real-time",
  hours: DAYS * 24,
  // [lat, lng, minutes since 1970 UTC, fire radiative power in MW]
  points,
}));
