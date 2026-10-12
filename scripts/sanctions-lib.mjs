// The logic behind sanctions-data.json, without any downloading, so tests/run.mjs can check it against the small
// sample files in tests/fixtures/. scripts/sanctions.mjs does the downloading and calls these.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

export const FORMAT = 3; // raise when the file's contents change, so an older published copy isn't reused
// A source that can't be read (the dated list, OFAC's program page) is only a warning once it has failed this
// many days in a row: a day's hiccup shouldn't turn the status pill amber.
const FAILING_DAYS = 3;

// OFAC's country names that differ from the map's.
const ALIASES = {
  "Korea, North": "North Korea", "Korea, South": "South Korea", "Burma": "Myanmar",
  "Congo, Democratic Republic of the": "Dem. Rep. Congo", "Congo, Republic of the": "Congo",
  "Bosnia and Herzegovina": "Bosnia and Herz.", "Central African Republic": "Central African Rep.",
  "North Macedonia, The Republic of": "Macedonia", "Czech Republic": "Czechia", "Cote d Ivoire": "Côte d'Ivoire",
  "Virgin Islands, British": "British Virgin Is.", "Marshall Islands": "Marshall Is.", "Cayman Islands": "Cayman Is.",
  "The Gambia": "Gambia", "Gambia, The": "Gambia", "Bahamas, The": "Bahamas", "Man, Isle of": "Isle of Man",
  "Saint Kitts and Nevis": "St. Kitts and Nevis", "Saint Vincent and the Grenadines": "St. Vin. and Gren.",
  "Antigua and Barbuda": "Antigua and Barb.", "Dominican Republic": "Dominican Rep.", "Equatorial Guinea": "Eq. Guinea",
  "Macau": "Macao", "Curacao": "Curaçao", "South Sudan": "S. Sudan", "United States": "United States of America",
  "Solomon Islands": "Solomon Is.", "Turks and Caicos Islands": "Turks and Caicos Is.", "Eswatini": "eSwatini",
  "Swaziland": "eSwatini", "Cape Verde": "Cabo Verde", "Sao Tome and Principe": "São Tomé and Principe",
  "Cook Islands": "Cook Is.", "Saint Lucia": "Saint Lucia", "Tanzania, United Republic of": "Tanzania",
  "Palestinian": "Palestine", "West Bank": "Palestine", "Gaza": "Palestine",
  "Region: Gaza": "Palestine", "Region: West Bank": "Palestine", "Region: Northern Gaza": "Palestine", "Region: North Gaza": "Palestine",
  "Region: Russia": "Russia", "Region: Iran": "Iran", "Region: Northern Mali": "Mali", "Region: Crimea": "Crimea",
};
// Addresses and flags that name no single country on the map (or one too small for it). A flag marked "False" is
// one a ship flies without being registered there, so it says nothing about that country.
const NO_COUNTRY = /^(-0-|Unknown|None Identified|Gibraltar|Tuvalu|Region: (Kafia Kingi|Jammu and Kashmir|Kashmir|Commonwealth of Independent States))$|\bfalse\b/i;
// Ship flags are typed by hand and vary ("St Kitts & Nevis", "PANAMA", "Republic of Palau"): compared loosely.
const loose = (s) => s.toLowerCase().replace(/&/g, "and").replace(/^st\.? /, "saint ").replace(/^(the )?republic of (the )?/, "").replace(/\s+/g, " ").trim();
const LOOSE_ALIASES = {
  "democratic people's republic of korea": "North Korea", "saint vincent and grenadines": "St. Vin. and Gren.",
  "british virgin islands": "British Virgin Is.",
};
// Program pages on OFAC's site that aren't a country program in sanctions.js.
const OTHER_PAGES = new Set([
  "counter-narcotics-trafficking-sanctions", "counter-terrorism-sanctions",
  "countering-americas-adversaries-through-sanctions-act-related-sanctions",
  "sanctions-related-to-significant-malicious-cyber-enabled-activities",
  "foreign-interference-in-a-united-states-election-sanctions", "global-magnitsky-sanctions",
  "hostages-and-wrongfully-detained-us-nationals-sanctions", "international-criminal-court-related-sanctions",
  "the-magnitsky-sanctions", "non-proliferation-sanctions", "rough-diamond-trade-controls",
  "transnational-criminal-organizations", "balkans-related-sanctions",
]);

const DAY = 864e5;

// sanctions.js (its rules and hand-set levels) and the map's country names, loaded like the page loads them.
export function loadSite(root) {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(path.join(root, "sanctions.js"), "utf8"), context, { filename: "sanctions.js" });
  const S = vm.runInContext("({ countries: SANCTION_COUNTRIES, regions: SANCTION_REGION_INFO, M: MeridianSanctions, RECENT_YEARS, LOWER_AFTER_DAYS, SURGE_MIN, SURGE_FACTOR })", context);
  const topo = JSON.parse(readFileSync(path.join(root, "vendor/countries-50m.json"), "utf8"));
  return { S, mapNames: new Set(topo.objects.countries.geometries.map((g) => g.properties.name)) };
}

export const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createLib({ S, mapNames }) {
  const byLoose = new Map();
  for (const n of mapNames) byLoose.set(loose(n), n);
  for (const [k, v] of Object.entries(ALIASES)) byLoose.set(loose(k), v);
  for (const [k, v] of Object.entries(LOOSE_ALIASES)) byLoose.set(k, v);

  function mapName(name) {
    if (mapNames.has(name)) return name;
    if (ALIASES[name]) return ALIASES[name];
    return byLoose.get(loose(name)) || null;
  }

  // OFAC's CSV files: no header, quoted fields, "-0-" for empty.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field.trim()); field = ""; }
      else if (c === "\n") { row.push(field.trim()); rows.push(row); row = []; field = ""; }
      else if (c !== "\r" && c !== "\x1a") field += c;
    }
    if (field.trim() || row.length) { row.push(field.trim()); rows.push(row); }
    return rows;
  }

  // When each entry was put on the list, from the dated ("enhanced") XML version: entity id -> "YYYY-MM-DD".
  // The first datePublished after an entity's opening tag is its listing date.
  function parseDates(xml) {
    const dates = new Map();
    let current = null;
    for (const m of xml.matchAll(/<entity id="(\d+)">|datePublished="(\d{4}-\d{2}-\d{2})"/g)) {
      if (m[1]) current = m[1];
      else if (current && !dates.has(current)) dates.set(current, m[2]);
    }
    return dates;
  }

  // Program pages listed on OFAC's site (the end of each address), or null if the page looks different than expected.
  function parsePages(html) {
    const pages = new Set([...html.matchAll(/href="\/sanctions-programs-and-country-information\/([a-z0-9-]+)"\s+hreflang="en"/g)].map((m) => m[1]));
    return pages.size >= 20 ? pages : null;
  }

  // Counts per country. People and companies count where they have an address; ships, which rarely have one,
  // count under the flag they fly. dates: id -> listing date, or null (then there are no recent counts).
  function build(sdnText, addText, dates, listDate, now = Date.now()) {
    const programsOf = new Map(); // entity id -> program codes
    const flagOf = new Map(); // ship id -> map name of its flag
    const tagCount = new Map();
    const unknown = new Map();
    for (const r of parseCsv(sdnText)) {
      if (r.length < 4 || !/^\d+$/.test(r[0])) continue;
      const tags = r[3].replace(/^\[|\]$/g, "").split(/\]\s*\[/).map((t) => t.trim()).filter(Boolean);
      programsOf.set(r[0], tags);
      for (const t of tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
      if (r[2] === "vessel" && r[9] && !NO_COUNTRY.test(r[9])) {
        const flag = mapName(r[9]);
        if (flag) flagOf.set(r[0], flag);
        else unknown.set(r[9], (unknown.get(r[9]) || 0) + 1);
      }
    }
    const based = new Map(); // map name -> Set of entity ids
    const add = (name, id) => { if (!based.has(name)) based.set(name, new Set()); based.get(name).add(id); };
    for (const r of parseCsv(addText)) {
      if (r.length < 5 || !programsOf.has(r[0])) continue;
      const raw = r[4];
      if (!raw || NO_COUNTRY.test(raw)) continue;
      const name = mapName(raw);
      if (!name) { unknown.set(raw, (unknown.get(raw) || 0) + 1); continue; }
      add(name, r[0]);
    }
    for (const [id, flag] of flagOf) add(flag, id);
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const since = day(now - S.RECENT_YEARS * 365.25 * DAY);
    const yearAgo = day(now - 365 * DAY);
    const monthAgo = day(now - 30 * DAY);
    const countries = {};
    for (const [name, ids] of [...based].sort((a, b) => a[0].localeCompare(b[0]))) {
      const programs = {};
      const families = {}; // each one once per family, though it may be under several codes
      const recentReasons = {}; // listed since `since`: each once per reason
      let recent = 0;
      let year = 0;
      let month = 0;
      let ships = 0;
      for (const id of ids) {
        const tags = programsOf.get(id);
        if (flagOf.get(id) === name) ships++;
        for (const t of tags) programs[t] = (programs[t] || 0) + 1;
        for (const f of new Set(tags.map(S.M.familyOf))) families[f] = (families[f] || 0) + 1;
        const date = dates && dates.get(id);
        if (!date) continue;
        if (date >= yearAgo) year++;
        if (date >= monthAgo) month++;
        if (date >= since) {
          recent++;
          for (const reason of S.M.reasonsOfTags(tags, name)) recentReasons[reason] = (recentReasons[reason] || 0) + 1;
        }
      }
      countries[name] = { entities: ids.size, ships, programs, families };
      if (dates) Object.assign(countries[name], { recent, year, month, recentReasons });
    }
    return {
      data: {
        format: FORMAT,
        generated_at: new Date(now).toISOString(),
        list_date: listDate,
        source: "US Treasury, OFAC Specially Designated Nationals (SDN) list",
        entries: programsOf.size,
        dated: dates ? dates.size : 0,
        recent_since: dates ? since : null,
        tags: [...tagCount.keys()].sort(),
        countries,
      },
      tagCount,
      unknown,
    };
  }

  // A country program has ended when none of its codes is on the list and its pages are gone from OFAC's site, for
  // LOWER_AFTER_DAYS days in a row (pending keeps the day it first looked ended). Without OFAC's program page,
  // the last decision stands. Returns { ended, pending, notes }.
  function endedPrograms(data, pages, prev, now = Date.now()) {
    if (!pages) return { ended: (prev && prev.ended) || [], pending: (prev && prev.pending) || {}, notes: [] };
    const items = [...S.countries.filter((c) => c.level <= 3), ...Object.entries(S.regions).map(([country, r]) => ({ country, ...r }))];
    const ended = [];
    const pending = {};
    const notes = [];
    for (const c of items) {
      const codesGone = !c.tags.length || !c.tags.some((t) => data.tags.includes(t));
      if (c.tags.length && codesGone) notes.push(`${c.country}: none of its program codes (${c.tags.join(", ")}) is on OFAC's list. If OFAC renamed them, add the new codes in sanctions.js.`);
      if (!c.pages.length) continue;
      const pagesGone = !c.pages.some((p) => pages.has(p));
      if (pagesGone && !codesGone) notes.push(`${c.country}: its program page (${c.pages.join(", ")}) is no longer on OFAC's site, but its codes are still on the list.`);
      if (!(codesGone && pagesGone)) continue;
      const first = (prev && prev.pending && prev.pending[c.country]) || new Date(now).toISOString();
      pending[c.country] = first;
      if ((now - Date.parse(first)) / DAY >= S.LOWER_AFTER_DAYS) {
        ended.push(c.country);
        notes.push(`${c.country}: its program looks ended (codes off the list, page gone) since ${first.slice(0, 10)}, so the map lowered it. Update sanctions.js.`);
      } else {
        notes.push(`${c.country}: its program looks ended since ${first.slice(0, 10)}; the map lowers it after ${S.LOWER_AFTER_DAYS} days unless it comes back.`);
      }
    }
    return { ended, pending, notes };
  }

  // Automatic reasons for countries without a program (or whose program ended), each kept with a lower bar if it
  // was already shown last time (see autoReason in sanctions.js).
  function autoReasons(data, prev) {
    const out = {};
    for (const [name, counts] of Object.entries(data.countries)) {
      const r = S.M.levelOf(name, data);
      if (r.home || (r.level && r.level <= 3)) continue;
      const before = prev && prev.auto_reasons ? prev.auto_reasons[name] : null;
      const auto = S.M.autoReason(name, counts, before);
      if (auto) out[name] = { reason: auto.reason, share: Math.round(auto.share * 1000) / 1000, recent: auto.recent };
    }
    return out;
  }

  // Bursts of listings in the last 30 days (see SURGE_MIN and SURGE_FACTOR in sanctions.js).
  function surges(data) {
    const out = [];
    for (const [name, c] of Object.entries(data.countries)) {
      if (c.month === undefined || c.month < S.SURGE_MIN) continue;
      const usual = c.year / 12;
      if (c.month < S.SURGE_FACTOR * usual) continue;
      const level = S.M.levelOf(name, data);
      out.push(`${name}: ${c.month} people, companies and ships listed in the last 30 days, about ${Math.round(c.month / Math.max(usual, 1))} times the usual. ${level.level && level.level <= 3 ? "Check whether its level should go up." : "Check whether it needs a program entry in sanctions.js."}`);
    }
    return out;
  }

  // What changed since the last list check, for the Key: listings added or removed, reasons that appeared,
  // changed or went, and programs that ended. Returns { since, items } or null.
  function changes(data, prev) {
    if (!prev || !prev.countries || prev.format !== FORMAT) return null;
    const items = [];
    for (const name of new Set([...(data.ended || []), ...(prev.ended || [])])) {
      if (!(prev.ended || []).includes(name)) items.push(`${name}: program ended, level lowered`);
      else if (!(data.ended || []).includes(name)) items.push(`${name}: program back`);
    }
    const label = (r) => S.M.REASON[r].label;
    const before = prev.auto_reasons || {};
    const after = data.auto_reasons || {};
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = before[name];
      const b = after[name];
      if (!a && b) items.push(`${name}: now listed mostly for ${label(b.reason).toLowerCase()}`);
      else if (a && !b) items.push(`${name}: no longer one main reason`);
      else if (a.reason !== b.reason) items.push(`${name}: now listed mostly for ${label(b.reason).toLowerCase()} (was ${label(a.reason).toLowerCase()})`);
    }
    const deltas = [];
    for (const name of new Set([...Object.keys(data.countries), ...Object.keys(prev.countries)])) {
      const d = ((data.countries[name] || {}).entities || 0) - ((prev.countries[name] || {}).entities || 0);
      if (Math.abs(d) >= 5) deltas.push([name, d]);
    }
    deltas.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    for (const [name, d] of deltas.slice(0, 8)) items.push(`${name}: ${d > 0 ? "+" : ""}${d} listed`);
    const net = data.entries - prev.entries;
    if (net) items.push(`In all: ${net > 0 ? "+" : ""}${net} entries on the list`);
    return { since: prev.generated_at, items };
  }

  // Days each source has been failing, carried from the last check: { pages, dated } -> ISO date or null.
  function failing(prev, ok, now = Date.now()) {
    const before = (prev && prev.failing) || {};
    const out = {};
    for (const [key, works] of Object.entries(ok)) out[key] = works ? null : before[key] || new Date(now).toISOString();
    return out;
  }

  // Things a person should look at. They show on the workflow run and in the page's status pill; none of them stops
  // the deploy.
  function warnings({ tagCount, unknown, pages, programNotes, fails, surgeNotes }, now = Date.now()) {
    const out = [...programNotes, ...surgeNotes];
    const known = new Set([...S.countries, ...Object.values(S.regions)].flatMap((c) => c.tags));
    for (const [tag, n] of tagCount) {
      if (!known.has(tag) && S.M.familyOf(tag) === "Other") out.push(`New program code on OFAC's list: "${tag}" (${n} entries). Check whether a country's level in sanctions.js should change.`);
    }
    if (pages) {
      const knownPages = new Set([...OTHER_PAGES, ...[...S.countries, ...Object.values(S.regions)].flatMap((c) => c.pages)]);
      for (const p of pages) if (!knownPages.has(p)) out.push(`New program page on OFAC's site: "${p}". Check whether a country's level in sanctions.js should change.`);
    }
    const days = (iso) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : 0);
    if (days(fails.pages) >= FAILING_DAYS) out.push(`OFAC's list of programs couldn't be read for ${days(fails.pages)} days, so ended programs can't be confirmed (the last levels stand). The page may have changed: check parsePages in scripts/sanctions-lib.mjs.`);
    if (days(fails.dated) >= FAILING_DAYS) out.push(`OFAC's dated list couldn't be read for ${days(fails.dated)} days, so automatic reasons, surges and recent counts are missing.`);
    for (const [raw, n] of unknown) out.push(`Country not on the map: "${raw}" (${n} addresses or flags). Add it to ALIASES in scripts/sanctions-lib.mjs.`);
    return out;
  }

  // Everything together, from the downloaded texts (any but the SDN and address files may be null).
  // minDated: fewer dated entries than this means the dated list was cut short (the tests use tiny samples).
  function assemble({ sdn, add, xml, page, listDate, prev, now = Date.now(), minDated = 1000 }) {
    const dates = xml ? parseDates(xml) : null;
    const dated = dates && dates.size >= minDated ? dates : null;
    const pages = page ? parsePages(page) : null;
    const { data, tagCount, unknown } = build(sdn, add, dated, listDate, now);
    const before = prev && prev.format === FORMAT ? prev : null;
    const programs = endedPrograms(data, pages, before, now);
    data.ended = programs.ended;
    data.pending = programs.pending;
    data.auto_reasons = dated ? autoReasons(data, before) : (before && before.auto_reasons) || {};
    data.failing = failing(before, { pages: !!pages, dated: !!dated }, now);
    data.changes = changes(data, before);
    data.warnings = warnings({ tagCount, unknown, pages, programNotes: programs.notes, fails: data.failing, surgeNotes: dated ? surges(data) : [] }, now);
    return { data, pages };
  }

  return { mapName, parseCsv, parseDates, parsePages, build, endedPrograms, autoReasons, surges, changes, failing, warnings, assemble };
}
