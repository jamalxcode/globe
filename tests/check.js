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
    const got = m ? { type: m.type, place: m.place.name, precision: m.place.precision, target: m.target } : null;
    const e = c.expect;
    let ok;
    if (e === null) ok = got === null;
    else if (!got) ok = false;
    else {
      ok = (e.type === undefined || e.type === got.type)
        && (e.place === undefined || e.place === got.place)
        && (e.precision === undefined || e.precision === got.precision)
        && (e.target === undefined || e.target === got.target);
    }
    if (ok) passed++;
    else failed.push({ why: c.why, title: c.title, expected: e, got });
  });
  return { passed, failed };
}

if (typeof module !== "undefined") module.exports = { runChecks };
