// Turns news items into "mentions": one headline that names a kind of strike and a known place.
// Shared by the page (app.js) and the archiver (scripts/archive.mjs), so both apply the same rules.
// Needs places.js and cities.js loaded first, and a global d3 with geoCentroid and geoArea.
var MeridianExtract = (function () {
  "use strict";

  const SKIP_CATEGORIES = new Set(["tech", "biz", "science"]);
  // "Other" (a bare "strike" or "attack") is only trusted from conflict-focused sources.
  const OTHER_CATEGORIES = new Set(["osint", "mideast", "defense"]);

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

  // What was hit, when the headline says. First match wins, so the more specific targets come first
  // ("airport fuel depot" is an airport, "power plant" is power, not industry).
  const TARGET_RULES = [
    ["hospital", /\b(hospitals?|clinics?|medical (centre|center|facility|facilities)|ambulances?)\b/i],
    ["airport", /\b(airports?|airfields?|air ?bases?|aerodromes?|runways?|hangars?)\b/i],
    ["fuel", /\b(refiner(y|ies)|oil (depots?|terminals?|facilit\w+|storage|tanks?|fields?|plants?|platforms?)|fuel (depots?|storage|tanks?|facilit\w+|stations?)|petrol(eum)? (depots?|facilit\w+)|gas (plants?|facilit\w+|fields?|stations?)|LNG|pipelines?|tank farm)\b/i],
    ["power", /\b(power (plants?|stations?|grid|lines?|facilit\w+|infrastructure|substations?)|substations?|thermal (power )?plants?|energy (infrastructure|facilit\w+|sites?)|hydroelectric|dams?|nuclear (power )?plants?|electricity)\b/i],
    ["rail", /\b(railways?|railroads?|rail (lines?|stations?|infrastructure|depots?|hub)|train stations?|trains?|locomotives?)\b/i],
    ["bridge", /\b(bridges?)\b/i],
    ["ship", /\b(ports?|harbou?rs?|docks?|shipyards?|ships?|vessels?|tankers?|freighters?|warships?|frigates?|boats?)\b/i],
    ["military", /\b(military (bases?|facilit\w+|sites?|targets?|positions?|headquarters|HQ|airfields?)|bases?|barracks|command (posts?|centers?|centres?)|headquarters|air defen[cs]e|radars?|ammunition (depots?|warehouses?|dumps?|stores?)|arms (depots?|warehouses?)|weapons (depots?|warehouses?|stores?)|arsenals?|troops)\b/i],
    ["industry", /\b(factor(y|ies)|plants?|industrial|enterprises?|warehouses?|depots?|production (facilit\w+|sites?)|workshops?)\b/i],
    ["civilian", /\b(residential|apartments?|high-rises?|blocks? of flats|homes?|houses?|buildings?|neighbou?rhoods?|villages?|markets?|schools?|universit(y|ies)|kindergartens?|shelters?|civilians?)\b/i],
  ];

  const RANK = { city: 3, region: 2, country: 1 };
  const RADIUS_KM = { city: 10, region: 100, country: 300 };

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

  // countries: GeoJSON features from world-atlas (the map's country shapes).
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
  function locate(matcher, text) {
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

  function detectTarget(text) {
    if (!text) return null;
    for (const [target, re] of TARGET_RULES) if (re.test(text)) return target;
    return null;
  }

  // About 100 m: plenty for a map pin.
  function round3(x) {
    return Math.round(x * 1000) / 1000;
  }

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

  // One feed item -> a mention, or null when it isn't a strike report with a known place.
  function toMention(matcher, raw) {
    if (SKIP_CATEGORIES.has(raw.category)) return null;
    const t = Date.parse(raw.published);
    if (!Number.isFinite(t)) return null;
    const item = normalize(raw);
    const kind = classify(item.title, item.category);
    if (!kind) return null;
    // Telegram summaries often carry ads, so only news summaries help find the place, and only when they
    // name a city or region: a country in a summary is often a ship's flag or a side note.
    let place = locate(matcher, item.title);
    if (!place && !item.social) {
      const fromSummary = locate(matcher, item.summary || "");
      if (fromSummary && fromSummary.precision !== "country") place = fromSummary;
    }
    if (!place) return null;
    // Leave out place names that start with "Port" (Port Sudan, Port Said) so they don't read as a port.
    const title = /^Port\b/.test(place.term) ? item.title.replace(place.term, "") : item.title;
    // Headline only: summaries mention too much else (a surgery story is not a hospital strike).
    const target = detectTarget(title);
    return {
      target,
      id: item.id,
      published: new Date(t).toISOString(),
      title: item.title,
      url: item.url,
      source: item.source,
      social: !!item.social,
      type: kind.type,
      place: { name: place.display, country: place.country, lat: round3(place.lat), lng: round3(place.lng), precision: place.precision },
    };
  }

  return { RANK, RADIUS_KM, buildMatcher, locate, classify, detectTarget, toMention };
})();
