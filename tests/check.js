// Checks extract.js against tests/headlines.json. Shared by tests/run.mjs (GitHub Actions, Node) and the
// browser (paste-free debugging: load the page, then call runChecks with the page's matcher).
// Returns { passed, failed: [{ why, title, expected, got }] }.
function runChecks(extract, matcher, suite) {
  const failed = [];
  let passed = 0;
  suite.cases.forEach((c, i) => {
    const m = extract.toMention(matcher, {
      id: `test-${i}`,
      title: c.title,
      summary: c.summary || "",
      category: c.category || "world",
      social: !!c.social,
      source: c.source || "Test",
      published: c.published || suite.published,
    });
    const got = m ? { type: m.type, place: m.place.name, precision: m.place.precision, target: m.target, when: m.when ? m.when.label : null } : null;
    const e = c.expect;
    let ok;
    if (e === null) ok = got === null;
    else if (!got) ok = false;
    else {
      ok = (e.type === undefined || e.type === got.type)
        && (e.place === undefined || e.place === got.place)
        && (e.precision === undefined || e.precision === got.precision)
        && (e.target === undefined || e.target === got.target)
        && (e.when === undefined || e.when === got.when);
    }
    if (ok) passed++;
    else failed.push({ why: c.why, title: c.title, expected: e, got });
  });
  return { passed, failed };
}

// Checks events.js against tests/events.json scenarios. Same result shape as runChecks.
function runEventChecks(events, suite) {
  const base = Date.parse(suite.base);
  const at = (minutes) => new Date(base + minutes * 60000).toISOString();
  const failed = [];
  let passed = 0;
  suite.cases.forEach((c, i) => {
    const mentions = c.reports.map((r, j) => ({
      id: `case${i}-${j}`, source: r.src, title: r.title, url: `https://example.test/${i}/${j}`, published: at(r.at),
      social: !!r.social, wire: r.wire || null, target: r.target || null, type: r.type, lang: "en",
      when: r.when === "overnight" ? { label: "overnight", from: at(r.at - 10 * 60), to: at(r.at) } : null,
      why: null, place: suite.places[r.place],
    }));
    // Satellite points: [place, km east of it, minutes after base] -> [lat, lng, minutes since 1970, frp].
    const points = (c.fires || []).map(([name, km, minutes]) => {
      const p = suite.places[name];
      return [p.lat, p.lng + km / (111.32 * Math.cos((p.lat * Math.PI) / 180)), Math.round(base / 60000) + minutes, 10];
    });
    const list = events.buildEvents(mentions, { fires: c.fires ? events.fireGrid(points) : null });
    const ev = list[0];
    const now = base + (c.checkAt === undefined ? 60 : c.checkAt) * 60000;
    const got = ev ? {
      events: list.length, source_count: ev.source_count, status: ev.status, combined: ev.combined, types: [...ev.types].sort(),
      event_type: ev.event_type, weak: ev.weak, offMap: events.offMap(ev, now), satellite: !!ev.satellite, target: ev.target,
      when: ev.when ? ev.when.label : null,
    } : { events: 0 };
    const ok = Object.entries(c.expect).every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(Array.isArray(v) ? [...v].sort() : v));
    if (ok) passed++;
    else failed.push({ why: c.why, title: c.reports.map((r) => r.title).join(" | "), expected: c.expect, got });
  });
  return { passed, failed };
}

if (typeof module !== "undefined") module.exports = { runChecks, runEventChecks };

// Checks sanctions.js: names exist on the map, and the self-correcting levels behave. mapNames: the map's
// country names. Same result shape as runChecks.
function runSanctionChecks(S, countries, regionInfo, regions, mapNames) {
  const failed = [];
  let passed = 0;
  const check = (ok, why, got) => { if (ok) passed++; else failed.push({ why, title: "sanctions", expected: true, got }); };
  for (const c of countries) check(mapNames.has(c.country), `sanctions.js names a country that isn't on the map: ${c.country}`, c.country);
  const shapes = new Set(regions.features.map((f) => f.properties.name));
  for (const name of Object.keys(regionInfo)) check(shapes.has(name), `no shape in regions.js for ${name}`, name);
  for (const name of shapes) check(!!regionInfo[name], `regions.js shape without sanctions info: ${name}`, name);
  const data = { tags: ["IRAN", "RUSSIA-EO14024", "UKRAINE-EO13685"], countries: { Iran: { entities: 10 }, Cuba: { entities: 3 }, "United Arab Emirates": { entities: 700 } } };
  check(S.levelOf("Iran", data).level === 1, "Iran stays level 1 while its program is on the list", S.levelOf("Iran", data));
  const cuba = S.levelOf("Cuba", data);
  check(cuba.level === 4 && cuba.lowered === 1, "Cuba drops to 4 when no Cuba code is on the list", cuba);
  check(S.levelOf("Cuba", null).level === 1, "without the list, the hand-set level stands", S.levelOf("Cuba", null));
  check(S.levelOf("United Arab Emirates", data).level === 4, "listed companies but no program: level 4", S.levelOf("United Arab Emirates", data));
  check(S.levelOf("Norway", data).level === 5, "nobody listed, no program: level 5", S.levelOf("Norway", data));
  check(S.levelOf("Norway", null).level === null, "without the list, a country without a program is unknown", S.levelOf("Norway", null));
  check(S.levelOf("China", { tags: [], countries: {} }).level === 3, "a program without codes is never lowered", S.levelOf("China", { tags: [], countries: {} }));
  check(S.levelOf("Puerto Rico", data).home === true, "US territories set the sanctions", S.levelOf("Puerto Rico", data));
  check(S.regionLevel("Crimea", data).level === 1, "Crimea is level 1 while its code is on the list", S.regionLevel("Crimea", data));
  check(S.regionLevel("Donetsk region", data) === null, "a region whose program ended takes its country's color", S.regionLevel("Donetsk region", data));
  check(S.familyOf("RUSSIA-EO14024") === "Russia / Ukraine" && S.familyOf("SDGT") === "Terrorism", "program codes get plain names", S.familyOf("SDGT"));
  for (const c of [...countries, ...Object.values(regionInfo)]) {
    check(!!S.REASON[c.reason] && (!c.reason2 || !!S.REASON[c.reason2]), `unknown reason for ${c.country || c.program}`, c.reason);
  }
  const fam = { tags: [], countries: { Mexico: { entities: 50, families: { "Drug trafficking": 40, "Terrorism": 5 } }, Iceland: { entities: 1, families: { "Terrorism": 1 } } } };
  const mx = S.reasonOf("Mexico", fam, S.levelOf("Mexico", fam));
  check(mx && mx.reason === "crime" && mx.auto, "a country without a program gets the reason most of its listed are under", mx);
  check(S.reasonOf("Iceland", fam, S.levelOf("Iceland", fam)) === null, "too few listed: no reason", S.reasonOf("Iceland", fam, S.levelOf("Iceland", fam)));
  const ru = S.reasonOf("Russia", null, S.levelOf("Russia", null));
  check(ru && ru.reason === "war" && !ru.auto, "a program country has its hand-set reason", ru);
  check(S.reasonOf("Puerto Rico", fam, S.levelOf("Puerto Rico", fam)) === null, "the US has no reason", null);
  return { passed, failed };
}
