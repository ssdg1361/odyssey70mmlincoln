"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type SourceState = "loading" | "snapshot" | "no_snapshot" | "api_error";
type Showtime = {
  id: number;
  performanceNumber: number;
  listingDate: string;
  showDateTimeLocal?: string;
  showDateTimeUtc?: string;
  isSoldOut: boolean;
  purchaseUrl: string;
};
type Seat = { available: boolean; row: number; column: number; name: string; type: string };
type SeatMap = { rows: number; columns: number; seats: Seat[]; checkedAt: string };

const REFERENCE_URL = "https://www.amctheatres.com/showtimes/145701522/seats";
const preferredRows = new Set(["D", "E", "F", "G", "H", "J"]);
const referenceRows = [
  ["A", 6, 33], ["B", 5, 35], ["C", 3, 38], ["D", 2, 41],
  ["E", 1, 42], ["F", 1, 42], ["G", 1, 42], ["H", 1, 42],
  ["J", 1, 42], ["K", 1, 42], ["L", 1, 42], ["M", 2, 39],
] as const;

function instant(showtime: Showtime) {
  const value = showtime.showDateTimeUtc ?? showtime.showDateTimeLocal ?? "";
  return new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}-04:00`);
}
function timeLabel(showtime: Showtime) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(instant(showtime));
}
function actualDateLabel(showtime: Showtime) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(instant(showtime));
}
function listingDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}
function checkedLabel(value?: string) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" }).format(new Date(value));
}
function isEarly(showtime: Showtime) {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZone: "America/New_York" }).formatToParts(instant(showtime));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 24);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 59);
  return hour < 10 || (hour === 10 && minute === 0);
}
function rowLetter(seat: Seat) {
  return seat.name.match(/^[A-Z]+/)?.[0] ?? "";
}

export default function Home() {
  const [state, setState] = useState<SourceState>("loading");
  const [message, setMessage] = useState("");
  const [showtimes, setShowtimes] = useState<Showtime[]>([]);
  const [checkedAt, setCheckedAt] = useState<string>();
  const [selected, setSelected] = useState<Showtime | null>(null);
  const [seatMap, setSeatMap] = useState<SeatMap | null>(null);
  const [seatLoading, setSeatLoading] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [newlyOpened, setNewlyOpened] = useState<Set<string>>(new Set());

  const loadShowtimes = useCallback(async () => {
    setState((current) => current === "snapshot" ? current : "loading");
    try {
      const response = await fetch("/api/amc/showtimes?v=1", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { setState(data.state ?? "api_error"); setMessage(data.message ?? "AMC connection failed"); return; }
      setState("snapshot"); setMessage(""); setShowtimes(data.showtimes ?? []); setCheckedAt(data.checkedAt);
      setSelected((current) => current ?? data.showtimes?.[0] ?? null);
    } catch {
      setState("api_error"); setMessage("The tracker could not reach its AMC connector.");
    }
  }, []);

  const loadSeats = useCallback(async (showtime: Showtime, quiet = false) => {
    if (!quiet) setSeatLoading(true);
    try {
      const params = new URLSearchParams({ showtimeId: String(showtime.id) });
      const response = await fetch(`/api/amc/seats?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { setMessage(data.message ?? "AMC seating request failed"); return; }
      const map: SeatMap = data;
      const storageKey = `odyssey-seats-${showtime.id}`;
      const previous: Record<string, boolean> = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      const current: Record<string, boolean> = {};
      const opened = new Set<string>();
      map.seats.forEach((seat) => {
        if (!seat.name || seat.type === "NotASeat") return;
        current[seat.name] = seat.available;
        if (Object.prototype.hasOwnProperty.call(previous, seat.name) && !previous[seat.name] && seat.available) opened.add(seat.name);
      });
      localStorage.setItem(storageKey, JSON.stringify(current));
      setNewlyOpened(opened); setSeatMap(map); setSelectedSeat(null); setMessage("");
    } catch {
      setMessage("The tracker could not refresh this seat map.");
    } finally { setSeatLoading(false); }
  }, []);

  useEffect(() => { loadShowtimes(); const timer = window.setInterval(loadShowtimes, 10 * 60_000); return () => clearInterval(timer); }, [loadShowtimes]);
  useEffect(() => {
    if (!selected || state !== "snapshot") { setSeatMap(null); return; }
    loadSeats(selected);
    const timer = window.setInterval(() => loadSeats(selected, true), 60_000);
    return () => clearInterval(timer);
  }, [selected, state, loadSeats]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Showtime[]>();
    showtimes.forEach((showtime) => groups.set(showtime.listingDate, [...(groups.get(showtime.listingDate) ?? []), showtime]));
    return Array.from(groups.entries());
  }, [showtimes]);
  const seatRows = useMemo(() => {
    if (!seatMap) return [];
    return Array.from({ length: seatMap.rows }, (_, index) => seatMap.seats.filter((seat) => seat.row === index + 1));
  }, [seatMap]);
  const eligibleCount = seatMap?.seats.filter((seat) => seat.available && seat.type === "CanReserve" && !["A", "B"].includes(rowLetter(seat))).length ?? 0;

  return <main>
    <header className="hero">
      <div className="eyebrow"><span className="dot" /> LIVE SEAT WATCH</div>
      <h1>Odyssey<br /><em>Seat Tracker</em></h1>
      <p>One ticket · AMC Lincoln Square 13 · IMAX 70mm only</p>
      <div className="date-range">AUG 21 — SEP 16, 2026 <span>·</span> AUG 27–30 EXCLUDED</div>
    </header>

    <section className={`status-card ${state}`}>
      <div><span className="status-label">AMC DATA SOURCE</span><strong>{state === "snapshot" ? "Snapshot available" : state === "loading" ? "Checking snapshot…" : state === "no_snapshot" ? "Awaiting first capture" : "Connection error"}</strong><p>{state === "snapshot" ? `${showtimes.length} eligible IMAX 70mm performance${showtimes.length === 1 ? "" : "s"} in the last ordinary-browser capture.` : message}</p></div>
      <div className="status-side"><span className="status-pill">{state === "snapshot" ? "CAPTURED" : state === "loading" ? "CHECKING" : "SETUP"}</span><small>Last captured<br />{checkedLabel(checkedAt)}</small></div>
    </section>

    {state === "no_snapshot" && <section className="setup-card"><span className="section-kicker">COLLECTOR REQUIRED</span><h2>Capture from normal AMC pages</h2><p>This dashboard uses a compact snapshot captured from AMC’s ordinary public pages in a normal browser. It does not use an AMC vendor key, invent showtimes, or bypass Queue-it/CAPTCHAs. The private collector token stays only in the capture setup.</p><div className="reference"><b>Verified parsing reference</b><span>AMC listing date Aug 22 · actual start Sun, Aug 23 at 2:00 AM · ID 145701522. The map preserves AMC’s real 42 × 12 geometry.</span><a href={REFERENCE_URL} target="_blank" rel="noreferrer">View at AMC</a></div></section>}

    <section className="showings">
      <div className="section-heading"><div><span className="section-kicker">PERFORMANCES</span><h2>Eligible showings</h2></div><button onClick={loadShowtimes} disabled={state === "loading"}>Refresh</button></div>
      {state === "snapshot" && showtimes.length === 0 && <div className="empty"><b>No eligible showings found</b><p>The last capture contained no IMAX 70mm performances in the tracked window.</p></div>}
      {state !== "snapshot" && <div className="empty"><b>Waiting for an AMC page capture</b><p>No substitute or fabricated showtimes are displayed.</p></div>}
      {state === "snapshot" && grouped.map(([date, dateShowtimes]) => <article className="day-card" key={date}><div className="day-label"><b>{listingDateLabel(date)}</b><small>AMC listing date</small></div><div className="times">{dateShowtimes.map((showtime) => { const chosen = selected?.id === showtime.id; return <button key={showtime.id} className={chosen ? "selected" : ""} onClick={() => setSelected(showtime)}><b>{timeLabel(showtime)}</b><span>{actualDateLabel(showtime)}</span>{isEarly(showtime) && <small>EARLY</small>}</button>; })}</div></article>)}
    </section>

    <section className="seat-panel">
      <div className="section-heading"><div><span className="section-kicker">LIVE AUDITORIUM</span><h2>{selected ? `${actualDateLabel(selected)} · ${timeLabel(selected)}` : "Select a showing"}</h2></div>{selected && <button onClick={() => loadSeats(selected)} disabled={seatLoading}>{seatLoading ? "Checking…" : "Refresh seats"}</button>}</div>
      {seatMap && <div className="map-stats"><span><b>{eligibleCount}</b> eligible open</span><span><b>{newlyOpened.size}</b> newly opened</span><span>Checked {checkedLabel(seatMap.checkedAt)}</span></div>}
      {!seatMap && <><p className="map-note">The verified Lincoln Square IMAX auditorium is 42 columns × 12 rows. Live colors appear after the AMC connection returns this performance’s seating layout.</p><ReferenceMap /></>}
      {seatMap && <div className="map-scroll"><div className="screen" style={{ width: seatMap.columns * 14 }}>SCREEN</div><div className="seat-map" style={{ width: seatMap.columns * 14 + 26 }}>{seatRows.map((row, index) => { const label = row.find((seat) => seat.name)?.name.match(/^[A-Z]+/)?.[0] ?? ""; return <div className="map-row" key={index}><span className="row-label">{label}</span><div className="seat-grid" style={{ gridTemplateColumns: `repeat(${seatMap.columns}, 12px)` }}>{row.filter((seat) => seat.type !== "NotASeat" && seat.name).map((seat) => { const letter = rowLetter(seat); const excluded = ["A", "B"].includes(letter); const lower = letter === "C"; const preferred = preferredRows.has(letter) && Math.abs(seat.column - (seatMap.columns + 1) / 2) <= 5; const open = seat.available && seat.type === "CanReserve"; const classes = ["seat", open ? "open" : "occupied", excluded ? "excluded" : "", lower ? "lower" : "", preferred ? "preferred" : "", seat.type === "Wheelchair" || seat.type === "Companion" ? "accessible" : "", newlyOpened.has(seat.name) ? "new" : "", selectedSeat === seat.name ? "chosen" : ""].join(" "); return <button key={seat.name} style={{ gridColumn: seat.column }} className={classes} disabled={!open || excluded} onClick={() => setSelectedSeat(seat.name)} aria-label={`${seat.name}: ${open ? "available" : "occupied"}`}>{seat.name.replace(letter, "")}</button>; })}</div></div>; })}</div></div>}
      <div className="legend"><span><i className="lg-preferred" /> Preferred center D–J</span><span><i className="lg-open" /> Eligible open</span><span><i className="lg-lower" /> Row C</span><span><i className="lg-occupied" /> Occupied</span><span><i className="lg-new" /> Newly opened</span></div>
      {selectedSeat && <div className="seat-choice"><b>{selectedSeat}</b> is open and meets your rules. <a href={selected?.purchaseUrl ?? REFERENCE_URL} target="_blank" rel="noreferrer">Book at AMC ↗</a></div>}
    </section>
    <footer>AMC PAGE SNAPSHOT · NO VENDOR KEY · ACCESS CONTROLS ARE NEVER BYPASSED</footer>
  </main>;
}

function ReferenceMap() {
  return <div className="map-scroll reference-map"><div className="screen" style={{ width: 42 * 14 }}>SCREEN</div><div className="seat-map" style={{ width: 42 * 14 + 26 }}>{referenceRows.map(([label, start, count]) => <div className="map-row" key={label}><span className="row-label">{label}</span><div className="seat-grid" style={{ gridTemplateColumns: "repeat(42, 12px)" }}>{Array.from({ length: count }, (_, index) => <i className="seat shell" style={{ gridColumn: start + index }} key={index} />)}</div></div>)}</div></div>;
}
