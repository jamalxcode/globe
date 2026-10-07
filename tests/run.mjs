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
for (const file of ["vendor/d3.min.js", "vendor/topojson.min.js", "provinces.js", "cities.js", "places.js", "extract.js", "tests/check.js"]) {
  vm.runInContext(read(file), context, { filename: file });
}

const topo = JSON.parse(read("vendor/countries-50m.json"));
const countries = context.topojson.feature(topo, topo.objects.countries).features;
const extract = vm.runInContext("MeridianExtract", context);
const matcher = extract.buildMatcher(countries);
const suite = JSON.parse(read("tests/headlines.json"));
const { passed, failed } = context.runChecks(extract, matcher, suite);

for (const f of failed) {
  console.log(`FAIL  ${f.why}\n      ${f.title}\n      expected ${JSON.stringify(f.expected)}\n      got      ${JSON.stringify(f.got)}`);
}
console.log(`${passed} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
