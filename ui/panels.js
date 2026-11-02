// Meridian, the side panels, the feed list and the info card. One of the page's scripts in ui/; they share one global scope and load in order
// (see index.html): core, feed, map, panels, sanctions-view, main.
"use strict";

// ---------- panels ----------

function renderPlaces() {
  const html = FEATURED_PLACES.map((p) => {
    const active = state.hover === p.id || (state.selection && state.selection.id === p.id);
    return `<li><button type="button" class="row place-row${active ? " active" : ""}" data-row-kind="place" data-row-id="${p.id}">
      <span class="pin" aria-hidden="true"></span>
      <span><span class="name">${esc(p.name)}</span><span class="coords">${p.lat.toFixed(1)}°, ${p.lng.toFixed(1)}°</span></span>
    </button></li>`;
  }).join("");
  document.querySelectorAll("[data-places]").forEach((el) => setHTML(el, html));
}

function renderFilters() {
  const types = EVENT_TYPES.map((t) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${state.enabled[t]}">${typeIcon(t)}${TYPE_LABEL[t]}</button>`).join("");
  const corr = `<button type="button" class="chip corr" data-corr aria-pressed="${state.corroboratedOnly}" title="Only events reported by two or more independent sources">2+ sources only</button>`;
  const wins = WINDOWS.map((w) => `<button type="button" class="chip win" data-window="${w.h}" aria-pressed="${state.windowH === w.h}" title="Last ${w.long}">${w.label}</button>`).join("");
  const html = types + corr + '<span class="sep"></span>' + wins;
  document.querySelectorAll("[data-filters]").forEach((el) => setHTML(el, html));
}

function renderFeed() {
  const now = Date.now();
  const list = filtered();
  let html;
  if (!state.data || !matcher) {
    html = `<li class="empty">${state.feedOk === false ? "Can't reach the news feed. Retrying every minute." : "Loading reports…"}</li>`;
  } else if (!list.length) {
    html = `<li class="empty">No reports match these filters in the last ${windowInfo(state.windowH).long}.</li>`;
  } else {
    html = list.map((ev) => {
      const tone = ev.status === "corroborated" ? "multi" : "one";
      const active = state.hover === ev.id || (state.selection && state.selection.id === ev.id);
      // The tag spells out the source count (hollow for one, solid for several), so color isn't needed.
      const sat = ev.satellite ? `<span class="tag sat" title="Satellite heat detected ${ev.satellite.km.toFixed(1)} km away (NASA FIRMS)">${svgIcon(SATELLITE_ICON)}heat</span>` : "";
      const tag = `${sat}<span class="tag ${tone}">${ev.source_count} ${ev.source_count === 1 ? "source" : "sources"}</span>`;
      const target = ev.target ? `<span class="target" title="${esc(TARGETS[ev.target].label)}">${targetIcon(ev.target)}${esc(TARGETS[ev.target].label)}</span>` : "";
      const hidden = offMap(ev, now);
      const weakNote = hidden ? `<span class="weak-note">Not confirmed within ${WEAK_HOURS} h: off the map</span>` : ev.weak ? `<span class="weak-note">${weakReason(ev)}: shown faintly until a second source confirms</span>` : "";
      return `<li><button type="button" class="row ${tone}${active ? " active" : ""}${hidden ? " off-map" : ""}" data-row-kind="event" data-row-id="${ev.id}">
        <span class="line"><span class="type">${typeIcons(ev)}${typeLabel(ev)}${target}</span><span class="time">${relativeTime(ev.last_updated, now)}</span></span>
        <span class="line"><span class="where">${esc(ev.location_name)}<span> · ${esc(ev.country)}</span></span>${tag}</span>
        <span class="headline">${esc(ev.reports[0].title)}</span>${ev.when ? `<span class="when-note">Happened ${esc(ev.when.label)} (estimated)</span>` : ""}${weakNote}
      </button></li>`;
    }).join("");
  }
  document.querySelectorAll("[data-feed]").forEach((el) => setHTML(el, html));
  const count = document.querySelector("[data-feed-count]");
  if (count) count.textContent = state.data && matcher ? `· ${list.length}` : "";
}

// ---------- auto-hiding side panels (mouse only) ----------

const autoHide = window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)");
const HIDE_DELAY_MS = 350;

function setPanelOpen(panel, open) {
  panel.classList.toggle("open", open);
  const edge = document.querySelector(`[data-edge="${panel.id}"]`);
  if (edge) edge.classList.toggle("hide-tab", open);
  if (panel.id === "feed-panel") document.body.classList.toggle("feed-open", open);
}

for (const panel of document.querySelectorAll(".panel")) {
  const edge = document.querySelector(`[data-edge="${panel.id}"]`);
  let timer = 0;
  const show = () => { clearTimeout(timer); if (autoHide.matches) setPanelOpen(panel, true); };
  const hideSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!autoHide.matches || panel.classList.contains("pinned")) return;
      if (panel.matches(":hover, :focus-within") || (edge && edge.matches(":hover"))) return;
      setPanelOpen(panel, false);
    }, HIDE_DELAY_MS);
  };
  for (const el of [panel, edge]) {
    if (!el) continue;
    el.addEventListener("pointerenter", show);
    el.addEventListener("pointerleave", hideSoon);
  }
  panel.addEventListener("focusin", show);
  panel.addEventListener("focusout", hideSoon);
}

function renderCard() {
  const card = document.getElementById("card");
  const sel = state.selection;
  if (!state.cardOn || !sel) { card.hidden = true; writeHash(); return; }
  const close = `<button type="button" class="icon-btn" data-close aria-label="Close">${ICON_X}</button>`;
  if (sel.kind === "country") {
    card.innerHTML = sanctionCardHtml(sel.id, close);
  } else if (sel.kind === "place") {
    const p = FEATURED_PLACES.find((x) => x.id === sel.id);
    if (!p) { card.hidden = true; return; }
    card.innerHTML = `<div class="top"><div><p class="kicker">Featured location</p><h2>${esc(p.name)}</h2></div>${close}</div>
      <div class="body"><p class="muted">${esc(p.description)}</p>
      <p class="meta muted">${p.lat.toFixed(2)}°, ${p.lng.toFixed(2)}°</p></div>`;
  } else {
    const ev = state.events.find((x) => x.id === sel.id);
    if (!ev) { card.hidden = true; return; }
    const corroborated = ev.status === "corroborated";
    const now = Date.now();
    const reports = ev.reports.slice(0, 8).map((r) => {
      const url = safeUrl(r.url);
      const inner = `${ICON_EXT}
      <span><span class="src">${esc(r.source)}${r.social ? " · social" : ""}${r.wire && r.wire !== r.source ? ` · credits ${esc(r.wire)}` : ""} · ${relativeTime(r.published, now)}</span><span class="ttl">${markTerms(r.title, r.why ? [r.why.type, r.why.place, r.why.target] : [])}</span></span>`;
      return url ? `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a></li>` : `<li><span class="nolink">${inner}</span></li>`;
    }).join("");
    const target = ev.target ? `<p class="hit-target">${targetIcon(ev.target)}<span>Hit: ${esc(TARGETS[ev.target].label)} <span class="muted">(from the headlines)</span></span></p>` : "";
    const sourcesLabel = ev.source_count === 1 ? "1 source" : `${ev.source_count} independent sources`;
    card.innerHTML = `<div class="top"><div><p class="kicker ${corroborated ? "multi" : "one"}">${typeIcons(ev)}${typeLabel(ev)}${ev.combined ? " (combined attack)" : ""} · ${sourcesLabel}</p><h2>${esc(ev.location_name)}</h2></div>${close}</div>
      <div class="body"><p class="muted">${esc(ev.country)}</p>${target}
      <p class="meta">${formatUtc(ev.last_updated)} · ${formatLocal(ev.last_updated)} <span class="muted">(when reported)</span></p>
      ${whyHtml(ev)}
      <ul class="reports">${reports}</ul>
      <a class="search" href="${esc(xSearchUrl(ev.location_name, ev.event_type))}" target="_blank" rel="noopener noreferrer">Latest posts on X →</a></div>`;
  }
  card.hidden = false;
  writeHash();
}

// A headline with the words the rules matched highlighted (escaped; first match of each term).
function markTerms(title, terms) {
  const ranges = [];
  const lower = title.toLowerCase();
  for (const term of new Set(terms.filter(Boolean))) {
    const at = lower.indexOf(term.toLowerCase());
    if (at >= 0 && !ranges.some(([s, e]) => at < e && at + term.length > s)) ranges.push([at, at + term.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "";
  let pos = 0;
  for (const [s, e] of ranges) {
    out += esc(title.slice(pos, s)) + `<mark>${esc(title.slice(s, e))}</mark>`;
    pos = e;
  }
  return out + esc(title.slice(pos));
}

function weakReason(ev) {
  return ev.reports.every((r) => r.social && !r.wire) ? "Single social-media source" : "Only a whole country is named";
}

const PRECISION_TEXT = { city: "city, ±10 km", region: "region, ±100 km", country: "whole country, ±300 km" };

// "Why this is on the map": the words behind the type, place, target and source count.
function whyHtml(ev) {
  const quote = (s) => `“${esc(s)}”`;
  const lines = [];
  // One line per kind: a combined attack explains each weapon.
  for (const type of ev.combined ? ev.weapons : [ev.event_type]) {
    const typeR = ev.reports.find((r) => r.type === type && r.why);
    if (typeR) lines.push(`<li><b>${typeIcon(type)}${TYPE_LABEL[type]}</b> <span>because ${esc(typeR.source)} wrote ${quote(typeR.why.type)}</span></li>`);
  }
  if (ev.combined) lines.push(`<li class="once">Different weapons reported in the same city within 3 hours count as one combined attack.</li>`);
  if (ev.when) {
    const w = ev.when;
    const r = ev.reports.find((x) => x.when && x.when.from === w.from);
    lines.push(`<li><b>When</b> <span>${esc(w.label)} (estimated from ${esc(r ? r.source : "a headline")}'s wording: between ${formatUtc(w.from)} and ${formatUtc(w.to)}${new Date(w.from).toISOString().slice(0, 10) !== new Date(w.to).toISOString().slice(0, 10) ? ", across two days" : ""})</span></li>`);
  }
  const placeR = ev.reports.find((r) => r.placeName === ev.location_name && r.why);
  if (placeR) {
    const words = placeR.why.cue === "'s" ? `${placeR.why.place}'s` : placeR.why.cue ? `${placeR.why.cue} ${placeR.why.place}` : placeR.why.place;
    lines.push(`<li><b>${esc(ev.location_name)}</b> <span>(${PRECISION_TEXT[ev.precision]}) because of ${quote(words)}</span></li>`);
  }
  const targetR = ev.target && ev.reports.find((r) => r.target === ev.target && r.why && r.why.target);
  if (targetR) lines.push(`<li><b>${targetIcon(ev.target)}${esc(TARGETS[ev.target].label)}</b> <span>because of ${quote(targetR.why.target)}</span></li>`);
  // Sources: how the headlines were counted.
  const headlines = ev.reports.length;
  let sources = `<b>${ev.source_count === 1 ? "1 source" : `${ev.source_count} independent sources`}</b> <span>from ${headlines} ${headlines === 1 ? "headline" : "headlines"}`;
  sources += ev.outlet_count !== headlines ? ` by ${ev.outlet_count} ${ev.outlet_count === 1 ? "outlet" : "outlets"}` : "";
  sources += "</span>";
  const once = ev.groups
    .filter((g) => g.reasons.size && new Set(g.reports.map((r) => r.source)).size > 1)
    .map((g) => `<li class="once">Counted once: ${esc([...new Set(g.reports.map((r) => r.source))].join(", "))} <span>(${esc([...g.reasons].join("; "))})</span></li>`);
  lines.push(`<li>${sources}</li>`, ...once);
  if (ev.satellite) {
    const s = ev.satellite;
    lines.push(`<li><b>${svgIcon(SATELLITE_ICON)}Satellite heat</b> <span>detected ${s.km.toFixed(1)} km away at ${formatUtc(s.time)} (NASA FIRMS). It may be unrelated: industry and farm fires show up too.</span></li>`);
  }
  if (ev.weak) {
    lines.push(offMap(ev)
      ? `<li class="once">${weakReason(ev)}, and no second source within ${WEAK_HOURS} hours, so it's off the map (still listed here).</li>`
      : `<li class="once">${weakReason(ev)}, so it's shown faintly; it leaves the map if no second source confirms within ${WEAK_HOURS} hours.</li>`);
  }
  return `<div class="why"><p class="why-title">Why this is on the map</p><ul>${lines.join("")}</ul></div>`;
}
