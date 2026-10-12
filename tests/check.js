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
// Checks sanctions.js: names exist on the map, and the self-correcting levels and reasons behave. mapNames: the
// map's country names. Same result shape as runChecks.
function runSanctionChecks(S, countries, regionInfo, regions, mapNames) {
  const failed = [];
  let passed = 0;
  const check = (ok, why, got) => { if (ok) passed++; else failed.push({ why, title: "sanctions", expected: true, got }); };
  for (const c of countries) check(mapNames.has(c.country), `sanctions.js names a country that isn't on the map: ${c.country}`, c.country);
  const shapes = new Set(regions.features.map((f) => f.properties.name));
  for (const name of Object.keys(regionInfo)) check(shapes.has(name), `no shape in regions.js for ${name}`, name);
  for (const name of shapes) check(!!regionInfo[name], `regions.js shape without sanctions info: ${name}`, name);
  for (const c of [...countries, ...Object.values(regionInfo)]) {
    const label = c.country || c.program;
    if (c.level <= 3) check(!!S.REASON[c.reason] && (!c.reason2 || !!S.REASON[c.reason2]), `unknown reason for ${label}`, c.reason);
    if (c.level <= 3) check(Array.isArray(c.pages) && c.pages.length > 0, `no OFAC page for ${label}`, c.pages);
  }

  // Levels: lowered only when the list check says the program ended.
  const data = { tags: ["IRAN"], ended: ["Cuba", "Donetsk region"], countries: { Iran: { entities: 10 }, "United Arab Emirates": { entities: 700 } } };
  check(S.levelOf("Iran", data).level === 1, "Iran stays level 1", S.levelOf("Iran", data));
  const cuba = S.levelOf("Cuba", data);
  check(cuba.level === 4 && cuba.lowered === 1, "Cuba drops to 4 once its program is marked ended", cuba);
  check(S.levelOf("North Korea", data).level === 1, "codes missing but not marked ended (under 7 days): no change", S.levelOf("North Korea", data));
  check(S.levelOf("Cuba", null).level === 1, "without the list, the hand-set level stands", S.levelOf("Cuba", null));
  check(S.levelOf("United Arab Emirates", data).level === 4 && S.levelOf("Norway", data).level === 4 && S.levelOf("Norway", null).level === 4, "no program: level 4, list or not", S.levelOf("Norway", null));
  check(S.levelOf("Puerto Rico", data).home === true, "US territories set the sanctions", S.levelOf("Puerto Rico", data));
  check(S.regionLevel("Crimea", data).level === 1, "Crimea stays level 1", S.regionLevel("Crimea", data));
  check(S.regionLevel("Donetsk region", data) === null, "a region whose program ended takes its country's color", S.regionLevel("Donetsk region", data));

  // Reasons: hand-set for program countries; otherwise only when recent listings clearly agree.
  check(S.familyOf("RUSSIA-EO14024") === "Russia / Ukraine" && S.familyOf("SDGT") === "Terrorism", "program codes get plain names", S.familyOf("SDGT"));
  check(S.reasonsOfTags(["IRAN"]).join() === "evasion" && S.reasonsOfTags(["SDGT", "SDNTK"]).sort().join() === "crime,terror", "codes map to reasons", S.reasonsOfTags(["SDGT", "SDNTK"]));
  const ru = S.reasonOf("Russia", null, S.levelOf("Russia", null));
  check(ru && ru.reason === "war" && !ru.auto, "a program country has its hand-set reason", ru);
  const fam = { tags: [], countries: {
    Mexico: { entities: 900, recent: 300, recentReasons: { crime: 250, terror: 10 } },
    Turkey: { entities: 400, recent: 100, recentReasons: { evasion: 50, terror: 45 } },
    Iceland: { entities: 30, recent: 5, recentReasons: { terror: 5 } },
    Norway: { entities: 40 },
  } };
  const at = (n) => S.reasonOf(n, fam, S.levelOf(n, fam));
  check(at("Mexico") && at("Mexico").reason === "crime" && at("Mexico").auto, "recent listings mostly for one reason: that reason, marked automatic", at("Mexico"));
  check(at("Turkey") === null, "no reason over 60%: none shown", at("Turkey"));
  check(at("Iceland") === null, "too few recent listings: none shown", at("Iceland"));
  check(at("Norway") === null, "no dates: none shown", at("Norway"));
  check(at("Puerto Rico") === null, "the US has no reason", at("Puerto Rico"));
  check(S.reasonOf("Cuba", data, S.levelOf("Cuba", data)) === null, "a lowered country loses its hand-set reason", S.reasonOf("Cuba", data, S.levelOf("Cuba", data)));
  check(S.reasonsOfTags(["RUSSIA-EO14024"], "Ukraine").length === 0 && S.reasonsOfTags(["RUSSIA-EO14024"], "Turkey").join() === "evasion", "a program doesn't count against the place it's about", S.reasonsOfTags(["RUSSIA-EO14024"], "Ukraine"));
  const occupied = { countries: { Ukraine: { entities: 300, recent: 100, recentReasons: { evasion: 90 } }, Palestine: { entities: 60, recent: 50, recentReasons: { terror: 48 } } } };
  check(S.reasonOf("Ukraine", occupied, S.levelOf("Ukraine", occupied)) === null && S.reasonOf("Palestine", occupied, S.levelOf("Palestine", occupied)) === null, "occupied and contested places get no automatic reason", null);
  const published = { auto_reasons: { Chad: { reason: "conflict", share: 0.7, recent: 30 } }, countries: { Mexico: fam.countries.Mexico } };
  check(S.reasonOf("Chad", published, S.levelOf("Chad", published)).reason === "conflict" && S.reasonOf("Mexico", published, S.levelOf("Mexico", published)) === null, "the published automatic reasons win (they carry the margin)", null);
  check(S.autoReason("Turkey", { recent: 40, recentReasons: { evasion: 22 } }, { reason: "evasion" }) && !S.autoReason("Turkey", { recent: 40, recentReasons: { evasion: 22 } }, null), "a shown reason is kept down to 50%", null);

  // What needs a person's look.
  const fresh = { generated_at: new Date().toISOString(), warnings: [] };
  check(S.needsCheck(fresh, Date.parse(SANCTIONS_CHECKED) + 864e5).length === 0, "nothing to check when fresh", S.needsCheck(fresh, Date.parse(SANCTIONS_CHECKED) + 864e5));
  check(S.needsCheck(fresh, Date.parse(SANCTIONS_CHECKED) + 100 * 864e5).some((w) => /checked by hand/.test(w)), "hand-set levels go stale after 90 days", S.needsCheck(fresh, Date.parse(SANCTIONS_CHECKED) + 100 * 864e5));
  check(S.needsCheck({ ...fresh, warnings: ["x"] }).includes("x"), "list warnings show", null);
  check(S.needsCheck({ generated_at: "2020-01-01T00:00:00Z" }).some((w) => /last read/.test(w)), "an old list shows", null);
  return { passed, failed };
}
