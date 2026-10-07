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
    // Incidents that hit a country's land, water or resources, accident or not.
    ["wildfire", /\b(wildfires?|wild ?land fires?|forest fires?|bush ?fires?|brush ?fires?|grass ?fires?|peat fires?|fires? (rages?|raging|spreads?|spreading) (through|across))\b/i],
    ["environment", /\b(oil spills?|fuel spills?|chemical spills?|toxic (spills?|leaks?|clouds?)|(gas|ammonia|chlorine|chemical|radiation|radioactive) leaks?|pipeline (leaks?|ruptures?|bursts?|spills?|breach\w*)|oil (leaks?|slicks?)|dam (breach\w*|bursts?|collapses?|failures?)|(dam|levee) (breaks?|broke)|mine (collapses?|accidents?|disasters?|floods?|blasts?|explosions?)|(river|water|sea|lake|groundwater) (contaminat\w+|pollut\w+)|contaminat\w+ (of|in) (the )?(river|water|sea|lake))\b/i],
    // Only at a facility (see FIRE_TARGETS): a refinery fire counts, a house fire doesn't.
    ["fire", /\b(fires?|blaze|ablaze|burn(s|ing)?|flames|inferno)\b/i],
    ["other", /\b(strikes?|struck|shot down|downed|attacks? on|attacked)\b/i],
  ];

  // Fires count only at these kinds of site (targets from TARGET_RULES below).
  const FIRE_TARGETS = new Set(["fuel", "power", "industry", "military", "ship", "airport", "rail"]);

  // A weapon alone ("drone maker opens plant") isn't an event; the headline must also say something happened.
  const ACTION = /\b(attack(s|ed|ing)?|launch(es|ed|ing)? (\w+ )?(at|on|against|toward|towards)|strikes?|struck|hit(s|ting)?|shot down|downed|intercept(s|ed|ion|ions)?|explosions?|blasts?|explod\w+|detonat\w+|kill(s|ed|ing)?|injur\w+|wound\w+|damag\w+|destroy\w+|fires?|burn(s|ing|ed)?|ablaze|blazes?|engulf\w*|flames|inferno|gutted|(breaks?|broke) out|sank|sinks?|sinking|sunk|target(s|ed|ing)|land(ed|s)? (in|on|near)|impacts?|shelling|shelled|air ?strikes?|air ?raids?|bombed|bombing|bombard\w*|casualt\w+|dead|died|victims?|pounded|hammered)\b/i;

  // Headlines that use strike words for something else, or talk about what might happen.
  const NEGATIVE = /\b(on strike|strike action|strikers|workers'? strike|general strike|hunger strike|labou?r strike|walkouts?|explosive (growth|rise|increase|claims?|allegations?|report|interview|testimony)|population explosion|lawsuits?|films?|movies?|documentary|anniversary|years ago|missile tests?|tests?|tested|test[- ]?fir\w*|test[- ]?launch\w*|test flights?|acceptance firing|successfully launch\w*|first release|drills?|military exercises?|contest|parade|contracts?|arms deals?|arms sales?|sale|approved|procure\w*|budget|aid package|unveil\w*|presented|develop\w*|manufactur\w*|delivery|deliveries|supply chain|subsidiary|partnership|SpaceX|NASA|Starship|spacecraft|satellite launch|open(ed)? fire|gunfire|fire brigades?|fire season|fire risk|potential|possible|could|might|would|threat of|fears?|plot|prepar\w+|plans? to|expected|may be|risk of|projected)\b/i;

  // Stories that look back at an earlier attack (features, investigations, recaps). Their publish time is new,
  // but the event isn't: "Generals were warned their Kuwait location was vulnerable. Then an Iranian drone hit".
  const RETRO = /\b(were warned|was warned|had warned|had been|investigat\w+|probe into|inquiry|report finds|documents show|records show|declassified|look(s|ing)? back|lessons from|recall(s|ed)?|remember(s|ed|ing)?|retrospective|explainer|what we know|how (a|an|the)|why (a|an|the)|inside the|(months?|weeks?|years?) (ago|after|later|on|since)|last (year|month|spring|summer|autumn|fall|winter)|earlier this year|a year (ago|after|since))\b|[.!?]\s+Then\b/i;

  // Month names. "May" also counts only in a date ("May 3", "in May"), since "may" is a common word.
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTH_RE = /\b(January|February|March|April|June|July|August|September|Sept|October|November|December)\b|\b(in|since|last|early|late|mid|of|on) May\b|\bMay \d/g;

  // True when the headline names a month other than the one it was published in (or, in a month's first
  // three days, the month before), so it's about something that happened earlier.
  function namesOtherMonth(title, published) {
    const d = new Date(published);
    const now = d.getUTCMonth();
    const prev = d.getUTCDate() <= 3 ? (now + 11) % 12 : now;
    for (const m of title.matchAll(MONTH_RE)) {
      const word = m[1] || "May";
      const index = word === "Sept" ? 8 : MONTHS.indexOf(word);
      if (index !== now && index !== prev) return true;
    }
    return false;
  }

  // A place right after one of these words is more likely where it happened than who did it.
  const PLACE_CUES = new Set(["in", "on", "near", "at", "over", "into", "across", "off", "inside", "throughout", "around", "outside", "inside", "of", "targeting", "targeted", "targets", "hit", "hits", "struck", "strikes", "strike", "attack", "attacks", "attacked", "pounds", "pounded", "bombed", "bombs", "shelled", "shells", "toward", "towards"]);

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

  // A place followed by one of these is the speaker ("Russia says", "Moscow warns"), not where it happened.
  // Also "Russia's army says": a possessive and one word, then the verb.
  const SPEAKER = /^(['’]s\s+\w+)?\s+(says?|said|claims?|claimed|accuses?|accused|warns?|warned|denies|denied|vows?|vowed|threatens?|threatened|condemns?|condemned|blames?|blamed|responds?|responded|announces?|announced|confirms?|confirmed|reports?|reported|insists?|urges?|urged|demands?|retaliates?|launch(es|ed)?|fired)\b/i;
  // Words that can sit between a cue and the place: "over southwestern Saudi Arabia", "in the occupied West Bank".
  const BETWEEN = /\s+(the|northern|southern|eastern|western|north-?eastern|north-?western|south-?eastern|south-?western|central|occupied|coastal|far)\s*$/;

  // The most specific place wins; among equals, one after a cue word ("in", "hits"...), then the first.
  // A whole country only counts with a cue ("in Russia", "hits Russia") or as "Russia's ...", so a country
  // named as the actor ("Russia says...", "Russia-Ukraine war") doesn't pin a marker to its middle.
  function locate(matcher, text) {
    if (!text || !matcher) return null;
    let best = null;
    for (const m of text.matchAll(matcher.regex)) {
      const entry = matcher.entries.get(m[1]);
      if (!entry) continue;
      const after = text.slice(m.index + m[1].length, m.index + m[1].length + 30);
      if (SPEAKER.test(after)) continue;
      const prevChar = text[m.index - 1];
      const nextChar = after[0];
      if (entry.precision === "country" && (prevChar === "-" || nextChar === "-")) continue; // "Russia-Ukraine"
      let pre = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
      while (BETWEEN.test(pre)) pre = pre.replace(BETWEEN, " ");
      const before = pre.match(/([a-z]+)[\s,'’]*$/);
      const cued = before && PLACE_CUES.has(before[1]);
      const possessive = /^['’]s\b/.test(after);
      if (entry.precision === "country" && !cued && !possessive) continue;
      const score = RANK[entry.precision] * 10 + (cued ? 4 : 0) - m.index / 10000;
      if (!best || score > best.score) best = { ...entry, score, term: m[1] };
    }
    return best;
  }

  // target: what the headline says was hit (detectTarget), needed to decide whether a fire counts.
  function classify(title, category, target) {
    if (NEGATIVE.test(title)) return null;
    const acted = ACTION.test(title);
    for (const [type, re] of TYPE_RULES) {
      const m = title.match(re);
      if (!m) continue;
      // A wildfire or a spill is itself the incident; everything else also needs a word saying something happened.
      if (!acted && type !== "wildfire" && type !== "environment") continue;
      if (type === "fire" && !FIRE_TARGETS.has(target)) continue;
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
    if (RETRO.test(item.title) || namesOtherMonth(item.title, t)) return null;
    // Headline only: summaries mention too much else (a surgery story is not a hospital strike).
    let target = detectTarget(item.title);
    const kind = classify(item.title, item.category, target);
    if (!kind) return null;
    // Telegram summaries often carry ads, so only news summaries help find the place, and only when they
    // name a city or region: a country in a summary is often a ship's flag or a side note.
    // If the headline names a place but only as the actor ("Pakistan launches strikes"), don't go looking in
    // the summary: it would find the same actor's capital.
    let place = locate(matcher, item.title);
    if (!place && !item.social && !item.title.match(matcher.regex)) {
      const fromSummary = locate(matcher, item.summary || "");
      if (fromSummary && fromSummary.precision !== "country") place = fromSummary;
    }
    if (!place) return null;
    // Leave out place names that start with "Port" (Port Sudan, Port Said) so they don't read as a port.
    if (/^Port\b/.test(place.term)) target = detectTarget(item.title.replace(place.term, ""));
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
