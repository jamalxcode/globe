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
