// Meridian, loading the feeds and turning headlines into events. One of the page's scripts in ui/; they share one global scope and load in order
// (see index.html): core, feed, map, panels, sanctions-view, main.
"use strict";

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
// Every open tab asks Bluesky, so the page is polite about it: a few accounts at a time, and when Bluesky
// says "too many requests" (429) it waits (Retry-After, or 5 minutes) before asking again.
const LIVE_PARALLEL = 4;
const LIVE_BACKOFF_MS = 5 * 60e3;
let livePolling = false;
let liveResumeAt = 0;
async function pollLive() {
  if (!state.data || !state.data.live || livePolling || document.hidden || Date.now() < liveResumeAt) return;
  livePolling = true;
  const cutoff = Date.now() - 48 * 3600e3;
  let added = 0;
  const queue = state.data.live.slice();
  const worker = async () => {
    for (let src; (src = queue.shift()) && Date.now() >= liveResumeAt;) await pollAccount(src);
  };
  const pollAccount = async (src) => {
    try {
      const u = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?filter=posts_no_replies&limit=10&actor=" + encodeURIComponent(src.handle);
      const res = await fetch(u);
      if (res.status === 429) {
        const wait = Number(res.headers.get("Retry-After")) * 1000;
        liveResumeAt = Date.now() + (wait > 0 ? Math.min(wait, 30 * 60e3) : LIVE_BACKOFF_MS);
        return;
      }
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
  };
  try {
    await Promise.all(Array.from({ length: LIVE_PARALLEL }, worker));
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
  if (state.view === "sanctions") {
    const list = sanctionsData && sanctionsData.list_date ? ` OFAC's list as of ${formatDay(sanctionsData.list_date)}.` : sanctionsData ? "" : " OFAC's list couldn't be loaded, so only the hand-set levels show.";
    // Amber when something needs a person's look: warnings from the daily list check, or old hand-set levels.
    const checks = MeridianSanctions.needsCheck(sanctionsData);
    el.className = `status ${checks.length ? "delayed" : "live"}`;
    el.title = `US sanctions by country. Levels checked by hand on ${formatDay(SANCTIONS_CHECKED)}.${list}`
      + (checks.length ? `\n\nNeeds a look:\n• ${checks.join("\n• ")}` : "");
    el.querySelector(".label").textContent = checks.length ? `US sanctions · ${checks.length} to check` : "US sanctions";
    return;
  }
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
