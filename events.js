// Turns mentions (from extract.js) into map events: merging, combined attacks, independent sources, weak
// reports, satellite heat and estimated event time. No page code here, so tests/run.mjs checks it directly
// (tests/events.json). Needs extract.js loaded first.
var MeridianEvents = (function () {
  "use strict";

  const { RANK, RADIUS_KM } = MeridianExtract;

  const MERGE_KM = 50;              // reports this close...
  const MERGE_MS = 3 * 3600e3;      // ...and this close in time can be one event
  const COMBINED_KM = 15;           // different weapons this close (same city) are one combined attack
  const MAX_EVENTS = 500;
  const WEAK_HOURS = 6;             // weak reports leave the map if nothing confirms them in this time
  const SAT_KM = 10;                // satellite heat this close to a city event...
  const SAT_BEFORE_H = 12;          // ...from this long before the first report (or estimated event time)...
  const SAT_AFTER_H = 24;           // ...to this long after the last
  const SAT_TYPES = new Set(["airstrike", "missile", "explosion", "shelling", "drone", "fire", "wildfire", "other"]);

  // How specific a type is: a merged event takes the most specific one ("refinery fire" + "drone strike" =
  // drone). Weapons (rank 3) of different kinds only merge as a combined attack in the same city.
  const TYPE_RANK = { other: 0, fire: 1, explosion: 2, airstrike: 3, missile: 3, shelling: 3, drone: 3, wildfire: 3, environment: 3 };
  const WEAPONS = new Set(["airstrike", "missile", "shelling", "drone"]);

  // Outlets with the same owner count as one source. Names as the feeds (or Google News) spell them.
  const OWNER_GROUPS = {
    "Russian state media": ["RT", "RT Arabic", "Sputnik", "TASS", "RIA Novosti"],
    "Turkish state media": ["Anadolu", "Anadolu Agency", "TRT World"],
    "Ukrainian state media": ["Ukrinform"],
    "Chinese state media": ["CGTN", "Xinhua", "Global Times", "China Daily"],
    "Iranian state media": ["Press TV", "IRNA", "Tasnim", "Fars"],
    "Al Jazeera": ["Al Jazeera", "Al Jazeera English", "Al Jazeera Arabic"],
    BBC: ["BBC", "BBC News", "BBC Middle East", "BBC Arabic", "BBC Russian", "BBC Ukrainian"],
    DW: ["DW", "DW News"],
    AP: ["AP", "AP News", "Associated Press", "The Associated Press"],
    Meduza: ["Meduza", "Meduza (Russian)"],
    "Ukrainska Pravda": ["Ukrainska Pravda", "Ukrainska Pravda (Ukrainian)"],
    "Sky News Arabia": ["Sky News Arabia"],
  };
  const OWNER_OF = new Map(Object.entries(OWNER_GROUPS).flatMap(([group, names]) => names.map((n) => [n.toLowerCase(), group])));

  function ownerOf(source) {
    return OWNER_OF.get(source.toLowerCase()) || source;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const toRad = Math.PI / 180;
    const s1 = Math.sin(((lat2 - lat1) * toRad) / 2);
    const s2 = Math.sin(((lng2 - lng1) * toRad) / 2);
    const a = s1 * s1 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * s2 * s2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  const SIMILAR_SKIP = new Set("the and for from with after over says said into amid near this that their its are was were has have had new".split(" "));

  function keywords(title) {
    return new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !SIMILAR_SKIP.has(w)));
  }

  // Near-identical headlines (a reprint, maybe lightly edited): at least 4 shared words, and 70% of all the
  // words in both are shared. Two newsrooms describing the same facts in their own words stay separate.
  function nearIdentical(a, b) {
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    return shared >= 4 && shared / (a.size + b.size - shared) >= 0.7;
  }

  // Splits an event's reports into independent sources. Reports join one source when they credit the same wire
  // agency (or are it), come from outlets with the same owner, or have near-identical headlines (reprints).
  // Returns [{ name, reasons: Set, reports }].
  function independentGroups(reports) {
    const parent = reports.map((_, i) => i);
    const reasons = reports.map(() => new Set());
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const join = (a, b, reason) => {
      a = find(a);
      b = find(b);
      if (a !== b) { parent[b] = a; for (const r of reasons[b]) reasons[a].add(r); }
      if (reason) reasons[a].add(reason);
    };
    const firstByKey = new Map();
    reports.forEach((r, i) => {
      const key = r.wire || ownerOf(r.source);
      if (!firstByKey.has(key)) { firstByKey.set(key, i); return; }
      const other = reports[firstByKey.get(key)];
      if (other.source === r.source && !r.wire) join(firstByKey.get(key), i, null); // same outlet twice
      else if (r.wire || key === r.source) join(firstByKey.get(key), i, `same ${key} story`); // credits the wire, or is it
      else join(firstByKey.get(key), i, `same owner: ${key}`);
    });
    const words = reports.map((r) => keywords(r.title));
    for (let i = 0; i < reports.length; i++) {
      for (let j = i + 1; j < reports.length; j++) {
        if (find(i) !== find(j) && nearIdentical(words[i], words[j])) join(i, j, "near-identical headlines");
      }
    }
    const groups = new Map();
    reports.forEach((r, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, { name: r.wire || ownerOf(r.source), reasons: reasons[root], reports: [] });
      groups.get(root).reports.push(r);
    });
    return [...groups.values()];
  }

  // Satellite points [[lat, lng, minutes, frp]] on a 1-degree grid, for satelliteHeat.
  function fireGrid(points) {
    const grid = new Map();
    for (const p of points || []) {
      const key = `${Math.floor(p[0])},${Math.floor(p[1])}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(p);
    }
    return grid;
  }

  // The nearest detection within SAT_KM of a city event, in its time window: { km, time, frp } or null.
  function satelliteHeat(ev, grid) {
    if (!grid || ev.precision !== "city" || ![...ev.types].some((t) => SAT_TYPES.has(t))) return null;
    const start = Math.min(Date.parse(ev.first_seen), ev.when ? Date.parse(ev.when.from) : Infinity);
    const from = (start - SAT_BEFORE_H * 3600e3) / 60000;
    const to = (ev.lastT + SAT_AFTER_H * 3600e3) / 60000;
    let best = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const [lat, lng, minutes, frp] of grid.get(`${Math.floor(ev.lat) + dy},${Math.floor(ev.lng) + dx}`) || []) {
          if (minutes < from || minutes > to) continue;
          const d = haversineKm(ev.lat, ev.lng, lat, lng);
          if (d <= SAT_KM && (!best || d < best.km)) best = { km: d, time: new Date(minutes * 60000).toISOString(), frp };
        }
      }
    }
    return best;
  }

  // Can a mention (type, place precision, km from the event) join it? Same kind always; an explosion, fire or
  // "other" report can be part of any attack; different weapons only as a combined attack in the same city
  // (both pinned to a city, within COMBINED_KM), never across a whole region or country.
  function canJoin(ev, type, precision, km) {
    if (ev.types.has(type)) return true;
    if (TYPE_RANK[type] < 3) return true;
    if ([...ev.types].every((t) => TYPE_RANK[t] < 3)) return true;
    return WEAPONS.has(type) && [...ev.types].some((t) => WEAPONS.has(t))
      && precision === "city" && ev.precision === "city" && km <= COMBINED_KM;
  }

  // mentions: from MeridianExtract.toMention, any order. options.fires: fireGrid(...) or null.
  function buildEvents(mentions, options = {}) {
    const grid = options.fires || null;
    const sorted = [...mentions].sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
    const events = [];
    let open = []; // events still within MERGE_MS of the current mention
    for (const m of sorted) {
      const t = Date.parse(m.published);
      open = open.filter((ev) => t - ev.lastT <= MERGE_MS);
      let best = null;
      let bestDist = Infinity;
      for (const ev of open) {
        const d = haversineKm(ev.lat, ev.lng, m.place.lat, m.place.lng);
        if (d <= MERGE_KM && d < bestDist && canJoin(ev, m.type, m.place.precision, d)) { best = ev; bestDist = d; }
      }
      const report = {
        source: m.source, title: m.title, url: m.url, published: m.published, social: m.social, id: m.id,
        target: m.target, type: m.type, wire: m.wire, why: m.why, when: m.when || null, lang: m.lang || "en",
        placeName: m.place.name, precision: m.place.precision,
      };
      if (best) {
        if (!best.urls.has(report.url)) { best.urls.add(report.url); best.reports.push(report); }
        best.sources.add(report.source);
        best.types.add(m.type);
        best.lastT = t;
        best.last_updated = m.published;
        if (RANK[m.place.precision] > RANK[best.precision]) {
          Object.assign(best, { lat: m.place.lat, lng: m.place.lng, location_name: m.place.name, country: m.place.country, precision: m.place.precision, radius_km: RADIUS_KM[m.place.precision] });
        }
        continue;
      }
      const ev = {
        id: "e_" + m.id,
        lat: m.place.lat,
        lng: m.place.lng,
        types: new Set([m.type]),
        location_name: m.place.name,
        country: m.place.country,
        precision: m.place.precision,
        radius_km: RADIUS_KM[m.place.precision],
        first_seen: m.published,
        last_updated: m.published,
        lastT: t,
        reports: [report],
        urls: new Set([report.url]),
        sources: new Set([report.source]),
      };
      events.push(ev);
      open.push(ev);
    }
    for (const ev of events) finish(ev, grid);
    events.sort((a, b) => b.lastT - a.lastT);
    return events.slice(0, MAX_EVENTS);
  }

  function finish(ev, grid) {
    ev.reports.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    // Main type: the most specific; among equals, the one most headlines name.
    const count = (type) => ev.reports.filter((r) => r.type === type).length;
    ev.event_type = [...ev.types].sort((a, b) => TYPE_RANK[b] - TYPE_RANK[a] || count(b) - count(a))[0];
    ev.weapons = [...ev.types].filter((t) => WEAPONS.has(t)).sort((a, b) => count(b) - count(a));
    ev.combined = ev.weapons.length >= 2;
    ev.groups = independentGroups(ev.reports);
    ev.source_count = ev.groups.length; // independent sources
    ev.outlet_count = ev.sources.size;  // outlet names, before counting reprints and owners once
    ev.status = ev.source_count >= 2 ? "corroborated" : "unverified";
    // Estimated event time: the earliest a headline implies ("overnight", "yesterday", "on Monday").
    ev.when = ev.reports.filter((r) => r.when).sort((a, b) => Date.parse(a.when.from) - Date.parse(b.when.from)).map((r) => r.when)[0] || null;
    ev.satellite = satelliteHeat(ev, grid);
    // Weak: one source that is only social posts (not crediting a wire agency) or that only names a whole
    // country, and no satellite heat nearby.
    ev.weak = !ev.satellite && ev.source_count === 1 && (ev.reports.every((r) => r.social && !r.wire) || ev.precision === "country");
    // The target most headlines name; on a tie, the one the newest headline names.
    const votes = new Map();
    for (const r of ev.reports) if (r.target) votes.set(r.target, (votes.get(r.target) || 0) + 1);
    ev.target = null;
    for (const [target, n] of votes) if (!ev.target || n > votes.get(ev.target)) ev.target = target;
  }

  // A weak event nothing else confirmed within WEAK_HOURS of its first report: kept in the list, off the map.
  function offMap(ev, now) {
    return ev.weak && now - Date.parse(ev.first_seen) > WEAK_HOURS * 3600e3;
  }

  return {
    MERGE_KM, MERGE_MS, COMBINED_KM, WEAK_HOURS, SAT_KM, TYPE_RANK, WEAPONS, OWNER_GROUPS,
    ownerOf, haversineKm, independentGroups, fireGrid, satelliteHeat, buildEvents, offMap,
  };
})();
