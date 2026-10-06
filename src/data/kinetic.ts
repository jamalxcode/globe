export const EVENT_TYPES = [
  "airstrike",
  "missile",
  "explosion",
  "shelling",
  "drone",
  "other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type Precision = "city" | "region" | "country";
export type KineticStatus = "unverified" | "corroborated";
export type IngestMode = "mock" | "live" | "search";

export type KineticEvent = {
  id: string;
  lat: number;
  lng: number;
  event_type: EventType;
  location_name: string;
  country: string;
  precision: Precision;
  radius_km: number;
  status: KineticStatus;
  source_count: number;
  confidence: number;
  first_seen: string;
  last_updated: string;
  post_urls: string[];
};

export type FeaturedPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  description: string;
};

export type Hotspot = {
  name: string;
  country: string;
  lat: number;
  lng: number;
  precision: Precision;
};

export const FEATURED_PLACES: FeaturedPlace[] = [
  {
    id: "kuwait-city",
    name: "Kuwait City",
    lat: 29.3759,
    lng: 47.9774,
    description: "Capital of Kuwait, on the northwest shore of the Persian Gulf.",
  },
  {
    id: "tehran",
    name: "Tehran",
    lat: 35.6892,
    lng: 51.389,
    description: "Capital of Iran, on the southern slopes of the Alborz mountains.",
  },
  {
    id: "tel-aviv",
    name: "Tel Aviv",
    lat: 32.0853,
    lng: 34.7818,
    description: "Mediterranean coastal city and Israel's main economic center.",
  },
  {
    id: "kyiv",
    name: "Kyiv",
    lat: 50.4501,
    lng: 30.5234,
    description: "Capital of Ukraine, straddling the Dnieper River.",
  },
  {
    id: "baghdad",
    name: "Baghdad",
    lat: 33.3152,
    lng: 44.3661,
    description: "Capital of Iraq, on the Tigris River.",
  },
  {
    id: "damascus",
    name: "Damascus",
    lat: 33.5138,
    lng: 36.2765,
    description: "Capital of Syria and one of the oldest continuously inhabited cities.",
  },
  {
    id: "sanaa",
    name: "Sana'a",
    lat: 15.3694,
    lng: 44.191,
    description: "Capital of Yemen, high in the western Sarawat mountains.",
  },
  {
    id: "beirut",
    name: "Beirut",
    lat: 33.8938,
    lng: 35.5018,
    description: "Capital of Lebanon, on a peninsula in the eastern Mediterranean.",
  },
  {
    id: "taipei",
    name: "Taipei",
    lat: 25.033,
    lng: 121.5654,
    description: "Capital of Taiwan, in a basin ringed by volcanic hills.",
  },
  {
    id: "kharkiv",
    name: "Kharkiv",
    lat: 49.9935,
    lng: 36.2304,
    description: "Major city in northeastern Ukraine, near the Russian border.",
  },
];

/** Real-world places used only by mock mode. Not live reporting. */
export const HOTSPOTS: Hotspot[] = [
  { name: "Kyiv", country: "Ukraine", lat: 50.4501, lng: 30.5234, precision: "city" },
  { name: "Kharkiv", country: "Ukraine", lat: 49.9935, lng: 36.2304, precision: "city" },
  { name: "Odesa", country: "Ukraine", lat: 46.4825, lng: 30.7233, precision: "city" },
  { name: "Dnipro", country: "Ukraine", lat: 48.4647, lng: 35.0462, precision: "city" },
  { name: "Zaporizhzhia", country: "Ukraine", lat: 47.8388, lng: 35.1396, precision: "city" },
  { name: "Kherson", country: "Ukraine", lat: 46.6354, lng: 32.6169, precision: "city" },
  { name: "Donetsk Oblast", country: "Ukraine", lat: 48.0159, lng: 37.8028, precision: "region" },
  { name: "Sumy", country: "Ukraine", lat: 50.9077, lng: 34.7981, precision: "city" },
  { name: "Gaza City", country: "Palestine", lat: 31.5017, lng: 34.4668, precision: "city" },
  { name: "Rafah", country: "Palestine", lat: 31.2969, lng: 34.2455, precision: "city" },
  { name: "Khan Yunis", country: "Palestine", lat: 31.3462, lng: 34.306, precision: "city" },
  { name: "Tel Aviv", country: "Israel", lat: 32.0853, lng: 34.7818, precision: "city" },
  { name: "Haifa", country: "Israel", lat: 32.794, lng: 34.9896, precision: "city" },
  { name: "Northern District", country: "Israel", lat: 32.95, lng: 35.35, precision: "region" },
  { name: "Beirut", country: "Lebanon", lat: 33.8938, lng: 35.5018, precision: "city" },
  { name: "Tyre", country: "Lebanon", lat: 33.2705, lng: 35.2038, precision: "city" },
  { name: "South Governorate", country: "Lebanon", lat: 33.27, lng: 35.37, precision: "region" },
  { name: "Damascus", country: "Syria", lat: 33.5138, lng: 36.2765, precision: "city" },
  { name: "Aleppo", country: "Syria", lat: 36.2021, lng: 37.1343, precision: "city" },
  { name: "Homs", country: "Syria", lat: 34.7324, lng: 36.7137, precision: "city" },
  { name: "Idlib", country: "Syria", lat: 35.9306, lng: 36.6339, precision: "city" },
  { name: "Baghdad", country: "Iraq", lat: 33.3152, lng: 44.3661, precision: "city" },
  { name: "Erbil", country: "Iraq", lat: 36.1911, lng: 44.0092, precision: "city" },
  { name: "Mosul", country: "Iraq", lat: 36.335, lng: 43.1189, precision: "city" },
  { name: "Sana'a", country: "Yemen", lat: 15.3694, lng: 44.191, precision: "city" },
  { name: "Aden", country: "Yemen", lat: 12.7855, lng: 45.0187, precision: "city" },
  { name: "Al Hudaydah", country: "Yemen", lat: 14.7978, lng: 42.9545, precision: "city" },
  { name: "Marib", country: "Yemen", lat: 15.4706, lng: 45.3228, precision: "city" },
  { name: "Tehran", country: "Iran", lat: 35.6892, lng: 51.389, precision: "city" },
  { name: "Isfahan", country: "Iran", lat: 32.6546, lng: 51.668, precision: "city" },
  { name: "Bandar Abbas", country: "Iran", lat: 27.1832, lng: 56.2666, precision: "city" },
  { name: "Khuzestan", country: "Iran", lat: 31.32, lng: 48.68, precision: "region" },
  { name: "Strait of Hormuz", country: "Iran", lat: 26.5667, lng: 56.25, precision: "region" },
  { name: "Belgorod", country: "Russia", lat: 50.5954, lng: 36.5873, precision: "city" },
  { name: "Kursk", country: "Russia", lat: 51.7304, lng: 36.1926, precision: "city" },
  { name: "Sevastopol", country: "Ukraine", lat: 44.6166, lng: 33.5254, precision: "city" },
  { name: "Khartoum", country: "Sudan", lat: 15.5007, lng: 32.5599, precision: "city" },
  { name: "El Fasher", country: "Sudan", lat: 13.6281, lng: 25.3494, precision: "city" },
  { name: "Port Sudan", country: "Sudan", lat: 19.6158, lng: 37.2164, precision: "city" },
  { name: "Sudan", country: "Sudan", lat: 15.5, lng: 30.2, precision: "country" },
  { name: "Yangon", country: "Myanmar", lat: 16.8409, lng: 96.1735, precision: "city" },
  { name: "Mandalay", country: "Myanmar", lat: 21.9588, lng: 96.0891, precision: "city" },
  { name: "Myanmar", country: "Myanmar", lat: 21.0, lng: 96.0, precision: "country" },
  { name: "Goma", country: "DR Congo", lat: -1.6585, lng: 29.2205, precision: "city" },
  { name: "North Kivu", country: "DR Congo", lat: -0.7, lng: 28.8, precision: "region" },
];

const TYPE_WEIGHTS: { type: EventType; w: number }[] = [
  { type: "airstrike", w: 22 },
  { type: "missile", w: 18 },
  { type: "explosion", w: 20 },
  { type: "shelling", w: 16 },
  { type: "drone", w: 16 },
  { type: "other", w: 8 },
];

export function radiusKm(precision: Precision): number {
  if (precision === "city") return 10;
  if (precision === "region") return 100;
  return 300;
}

export function pickEventType(rng: () => number = Math.random): EventType {
  const total = TYPE_WEIGHTS.reduce((s, t) => s + t.w, 0);
  let roll = rng() * total;
  for (const entry of TYPE_WEIGHTS) {
    roll -= entry.w;
    if (roll <= 0) return entry.type;
  }
  return "other";
}

export function typesCompatible(a: EventType, b: EventType): boolean {
  if (a === b) return true;
  if (a === "explosion" || b === "explosion") return true;
  if (a === "other" || b === "other") return true;
  return false;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const a =
    s1 * s1 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Unit vector for an equirectangular globe texture on THREE.SphereGeometry. */
export function latLngToUnit(lat: number, lng: number): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return [
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ];
}

export function searchUrl(location: string, eventType: string): string {
  const q = `${location} ${eventType}`;
  return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
}

export function relativeTime(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatUtc(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

export function formatLocal(iso: string): string {
  const label = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  return `${label} local`;
}
