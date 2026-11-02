// The weekly self-audit, automated: takes a random sample of live headlines the map accepted and of ones it
// rejected despite strike words, asks Claude whether the rules got each one right, and writes a Markdown
// report of the suspected mistakes, each as a ready-to-paste case for tests/headlines.json.
//   ANTHROPIC_API_KEY=... node scripts/audit.mjs > audit.md
// Prints nothing (and exits 0) when no mistakes are suspected. Run by .github/workflows/audit.yml, which
// opens an issue with the report. Claude's verdicts are a second opinion for a person to check, never applied
// to the map by themselves.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const Anthropic = require("@anthropic-ai/sdk");

const FEEDS = ["https://news.sala.company/feed.json", "https://news.sala.company/local.json"];
const SAMPLE = 40; // of each: accepted, rejected
const MODEL = "claude-opus-5-5";
// Loose: anything that might be a strike, fire or spill. The rules are much stricter; this finds what they turned down.
const STRIKEISH = /\b(strikes?|struck|drones?|missiles?|air ?strikes?|shell(?:ing|ed)|explosions?|blasts?|explod\w*|attacks?|bomb\w*|rockets?|fires?|blaze|wildfires?|spill|leak)\b/i;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");

// The page's own rules, loaded the way tests/run.mjs does.
const context = vm.createContext({ console });
for (const file of ["vendor/d3.min.js", "vendor/topojson.min.js", "provinces.js", "cities.js", "places.js", "names-i18n.js", "regions.js", "sanctions.js", "extract.js"]) {
  vm.runInContext(read(file), context, { filename: file });
}
const topo = JSON.parse(read("vendor/countries-50m.json"));
const extract = vm.runInContext("MeridianExtract", context);
const matcher = extract.buildMatcher(context.topojson.feature(topo, topo.objects.countries).features);

const items = [];
for (const url of FEEDS) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  items.push(...((await res.json()).items || []));
}

const accepted = [];
const rejected = [];
for (const raw of items) {
  const m = extract.toMention(matcher, raw);
  if (m) accepted.push({ id: raw.id, title: m.title, category: raw.category, rules: { type: m.type, place: m.place.name, country: m.place.country, precision: m.place.precision } });
  else if (STRIKEISH.test(raw.title || "")) rejected.push({ id: raw.id, title: raw.title, category: raw.category, rules: null });
}

function sample(list, n) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
const picked = [...sample(accepted, SAMPLE), ...sample(rejected, SAMPLE)];
if (!picked.length) process.exit(0);

const SYSTEM = `You check the output of keyword rules that turn news headlines into points on a live map of strikes, explosions, industrial fires, wildfires and environmental incidents.

A headline belongs on the map only if it reports a specific incident that has just happened (not a forecast, threat, test, arms deal, statement, analysis, or a look back at an older event), and it names where it happened. The place is where the incident happened, not the country that carried it out or is speaking ("Russia says...").

Types: airstrike, missile, explosion, shelling, drone, fire (only at a facility: refinery, depot, factory, power plant, port or ship, airport, railway, military site), wildfire, environment (spills, leaks, dam breaches, mine accidents, pollution), other (a strike or attack of unstated kind).

For each headline you get what the rules decided: "rules" is null when they left it off the map, or the type and place they chose. Give a verdict:
- "right": the rules' decision is correct (on the map with a fitting type and place, or correctly left off).
- "wrong_type" / "wrong_place": on the map, but the type or place is wrong.
- "not_an_event": on the map, but it shouldn't be.
- "missed": left off, but it should be on the map.
- "unsure": the headline alone doesn't settle it.
When the right answer differs from the rules, give it in type and place (empty strings when it should not be on the map). Keep the note to one short sentence. Judge only from the headline text.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "verdict", "type", "place", "note"],
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["right", "wrong_type", "wrong_place", "not_an_event", "missed", "unsure"] },
          type: { type: "string" },
          place: { type: "string" },
          note: { type: "string" },
        },
      },
    },
  },
};

const client = new Anthropic();
const response = await client.beta.messages.create({
  model: MODEL,
  max_tokens: 16000,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
  system: SYSTEM,
  messages: [{ role: "user", content: JSON.stringify(picked.map(({ id, title, category, rules }) => ({ id: String(id), title, category, rules }))) }],
});
if (response.stop_reason === "refusal") throw new Error("Claude declined the audit request");
if (response.stop_reason === "max_tokens") throw new Error("The audit answer was cut off; lower SAMPLE");
const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
const verdicts = JSON.parse(text).verdicts;

const byId = new Map(picked.map((p) => [String(p.id), p]));
const mistakes = verdicts.filter((v) => v.verdict !== "right" && v.verdict !== "unsure" && byId.has(v.id));
const unsure = verdicts.filter((v) => v.verdict === "unsure").length;
if (!mistakes.length) process.exit(0);

const acceptedN = picked.filter((p) => p.rules).length;
const wrongAccepted = mistakes.filter((v) => byId.get(v.id).rules).length;
const missed = mistakes.length - wrongAccepted;
const lines = [
  `Claude (${MODEL}) checked a random sample of this week's live headlines: ${acceptedN} the map accepted and ${picked.length - acceptedN} it rejected despite strike words.`,
  "",
  `| Accepted, suspected wrong | Rejected, suspected missed | Unsure |`,
  `|---|---|---|`,
  `| ${wrongAccepted} of ${acceptedN} | ${missed} of ${picked.length - acceptedN} | ${unsure} |`,
  "",
  "These are a second opinion, not facts: check each one, fix the rule in `extract.js` (or a place list), and add the case to `tests/headlines.json` so it can't come back. Close this issue when done.",
  "",
];
for (const v of mistakes) {
  const p = byId.get(v.id);
  const rules = p.rules ? `${p.rules.type} at ${p.rules.place}, ${p.rules.country} (${p.rules.precision})` : "left off the map";
  const expect = v.type && v.place ? { type: v.type, place: v.place } : null;
  const testCase = { why: v.note, title: p.title, category: p.category, expect };
  lines.push(`### ${v.verdict.replace("_", " ")}: ${p.title.replace(/\s+/g, " ").slice(0, 120)}`);
  lines.push("", `- Rules: ${rules}`, `- Claude: ${v.note}`, "", "```json", JSON.stringify(testCase), "```", "");
}
console.log(lines.join("\n"));
