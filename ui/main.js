// Meridian, view switch, Key, input handling, shareable links and start-up. One of the page's scripts in ui/; they share one global scope and load in order
// (see index.html): core, feed, map, panels, sanctions-view, main.
"use strict";

// "strikes", "sanctions" (colored by level) or "reasons" (the Sanctions view colored by reason): one switch at the top.
function setView(button) {
  const view = button === "strikes" ? "strikes" : "sanctions";
  const sColor = button === "reasons" ? "reason" : "severity";
  if (state.view === view && (view === "strikes" || state.sColor === sColor)) return;
  const switching = state.view !== view;
  state.view = view;
  state.sColor = sColor;
  document.body.classList.toggle("view-sanctions", view === "sanctions");
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === button)));
  document.querySelector("[data-left-title]").textContent = view === "sanctions" ? "Countries" : "Featured locations";
  document.querySelector("[data-left-tab]").textContent = view === "sanctions" ? "Countries" : "Places";
  if (switching) {
    state.selection = null;
    state.cardOn = false;
    focusToken = null;
    setKeyOpen(false);
    if (autoHide.matches) {
      for (const panel of document.querySelectorAll(".panel.open:not(.pinned)")) setPanelOpen(panel, false);
    }
    // Phones: the sheet holds the country list, closed so the map shows first.
    if (view === "sanctions") { state.strikeSheet = state.sheet; state.sheet = "countries"; state.sheetOpen = false; }
    else { state.sheet = state.strikeSheet || "feed"; state.sheetOpen = true; }
  }
  // The sanctions data loads the first time it's needed, not with every visit.
  if (view === "sanctions" && !sanctionsRequested) loadSanctions();
  renderKey();
  paintSanctions();
  updateStatus();
  render();
}

// The Key popover: what the marker shapes, colors and icons mean.
function renderKey() {
  if (state.view === "sanctions") { renderSanctionKey(); return; }
  const item = (icon, label) => `<li>${icon}<span>${esc(label)}</span></li>`;
  document.getElementById("key").innerHTML = `
    <h2>Sources</h2>
    <ul>
      ${item('<i class="swatch one"></i>', "Hollow ring: 1 source")}
      ${item('<i class="swatch multi"></i>', "Solid dot: 2+ independent sources")}
    </ul>
    <p class="key-note">Reprints of one wire story, near-identical headlines and outlets with the same owner (RT and Sputnik, for example) count as one source. A report from a single social-media source, or naming only a whole country, is shown faintly and leaves the map if nothing confirms it within ${WEAK_HOURS} hours (it stays in the feed list).</p>
    <p class="key-note">${svgIcon(SATELLITE_ICON)} <b>heat</b>: a NASA satellite detected heat within ${SAT_KM} km around the time of the report. Supporting evidence, not proof: industry and farm fires show up too.</p>
    <h2>What happened</h2>
    <ul>${EVENT_TYPES.map((t) => item(typeIcon(t), TYPE_LABEL[t])).join("")}</ul>
    <h2>What was hit <span>(small badge, when the headline says)</span></h2>
    <ul>${Object.keys(TARGETS).map((t) => item(targetIcon(t), TARGETS[t].label)).join("")}</ul>
    <p>A numbered bubble groups nearby events; click it to zoom in. Different weapons reported in the same city within 3 hours show as one combined attack ("Missile + drone"). "Happened overnight (estimated)" comes from wording like "overnight" or "yesterday"; otherwise the time is when it was reported. Headlines in Arabic, Russian and Ukrainian are read too.</p>
    <p>Not every marker is an attack. Fire is a blaze at a facility (refinery, depot, plant, port…), Wildfire is a forest, bush or grass fire, and Environmental is a spill, leak, dam breach or mine accident; explosions and fires may be accidents. Cities are markers; regions and countries also get a 100 or 300 km disc. Markers fade as reports age.</p>`;
}

function setKeyOpen(open) {
  document.getElementById("key").hidden = !open;
  document.querySelector("[data-key-toggle]").setAttribute("aria-expanded", String(open));
}

function renderSheet() {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.sheet));
  document.querySelectorAll("[data-sheet]").forEach((el) => { el.hidden = el.dataset.sheet !== state.sheet; });
  document.querySelector("[data-sheet-body]").hidden = !state.sheetOpen;
}

function render() {
  renderPlaces();
  renderSanctionList();
  renderFilters();
  renderFeed();
  renderSheet();
  renderCard();
  drawEvents();
}

document.addEventListener("click", (e) => {
  const row = e.target.closest("[data-row-kind]");
  if (row) { pick(row.dataset.rowKind, row.dataset.rowId); return; }
  const type = e.target.closest("[data-type]");
  if (type) { state.enabled[type.dataset.type] = !state.enabled[type.dataset.type]; render(); return; }
  if (e.target.closest("[data-corr]")) { state.corroboratedOnly = !state.corroboratedOnly; render(); return; }
  const win = e.target.closest("[data-window]");
  if (win) {
    state.windowH = Number(win.dataset.window);
    // Events are rebuilt per range, since reports merge differently over a longer window.
    if (matcher && state.data) rebuild(false); else render();
    return;
  }
  if (e.target.closest("[data-close]")) { state.cardOn = false; renderCard(); return; }
  const view = e.target.closest("[data-view]");
  if (view) { setView(view.dataset.view); return; }
  if (e.target.closest("[data-reset]")) { resetView(); return; }
  if (e.target.closest("[data-key-toggle]")) { setKeyOpen(document.getElementById("key").hidden); return; }
  if (!e.target.closest("#key")) setKeyOpen(false);
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    const panel = document.getElementById(toggle.dataset.toggle);
    const label = toggle.querySelector(".sr-only");
    const title = panel.querySelector("h2").textContent.toLowerCase();
    if (autoHide.matches) {
      // Auto-hiding panels: the button pins the panel open instead of collapsing it.
      const pinned = panel.classList.toggle("pinned");
      toggle.setAttribute("aria-pressed", String(pinned));
      toggle.title = pinned ? "Unpin (hide when the mouse leaves)" : "Pin open";
      if (label) label.textContent = pinned ? `Unpin ${title}` : `Pin ${title} open`;
      return;
    }
    const collapsed = panel.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (label) label.textContent = collapsed ? `Expand ${title}` : `Collapse ${title}`;
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    if (state.sheet === tab.dataset.tab) state.sheetOpen = !state.sheetOpen;
    else { state.sheet = tab.dataset.tab; state.sheetOpen = true; }
    renderSheet();
  }
});

document.addEventListener("pointerover", (e) => {
  if (e.target.closest("svg")) return;
  const row = e.target.closest("[data-row-id]");
  if (row && row.dataset.rowKind === "country") { highlightCountry(row.dataset.rowId); return; }
  highlightCountry(null);
  setHover(row ? row.dataset.rowId : null);
});
document.addEventListener("focusin", (e) => {
  const row = e.target.closest("[data-row-id]");
  if (row && row.dataset.rowKind === "country") highlightCountry(row.dataset.rowId);
  else if (row) setHover(row.dataset.rowId);
});
// The Countries search box (there are two: the side panel and the phone sheet; they stay in step).
document.addEventListener("input", (e) => {
  const box = e.target.closest("[data-s-search]");
  if (!box) return;
  sanctionQuery = box.value;
  document.querySelectorAll("[data-s-search]").forEach((el) => { if (el !== box) el.value = box.value; });
  renderSanctionList();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { setKeyOpen(false); if (state.cardOn) { state.cardOn = false; renderCard(); } }
  if ((e.key === "0" || e.key === "Home") && !e.target.closest("input, textarea")) resetView();
});

// ---------- shareable links ----------

// The address always describes what's on screen, so copying it shares this exact view:
//   #e=<event id>  #c=<country>  #p=<featured place>   the open card
//   #m=<lng>,<lat>,<zoom>                              otherwise, the map position (when zoomed in)
//   v=sanctions|reasons  w=<hours>                     the view and time range, when not the defaults
const HASH_KIND = { event: "e", country: "c", place: "p" };
let hashApplied = false; // a pasted link isn't overwritten before it has been applied

function writeHash() {
  if (!hashApplied) return;
  const q = new URLSearchParams();
  if (state.view === "sanctions") q.set("v", state.sColor === "reason" ? "reasons" : "sanctions");
  if (state.windowH !== DEFAULT_WINDOW_H) q.set("w", String(state.windowH));
  const sel = state.selection;
  if (sel && state.cardOn && HASH_KIND[sel.kind]) {
    q.set(HASH_KIND[sel.kind], sel.id);
  } else {
    const t = d3.zoomTransform(svg.node());
    const ll = t.k > 1.01 && projection.invert([(W / 2 - t.x) / t.k, (H / 2 - t.y) / t.k]);
    if (ll && ll.every(Number.isFinite)) q.set("m", `${ll[0].toFixed(2)},${ll[1].toFixed(2)},${t.k.toFixed(1)}`);
  }
  const hash = q.toString();
  if (hash === location.hash.slice(1)) return;
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

function applyHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const v = q.get("v");
  setView(v === "sanctions" || v === "reasons" ? v : q.get("c") ? "sanctions" : "strikes");
  const w = Number(q.get("w"));
  const windowH = WINDOWS.some((x) => x.h === w) ? w : DEFAULT_WINDOW_H;
  if (windowH !== state.windowH) {
    state.windowH = windowH;
    if (matcher && state.data) rebuild(false); else render();
  }
  const m = (q.get("m") || "").split(",").map(Number);
  if (q.get("e")) pick("event", q.get("e")); // an event that has since left the feed is simply not opened
  else if (q.get("c")) focusCountry(q.get("c"));
  else if (q.get("p")) pick("place", q.get("p"));
  else if (m.length === 3 && m.every(Number.isFinite)) {
    const kk = Math.min(60, Math.max(1, m[2]));
    const [x, y] = projection([m[0], m[1]]);
    svg.interrupt().call(zoom.transform, d3.zoomIdentity.translate(W / 2 - x * kk, H / 2 - y * kk).scale(kk));
  }
  hashApplied = true;
  writeHash();
}
window.addEventListener("hashchange", applyHash);

// ---------- start ----------

async function start() {
  renderKey();
  renderSanctionLegend();
  render();
  layout();
  new ResizeObserver(() => layout()).observe(mapEl);
  const feed = loadFeed();
  try {
    const topo = await d3.json(ATLAS_URL);
    const countries = topojson.feature(topo, topo.objects.countries).features;
    world = { borders: topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b) };
    countriesG.selectAll("path").data(countries).join("path").attr("class", "country").attr("d", geoPath)
      .attr("data-kind", "country").attr("data-id", (d) => d.properties.name)
      .append("title").text((d) => countryLabel(d.properties.name));
    regionsG.selectAll("path").data(SANCTION_REGIONS.features.map(rewind)).join("path").attr("class", "region").attr("d", geoPath)
      .attr("data-kind", "country").attr("data-id", (d) => d.properties.name)
      .append("title");
    bordersEl.attr("d", geoPath(world.borders));
    matcher = MeridianExtract.buildMatcher(countries);
  } catch {
    document.getElementById("status").title = "The world map didn't load. Reload the page to try again.";
  }
  if (state.view === "sanctions") paintSanctions();
  await Promise.all([feed, loadFires()]);
  rebuild();
  applyHash();
  // Satellite data changes hourly at most.
  setInterval(() => loadFires().then((ok) => { if (ok) rebuild(false); }), 30 * 60 * 1000);
  pollLive();
  // A hidden tab doesn't download anything; it catches up when it's shown again (visibilitychange below).
  setInterval(() => { if (!document.hidden) loadFeed(); }, POLL_S * 1000);
  setInterval(pollLive, POLL_S * 1000);
  setInterval(() => { renderFeed(); drawEvents(); updateStatus(); }, 10000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadFeed(); pollLive(); } });
}

start();
