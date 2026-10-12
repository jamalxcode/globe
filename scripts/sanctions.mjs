// Writes sanctions-data.json for the Sanctions view, from OFAC's list of sanctioned people, companies and ships (the
// SDN list, plain and dated) and OFAC's list of sanctions programs. Run by .github/workflows/deploy.yml:
//   node scripts/sanctions.mjs _site/sanctions-data.json
// The logic (counts per country, ended programs, automatic reasons, surges, changes, warnings) is in
// sanctions-lib.mjs, where tests/run.mjs checks it. This file only downloads.
// The dated list is about 110 MB, so the published copy is reused while it's less than a day old. If OFAC can't be
// reached, the published copy is kept; with neither, it exits 1 and the site goes out without the file.
import { writeFileSync } from "node:fs";
import { createLib, loadSite, siteRoot, FORMAT } from "./sanctions-lib.mjs";

const OUT = process.argv[2] || "sanctions-data.json";
const PUBLISHED = "https://jamalxcode.github.io/globe/sanctions-data.json";
const OFAC = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/";
const PROGRAMS_PAGE = "https://ofac.treasury.gov/sanctions-programs-and-country-information";
const REUSE_HOURS = 20;

const lib = createLib(loadSite(siteRoot));

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
  const { data, pages } = lib.assemble({
    sdn: sdn.text, add: add.text, xml: xml && xml.text, page: page && page.text,
    listDate: sdn.modified ? new Date(sdn.modified).toISOString() : null, prev,
  });
  if (data.entries < 1000) throw new Error(`only ${data.entries} entries: not the full list`);
  writeFileSync(OUT, JSON.stringify(data));
  console.log(`${data.entries} entries (${data.dated} dated), ${data.tags.length} program codes, ${pages ? pages.size : "no"} program pages, ${Object.keys(data.countries).length} countries, ${Object.keys(data.auto_reasons).length} automatic reasons`);
  for (const c of (data.changes && data.changes.items) || []) console.log(`changed: ${c}`);
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
