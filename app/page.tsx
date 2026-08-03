"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Showing = { id: string; date: string; time: string; source: "manual" };

const validDates = [
  "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26",
  "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16",
];
const rows = ["A", "B", "C", "D", "E", "F", "G", "H", "J"];
const seatNumbers = Array.from({ length: 14 }, (_, i) => i + 1);
const amcUrl = "https://www.amctheatres.com/movie-theatres/new-york-city/amc-lincoln-square-13/showtimes";

function labelDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}
function labelTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(`2026-01-01T${value}:00`));
}

export default function Home() {
  const [showings, setShowings] = useState<Showing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seat, setSeat] = useState<string | null>(null);
  const [date, setDate] = useState(validDates[0]);
  const [time, setTime] = useState("14:00");

  useEffect(() => {
    const saved = window.localStorage.getItem("odyssey-confirmed-showings");
    if (saved) setShowings(JSON.parse(saved));
  }, []);
  const save = (next: Showing[]) => { setShowings(next); window.localStorage.setItem("odyssey-confirmed-showings", JSON.stringify(next)); };
  const selected = showings.find((showing) => showing.id === selectedId) ?? null;
  const sorted = useMemo(() => [...showings].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)), [showings]);

  function addShowing(event: FormEvent) {
    event.preventDefault();
    const next = [...showings, { id: crypto.randomUUID(), date, time, source: "manual" }];
    save(next); setSelectedId(next[next.length - 1].id); setSeat(null);
  }
  function removeShowing(id: string) {
    save(showings.filter((showing) => showing.id !== id));
    if (selectedId === id) { setSelectedId(null); setSeat(null); }
  }

  return <main>
    <header className="hero">
      <div className="eyebrow"><span className="dot" /> PERSONAL DASHBOARD</div>
      <h1>Odyssey<br /><em>Seat Tracker</em></h1>
      <p>One ticket · AMC Lincoln Square 13 · IMAX 70mm only</p>
      <div className="date-range">AUG 21 — SEP 16, 2026 <span>·</span> AUG 27–30 EXCLUDED</div>
    </header>

    <section className="truth-card">
      <div><span className="status-label">LIVE AVAILABILITY</span><strong>Not connected</strong><p>No AMC API or approved data feed is configured. This dashboard never invents showtimes or seat availability.</p></div>
      <span className="chip">HONEST V1</span>
    </section>

    <section className="source-panel">
      <div><span className="section-kicker">CHECK SOURCE</span><h2>AMC Lincoln Square 13</h2><p>Use AMC to verify date, time, format, and seats; then save the confirmed showing here.</p></div>
      <a href={amcUrl} target="_blank" rel="noreferrer">Open AMC <span>↗</span></a>
    </section>

    <section className="add-panel">
      <div className="section-heading"><div><span className="section-kicker">STEP 1</span><h2>Add a confirmed showing</h2></div><span>Manual entry</span></div>
      <form onSubmit={addShowing}>
        <label>Date<select value={date} onChange={(e) => setDate(e.target.value)}>{validDates.map((value) => <option value={value} key={value}>{labelDate(value)}</option>)}</select></label>
        <label>AMC time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></label>
        <button type="submit">Save showing</button>
      </form>
      <p className="form-note">Only add performances labelled <b>IMAX 70mm</b> on AMC. Times stay on this device.</p>
    </section>

    <section className="showings">
      <div className="section-heading"><div><span className="section-kicker">STEP 2</span><h2>Confirmed showings</h2></div><span>{sorted.length} saved</span></div>
      {sorted.length === 0 ? <div className="empty"><b>No showings saved yet</b><p>Start with the AMC link above. The previous sample times were removed.</p></div> : <div className="showing-list">{sorted.map((showing) => <article key={showing.id} className={selectedId === showing.id ? "showing selected" : "showing"}><button className="showing-main" onClick={() => { setSelectedId(showing.id); setSeat(null); }}><span className="showing-date">{labelDate(showing.date)}</span><strong>{labelTime(showing.time)}</strong><small>IMAX 70mm · confirmed by you</small></button><button className="delete" onClick={() => removeShowing(showing.id)} aria-label={`Remove ${labelDate(showing.date)} ${labelTime(showing.time)}`}>×</button></article>)}</div>}
    </section>

    <section className="seat-panel">
      <div className="section-heading"><div><span className="section-kicker">STEP 3</span><h2>Seat preference guide</h2></div><span className="sample-chip">NOT AVAILABILITY</span></div>
      {selected ? <p className="map-context">For <b>{labelDate(selected.date)} · {labelTime(selected.time)}</b>. Compare these preferences against AMC’s live seat map.</p> : <p className="map-context">Select a saved showing to use this with AMC’s live seat map.</p>}
      <div className="screen">SCREEN</div>
      <div className="seat-map" role="grid" aria-label="Seat preference guide">{rows.map(row => <div className="seat-row" key={row}><span>{row}</span>{seatNumbers.map(n => { const id = `${row}${n}`; const excluded = row === "A" || row === "B"; const lower = row === "C"; const preferred = !excluded && !lower && n >= 5 && n <= 10; return <button key={id} disabled={!selected || excluded} onClick={() => setSeat(id)} className={`${excluded ? "avoid" : ""} ${lower ? "lower" : ""} ${preferred ? "preferred" : ""} ${seat === id ? "chosen" : ""}`} aria-label={`Row ${row}, seat ${n}`}>{n}</button>; })}</div>)}</div>
      <div className="legend"><span><i className="preferred-dot" /> Preferred: D–J center</span><span><i className="lower-dot" /> Lower priority: C</span><span><i className="avoid-dot" /> Exclude: A–B</span></div>
      <div className="selection">{seat ? <>Preference noted: <b>{seat}</b>. Now confirm it is available at AMC.</> : <>Availability is shown only by AMC; this map records your preference.</>}</div>
    </section>
    <footer>MANUAL CHECKING · DEVICE-LOCAL SAVED SHOWINGS · NO LIVE MONITORING</footer>
  </main>;
}
