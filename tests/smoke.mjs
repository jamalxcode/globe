// Loads the real page in a headless browser with a made-up feed, and checks that it works end to end:
// markers and feed rows appear, an event opens its card, the address can be shared and reopened, the
// 10-second refresh keeps keyboard focus, non-web links aren't clickable, and the Sanctions view opens.
//   node tests/smoke.mjs        (needs Playwright with Chromium; the deploy workflow installs it)
// Exits 1 on any failure, which stops the deploy like tests/run.mjs does.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

// The feed: every headline in tests/headlines.json that should be on the map, one outlet each, spread over
// the last few hours. One of them links to a javascript: address, which must not become a link.
const BAD_URL_TITLE_INDEX = 0;
function makeFeed() {
  const cases = JSON.parse(readFileSync(path.join(root, "tests/headlines.json"), "utf8")).cases.filter((c) => c.expect);
  const now = Date.now();
  const items = cases.map((c, i) => ({
    id: `t${i}`,
    title: c.title,
    url: i === BAD_URL_TITLE_INDEX ? "javascript:alert(1)" : `https://example.com/${i}`,
    source: `Outlet ${i}`,
    category: c.category || "world",
    published: new Date(now - (i % 30) * 6 * 60e3).toISOString(),
    social: !!c.social,
  }));
  return { generated_at: new Date(now - 60e3).toISOString(), items, live: [] };
}

const server = createServer(async (req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/`;

const feed = makeFeed();
const failed = [];
const check = (ok, why) => { console.log(`${ok ? "pass" : "FAIL"}  ${why}`); if (!ok) failed.push(why); };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Nothing leaves the machine: the feed is the one above, everything else outside this server is refused.
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.startsWith("https://news.sala.company/feed.json")) {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "Last-Modified": new Date().toUTCString() }, body: JSON.stringify(feed) });
    }
    return route.abort();
  });

  await page.goto(base);
  await page.waitForSelector("[data-feed] [data-row-id]", { timeout: 15000 });
  const rows = await page.locator("#feed-panel [data-feed] [data-row-id]").count();
  check(rows >= 10, `feed list shows events (${rows})`);
  const markers = await page.locator("g.dot, g.cluster").count();
  check(markers > 0, `map shows markers (${markers})`);
  check((await page.locator("#status .label").textContent()) === "Live", "status pill says Live");

  // Open the first event from the list: the card opens and the address names it.
  const first = page.locator("#feed-panel [data-feed] [data-row-id]").first();
  const id = await first.getAttribute("data-row-id");
  await first.evaluate((el) => el.click()); // the side panel slides out of view without a mouse near it
  await page.waitForSelector("#card:not([hidden])", { timeout: 5000 });
  const place = await page.locator("#card h2").textContent();
  check(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("e") === id, "address names the open event");

  // The same address in a new tab opens the same card.
  const shared = page.url();
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page2.on("pageerror", (e) => errors.push(e.message));
  await page2.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue()
    : route.request().url().startsWith("https://news.sala.company/feed.json")
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(feed) })
      : route.abort()));
  await page2.goto(shared);
  await page2.waitForSelector("#card:not([hidden])", { timeout: 15000 });
  check((await page2.locator("#card h2").textContent()) === place, `shared link reopens the card (${place})`);
  await page2.goto(`${base}#w=6`);
  await page2.waitForSelector("[data-feed] [data-row-id]", { timeout: 15000 });
  check((await page2.locator('#feed-panel [data-window="6"]').getAttribute("aria-pressed")) === "true", "shared link sets the time range");
  await page2.close();

  // Keyboard focus survives the periodic refresh, even when the list's contents change.
  await page.keyboard.press("Escape");
  const row = page.locator("#feed-panel [data-feed] [data-row-id]").nth(2);
  const rowId = await row.getAttribute("data-row-id");
  await row.focus();
  await page.evaluate("state.events.forEach((e) => { e.last_updated = new Date(Date.parse(e.last_updated) - 60e3).toISOString(); }); renderFeed();");
  check(await page.evaluate("document.activeElement && document.activeElement.dataset.rowId") === rowId, "focus stays on the same row after a refresh");

  // A report whose address isn't a web link is shown without a link.
  const bad = await page.evaluate(`(() => {
    const ev = state.events.find((e) => e.reports.some((r) => r.url.startsWith("javascript:")));
    if (!ev) return null;
    state.selection = { kind: "event", id: ev.id }; state.cardOn = true; renderCard();
    return { links: document.querySelectorAll('#card a[href^="javascript"]').length, plain: document.querySelectorAll("#card .nolink").length };
  })()`);
  check(bad && bad.links === 0 && bad.plain >= 1, "javascript: links are not clickable");

  // The Sanctions view opens (without OFAC's data file, which only the deploy builds).
  await page.locator('[data-view="sanctions"]').evaluate((el) => el.click());
  await page.waitForSelector("[data-s-list] [data-row-id]", { timeout: 5000 });
  check(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("v") === "sanctions", "Sanctions view is in the address");

  check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`${failed.length ? "FAILED" : "smoke: all passed"}`);
process.exit(failed.length ? 1 : 0);
