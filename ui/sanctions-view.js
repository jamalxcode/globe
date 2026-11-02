// Meridian, the Sanctions view. One of the page's scripts in ui/; they share one global scope and load in order
// (see index.html): core, feed, map, panels, sanctions-view, main.
"use strict";

// ---------- sanctions view ----------

let sanctionsData = null; // sanctions-data.json, or null if it isn't there
let sanctionsRequested = false;

async function loadSanctions() {
  sanctionsRequested = true;
  try {
    const res = await fetch(SANCTIONS_URL, { cache: "no-cache" });
    if (res.ok) sanctionsData = await res.json();
  } catch { /* the hand-set levels still show */ }
  paintSanctions();
  if (state.view === "sanctions") { updateStatus(); renderKey(); renderCard(); renderSanctionList(); }
}

// The map's name for a country, as the rest of the site writes it ("Dem. Rep. Congo" -> "DR Congo").
function countryLabel(name) {
  return (COUNTRY_ALIASES[name] || [name])[0];
}

function sanctionOf(name) {
  return SANCTION_REGION_INFO[name] ? MeridianSanctions.regionLevel(name, sanctionsData) : MeridianSanctions.levelOf(name, sanctionsData);
}

function levelKey(r) {
  if (!r) return "none";
  if (r.home) return "home";
  return r.level ? String(r.level) : "unknown";
}

function reasonOf(name, r = sanctionOf(name)) {
  return MeridianSanctions.reasonOf(name, sanctionsData, r);
}

function sanctionTitle(name, r) {
  if (!r) return countryLabel(name);
  if (SANCTION_REGION_INFO[name] && SANCTION_REGION_INFO[name].partial) return `${countryLabel(name)}: full embargo on the occupied part (hatched)`;
  if (r.home) return `${countryLabel(name)}: sets these sanctions`;
  const level = r.level ? MeridianSanctions.LABEL[r.level] : "no country program";
  const why = reasonOf(name, r);
  if (state.sColor === "reason") {
    if (!why) return `${countryLabel(name)}: ${level}, no clear reason`;
    if (why.auto) return `${countryLabel(name)}: ${level}. Listed here mostly for: ${MeridianSanctions.REASON[why.reason].label.toLowerCase()}`;
    return `${countryLabel(name)}: ${MeridianSanctions.REASON[why.reason].label} · ${level}`;
  }
  return `${countryLabel(name)}: ${level}${why && !why.auto ? ` · ${MeridianSanctions.REASON[why.reason].label}` : ""}`;
}

// Colors the countries (and the embargoed regions) for the Sanctions view, or clears them. data-level and
// data-reason drive the colors (style.css); data-program marks countries with a program of their own, which
// the Reason colors show at full strength.
function paintSanctions() {
  const on = state.view === "sanctions";
  document.body.classList.toggle("s-reason", state.sColor === "reason");
  countriesG.selectAll("path.country")
    .each(function (d) {
      const r = on ? sanctionOf(d.properties.name) : null;
      const why = r ? reasonOf(d.properties.name, r) : null;
      d3.select(this)
        .attr("data-level", on ? levelKey(r) : null)
        .attr("data-reason", why ? why.reason : null)
        .attr("data-program", r && r.level && r.level <= 3 ? "" : null);
    })
    .select("title").text((d) => (on ? sanctionTitle(d.properties.name, sanctionOf(d.properties.name)) : countryLabel(d.properties.name)));
  regionsG.selectAll("path")
    .attr("data-level", (d) => levelKey(sanctionOf(d.properties.name)))
    .attr("data-reason", (d) => { const w = reasonOf(d.properties.name); return w ? w.reason : null; })
    .attr("data-program", "")
    .attr("data-partial", (d) => (SANCTION_REGION_INFO[d.properties.name].partial ? "" : null))
    .style("display", (d) => (sanctionOf(d.properties.name) ? null : "none"))
    .select("title").text((d) => sanctionTitle(d.properties.name, sanctionOf(d.properties.name)));
  renderSanctionLegend();
  drawExportControls();
  renderSanctionList();
}

function showCountry(name) {
  state.selection = { kind: "country", id: name };
  state.cardOn = true;
  renderCard();
  renderSanctionList();
}

// d3 reads a ring's direction to tell inside from outside; a shape that would cover most of the globe is
// wound the other way round.
function rewind(feature) {
  if (d3.geoArea(feature) <= 2 * Math.PI) return feature;
  const coordinates = feature.geometry.coordinates.map((poly) => poly.map((ring) => ring.slice().reverse()));
  return { ...feature, geometry: { ...feature.geometry, coordinates } };
}

function levelSwatch(key) {
  return `<i class="lvl" data-level="${key}"></i>`;
}

const EC_TEXT = "Also under broad US export controls on technology (Commerce Department), which the level doesn't include.";

// The small "+" badge for countries also under broad export controls (on the map, and in the legend and card).
const EC_BADGE = '<i class="ec-badge" aria-hidden="true">+</i>';

function sanctionCardHtml(name, close) {
  const regionInfo = SANCTION_REGION_INFO[name];
  const r = sanctionOf(name) || MeridianSanctions.levelOf("Ukraine", sanctionsData);
  const level = r.level ? SANCTION_LEVELS.find((l) => l.level === r.level) : null;
  const entry = r.entry;
  const lines = [];
  if (r.home) {
    lines.push(`<p class="lvl-line">${levelSwatch("home")}<span><b>Sets these sanctions</b></span></p>`);
  } else if (level) {
    lines.push(`<p class="lvl-line">${levelSwatch(r.level)}<span><b>${esc(level.label)}</b> <span class="muted">· level ${r.level} of ${SANCTION_LEVELS.length}</span></span></p><p class="muted">${esc(level.text)}</p>`);
  }
  if (regionInfo && regionInfo.partial) lines.push(`<p class="s-flag">Only the Russian-occupied part of the region is under the embargo. The map hatches the whole region because the front line moves.</p>`);
  const why = reasonOf(name, r);
  const R = MeridianSanctions.REASON;
  const since = sanctionsData && sanctionsData.recent_since ? sanctionsData.recent_since.slice(0, 4) : null;
  if (why && !why.auto) {
    const second = why.reason2 ? `<span class="muted"> · also </span><span class="s-reason-name">${reasonSwatch(why.reason2)}${esc(R[why.reason2].label)}</span>` : "";
    lines.push(`<p class="s-reason-line"><span class="muted s-label">Main reason</span><span class="s-reason-name">${reasonSwatch(why.reason)}<b>${esc(R[why.reason].label)}</b></span>${second}</p><p class="muted s-small">${esc(R[why.reason].text)}</p>`);
  } else if (why) {
    // Not a reason for sanctioning the country: what the people, companies and ships here were recently listed for.
    lines.push(`<p class="s-reason-line"><span class="muted s-label">Listed here mostly for</span><span class="s-reason-name">${reasonSwatch(why.reason)}<b>${esc(R[why.reason].label)}</b></span></p>
      <p class="muted s-small">${Math.round(why.share * 100)}% of the ${why.recent.toLocaleString("en")} people, companies and ships based or flagged here that were listed since ${since}. ${esc(R[why.reason].text)}</p>`);
  } else if (NO_AUTO_REASON.includes(name) && !(r.level && r.level <= 3)) {
    lines.push(`<p class="muted s-small">No main reason is worked out for occupied, contested or partly recognized places: the listings here are mostly about the occupier or the conflict, not the people who live here.</p>`);
  }
  if (entry && entry.program && !r.lowered) lines.push(`<p class="s-prog"><span class="muted">Program</span> ${esc(entry.program)}</p>`);
  if (entry && entry.note) lines.push(`<p class="s-note">${esc(entry.note)} <span class="muted s-small">(as of ${formatDay(entry.checked || SANCTIONS_CHECKED)})</span></p>`);
  if (entry && entry.exportControls && !r.lowered) lines.push(`<p class="s-ec">${EC_BADGE}<span>${EC_TEXT}</span></p>`);
  if (entry && entry.eased && !r.lowered) lines.push(`<p class="s-flag">Eased recently; the level may change again.</p>`);
  if (r.lowered) lines.push(`<p class="s-flag">This country's program looks ended: its codes have been off OFAC's list and its page gone from OFAC's site for over ${LOWER_AFTER_DAYS} days. The level was lowered automatically from ${esc(MeridianSanctions.LABEL[r.lowered])} (level ${r.lowered}).</p>`);
  // Who is listed: people and companies with an address here, and ships flying its flag, by program.
  if (sanctionsData) {
    const counts = sanctionsData.countries[name];
    if (counts && counts.entities) {
      const fams = MeridianSanctions.families(counts).slice(0, 6)
        .map(([label, n]) => `<li><span>${esc(label)}</span><b>${n.toLocaleString("en")}</b></li>`).join("");
      const extra = [];
      if (counts.recent !== undefined && since) extra.push(`${counts.recent.toLocaleString("en")} listed since ${since}`);
      if (counts.month) extra.push(`${counts.month.toLocaleString("en")} in the last 30 days`);
      if (counts.ships) extra.push(`${counts.ships.toLocaleString("en")} ${counts.ships === 1 ? "ship" : "ships"} flying its flag`);
      lines.push(`<div class="why"><p class="why-title">On the US list, based or flagged here</p>
        <p class="s-count"><b>${counts.entities.toLocaleString("en")}</b> ${counts.entities === 1 ? "person, company or ship" : "people, companies and ships"}</p>
        ${extra.length ? `<p class="muted s-small">${extra.join(" · ")}</p>` : ""}
        <ul class="s-fams">${fams}</ul>
        <p class="muted s-small">By program; some are under several. ${r.level && r.level >= 3 ? "Being listed is about the person, company or ship, not the country." : ""}</p></div>`);
    } else if (!r.home) {
      lines.push(`<p class="muted s-small">Nobody on the US list has an address here, and no listed ship flies its flag.</p>`);
    }
  }
  const asOf = sanctionsData && sanctionsData.list_date ? ` OFAC's list as of ${formatDay(sanctionsData.list_date)}.` : "";
  lines.push(`<p class="muted s-small">Levels are this site's simplification of US programs, checked by hand on ${formatDay(SANCTIONS_CHECKED)}.${asOf} Not legal advice. UN and EU sanctions aren't included.</p>
    <a class="search" href="${OFAC_PROGRAMS_URL}" target="_blank" rel="noopener noreferrer">OFAC sanctions programs →</a>`);
  const kicker = regionInfo ? "US sanctions · region of Ukraine" : "US sanctions";
  return `<div class="top"><div><p class="kicker">${kicker}</p><h2>${esc(countryLabel(name))}</h2></div>${close}</div>
    <div class="body s-body">${lines.join("")}</div>`;
}

function reasonSwatch(id) {
  return `<i class="lvl" data-reason="${id}"></i>`;
}

// Legend for the current colors (Sanctions: levels; Reasons: reasons).
function renderSanctionLegend() {
  const reason = state.sColor === "reason";
  const items = reason
    ? SANCTION_REASONS.map((x) => `<li title="${esc(x.text)}">${reasonSwatch(x.id)}<span>${esc(x.label)}</span></li>`).join("")
    : SANCTION_LEVELS.map((l) => `<li title="${esc(l.text)}">${levelSwatch(l.level)}<span>${esc(l.label)}</span></li>`).join("");
  const ec = `<li title="${esc(EC_TEXT)}">${EC_BADGE}<span>Export controls too</span></li>`;
  document.querySelectorAll("[data-s-legend]").forEach((el) => { el.innerHTML = items + ec; });
  document.querySelectorAll("[data-s-legend-note]").forEach((el) => {
    el.innerHTML = reason
      ? `<b>Experimental. Results cannot be trusted.</b> Faded: no country program, but most of those listed there in the last ${RECENT_YEARS} years share one reason. Not legal advice.`
      : `<b>Experimental. Results cannot be trusted.</b> US sanctions, simplified, and may be out of date. Click a country for details. Not legal advice.`;
  });
}

function renderSanctionKey() {
  // Also here (not only in the status pill's tooltip), so it can be read on a phone.
  const checks = MeridianSanctions.needsCheck(sanctionsData);
  const pending = checks.length ? `<h2>Needs a look</h2><ul class="s-checks">${checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : "";
  const ch = sanctionsData && sanctionsData.changes;
  const changed = ch && ch.items.length
    ? `<h2>Changed since ${formatDay(ch.since)}</h2><ul class="s-changes">${ch.items.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
    : ch ? `<p class="key-note">No changes since ${formatDay(ch.since)}.</p>` : "";
  document.getElementById("key").innerHTML = `${pending}${changed}
    <h2>Sanctions: by level</h2>
    <ul class="s-key">${SANCTION_LEVELS.map((l) => `<li>${levelSwatch(l.level)}<span><b>${esc(l.label)}</b><br><span class="muted">${esc(l.text)}</span></span></li>`).join("")}
      <li>${levelSwatch("home")}<span><b>United States</b><br><span class="muted">Sets these sanctions.</span></span></li>
      <li>${EC_BADGE}<span><b>Export controls too</b><br><span class="muted">${esc(EC_TEXT)}</span></span></li></ul>
    <h2>Reasons: why</h2>
    <ul class="s-key">${SANCTION_REASONS.map((x) => `<li>${reasonSwatch(x.id)}<span><b>${esc(x.label)}</b><br><span class="muted">${esc(x.text)}</span></span></li>`).join("")}</ul>
    <p>Countries with a program of their own have a hand-set reason, at full color. Any other country is shown faded, and only when it's clear: at least ${REASON_MIN_RECENT} people, companies and ships based or flagged there were listed in the last ${RECENT_YEARS} years, and over ${Math.round(REASON_MIN_SHARE * 100)}% of them for one reason (once shown, it stays until it drops below ${Math.round(REASON_KEEP_SHARE * 100)}%). That's about who is listed there, not the country. Occupied, contested and partly recognized places (${NO_AUTO_REASON.map(countryLabel).join(", ")}) never get one.</p>
    <p>The levels are this site's simplification of the US Treasury's (OFAC) programs, checked by hand on ${formatDay(SANCTIONS_CHECKED)}. Crimea is under a full embargo; in Donetsk and Luhansk (hatched) only the occupied parts are.</p>
    <p>Counts come from OFAC's list, read daily: people and companies by address, ships by flag. A program country is lowered by itself only after its codes have been off the list and its page gone from OFAC's site for ${LOWER_AFTER_DAYS} days. The status pill turns amber when something needs a look, including a sudden burst of listings.</p>
    <p>UN and EU sanctions aren't shown. Not legal advice. Click a country, or find it in the Countries list, for details.</p>`;
}

// The Countries list (left panel, or the sheet on phones): program countries by level, then countries with a
// clear automatic reason, then the rest, filtered by the search box.
let sanctionQuery = "";

function renderSanctionList() {
  if (state.view !== "sanctions" || !world) return;
  const q = sanctionQuery.trim().toLowerCase();
  const names = [...countriesG.selectAll("path.country").data().map((d) => d.properties.name), ...Object.keys(SANCTION_REGION_INFO)];
  const rows = names.map((name) => {
    const r = sanctionOf(name);
    if (!r) return null;
    const why = reasonOf(name, r);
    const counts = sanctionsData && sanctionsData.countries[name];
    return { name, label: countryLabel(name), r, why, entities: counts ? counts.entities : 0 };
  }).filter((x) => x && (!q || x.label.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)));
  const group = (x) => (x.r.home ? 9 : x.r.level <= 3 ? x.r.level : x.why ? 4 : 5);
  rows.sort((a, b) => group(a) - group(b) || b.entities - a.entities || a.label.localeCompare(b.label));
  const heads = { 1: "Full embargo", 2: "Heavy", 3: "Targeted program", 4: "No program; listed here mostly for one reason", 5: "No country program", 9: "Sets the sanctions" };
  const R = MeridianSanctions.REASON;
  let html = "";
  let last = null;
  for (const x of rows) {
    const g = group(x);
    if (g !== last) { html += `<li class="s-head">${heads[g]}</li>`; last = g; }
    const swatch = state.sColor === "reason" ? (x.why ? reasonSwatch(x.why.reason) : levelSwatch("4")) : levelSwatch(levelKey(x.r));
    const meta = [x.why ? (x.why.auto ? `mostly ${R[x.why.reason].label.toLowerCase()}` : R[x.why.reason].label) : "", x.entities ? `${x.entities.toLocaleString("en")} listed` : ""].filter(Boolean).join(" · ");
    const active = state.selection && state.selection.kind === "country" && state.selection.id === x.name;
    html += `<li><button type="button" class="row s-row${active ? " active" : ""}" data-row-kind="country" data-row-id="${esc(x.name)}">
      ${swatch}<span><span class="name">${esc(x.label)}${x.r.entry && x.r.entry.exportControls && !x.r.lowered ? ` ${EC_BADGE}` : ""}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ""}</span></button></li>`;
  }
  if (!rows.length) html = `<li class="empty">No country matches “${esc(sanctionQuery)}”.</li>`;
  document.querySelectorAll("[data-s-list]").forEach((el) => setHTML(el, html));
}

// Zooms to a country (or region) and opens its card.
function focusCountry(name) {
  const feature = [...countriesG.selectAll("path.country").data(), ...regionsG.selectAll("path").data()].find((d) => d.properties.name === name);
  showCountry(name);
  if (!feature) return;
  const [[x0, y0], [x1, y1]] = geoPath.bounds(feature);
  // Big countries that cross the date line (Russia, the US) would zoom out; cap the box to something sensible.
  const kk = Math.max(1, Math.min(8, 0.6 / Math.max((x1 - x0) / W, (y1 - y0) / H)));
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const cx = W >= 1100 ? (14 * rem + W - 25 * rem) / 2 : W / 2;
  const cy = W < 768 ? H * 0.3 : H / 2;
  const t = d3.zoomIdentity.translate(cx - ((x0 + x1) / 2) * kk, cy - ((y0 + y1) / 2) * kk).scale(kk);
  const duration = reduceMotion ? 0 : 750;
  let settled = false;
  svg.interrupt().transition().duration(duration).ease(d3.easeCubicInOut).call(zoom.transform, t)
    .on("end interrupt", () => { settled = true; });
  // Animations pause in background tabs; jump there instead.
  setTimeout(() => { if (!settled) { svg.interrupt(); svg.call(zoom.transform, t); } }, duration + 150);
}

// Outlines a country while its row in the list is hovered.
function highlightCountry(name) {
  countriesG.selectAll("path.country").classed("hl", (d) => d.properties.name === name);
  regionsG.selectAll("path").classed("hl", (d) => d.properties.name === name);
}

// The "+" badges on countries also under broad export controls, at each country's middle.
function drawExportControls() {
  const marks = world && state.view === "sanctions"
    ? countriesG.selectAll("path.country").data().filter((d) => {
      const r = sanctionOf(d.properties.name);
      return r && r.entry && r.entry.exportControls && !r.lowered;
    })
    : [];
  ecG.selectAll("g.ec").data(marks, (d) => d.properties.name).join((enter) => {
    const g = enter.append("g").attr("class", "ec");
    g.append("circle");
    g.append("text").text("+");
    return g;
  }).attr("transform", (d) => `translate(${projection(d3.geoCentroid(d))})`);
  rescaleExportControls();
}

function rescaleExportControls() {
  const s = 1 / k;
  const r = W < 768 ? 5 : 7; // smaller on phones, where the map is small
  ecG.selectAll("g.ec").call((g) => g.select("circle").attr("r", r * s))
    .call((g) => g.select("text").attr("font-size", (r + 5) * s).attr("dy", (r * 0.6) * s));
}
