import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink, MapPin, Radio, X } from "lucide-react";
import {
  EVENT_TYPES,
  FEATURED_PLACES,
  formatLocal,
  formatUtc,
  relativeTime,
  type EventType,
  type FeaturedPlace,
  type IngestMode,
  type KineticEvent,
} from "@/data/kinetic";
import type { GlobeHandle, Pick } from "@/globe/mount-globe";

type Conn = "live" | "reconnecting" | "mock";

type Selection = { kind: "place" | "event"; id: string } | null;

const TYPE_LABEL: Record<EventType, string> = {
  airstrike: "Airstrike",
  missile: "Missile",
  explosion: "Explosion",
  shelling: "Shelling",
  drone: "Drone",
  other: "Other",
};

function passes(
  event: KineticEvent,
  enabled: Record<EventType, boolean>,
  corroboratedOnly: boolean,
) {
  if (!enabled[event.event_type]) return false;
  if (corroboratedOnly && event.status !== "corroborated") return false;
  return true;
}

export function MeridianApp() {
  const stageRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeHandle | null>(null);
  const flashRef = useRef(new Set<string>());
  const [events, setEvents] = useState<KineticEvent[]>([]);
  const [mode, setMode] = useState<IngestMode>("mock");
  const [conn, setConn] = useState<Conn>("reconnecting");
  const [hover, setHover] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [cardOn, setCardOn] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [placesOpen, setPlacesOpen] = useState(true);
  const [feedOpen, setFeedOpen] = useState(true);
  const [sheet, setSheet] = useState<"places" | "feed">("feed");
  const [sheetOpen, setSheetOpen] = useState(true);
  const [enabled, setEnabled] = useState<Record<EventType, boolean>>({
    airstrike: true,
    missile: true,
    explosion: true,
    shelling: true,
    drone: true,
    other: true,
  });
  const [corroboratedOnly, setCorroboratedOnly] = useState(false);
  const [flashTick, setFlashTick] = useState(0);
  const [ready, setReady] = useState(false);

  const onPickRef = useRef<(pick: Pick) => void>(() => undefined);
  const onHoverRef = useRef<(pick: Pick | null) => void>(() => undefined);

  const filtered = useMemo(
    () =>
      events
        .filter((event) => passes(event, enabled, corroboratedOnly))
        .sort((a, b) => Date.parse(b.last_updated) - Date.parse(a.last_updated)),
    [events, enabled, corroboratedOnly],
  );
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const parent = stageRef.current;
    const arrows = arrowRef.current;
    if (!parent || !arrows) return;
    let dead = false;
    let handle: GlobeHandle | null = null;
    void import("@/globe/mount-globe").then(({ mountGlobe }) => {
      if (dead) return;
      handle = mountGlobe(parent, arrows, {
        onPick: (pick) => onPickRef.current(pick),
        onHover: (pick) => onHoverRef.current(pick),
      });
      globeRef.current = handle;
      handle.sync(filteredRef.current, new Set());
      setReady(true);
    });
    return () => {
      dead = true;
      handle?.dispose();
      globeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const flashes = flashRef.current;
    flashRef.current = new Set();
    globeRef.current?.sync(filtered, flashes);
  }, [filtered, flashTick, ready]);

  useEffect(() => {
    globeRef.current?.setHover(hover);
  }, [hover, ready]);

  useEffect(() => {
    const source = new EventSource("/events");
    const mark = () => {
      if (source.readyState === EventSource.OPEN) return;
      setConn("reconnecting");
    };
    source.addEventListener("snapshot", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as {
        mode: IngestMode;
        events: KineticEvent[];
      };
      setMode(data.mode);
      setConn(data.mode === "mock" ? "mock" : "live");
      setEvents(data.events);
    });
    source.addEventListener("mode", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { mode: IngestMode };
      setMode(data.mode);
      setConn(data.mode === "mock" ? "mock" : "live");
    });
    source.addEventListener("upsert", (ev) => {
      const event = JSON.parse((ev as MessageEvent).data) as KineticEvent;
      setEvents((prev) => {
        const idx = prev.findIndex((row) => row.id === event.id);
        if (idx === -1) {
          flashRef.current.add(event.id);
          return [event, ...prev].slice(0, 200);
        }
        const prior = prev[idx];
        if (prior && prior.status !== "corroborated" && event.status === "corroborated") {
          flashRef.current.add(event.id);
        }
        const next = prev.slice();
        next[idx] = event;
        return next;
      });
      setFlashTick((tick) => tick + 1);
    });
    source.addEventListener("remove", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { id: string };
      setEvents((prev) => prev.filter((row) => row.id !== data.id));
    });
    source.onerror = () => {
      setConn("reconnecting");
    };
    source.onopen = () => {
      mark();
    };
    return () => source.close();
  }, []);

  function focusOn(lat: number, lng: number, next: Selection) {
    setSelection(next);
    setCardOn(false);
    globeRef.current?.focus(lat, lng, () => setCardOn(true));
  }

  onPickRef.current = (pick) => {
    if (pick.kind === "place") {
      const place = FEATURED_PLACES.find((row) => row.id === pick.id);
      if (!place) return;
      focusOn(place.lat, place.lng, { kind: "place", id: place.id });
      return;
    }
    const event = events.find((row) => row.id === pick.id);
    if (!event) return;
    focusOn(event.lat, event.lng, { kind: "event", id: event.id });
  };

  onHoverRef.current = (pick) => {
    setHover(pick ? pick.id : null);
  };

  const selectedPlace =
    selection?.kind === "place"
      ? FEATURED_PLACES.find((place) => place.id === selection.id)
      : undefined;
  const selectedEvent =
    selection?.kind === "event" ? events.find((event) => event.id === selection.id) : undefined;

  const filters = (
    <FilterBar
      enabled={enabled}
      corroboratedOnly={corroboratedOnly}
      onToggleType={(type) => setEnabled((prev) => ({ ...prev, [type]: !prev[type] }))}
      onToggleCorroborated={() => setCorroboratedOnly((value) => !value)}
    />
  );

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <div ref={stageRef} className="absolute inset-0 touch-none" />
      <div ref={arrowRef} className="pointer-events-none absolute inset-0 z-10" />

      <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2">
        <StatusPill conn={conn} mode={mode} />
      </div>

      <aside
        className={`${placesOpen ? "w-72" : "w-12"} fixed top-4 bottom-14 left-4 z-20 hidden flex-col overflow-hidden rounded-md border border-line bg-surface/95 md:flex`}
      >
        <PanelHead
          title="Featured locations"
          open={placesOpen}
          onToggle={() => setPlacesOpen((value) => !value)}
          icon={<MapPin className="size-4" aria-hidden />}
        />
        {placesOpen ? (
          <PlaceList
            hover={hover}
            selected={selectedPlace?.id ?? null}
            onHover={setHover}
            onSelect={(place) => focusOn(place.lat, place.lng, { kind: "place", id: place.id })}
          />
        ) : null}
      </aside>

      <aside
        className={`${feedOpen ? "w-80" : "w-12"} fixed top-4 right-4 bottom-14 z-20 hidden flex-col overflow-hidden rounded-md border border-line bg-surface/95 md:flex`}
      >
        <PanelHead
          title="Live feed"
          open={feedOpen}
          onToggle={() => setFeedOpen((value) => !value)}
          icon={<Radio className="size-4" aria-hidden />}
        />
        {feedOpen ? (
          <>
            {filters}
            <FeedList
              events={filtered}
              now={now}
              hover={hover}
              selected={selectedEvent?.id ?? null}
              mode={mode}
              onHover={setHover}
              onSelect={(event) => focusOn(event.lat, event.lng, { kind: "event", id: event.id })}
            />
          </>
        ) : null}
      </aside>

      <section className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface md:hidden">
        <p className="px-3 pt-2 text-center text-xs text-pretty text-muted">
          Unverified social media reports. Not for operational use.
        </p>
        <div className="grid grid-cols-2">
          <SheetTab
            label="Places"
            active={sheet === "places"}
            onClick={() => {
              if (sheet === "places") setSheetOpen((value) => !value);
              else {
                setSheet("places");
                setSheetOpen(true);
              }
            }}
          />
          <SheetTab
            label="Feed"
            active={sheet === "feed"}
            onClick={() => {
              if (sheet === "feed") setSheetOpen((value) => !value);
              else {
                setSheet("feed");
                setSheetOpen(true);
              }
            }}
          />
        </div>
        {sheetOpen ? (
          <div className="max-h-[46vh] overflow-y-auto">
            {sheet === "places" ? (
              <PlaceList
                hover={hover}
                selected={selectedPlace?.id ?? null}
                onHover={setHover}
                onSelect={(place) => focusOn(place.lat, place.lng, { kind: "place", id: place.id })}
              />
            ) : (
              <>
                {filters}
                <FeedList
                  events={filtered}
                  now={now}
                  hover={hover}
                  selected={selectedEvent?.id ?? null}
                  mode={mode}
                  onHover={setHover}
                  onSelect={(event) =>
                    focusOn(event.lat, event.lng, { kind: "event", id: event.id })
                  }
                />
              </>
            )}
          </div>
        ) : null}
      </section>

      <p className="pointer-events-none fixed inset-x-0 bottom-3 z-20 hidden text-center text-xs text-pretty text-muted md:block">
        Unverified social media reports. Not for operational use.
      </p>

      {cardOn && selectedPlace ? (
        <InfoCard title={selectedPlace.name} kicker="Featured location" onClose={() => setCardOn(false)}>
          <p className="text-sm text-pretty text-muted">{selectedPlace.description}</p>
          <p className="mt-3 font-mono text-xs text-muted tabular-nums">
            {selectedPlace.lat.toFixed(2)}°, {selectedPlace.lng.toFixed(2)}°
          </p>
        </InfoCard>
      ) : null}

      {cardOn && selectedEvent ? (
        <EventCard event={selectedEvent} onClose={() => setCardOn(false)} />
      ) : null}
    </div>
  );
}

function StatusPill({ conn, mode }: { conn: Conn; mode: IngestMode }) {
  const label = conn === "reconnecting" ? "Reconnecting" : conn === "mock" ? "Mock" : "Live";
  const dot =
    conn === "mock" ? "bg-amber" : conn === "live" ? "bg-sky" : "bg-muted";
  const detail =
    conn === "mock"
      ? "Simulated reports. No API keys in use."
      : mode === "search"
        ? "Connected. Ingest is polling recent search."
        : conn === "live"
          ? "Connected to the event stream."
          : "Reconnecting to the event stream.";
  return (
    <div
      title={detail}
      className="pointer-events-auto flex items-center gap-2 rounded-md border border-line bg-surface/95 px-3 py-2 font-mono text-xs tracking-wide text-fg uppercase"
    >
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      {label}
    </div>
  );
}

function PanelHead({
  title,
  open,
  onToggle,
  icon,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-2 py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-sky hover:bg-surface-2"
      >
        {icon}
        <span className="sr-only">{open ? `Collapse ${title}` : `Expand ${title}`}</span>
      </button>
      {open ? (
        <div className="min-w-0">
          {title === "Featured locations" ? (
            <p className="font-mono text-xs tracking-widest text-amber">MERIDIAN</p>
          ) : null}
          <h2 className="text-sm font-semibold tracking-tight text-balance">{title}</h2>
        </div>
      ) : null}
    </div>
  );
}

function PlaceList({
  hover,
  selected,
  onHover,
  onSelect,
}: {
  hover: string | null;
  selected: string | null;
  onHover: (id: string | null) => void;
  onSelect: (place: FeaturedPlace) => void;
}) {
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {FEATURED_PLACES.map((place) => {
        const active = hover === place.id || selected === place.id;
        return (
          <li key={place.id}>
            <button
              type="button"
              onMouseEnter={() => onHover(place.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(place.id)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(place)}
              className={`flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 ${active ? "bg-surface-2" : ""}`}
            >
              <span className="size-2 shrink-0 rounded-full bg-sky" aria-hidden />
              <span>
                <span className="block text-sm">{place.name}</span>
                <span className="block font-mono text-xs text-muted tabular-nums">
                  {place.lat.toFixed(1)}°, {place.lng.toFixed(1)}°
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FeedList({
  events,
  now,
  hover,
  selected,
  mode,
  onHover,
  onSelect,
}: {
  events: KineticEvent[];
  now: number;
  hover: string | null;
  selected: string | null;
  mode: IngestMode;
  onHover: (id: string | null) => void;
  onSelect: (event: KineticEvent) => void;
}) {
  if (!events.length) {
    return (
      <p className="px-3 py-6 text-sm text-pretty text-muted">
        {mode === "mock" ? "Waiting for the next simulated report." : "No reports match these filters."}
      </p>
    );
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {events.map((event) => {
        const active = hover === event.id || selected === event.id;
        const corroborated = event.status === "corroborated";
        return (
          <li key={event.id}>
            <button
              type="button"
              onMouseEnter={() => onHover(event.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(event.id)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(event)}
              className={`flex min-h-11 w-full flex-col gap-1 border-b border-b-line px-3 py-2 text-left hover:bg-surface-2 ${
                corroborated ? "border-l-2 border-l-alert" : "border-l-2 border-l-amber"
              } ${active ? "bg-surface-2" : ""}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className={`font-mono text-xs tracking-wide uppercase ${corroborated ? "text-alert" : "text-amber"}`}
                >
                  {TYPE_LABEL[event.event_type]}
                </span>
                <span className="font-mono text-xs text-muted tabular-nums">
                  {relativeTime(event.last_updated, now)}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">
                  {event.location_name}
                  <span className="text-muted"> · {event.country}</span>
                </span>
                {event.source_count < 2 ? (
                  <span className="shrink-0 rounded-md border border-amber px-1.5 py-0.5 font-mono text-xs tracking-wide text-amber uppercase">
                    Unverified
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FilterBar({
  enabled,
  corroboratedOnly,
  onToggleType,
  onToggleCorroborated,
}: {
  enabled: Record<EventType, boolean>;
  corroboratedOnly: boolean;
  onToggleType: (type: EventType) => void;
  onToggleCorroborated: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
      {EVENT_TYPES.map((type) => {
        const on = enabled[type];
        return (
          <button
            key={type}
            type="button"
            aria-pressed={on}
            onClick={() => onToggleType(type)}
            className={`min-h-11 rounded-md border px-2 font-mono text-xs tracking-wide uppercase md:min-h-8 ${
              on ? "border-amber text-amber" : "border-line text-muted"
            }`}
          >
            {TYPE_LABEL[type]}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={corroboratedOnly}
        onClick={onToggleCorroborated}
        className={`min-h-11 rounded-md border px-2 font-mono text-xs tracking-wide uppercase md:min-h-8 ${
          corroboratedOnly ? "border-alert text-alert" : "border-line text-muted"
        }`}
      >
        Corroborated only
      </button>
    </div>
  );
}

function SheetTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 border-b-2 text-sm font-medium ${
        active ? "border-amber text-fg" : "border-transparent text-muted"
      }`}
    >
      {label}
    </button>
  );
}

function InfoCard({
  title,
  kicker,
  onClose,
  children,
}: {
  title: string;
  kicker: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <article className="fixed top-16 right-4 left-4 z-30 mx-auto max-w-sm rounded-md border border-line bg-surface p-4 md:top-auto md:bottom-16">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-wide text-sky uppercase">{kicker}</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-balance">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3">{children}</div>
    </article>
  );
}

function EventCard({ event, onClose }: { event: KineticEvent; onClose: () => void }) {
  const corroborated = event.status === "corroborated";
  return (
    <InfoCard
      title={event.location_name}
      kicker={`${TYPE_LABEL[event.event_type]} · ${corroborated ? "Corroborated" : "Unverified"}`}
      onClose={onClose}
    >
      <p className="text-sm text-muted">{event.country}</p>
      <p className="mt-2 font-mono text-xs text-fg tabular-nums">
        {formatUtc(event.last_updated)} · {formatLocal(event.last_updated)}
      </p>
      <p className="mt-1 font-mono text-xs text-muted tabular-nums">
        {event.source_count} {event.source_count === 1 ? "source" : "sources"} · confidence{" "}
        {Math.round(event.confidence * 100)}%
        {event.precision !== "city" ? ` · ${event.precision} ±${event.radius_km} km` : null}
      </p>
      <ul className="mt-3 flex flex-col gap-1">
        {event.post_urls.map((url, index) => (
          <li key={url}>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 text-sm text-sky"
            >
              <ExternalLink className="size-4" aria-hidden />
              Source {index + 1}
            </a>
          </li>
        ))}
      </ul>
    </InfoCard>
  );
}
