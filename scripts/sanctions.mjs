// Writes sanctions-data.json for the Sanctions view: from OFAC's list of sanctioned people, companies and ships
// (the SDN list), how many are based in each country and under which programs, plus every program code on the
// list (sanctions.js uses these to notice a country program that has ended). Run by .github/workflows/deploy.yml:
//   node scripts/sanctions.mjs _site/sanctions-data.json
// The list is about 7 MB, so the published copy is reused while it's less than a day old. If OFAC can't be
// reached, the published copy is kept; with neither, it exits 1 and the site goes out without the file.
// Lines starting "::warning::" show on the workflow run: a new program code, a country program that ended, or an
// address country this script doesn't know.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const OUT = process.argv[2] || "sanctions-data.json";
const PUBLISHED = "https://jamalxcode.github.io/globe/sanctions-data.json";
const OFAC = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/";
const REUSE_HOURS = 20;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
vm.runInContext(readFileSync(path.join(root, "sanctions.js"), "utf8"), context, { filename: "sanctions.js" });
const S = vm.runInContext("({ countries: SANCTION_COUNTRIES, regions: SANCTION_REGION_INFO, M: MeridianSanctions })", context);
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
  "Swaziland": "eSwatini", "Cabo Verde": "Cabo Verde", "Cape Verde": "Cabo Verde", "Sao Tome and Principe": "São Tomé and Principe",
  "Palestinian": "Palestine", "West Bank": "Palestine", "Gaza": "Palestine",
  "Region: Gaza": "Palestine", "Region: West Bank": "Palestine", "Region: Northern Gaza": "Palestine", "Region: North Gaza": "Palestine",
  "Region: Russia": "Russia", "Region: Iran": "Iran", "Region: Northern Mali": "Mali", "Region: Crimea": "Crimea",
};
// Addresses that name no single country on the map (or one too small for it).
const NO_COUNTRY = /^(-0-|Gibraltar|Region: (Kafia Kingi|Jammu and Kashmir|Kashmir|Commonwealth of Independent States))$/;

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

async function published() {
  try {
    const res = await fetch(`${PUBLISHED}?t=${Date.now()}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function download(file) {
  const res = await fetch(OFAC + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return { text: new TextDecoder("latin1").decode(await res.arrayBuffer()), modified: res.headers.get("Last-Modified") };
}

function build(sdnText, addText, listDate) {
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
  const countries = {};
  for (const [name, ids] of [...based].sort((a, b) => a[0].localeCompare(b[0]))) {
    const programs = {};
    const families = {}; // each person or company once per family, though it may be under several codes
    for (const id of ids) {
      for (const t of programsOf.get(id)) programs[t] = (programs[t] || 0) + 1;
      for (const f of new Set(programsOf.get(id).map(S.M.familyOf))) families[f] = (families[f] || 0) + 1;
    }
    countries[name] = { entities: ids.size, programs, families };
  }
  return {
    data: {
      generated_at: new Date().toISOString(),
      list_date: listDate,
      source: "US Treasury, OFAC Specially Designated Nationals (SDN) list",
      entries: programsOf.size,
      tags: [...tagCount.keys()].sort(),
      countries,
    },
    tagCount,
    unknown,
  };
}

// Things a person should look at; none of them stops the deploy.
function warnings(data, tagCount, unknown) {
  const out = [];
  const known = new Set([...S.countries, ...Object.values(S.regions)].flatMap((c) => c.tags));
  for (const [tag, n] of tagCount) {
    if (!known.has(tag) && S.M.familyOf(tag) === "Other") out.push(`New program code on OFAC's list: "${tag}" (${n} entries). Check whether a country's level in sanctions.js should change.`);
  }
  for (const c of S.countries) {
    const r = S.M.levelOf(c.country, data, c);
    if (r.lowered) out.push(`${c.country}: none of its program codes (${c.tags.join(", ")}) is on OFAC's list any more, so the map lowered it from level ${r.lowered} to ${r.level}. Update sanctions.js.`);
  }
  for (const [raw, n] of unknown) out.push(`Address country not on the map: "${raw}" (${n} addresses). Add it to ALIASES in scripts/sanctions.mjs.`);
  return out;
}

const prev = await published();
if (prev && Date.now() - Date.parse(prev.generated_at) < REUSE_HOURS * 3600e3) {
  writeFileSync(OUT, JSON.stringify(prev));
  console.log(`Reused the published list from ${prev.generated_at}`);
  process.exit(0);
}
try {
  const [sdn, add] = await Promise.all([download("SDN.CSV"), download("ADD.CSV")]);
  const listDate = sdn.modified ? new Date(sdn.modified).toISOString() : null;
  const { data, tagCount, unknown } = build(sdn.text, add.text, listDate);
  if (data.entries < 1000) throw new Error(`only ${data.entries} entries: not the full list`);
  writeFileSync(OUT, JSON.stringify(data));
  console.log(`${data.entries} entries, ${data.tags.length} program codes, ${Object.keys(data.countries).length} countries`);
  for (const w of warnings(data, tagCount, unknown)) console.log(`::warning::${w}`);
} catch (err) {
  if (prev) {
    writeFileSync(OUT, JSON.stringify(prev));
    console.log(`::warning::OFAC's list couldn't be read (${err.message}); kept the published copy from ${prev.generated_at}`);
  } else {
    console.log(`::warning::OFAC's list couldn't be read (${err.message}); no sanctions-data.json`);
    process.exit(1);
  }
}
