// Checks scripts/sanctions-lib.mjs, which builds sanctions-data.json, against tests/fixtures/: tiny copies of OFAC's
// files in their real formats (quoted CSV with commas and quotes inside, the dated XML, the programs page with
// Libya's page removed and an unknown "atlantis" page added). Run by tests/run.mjs. Same result shape as runChecks.
import { readFileSync } from "node:fs";
import path from "node:path";
import { FORMAT } from "../scripts/sanctions-lib.mjs";

const DAY = 864e5;

export function runDataChecks(lib, root) {
  const failed = [];
  let passed = 0;
  const check = (ok, why, got) => { if (ok) passed++; else failed.push({ why, title: "sanctions data", expected: true, got }); };
  const fixture = (f) => readFileSync(path.join(root, "tests/fixtures", f), "latin1");
  const now = Date.parse("2026-10-12T00:00:00Z");

  // Reading OFAC's files.
  const rows = lib.parseCsv(fixture("sdn.csv"));
  check(rows.length === 5 && rows[3][1] === 'NORTH, SOUTH "TRADING" LLC', "CSV: commas and doubled quotes inside a field", rows[3] && rows[3][1]);
  const dates = lib.parseDates(fixture("enhanced.xml"));
  check(dates.size === 4 && dates.get("36") === "1986-07-25" && dates.get("9001") === "2026-09-30", "dated list: the listing date, not later dates", Object.fromEntries(dates));
  const pages = lib.parsePages(fixture("programs.html"));
  check(pages && pages.has("cuba-sanctions") && !pages.has("libya-sanctions") && pages.has("atlantis-related-sanctions"), "program page: the program links only", pages && pages.size);
  check(lib.parsePages("<html>redesigned</html>") === null, "a redesigned program page reads as unknown, not as every program gone", null);

  // Counting per country.
  const { data, unknown } = lib.build(fixture("sdn.csv"), fixture("add.csv"), dates, null, now);
  const c = data.countries;
  check(c.Cuba.entities === 1 && c.Switzerland.entities === 1 && c["North Korea"].entities === 1, "counted by address, with OFAC's names mapped to the map's", Object.keys(c));
  check(c.Panama.entities === 2 && c.Panama.ships === 1, "a ship counts under its flag", c.Panama);
  check(c.Panama.recent === 1 && c.Panama.month === 1 && c.Panama.recentReasons.evasion === 1 && c.Panama.recentReasons.terror === 1, "recent counts and reasons from the listing date", c.Panama);
  check(c.Ukraine.recent === 1 && !c.Ukraine.recentReasons.evasion, "Russia-related listings in Ukraine aren't evasion", c.Ukraine);
  check(unknown.has("Atlantis") && !unknown.has("Region: Kafia Kingi"), "unknown countries are reported; regions with no country are skipped", [...unknown.keys()]);
  check(lib.mapName("St Kitts & Nevis") === "St. Kitts and Nevis" && lib.mapName("PANAMA") === "Panama" && lib.mapName("Republic of Palau") === "Palau" && lib.mapName("Democratic People's Republic of Korea") === "North Korea", "hand-typed flag names still match", lib.mapName("St Kitts & Nevis"));
  check(data.tags.includes("SDGT") && data.tags.includes("IRAN"), "every program code is collected", data.tags);

  // Ended programs: Libya's page is gone and its codes aren't in the sample.
  const first = lib.endedPrograms(data, pages, null, now);
  check(first.pending.Libya && !first.ended.includes("Libya"), "a program that looks ended waits", first.pending);
  const later = lib.endedPrograms(data, pages, { pending: { Libya: new Date(now - 8 * DAY).toISOString() } }, now);
  check(later.ended.includes("Libya"), "after 7 days it's ended", later.ended);
  check(!later.ended.includes("Cuba") && !later.ended.includes("Iran"), "codes missing but page still there: not ended", later.ended);
  const blind = lib.endedPrograms(data, null, { ended: ["Mali"], pending: { Libya: "2026-10-01T00:00:00Z" } }, now);
  check(blind.ended.join() === "Mali" && blind.pending.Libya, "without the program page, the last decision stands", blind);

  // Automatic reasons, with a margin so they don't flicker.
  const synthetic = {
    tags: [], ended: [],
    countries: {
      "United Arab Emirates": { entities: 50, recent: 40, recentReasons: { evasion: 30, terror: 5 } },
      Turkey: { entities: 50, recent: 40, recentReasons: { evasion: 22, terror: 10 } },
      Ukraine: { entities: 200, recent: 100, recentReasons: { evasion: 90 } },
      Russia: { entities: 5000, recent: 3000, recentReasons: { evasion: 10 } },
      Kazakhstan: { entities: 80, recent: 70, year: 70, month: 60, recentReasons: { evasion: 70 } },
      Mexico: { entities: 1200, recent: 600, year: 900, month: 60, recentReasons: { crime: 600 } },
    },
  };
  const fresh = lib.autoReasons(synthetic, null);
  check(fresh["United Arab Emirates"] && fresh["United Arab Emirates"].reason === "evasion", "clear majority: reason shown", fresh);
  check(!fresh.Turkey, "55%: not shown when new", fresh.Turkey);
  check(lib.autoReasons(synthetic, { auto_reasons: { Turkey: { reason: "evasion" } } }).Turkey, "55%: kept when already shown", null);
  check(!fresh.Ukraine && !fresh.Russia, "no automatic reason for Ukraine or a program country", fresh);
  const surge = lib.surges(synthetic);
  check(surge.some((s) => s.startsWith("Kazakhstan")) && !surge.some((s) => s.startsWith("Mexico")), "a burst of listings is flagged; a usual month isn't", surge);

  // Changes since the last check.
  const prev = { format: FORMAT, generated_at: "2026-10-11T00:00:00Z", entries: 10, ended: [], countries: { Chad: { entities: 10 } }, auto_reasons: { "United Arab Emirates": { reason: "evasion" } } };
  const changed = lib.changes({ entries: 20, ended: ["Libya"], countries: { Chad: { entities: 20 } }, auto_reasons: {} }, prev);
  const items = changed ? changed.items : [];
  check(items.includes("Chad: +10 listed") && items.includes("In all: +10 entries on the list") && items.includes("Libya: program ended, level lowered") && items.includes("United Arab Emirates: no longer one main reason"), "changes since the last check", items);
  check(lib.changes({ entries: 1, countries: {} }, { ...prev, format: FORMAT - 1 }) === null, "no changes against an older file format", null);

  // Warnings only after a source has failed for days.
  const shortFail = lib.failing({ failing: { pages: new Date(now - DAY).toISOString() } }, { pages: false, dated: true }, now);
  const longFail = lib.failing({ failing: { pages: new Date(now - 4 * DAY).toISOString() } }, { pages: false, dated: true }, now);
  const warn = (fails) => lib.warnings({ tagCount: new Map(), unknown: new Map(), pages: null, programNotes: [], fails, surgeNotes: [] }, now);
  check(!warn(shortFail).length && warn(longFail).some((w) => /couldn't be read for 4 days/.test(w)), "a failing source warns only after 3 days", warn(longFail));
  check(lib.failing({ failing: { pages: "2026-01-01T00:00:00Z" } }, { pages: true, dated: true }, now).pages === null, "a source that works again is cleared", null);

  // All together.
  const all = lib.assemble({ sdn: fixture("sdn.csv"), add: fixture("add.csv"), xml: fixture("enhanced.xml"), page: fixture("programs.html"), listDate: null, prev: null, now, minDated: 1 });
  check(all.data.format === FORMAT && all.data.pending.Libya && Array.isArray(all.data.ended), "the whole file", Object.keys(all.data));
  check(all.data.warnings.some((w) => /atlantis-related-sanctions/.test(w)) && all.data.warnings.some((w) => /"Atlantis"/.test(w)), "new pages and unknown countries are warned about", all.data.warnings);
  return { passed, failed };
}
