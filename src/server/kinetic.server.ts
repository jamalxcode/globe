import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  HOTSPOTS,
  haversineKm,
  pickEventType,
  radiusKm,
  searchUrl,
  typesCompatible,
  type EventType,
  type IngestMode,
  type KineticEvent,
  type KineticStatus,
  type Precision,
} from "../data/kinetic";

const MAX_EVENTS = 200;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MERGE_KM = 50;
const MERGE_MS = 30 * 60 * 1000;
const LLM_HOURLY_CAP = 30;

const KEYWORDS =
  '(airstrike OR "missile strike" OR explosion OR shelling OR "drone strike" OR interception) -is:retweet';

const extractedSchema = z.object({
  is_kinetic: z.boolean(),
  event_type: z.enum(["airstrike", "missile", "explosion", "shelling", "drone", "other"]),
  location_name: z.string().trim().min(1).max(120),
  country: z.string().trim().min(1).max(80),
  precision: z.enum(["city", "region", "country"]),
  confidence: z.coerce.number().min(0).max(1),
});

type Extracted = z.infer<typeof extractedSchema>;

type StoredEvent = KineticEvent & { authors: Set<string> };

type Listener = (message: { event: string; data: unknown }) => void;

type Hub = {
  mode: IngestMode;
  ingestNote: string;
  events: Map<string, StoredEvent>;
  listeners: Set<Listener>;
  seenPosts: Set<string>;
  llmCalls: number[];
  geoCache: Map<string, { lat: number; lng: number } | null>;
  geoChain: Promise<void>;
  started: boolean;
  seq: number;
};

const globalRef = globalThis as typeof globalThis & { __meridianHub?: Hub };

function emptyHub(): Hub {
  return {
    mode: "mock",
    ingestNote: "starting",
    events: new Map(),
    listeners: new Set(),
    seenPosts: new Set(),
    llmCalls: [],
    geoCache: new Map(),
    geoChain: Promise.resolve(),
    started: false,
    seq: 1,
  };
}

function listPublic(hub: Hub): KineticEvent[] {
  return [...hub.events.values()]
    .map(toPublic)
    .sort((a, b) => Date.parse(b.last_updated) - Date.parse(a.last_updated));
}

function toPublic(event: StoredEvent): KineticEvent {
  return {
    id: event.id,
    lat: event.lat,
    lng: event.lng,
    event_type: event.event_type,
    location_name: event.location_name,
    country: event.country,
    precision: event.precision,
    radius_km: event.radius_km,
    status: event.status,
    source_count: event.source_count,
    confidence: event.confidence,
    first_seen: event.first_seen,
    last_updated: event.last_updated,
    post_urls: event.post_urls,
  };
}

function emit(hub: Hub, event: string, data: unknown) {
  for (const listener of hub.listeners) listener({ event, data });
}

function prune(hub: Hub, now = Date.now()) {
  for (const [id, event] of hub.events) {
    if (now - Date.parse(event.first_seen) > MAX_AGE_MS) {
      hub.events.delete(id);
      emit(hub, "remove", { id });
      console.log(`[discard] expired ${id}`);
    }
  }
  if (hub.events.size <= MAX_EVENTS) return;
  const oldest = [...hub.events.values()].sort(
    (a, b) => Date.parse(a.first_seen) - Date.parse(b.first_seen),
  );
  while (hub.events.size > MAX_EVENTS && oldest.length) {
    const event = oldest.shift();
    if (!event) break;
    hub.events.delete(event.id);
    emit(hub, "remove", { id: event.id });
    console.log(`[discard] cap ${event.id}`);
  }
}

function applyStatus(event: StoredEvent) {
  event.source_count = event.authors.size;
  event.status = (event.source_count >= 2 ? "corroborated" : "unverified") as KineticStatus;
}

function precisionRank(precision: Precision): number {
  if (precision === "city") return 3;
  if (precision === "region") return 2;
  return 1;
}

type Incoming = {
  lat: number;
  lng: number;
  event_type: EventType;
  location_name: string;
  country: string;
  precision: Precision;
  confidence: number;
  author: string;
  post_url: string;
  seenAt: string;
};

function acceptIncoming(hub: Hub, incoming: Incoming) {
  const seenMs = Date.parse(incoming.seenAt);
  let best: StoredEvent | null = null;
  let bestDist = Infinity;
  for (const event of hub.events.values()) {
    if (!typesCompatible(event.event_type, incoming.event_type)) continue;
    const dist = haversineKm(event.lat, event.lng, incoming.lat, incoming.lng);
    if (dist > MERGE_KM) continue;
    const anchor = Date.parse(event.last_updated);
    if (Math.abs(seenMs - anchor) > MERGE_MS) continue;
    if (dist < bestDist) {
      best = event;
      bestDist = dist;
    }
  }

  if (best) {
    const was = best.status;
    best.authors.add(incoming.author);
    applyStatus(best);
    best.last_updated = incoming.seenAt;
    best.confidence = Math.max(best.confidence, incoming.confidence);
    if (!best.post_urls.includes(incoming.post_url) && best.post_urls.length < 8) {
      best.post_urls.push(incoming.post_url);
    }
    if (precisionRank(incoming.precision) > precisionRank(best.precision)) {
      best.precision = incoming.precision;
      best.radius_km = radiusKm(incoming.precision);
      best.lat = incoming.lat;
      best.lng = incoming.lng;
      best.location_name = incoming.location_name;
      best.country = incoming.country;
    }
    emit(hub, "upsert", toPublic(best));
    console.log(
      `[merge] ${best.id} sources=${best.source_count} dist=${bestDist.toFixed(1)}km ${best.location_name} ${was}->${best.status}`,
    );
    return;
  }

  const event: StoredEvent = {
    id: `k_${hub.seq.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    lat: incoming.lat,
    lng: incoming.lng,
    event_type: incoming.event_type,
    location_name: incoming.location_name,
    country: incoming.country,
    precision: incoming.precision,
    radius_km: radiusKm(incoming.precision),
    status: "unverified",
    source_count: 1,
    confidence: incoming.confidence,
    first_seen: incoming.seenAt,
    last_updated: incoming.seenAt,
    post_urls: [incoming.post_url],
    authors: new Set([incoming.author]),
  };
  hub.seq += 1;
  applyStatus(event);
  hub.events.set(event.id, event);
  prune(hub);
  if (hub.events.has(event.id)) {
    emit(hub, "upsert", toPublic(event));
    console.log(
      `[ingest] ${event.id} ${event.event_type} ${event.location_name} @${incoming.author}`,
    );
  }
}

function loadGeoCache(hub: Hub) {
  const path = join(process.cwd(), "geocache.json");
  if (!existsSync(path)) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      { lat: number; lng: number } | null
    >;
    for (const [key, value] of Object.entries(parsed)) hub.geoCache.set(key, value);
  } catch (error) {
    console.log(`[discard] geocache unreadable ${error instanceof Error ? error.message : ""}`);
  }
}

function saveGeoCache(hub: Hub) {
  try {
    const obj: Record<string, { lat: number; lng: number } | null> = {};
    for (const [key, value] of hub.geoCache) obj[key] = value;
    writeFileSync(join(process.cwd(), "geocache.json"), JSON.stringify(obj));
  } catch {
    // Serverless filesystems are read-only; the memory cache still holds the hit.
  }
}

function geocode(hub: Hub, query: string): Promise<{ lat: number; lng: number } | null> {
  const key = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (hub.geoCache.has(key)) return Promise.resolve(hub.geoCache.get(key) ?? null);
  const job = hub.geoChain.then(async () => {
    await sleep(1100);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "MeridianGlobe/1.0 (kinetic-events-demo)",
        },
      });
      if (!res.ok) {
        console.log(`[discard] geocode http ${res.status} ${query}`);
        return null;
      }
      const rows = (await res.json()) as { lat?: string; lon?: string }[];
      const row = rows[0];
      if (!row?.lat || !row.lon) {
        hub.geoCache.set(key, null);
        saveGeoCache(hub);
        return null;
      }
      const hit = { lat: Number(row.lat), lng: Number(row.lon) };
      if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return null;
      hub.geoCache.set(key, hit);
      saveGeoCache(hub);
      return hit;
    } catch (error) {
      console.log(
        `[discard] geocode fail ${query} ${error instanceof Error ? error.message : ""}`,
      );
      return null;
    }
  });
  hub.geoChain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seedMock(hub: Hub) {
  const picks = [0, 8, 13, 14, 17, 21, 24, 28, 36, 43].filter((i) => HOTSPOTS[i]);
  const now = Date.now();
  picks.slice(0, 8).forEach((index, n) => {
    const spot = HOTSPOTS[index];
    if (!spot) return;
    const type = pickEventType();
    const ago = (4 + n * 8) * 60 * 1000;
    const seen = new Date(now - ago).toISOString();
    const corroborated = n === 1 || n === 4;
    const authors = new Set<string>([`mock-${n + 1}a`]);
    if (corroborated) authors.add(`mock-${n + 1}b`);
    const event: StoredEvent = {
      id: `k_seed_${n}`,
      lat: spot.lat,
      lng: spot.lng,
      event_type: type,
      location_name: spot.name,
      country: spot.country,
      precision: spot.precision,
      radius_km: radiusKm(spot.precision),
      status: corroborated ? "corroborated" : "unverified",
      source_count: authors.size,
      confidence: corroborated ? 0.84 : 0.67 + (n % 3) * 0.05,
      first_seen: seen,
      last_updated: corroborated ? new Date(now - ago + 4 * 60 * 1000).toISOString() : seen,
      post_urls: [searchUrl(spot.name, type)],
      authors,
    };
    if (corroborated) event.post_urls.push(searchUrl(`${spot.name} strike`, type));
    hub.events.set(event.id, event);
  });
  console.log(`[ingest] mock seed ${hub.events.size} events`);
}

function tickMock(hub: Hub) {
  const nowIso = new Date().toISOString();
  const open = [...hub.events.values()].filter(
    (event) =>
      event.status === "unverified" && Date.now() - Date.parse(event.last_updated) < MERGE_MS,
  );
  if (open.length > 0 && Math.random() < 0.38) {
    const event = open[Math.floor(Math.random() * open.length)];
    if (!event) return;
    acceptIncoming(hub, {
      lat: event.lat,
      lng: event.lng,
      event_type: event.event_type,
      location_name: event.location_name,
      country: event.country,
      precision: event.precision,
      confidence: Math.min(0.96, event.confidence + 0.1),
      author: `mock-corroborator-${event.authors.size + 1}`,
      post_url: searchUrl(`${event.location_name} confirmed`, event.event_type),
      seenAt: nowIso,
    });
    return;
  }
  const spot = HOTSPOTS[Math.floor(Math.random() * HOTSPOTS.length)];
  if (!spot) return;
  const type = pickEventType();
  const jitter = spot.precision === "city" ? (Math.random() - 0.5) * 0.18 : 0;
  acceptIncoming(hub, {
    lat: spot.lat + jitter,
    lng: spot.lng + jitter,
    event_type: type,
    location_name: spot.name,
    country: spot.country,
    precision: spot.precision,
    confidence: 0.62 + Math.random() * 0.28,
    author: `mock-${Math.floor(Math.random() * 9000 + 1000)}`,
    post_url: searchUrl(spot.name, type),
    seenAt: nowIso,
  });
}

function startMock(hub: Hub) {
  seedMock(hub);
  const timer = setInterval(() => {
    prune(hub);
    tickMock(hub);
  }, 5000);
  timer.unref?.();
  hub.ingestNote = "mock";
}

type AccountRow = { handle?: string };

function loadAccounts(): string[] {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), "accounts.json"), "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) => (row as AccountRow).handle?.replace(/^@/, "").trim() ?? "")
      .filter((handle) => /^[A-Za-z0-9_]{1,15}$/.test(handle));
  } catch (error) {
    console.log(`[discard] accounts.json ${error instanceof Error ? error.message : ""}`);
    return [];
  }
}

function ruleChunks(accounts: string[]): { value: string; tag: string }[] {
  const rules = [{ value: KEYWORDS, tag: "meridian-keywords" }];
  const chunk: string[] = [];
  let size = 0;
  let index = 0;
  const flush = () => {
    if (!chunk.length) return;
    rules.push({
      value: `(${chunk.join(" OR ")}) -is:retweet`,
      tag: `meridian-accounts-${index}`,
    });
    index += 1;
    chunk.length = 0;
    size = 0;
  };
  for (const handle of accounts) {
    const piece = `from:${handle}`;
    if (size + piece.length + 4 > 900) flush();
    chunk.push(piece);
    size += piece.length + 4;
  }
  flush();
  return rules;
}

async function xFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function retryDelay(res: Response, attempt: number): number {
  const reset = res.headers.get("x-rate-limit-reset");
  if (res.status === 429 && reset) {
    const wait = Number(reset) * 1000 - Date.now();
    if (Number.isFinite(wait) && wait > 0) return Math.min(wait + 500, 15 * 60 * 1000);
  }
  return Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
}

async function syncRules(token: string, rules: { value: string; tag: string }[]) {
  const list = await xFetch(token, "https://api.x.com/2/tweets/search/stream/rules");
  if (!list.ok) {
    const text = await list.text();
    throw Object.assign(new Error(`rules ${list.status} ${text.slice(0, 160)}`), {
      status: list.status,
    });
  }
  const body = (await list.json()) as { data?: { id: string; tag?: string }[] };
  const mine = (body.data ?? []).filter((rule) => rule.tag?.startsWith("meridian"));
  if (mine.length) {
    await xFetch(token, "https://api.x.com/2/tweets/search/stream/rules", {
      method: "POST",
      body: JSON.stringify({ delete: { ids: mine.map((rule) => rule.id) } }),
    });
  }
  const added = await xFetch(token, "https://api.x.com/2/tweets/search/stream/rules", {
    method: "POST",
    body: JSON.stringify({ add: rules }),
  });
  if (!added.ok) {
    const text = await added.text();
    throw Object.assign(new Error(`rules add ${added.status} ${text.slice(0, 160)}`), {
      status: added.status,
    });
  }
  console.log(`[ingest] stream rules ${rules.length}`);
}

const SYSTEM_PROMPT = `You extract kinetic events (airstrikes, missile strikes, explosions, shelling, drone strikes, interceptions) from a social post.
Reply with ONLY a JSON object:
{"is_kinetic":boolean,"event_type":"airstrike"|"missile"|"explosion"|"shelling"|"drone"|"other","location_name":string,"country":string,"precision":"city"|"region"|"country","confidence":number}
is_kinetic is false for politics, analysis, jokes, and posts with no specific place.
confidence is 0 to 1. precision is city only when a city or town is named.`;

async function extractKinetic(hub: Hub, text: string): Promise<Extracted | null> {
  const now = Date.now();
  hub.llmCalls = hub.llmCalls.filter((stamp) => now - stamp < 60 * 60 * 1000);
  if (hub.llmCalls.length >= LLM_HOURLY_CAP) {
    console.log("[discard] llm hourly cap");
    return null;
  }
  const key = process.env.LLM_API_KEY?.trim() || process.env.XAI_API_KEY?.trim();
  if (!key) {
    console.log("[discard] no LLM_API_KEY");
    return null;
  }
  const base = (process.env.LLM_BASE_URL?.trim() || "https://api.x.ai/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL?.trim() || "grok-4.5";
  hub.llmCalls.push(now);
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text.slice(0, 1800) },
        ],
      }),
    });
  } catch (error) {
    console.log(`[discard] llm network ${error instanceof Error ? error.message : ""}`);
    return null;
  }
  if (!res.ok) {
    console.log(`[discard] llm http ${res.status}`);
    return null;
  }
  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    console.log("[discard] llm empty");
    return null;
  }
  try {
    const fenced = content.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
    const parsed = extractedSchema.safeParse(JSON.parse(fenced ? fenced[1]! : content));
    if (!parsed.success) {
      console.log("[discard] llm schema");
      return null;
    }
    return parsed.data;
  } catch {
    console.log("[discard] llm parse");
    return null;
  }
}

type Tweet = {
  id: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  geo?: {
    coordinates?: { type?: string; coordinates?: [number, number] };
    place_id?: string;
  };
};

type Place = {
  id: string;
  full_name?: string;
  name?: string;
  country?: string;
  place_type?: string;
  geo?: { bbox?: number[] };
};

type User = { id: string; username?: string };

function placePrecision(placeType: string | undefined): Precision {
  const value = (placeType ?? "").toLowerCase();
  if (value.includes("country")) return "country";
  if (value.includes("city") || value.includes("poi") || value.includes("neighborhood")) return "city";
  return "region";
}

async function consumeTweet(
  hub: Hub,
  tweet: Tweet,
  users: Map<string, User>,
  places: Map<string, Place>,
) {
  if (!tweet.id || hub.seenPosts.has(tweet.id)) return;
  hub.seenPosts.add(tweet.id);
  if (hub.seenPosts.size > 8000) {
    const drop = [...hub.seenPosts].slice(0, 2000);
    for (const id of drop) hub.seenPosts.delete(id);
  }
  const text = tweet.text ?? "";
  if (!text || text.startsWith("RT @")) {
    console.log(`[discard] retweet ${tweet.id}`);
    return;
  }
  const extracted = await extractKinetic(hub, text);
  if (!extracted) return;
  if (!extracted.is_kinetic || extracted.confidence < 0.6) {
    console.log(
      `[discard] not kinetic ${tweet.id} flag=${extracted.is_kinetic} c=${extracted.confidence.toFixed(2)}`,
    );
    return;
  }

  const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
  const author = user?.username || tweet.author_id || "unknown";
  const postUrl = user?.username
    ? `https://x.com/${user.username}/status/${tweet.id}`
    : `https://x.com/i/web/status/${tweet.id}`;
  const seenAt = tweet.created_at && !Number.isNaN(Date.parse(tweet.created_at))
    ? tweet.created_at
    : new Date().toISOString();

  let lat: number | null = null;
  let lng: number | null = null;
  let precision = extracted.precision;
  const coords = tweet.geo?.coordinates?.coordinates;
  if (coords && coords.length === 2 && coords.every((n) => Number.isFinite(n))) {
    lng = coords[0]!;
    lat = coords[1]!;
    precision = "city";
  } else if (tweet.geo?.place_id) {
    const place = places.get(tweet.geo.place_id);
    const bbox = place?.geo?.bbox;
    if (bbox && bbox.length === 4 && bbox.every((n) => Number.isFinite(n))) {
      lng = (bbox[0]! + bbox[2]!) / 2;
      lat = (bbox[1]! + bbox[3]!) / 2;
      precision = placePrecision(place?.place_type);
    }
  }
  if (lat === null || lng === null) {
    const hit = await geocode(hub, `${extracted.location_name}, ${extracted.country}`);
    if (!hit) {
      console.log(`[discard] ungeocoded ${tweet.id} ${extracted.location_name}`);
      return;
    }
    lat = hit.lat;
    lng = hit.lng;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    console.log(`[discard] bad coords ${tweet.id}`);
    return;
  }
  acceptIncoming(hub, {
    lat,
    lng,
    event_type: extracted.event_type,
    location_name: extracted.location_name,
    country: extracted.country,
    precision,
    confidence: extracted.confidence,
    author,
    post_url: postUrl,
    seenAt,
  });
}

function indexIncludes(payload: { includes?: { users?: User[]; places?: Place[] } }) {
  const users = new Map<string, User>();
  const places = new Map<string, Place>();
  for (const user of payload.includes?.users ?? []) users.set(user.id, user);
  for (const place of payload.includes?.places ?? []) places.set(place.id, place);
  return { users, places };
}

const STREAM_FIELDS = new URLSearchParams({
  "tweet.fields": "created_at,geo,text,author_id",
  expansions: "author_id,geo.place_id",
  "user.fields": "username,name",
  "place.fields": "full_name,country,geo,name,place_type",
});

async function runStream(hub: Hub, token: string, rules: { value: string; tag: string }[]) {
  await syncRules(token, rules);
  let attempt = 0;
  while (hub.mode === "live") {
    let res: Response;
    try {
      res = await xFetch(
        token,
        `https://api.x.com/2/tweets/search/stream?${STREAM_FIELDS.toString()}`,
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    } catch (error) {
      attempt += 1;
      console.log(`[ingest] stream disconnect ${error instanceof Error ? error.message : ""}`);
      await sleep(Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)));
      continue;
    }
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      const text = await res.text();
      console.log(`[ingest] stream unavailable ${res.status} ${text.slice(0, 140)} — falling back to recent search`);
      hub.mode = "search";
      emit(hub, "mode", { mode: hub.mode });
      return;
    }
    if (!res.ok || !res.body) {
      const wait = retryDelay(res, attempt);
      attempt += 1;
      console.log(`[ingest] stream http ${res.status} retry ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    attempt = 0;
    hub.ingestNote = "filtered-stream";
    console.log("[ingest] filtered stream connected");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (!line) continue;
          try {
            const payload = JSON.parse(line) as {
              data?: Tweet;
              includes?: { users?: User[]; places?: Place[] };
            };
            if (!payload.data) continue;
            const indexed = indexIncludes(payload);
            await consumeTweet(hub, payload.data, indexed.users, indexed.places);
          } catch {
            console.log("[discard] stream line");
          }
        }
      }
    } catch (error) {
      console.log(`[ingest] stream read ${error instanceof Error ? error.message : ""}`);
    }
    attempt += 1;
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
    console.log(`[ingest] stream ended retry ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
}

async function runSearch(hub: Hub, token: string) {
  hub.mode = "search";
  hub.ingestNote = "recent-search";
  emit(hub, "mode", { mode: hub.mode });
  console.log("[ingest] recent search polling every 60s");
  let sinceId = "";
  let attempt = 0;
  for (;;) {
    const url = new URL("https://api.x.com/2/tweets/search/recent");
    url.searchParams.set("query", KEYWORDS);
    url.searchParams.set("max_results", "10");
    url.searchParams.set("tweet.fields", "created_at,geo,text,author_id");
    url.searchParams.set("expansions", "author_id,geo.place_id");
    url.searchParams.set("user.fields", "username,name");
    url.searchParams.set("place.fields", "full_name,country,geo,name,place_type");
    if (sinceId) url.searchParams.set("since_id", sinceId);
    try {
      const res = await xFetch(token, url.toString());
      if (res.status === 429) {
        const wait = retryDelay(res, attempt);
        console.log(`[ingest] search rate limit ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        attempt += 1;
        const text = await res.text();
        console.log(`[discard] search ${res.status} ${text.slice(0, 120)}`);
        await sleep(Math.min(60_000, 5000 * attempt));
        continue;
      }
      attempt = 0;
      const payload = (await res.json()) as {
        data?: Tweet[];
        includes?: { users?: User[]; places?: Place[] };
        meta?: { newest_id?: string };
      };
      const indexed = indexIncludes(payload);
      const tweets = payload.data ?? [];
      if (payload.meta?.newest_id) sinceId = payload.meta.newest_id;
      for (const tweet of tweets) {
        await consumeTweet(hub, tweet, indexed.users, indexed.places);
      }
      if (tweets.length) console.log(`[ingest] search batch ${tweets.length}`);
    } catch (error) {
      attempt += 1;
      console.log(`[discard] search ${error instanceof Error ? error.message : ""}`);
    }
    prune(hub);
    await sleep(60_000);
  }
}

async function runLive(hub: Hub, token: string) {
  const rules = ruleChunks(loadAccounts());
  try {
    await runStream(hub, token, rules);
  } catch (error) {
    const status = (error as { status?: number }).status;
    console.log(`[ingest] stream setup failed ${error instanceof Error ? error.message : ""}`);
    if (status && status !== 401 && status !== 402 && status !== 403) {
      await sleep(5000);
      void runLive(hub, token);
      return;
    }
  }
  if (hub.mode !== "live") {
    await runSearch(hub, token);
    return;
  }
  await runSearch(hub, token);
}

function ensureStarted(hub: Hub) {
  if (hub.started) return;
  hub.started = true;
  loadGeoCache(hub);
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (process.env.MOCK === "1" || !token) {
    hub.mode = "mock";
    startMock(hub);
    return;
  }
  hub.mode = "live";
  hub.ingestNote = "connecting";
  void runLive(hub, token);
}

export function getHub(): Hub {
  if (!globalRef.__meridianHub) globalRef.__meridianHub = emptyHub();
  const hub = globalRef.__meridianHub;
  ensureStarted(hub);
  return hub;
}

export function healthPayload() {
  const hub = getHub();
  return {
    status: "ok",
    mode: hub.mode,
    events: hub.events.size,
    ingest: hub.ingestNote,
  };
}

export function openEventStream(request: Request): Response {
  const hub = getHub();
  const encoder = new TextEncoder();
  let closed = false;
  let ping: ReturnType<typeof setInterval> | undefined;
  let listener: Listener | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    if (ping) clearInterval(ping);
    if (listener) hub.listeners.delete(listener);
  };
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("snapshot", { mode: hub.mode, events: listPublic(hub) });
      listener = (message) => {
        try {
          send(message.event, message.data);
        } catch {
          close();
        }
      };
      hub.listeners.add(listener);
      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          close();
        }
      }, 15000);
      request.signal.addEventListener("abort", () => {
        close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
