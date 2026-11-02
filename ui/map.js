// Meridian, the map: markers, groups, zooming. One of the page's scripts in ui/; they share one global scope and load in order
// (see index.html): core, feed, map, panels, sanctions-view, main.
"use strict";

// ---------- map ----------

const mapEl = document.getElementById("map");
const svg = d3.select(mapEl).append("svg");
// Type icons (y-...) and target icons (t-...) as reusable symbols, drawn inside event markers.
svg.append("defs").selectAll("symbol")
  .data([...Object.entries(TYPE_ICONS).map(([k, d]) => [`y-${k}`, d]), ...Object.entries(TARGETS).map(([k, t]) => [`t-${k}`, t.d])])
  .join("symbol")
  .attr("id", ([id]) => id).attr("viewBox", "0 0 24 24")
  .append("path").attr("d", ([, d]) => d);
// Hatching for Donetsk and Luhansk, where only the occupied part is under the embargo: one per view's color.
for (const [id, color] of [["hatch-level", "var(--s1)"], ["hatch-reason", "var(--r-war)"]]) {
  const p = svg.select("defs").append("pattern").attr("id", id).attr("patternUnits", "userSpaceOnUse")
    .attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)");
  p.append("rect").attr("width", 6).attr("height", 6).attr("fill", "var(--land)");
  p.append("rect").attr("width", 3).attr("height", 6).style("fill", color);
}
const root = svg.append("g");
const sphereEl = root.append("path").attr("class", "sphere");
const graticuleEl = root.append("path").attr("class", "graticule");
const countriesG = root.append("g");
const regionsG = root.append("g").attr("class", "sanction-layer"); // embargoed regions (Sanctions view)
const bordersEl = root.append("path").attr("class", "borders");
const ecG = root.append("g").attr("class", "sanction-layer ec-layer"); // "+" badges: export controls too (Sanctions view)
const discsG = root.append("g").attr("class", "strike-layer");
const dotsG = root.append("g").attr("class", "strike-layer");
const clustersG = root.append("g").attr("class", "strike-layer");
const burstsG = root.append("g").attr("class", "strike-layer");

// Grouping: markers closer than CLUSTER_PX on screen merge into a numbered bubble, up to CLUSTER_MAX_K zoom.
const CLUSTER_PX = 26;
const CLUSTER_MAX_K = 6;
let clusterK = 0; // zoom level the groups were last made for
let clusters = new Map(); // id -> { events, x, y }

const projection = d3.geoEqualEarth();
const geoPath = d3.geoPath(projection);
let W = 1;
let H = 1;
let k = 1;
let world = null;

const zoom = d3.zoom()
  .scaleExtent([1, 60])
  .clickDistance(4)
  .on("zoom", (e) => {
    k = e.transform.k;
    root.attr("transform", e.transform);
    // Regroup once the zoom has changed enough for groups to split or merge.
    if (Math.abs(Math.log(k / (clusterK || k))) > 0.25) drawEvents();
    else rescale();
  })
  .on("end", () => { if (k !== clusterK) drawEvents(); writeHash(); });
svg.call(zoom).on("dblclick.zoom", null);

function layout() {
  W = mapEl.clientWidth || 1;
  H = mapEl.clientHeight || 1;
  const mobile = W < 768;
  const top = 56;
  const bottom = mobile ? Math.min(H * 0.5, 320) : 48;
  projection.fitExtent([[12, top], [W - 12, Math.max(top + 100, H - bottom)]], { type: "Sphere" });
  zoom.extent([[0, 0], [W, H]]).translateExtent([[-W * 0.25, -H * 0.25], [W * 1.25, H * 1.25]]);
  sphereEl.attr("d", geoPath({ type: "Sphere" }));
  graticuleEl.attr("d", geoPath(d3.geoGraticule10()));
  if (world) {
    countriesG.selectAll("path").attr("d", geoPath);
    regionsG.selectAll("path").attr("d", geoPath);
    bordersEl.attr("d", geoPath(world.borders));
  }
  drawExportControls();
  drawEvents();
}

function drawEvents() {
  const now = Date.now();
  const list = filtered().filter((d) => !offMap(d, now)).reverse(); // oldest first, so the newest draw on top
  // "one" = a single source (hollow, dashed), "multi" = two or more (solid): told apart by shape, not only color.
  const tone = (d) => (d.status === "corroborated" ? "multi" : "one");
  const hot = (d) => (state.hover === d.id || (state.selection && state.selection.id === d.id) ? " hot" : "");

  discsG.selectAll("path").data(list.filter((d) => d.precision !== "city"), (d) => d.id).join("path")
    .attr("data-kind", "event").attr("data-id", (d) => d.id)
    .attr("class", (d) => `disc ${tone(d)}${hot(d)}`)
    .attr("d", (d) => geoPath(d3.geoCircle().center([d.lng, d.lat]).radius(d.radius_km / 111.2)()))
    .style("opacity", (d) => fadeFor(d, now));

  // Group markers that would overlap at this zoom; the selected or hovered event always stays on its own.
  const { singles, groups } = groupMarkers(list);
  clustersG.selectAll("g.cluster").data(groups, (d) => d.id).join((enter) => {
    const g = enter.append("g").attr("data-kind", "cluster").attr("data-id", (d) => d.id);
    g.append("circle").attr("class", "core");
    g.append("text");
    g.append("circle").attr("class", "hit");
    g.append("title");
    return g;
  })
    .attr("class", (d) => `cluster ${d.events.some((e) => e.status === "corroborated") ? "multi" : "one"}`)
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .call((g) => g.select("text").text((d) => d.events.length))
    .call((g) => g.select("title").text((d) => clusterTitle(d)));

  // Every event gets a marker (at a disc's center for regions and countries): the event-type icon inside,
  // and a small badge with what was hit when the headlines say.
  dotsG.selectAll("g.dot").data(singles, (d) => d.id).join((enter) => {
    const g = enter.append("g").attr("data-kind", "event").attr("data-id", (d) => d.id);
    g.append("circle").attr("class", "halo");
    g.append("circle").attr("class", "core");
    g.append("use").attr("class", "glyph");
    g.append("circle").attr("class", "tbadge");
    g.append("use").attr("class", "tglyph");
    g.append("circle").attr("class", "hit");
    g.append("title");
    return g;
  })
    .attr("class", (d) => `dot ${tone(d)}${d.weak ? " weak" : ""}${hot(d)}`)
    .attr("transform", (d) => `translate(${projection([d.lng, d.lat])})`)
    .style("opacity", (d) => fadeFor(d, now))
    .call((g) => g.select(".glyph").attr("href", (d) => `#y-${d.event_type}`))
    .call((g) => g.select(".tglyph").attr("href", (d) => (d.target ? `#t-${d.target}` : null)))
    .call((g) => g.select("title").text((d) => `${d.location_name}: ${typeLabel(d)}${d.target ? ` · ${TARGETS[d.target].label}` : ""} · ${d.source_count} ${d.source_count === 1 ? "source" : "sources"}`))
    .order();
  rescale();
}

// Splits events into single markers and groups of markers that would overlap on screen at the current zoom.
function groupMarkers(list) {
  clusterK = k;
  clusters = new Map();
  if (k >= CLUSTER_MAX_K) return { singles: list, groups: [] };
  const size = CLUSTER_PX / k; // in map units, so the same on screen at any zoom
  const keep = (d) => state.hover === d.id || (state.selection && state.selection.id === d.id);
  const singles = [];
  // Each marker joins the nearest group whose center is closer than `size`, then groups that ended up
  // overlapping merge, until nothing is closer than `size`.
  let piles = [];
  for (const d of list) {
    if (keep(d)) { singles.push(d); continue; }
    const [x, y] = projection([d.lng, d.lat]);
    let near = null;
    let nearDist = size;
    for (const p of piles) {
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < nearDist) { near = p; nearDist = dist; }
    }
    if (near) {
      near.events.push(d);
      near.x += (x - near.x) / near.events.length;
      near.y += (y - near.y) / near.events.length;
    } else piles.push({ events: [d], x, y });
  }
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < piles.length && !merged; i++) {
      for (let j = i + 1; j < piles.length; j++) {
        const a = piles[i];
        const b = piles[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) >= size) continue;
        const n = a.events.length + b.events.length;
        a.x = (a.x * a.events.length + b.x * b.events.length) / n;
        a.y = (a.y * a.events.length + b.y * b.events.length) / n;
        a.events.push(...b.events);
        piles.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  const groups = [];
  for (const p of piles) {
    if (p.events.length === 1) { singles.push(p.events[0]); continue; }
    // Named after its members, so a group keeps its identity while it doesn't change.
    p.id = `c_${p.events.map((e) => e.id).sort()[0]}`;
    clusters.set(p.id, p);
    groups.push(p);
  }
  // Keep the oldest-first order for singles, so the newest draw on top.
  const order = new Map(list.map((d, i) => [d.id, i]));
  singles.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { singles, groups };
}

function clusterTitle(group) {
  const counts = new Map();
  for (const e of group.events) counts.set(typeLabel(e), (counts.get(typeLabel(e)) || 0) + 1);
  const kinds = [...counts].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n} ${label.toLowerCase()}`).join(", ");
  const places = [...new Set(group.events.map((e) => e.location_name))].slice(0, 4).join(", ");
  return `${group.events.length} events: ${kinds}. ${places}${group.events.length > 4 ? "…" : ""}. Click to zoom in.`;
}

// Zooms in on a group until its markers separate.
function zoomToCluster(id) {
  const group = clusters.get(id);
  if (!group) return;
  const pts = group.events.map((e) => projection([e.lng, e.lat]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-3);
  // Enough to spread the group over about 4 marker widths, at least 2.5x more than now.
  const kk = Math.min(60, Math.max(k * 2.5, (CLUSTER_PX * 4) / spread));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const t = d3.zoomIdentity.translate(W / 2 - cx * kk, H / 2 - cy * kk).scale(kk);
  svg.interrupt().transition().duration(reduceMotion ? 0 : 700).ease(d3.easeCubicInOut).call(zoom.transform, t);
}

// Markers keep the same size on screen at every zoom level.
function rescale() {
  const s = 1 / k;
  rescaleExportControls();
  clustersG.selectAll("g.cluster").each(function (d) {
    const r = Math.min(22, 12 + Math.sqrt(d.events.length) * 2.5) * s;
    const g = d3.select(this);
    g.select(".core").attr("r", r);
    g.select(".hit").attr("r", r + 3 * s);
    g.select("text").attr("font-size", 11.5 * s).attr("dy", 4 * s);
  });
  dotsG.selectAll("g.dot").each(function (d) {
    const big = state.hover === d.id || (state.selection && state.selection.id === d.id) ? 1.4 : 1;
    const r = 10.5 * s * big;
    const icon = 13 * s * big;
    const g = d3.select(this);
    g.select(".halo").attr("r", r + 5 * s);
    g.select(".core").attr("r", r);
    g.select(".glyph").attr("x", -icon / 2).attr("y", -icon / 2).attr("width", icon).attr("height", icon);
    // Target badge sits on the marker's top-right edge.
    const bx = r * 0.85;
    const by = -r * 0.85;
    const br = 7.5 * s * big;
    const bi = 10 * s * big;
    g.select(".tbadge").attr("cx", bx).attr("cy", by).attr("r", br).style("display", d.target ? null : "none");
    g.select(".tglyph").attr("x", bx - bi / 2).attr("y", by - bi / 2).attr("width", bi).attr("height", bi).style("display", d.target ? null : "none");
    g.select(".hit").attr("r", Math.max(r + 3 * s, 11 * s));
  });
}

function burst(ev) {
  if (reduceMotion) return;
  const [x, y] = projection([ev.lng, ev.lat]);
  const color = ev.status === "corroborated" ? "var(--multi)" : "var(--one)";
  const s = 1 / k;
  burstsG.append("circle").attr("class", "flash").attr("cx", x).attr("cy", y).attr("r", 4 * s)
    .style("fill", color).style("opacity", 0.9)
    .transition().duration(1200).ease(d3.easeCubicOut).attr("r", 22 * s).style("opacity", 0).remove();
  burstsG.append("circle").attr("class", "burst").attr("cx", x).attr("cy", y).attr("r", 3 * s)
    .style("stroke", color).style("opacity", 0.9)
    .transition().duration(2000).ease(d3.easeCubicOut).attr("r", 40 * s).style("opacity", 0).remove();
}

function focusOn(lat, lng, selection) {
  state.selection = selection;
  state.cardOn = false;
  render();
  const [x, y] = projection([lng, lat]);
  const current = d3.zoomTransform(svg.node());
  const kk = Math.max(current.k, 5);
  const mobile = W < 768;
  // Keep the marker clear of the info card: above it on phones, left of it on wide screens
  // (the card sits 22rem from the right edge and is 24rem wide; the left panel ends at 19rem).
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  let cx = W / 2;
  if (W >= 1100) {
    // With auto-hiding panels the card sits at the right edge unless the feed is out.
    const hiding = autoHide.matches;
    const placesOut = !hiding || document.getElementById("places-panel").classList.contains("open");
    const feedOut = !hiding || document.getElementById("feed-panel").classList.contains("open");
    const left = placesOut ? 14 * rem : 0;
    const cardLeft = W - (feedOut ? 46 : 25) * rem;
    cx = (left + cardLeft) / 2;
  }
  const cy = mobile ? H * 0.22 : W >= 1100 ? H / 2 : H * 0.3;
  const t = d3.zoomIdentity.translate(cx - x * kk, cy - y * kk).scale(kk);
  const duration = reduceMotion ? 0 : 900;
  const token = {};
  focusToken = token;
  const show = () => {
    if (focusToken !== token) return; // a newer pick took over
    focusToken = null;
    state.cardOn = true;
    renderCard();
  };
  svg.transition().duration(duration).ease(d3.easeCubicInOut).call(zoom.transform, t)
    .on("end", show).on("interrupt", show);
  // Animations pause in background tabs; open the card anyway.
  setTimeout(show, duration + 150);
}
let focusToken = null;

// Back to the whole world: close the info card and the Key, clear the selection, slide away side panels that
// aren't pinned, then zoom out.
function resetView() {
  focusToken = null;
  state.cardOn = false;
  state.selection = null;
  setKeyOpen(false);
  if (autoHide.matches) {
    for (const panel of document.querySelectorAll(".panel.open:not(.pinned)")) setPanelOpen(panel, false);
  }
  render();
  const duration = reduceMotion ? 0 : 750;
  let settled = false;
  svg.interrupt().transition().duration(duration).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity)
    .on("end interrupt", () => { settled = true; });
  // Animations pause in background tabs; jump there instead (unless the user grabbed the map meanwhile).
  setTimeout(() => {
    if (settled) return;
    svg.interrupt();
    svg.call(zoom.transform, d3.zoomIdentity);
  }, duration + 150);
}

function pick(kind, id) {
  if (kind === "country") { focusCountry(id); return; }
  if (kind === "place") {
    const place = FEATURED_PLACES.find((p) => p.id === id);
    if (place) focusOn(place.lat, place.lng, { kind, id });
  } else {
    const ev = state.events.find((e) => e.id === id);
    if (ev) focusOn(ev.lat, ev.lng, { kind, id });
  }
}

let hoverPopped = false; // the hovered event was pulled out of a group to show it

function setHover(id) {
  if (state.hover === id) return;
  state.hover = id;
  discsG.selectAll("path").classed("hot", (d) => d.id === id || (state.selection && state.selection.id === d.id));
  // An event hidden inside a group (hovered in the list) is pulled out while hovered, then put back.
  const grouped = !!id && [...clusters.values()].some((g) => g.events.some((e) => e.id === id));
  if (grouped || hoverPopped) drawEvents();
  else rescale();
  hoverPopped = grouped;
  document.querySelectorAll("[data-row-id]").forEach((el) => {
    el.classList.toggle("active", el.dataset.rowId === id || (state.selection && state.selection.id === el.dataset.rowId));
  });
}

svg.on("click", (e) => {
  const target = e.target.closest("[data-kind]");
  if (!target) return;
  if (target.dataset.kind === "country") { if (state.view === "sanctions") showCountry(target.dataset.id); }
  else if (target.dataset.kind === "cluster") zoomToCluster(target.dataset.id);
  else pick(target.dataset.kind, target.dataset.id);
});
svg.on("pointerover", (e) => {
  const target = e.target.closest("[data-kind]");
  setHover(target && target.dataset.kind !== "country" ? target.dataset.id : null);
});
svg.on("pointerleave", () => setHover(null));
