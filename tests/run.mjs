// Runs the headline checks with the page's own files: node tests/run.mjs
// Exits 1 on any failure, which stops the GitHub Pages deploy (.github/workflows/deploy.yml), so a rule
// change that breaks a known case never goes live.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");

// Same scripts, same order as index.html, in one shared context (like <script> tags on a page).
const context = vm.createContext({ console });
for (const file of ["vendor/d3.min.js", "vendor/topojson.min.js", "provinces.js", "cities.js", "places.js", "names-i18n.js", "extract.js", "events.js", "tests/check.js"]) {
  vm.runInContext(read(file), context, { filename: file });
}

const topo = JSON.parse(read("vendor/countries-50m.json"));
const countries = context.topojson.feature(topo, topo.objects.countries).features;
const extract = vm.runInContext("MeridianExtract", context);
const matcher = extract.buildMatcher(countries);
const headlines = context.runChecks(extract, matcher, JSON.parse(read("tests/headlines.json")));
const events = context.runEventChecks(vm.runInContext("MeridianEvents", context), JSON.parse(read("tests/events.json")));

// Every non-English place name must point at a known place.
const missing = [...matcher.missingI18n];

for (const f of [...headlines.failed, ...events.failed]) {
  console.log(`FAIL  ${f.why}\n      ${f.title}\n      expected ${JSON.stringify(f.expected)}\n      got      ${JSON.stringify(f.got)}`);
}
if (missing.length) console.log(`FAIL  names-i18n.js names places that don't exist: ${missing.join(", ")}`);
const failedCount = headlines.failed.length + events.failed.length + (missing.length ? 1 : 0);
console.log(`headlines: ${headlines.passed} passed, ${headlines.failed.length} failed`);
console.log(`events: ${events.passed} passed, ${events.failed.length} failed`);
console.log(`${headlines.passed + events.passed} passed, ${failedCount} failed`);
process.exit(failedCount ? 1 : 0);
