// Writes sanctions-data.json for the Sanctions view, from OFAC's list of sanctioned people, companies and ships (the
// SDN list) and OFAC's list of sanctions programs. Run by .github/workflows/deploy.yml:
//   node scripts/sanctions.mjs _site/sanctions-data.json
// Per country: how many listed people and companies are based there, how many were listed in the last RECENT_YEARS
// years, and for which programs and reasons. Also which country programs have ended (see endedPrograms) and
// warnings for a person to look at, which the page shows in its status pill.
// The files are large (the dated list is about 110 MB), so the published copy is reused while it's less than a day
// old. If OFAC can't be reached, the published copy is kept; with neither, it exits 1 and the site goes out without
// the file.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const OUT = process.argv[2] || "sanctions-data.json";
const PUBLISHED = "https://jamalxcode.github.io/globe/sanctions-data.json";
const OFAC = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/";
const PROGRAMS_PAGE = "https://ofac.treasury.gov/sanctions-programs-and-country-information";
const REUSE_HOURS = 20;
const FORMAT = 2; // raise when the file's contents change, so an older published copy isn't reused

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
vm.runInContext(readFileSync(path.join(root, "sanctions.js"), "utf8"), context, { filename: "sanctions.js" });
const S = vm.runInContext("({ countries: SANCTION_COUNTRIES, regions: SANCTION_REGION_INFO, M: MeridianSanctions, RECENT_YEARS, LOWER_AFTER_DAYS })", context);
const topo = JSON.parse(readFileSync(path.join(root, "vendor/countries-50m.json"), "utf8"));
const mapNames = new Set(topo.objects.countries.geometries.map((g) => g.properties.name));

// OFAC's country names that differ from the map's.
const ALIASES = {
  "Korea, North": "North Korea", "Korea, South": "South Korea", "Burma": "Myanmar",
  "Congo, Democratic Republic of the": "Dem. Rep. Congo", "Congo, Republic of the": "Congo",
  "Bosnia and Herzegovina": "Bosnia and Herz.", "Central African Republic": "Central African Rep.",
  "North Macedonia, The Republic of": "Macedonia", "Czech Republic": "Czechia", "Cote d Ivoire": "Côte d'Ivoire",
  "Virgin Islands, British": "British Virgin Is.", "Marshall Islands": "Marshall Is.", "Cayman Islands": "Cayman Is.",
  "The Gambia": "Gambia", "Bahamas, The": "Bahamas", "Man, Isle of": "Isle of Man",
  "Saint Kitts and Nevis": "St. Kitts and Nevis", "Saint Vincent and the Grenadines": "St. Vin. and Gren.",
  "Antigua and Barbuda": "Antigua and Barb.", "Dominican Republic": "Dominican Rep.", "Equatorial Guinea": "Eq. Guinea",
  "Macau": "Macao", "Curacao": "Curaçao", "South Sudan": "S. Sudan", "United States": "United States of America",
  "Solomon Islands": "Solomon Is.", "Turks and Caicos Islands": "Turks and Caicos Is.", "Eswatini": "eSwatini",
  "Swaziland": "eSwatini", "Cape Verde": "Cabo Verde", "Sao Tome and Principe": "São Tomé and Principe",
  "Palestinian": "Palestine", "West Bank": "Palestine", "Gaza": "Palestine",
  "Region: Gaza": "Palestine", "Region: West Bank": "Palestine", "Region: Northern Gaza": "Palestine", "Region: North Gaza": "Palestine",
  "Region: Russia": "Russia", "Region: Iran": "Iran", "Region: Northern Mali": "Mali", "Region: Crimea": "Crimea",
};
// Addresses that name no single country on the map (or one too small for it).
const NO_COUNTRY = /^(-0-|Gibraltar|Region: (Kafia Kingi|Jammu and Kashmir|Kashmir|Commonwealth of Independent States))$/;
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

function mapName(name) {
  if (mapNames.has(name)) return name;
  if (ALIASES[name]) return ALIASES[name];
  return null;
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

async function published() {
  try {
    const res = await fetch(`${PUBLISHED}?t=${Date.now()}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function download(url, encoding = "latin1") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.split("/").pop()}: HTTP ${res.status}`);
  return { text: new TextDecoder(encoding).decode(await res.arrayBuffer()), modified: res.headers.get("Last-Modified") };
}

async function optional(url, encoding) {
  try {
    return await download(url, encoding);
  } catch (err) {
    console.log(`${err.message}: carrying on without it`);
    return null;
  }
}

function build(sdnText, addText, dates, listDate) {
  const programsOf = new Map(); // entity id -> program codes
  const tagCount = new Map();
  for (const r of parseCsv(sdnText)) {
    if (r.length < 4 || !/^\d+$/.test(r[0])) continue;
    const tags = r[3].replace(/^\[|\]$/g, "").split(/\]\s*\[/).map((t) => t.trim()).filter(Boolean);
    programsOf.set(r[0], tags);
    for (const t of tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  }
  const based = new Map(); // map name -> Set of entity ids
  const unknown = new Map();
  for (const r of parseCsv(addText)) {
    if (r.length < 5 || !programsOf.has(r[0])) continue;
    const raw = r[4];
    if (!raw || NO_COUNTRY.test(raw)) continue;
    const name = mapName(raw);
    if (!name) { unknown.set(raw, (unknown.get(raw) || 0) + 1); continue; }
    if (!based.has(name)) based.set(name, new Set());
    based.get(name).add(r[0]);
  }
  const since = new Date(Date.now() - S.RECENT_YEARS * 365.25 * 864e5).toISOString().slice(0, 10);
  const countries = {};
  for (const [name, ids] of [...based].sort((a, b) => a[0].localeCompare(b[0]))) {
    const programs = {};
    const families = {}; // each person or company once per family, though it may be under several codes
    const recentReasons = {}; // listed since `since`: each once per reason
    let recent = 0;
    for (const id of ids) {
      const tags = programsOf.get(id);
      for (const t of tags) programs[t] = (programs[t] || 0) + 1;
      for (const f of new Set(tags.map(S.M.familyOf))) families[f] = (families[f] || 0) + 1;
      if (dates && dates.get(id) >= since) {
        recent++;
        for (const reason of S.M.reasonsOfTags(tags)) recentReasons[reason] = (recentReasons[reason] || 0) + 1;
      }
    }
    countries[name] = dates ? { entities: ids.size, recent, programs, families, recentReasons } : { entities: ids.size, programs, families };
  }
  return {
    data: {
      format: FORMAT,
      generated_at: new Date().toISOString(),
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
// LOWER_AFTER_DAYS days in a row (pending keeps the day it first looked ended). Without OFAC's program page nothing
// is lowered. Returns { ended, pending, notes }.
function endedPrograms(data, pages, prev) {
  const items = [...S.countries.filter((c) => c.level <= 3), ...Object.entries(S.regions).map(([country, r]) => ({ country, ...r }))];
  const now = Date.now();
  const ended = [];
  const pending = {};
  const notes = [];
  for (const c of items) {
    const codesGone = !c.tags.length || !c.tags.some((t) => data.tags.includes(t));
    if (c.tags.length && codesGone) notes.push(`${c.country}: none of its program codes (${c.tags.join(", ")}) is on OFAC's list. If OFAC renamed them, add the new codes in sanctions.js.`);
    if (!pages || !c.pages.length) continue;
    const pagesGone = !c.pages.some((p) => pages.has(p));
    if (pagesGone && !codesGone) notes.push(`${c.country}: its program page (${c.pages.join(", ")}) is no longer on OFAC's site, but its codes are still on the list.`);
    if (!(codesGone && pagesGone)) continue;
    const first = (prev && prev.pending && prev.pending[c.country]) || new Date(now).toISOString();
    pending[c.country] = first;
    const days = (now - Date.parse(first)) / 864e5;
    if (days >= S.LOWER_AFTER_DAYS) {
      ended.push(c.country);
      notes.push(`${c.country}: its program looks ended (codes off the list, page gone) since ${first.slice(0, 10)}, so the map lowered it. Update sanctions.js.`);
    } else {
      notes.push(`${c.country}: its program looks ended since ${first.slice(0, 10)}; the map lowers it after ${S.LOWER_AFTER_DAYS} days unless it comes back.`);
    }
  }
  return { ended, pending, notes };
}

// Things a person should look at. They show on the workflow run and in the page's status pill; none of them stops
// the deploy.
function warnings(tagCount, unknown, pages, programNotes, dated) {
  const out = [...programNotes];
  const known = new Set([...S.countries, ...Object.values(S.regions)].flatMap((c) => c.tags));
  for (const [tag, n] of tagCount) {
    if (!known.has(tag) && S.M.familyOf(tag) === "Other") out.push(`New program code on OFAC's list: "${tag}" (${n} entries). Check whether a country's level in sanctions.js should change.`);
  }
  if (pages) {
    const knownPages = new Set([...OTHER_PAGES, ...[...S.countries, ...Object.values(S.regions)].flatMap((c) => c.pages)]);
    for (const p of pages) if (!knownPages.has(p)) out.push(`New program page on OFAC's site: "${p}". Check whether a country's level in sanctions.js should change.`);
  } else {
    out.push("OFAC's list of programs couldn't be read, so ended programs can't be confirmed (nothing is lowered meanwhile).");
  }
  if (!dated) out.push("OFAC's dated list couldn't be read, so no country gets a reason from its listed people this time.");
  for (const [raw, n] of unknown) out.push(`Address country not on the map: "${raw}" (${n} addresses). Add it to ALIASES in scripts/sanctions.mjs.`);
  return out;
}

const prev = await published();
if (prev && prev.format === FORMAT && Date.now() - Date.parse(prev.generated_at) < REUSE_HOURS * 3600e3) {
  writeFileSync(OUT, JSON.stringify(prev));
  console.log(`Reused the published list from ${prev.generated_at}`);
  process.exit(0);
}
try {
  const [sdn, add, xml, page] = await Promise.all([
    download(OFAC + "SDN.CSV"), download(OFAC + "ADD.CSV"), optional(OFAC + "SDN_ENHANCED.XML", "utf-8"), optional(PROGRAMS_PAGE, "utf-8"),
  ]);
  const dates = xml ? parseDates(xml.text) : null;
  const pages = page ? parsePages(page.text) : null;
  const listDate = sdn.modified ? new Date(sdn.modified).toISOString() : null;
  const { data, tagCount, unknown } = build(sdn.text, add.text, dates && dates.size > 1000 ? dates : null, listDate);
  if (data.entries < 1000) throw new Error(`only ${data.entries} entries: not the full list`);
  const programs = endedPrograms(data, pages, prev);
  data.ended = programs.ended;
  data.pending = programs.pending;
  data.warnings = warnings(tagCount, unknown, pages, programs.notes, data.dated > 1000);
  writeFileSync(OUT, JSON.stringify(data));
  console.log(`${data.entries} entries (${data.dated} dated), ${data.tags.length} program codes, ${pages ? pages.size : "no"} program pages, ${Object.keys(data.countries).length} countries`);
  for (const w of data.warnings) console.log(`::warning::${w}`);
} catch (err) {
  if (prev) {
    writeFileSync(OUT, JSON.stringify(prev));
    console.log(`::warning::OFAC's list couldn't be read (${err.message}); kept the published copy from ${prev.generated_at}`);
  } else {
    console.log(`::warning::OFAC's list couldn't be read (${err.message}); no sanctions-data.json`);
    process.exit(1);
  }
}
