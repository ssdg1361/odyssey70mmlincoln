"use client";

import { useMemo, useState } from "react";

type Showing = { date: string; day: string; times: string[] };

const showings: Showing[] = [
  { date: "AUG 21", day: "FRI", times: ["10:00 AM", "2:05 PM", "6:10 PM"] },
  { date: "AUG 22", day: "SAT", times: ["9:45 AM", "1:50 PM", "5:55 PM"] },
  { date: "AUG 23", day: "SUN", times: ["10:15 AM", "2:20 PM", "6:25 PM"] },
  { date: "AUG 24", day: "MON", times: ["11:00 AM", "3:05 PM"] },
  { date: "AUG 25", day: "TUE", times: ["10:30 AM", "2:35 PM", "6:40 PM"] },
  { date: "AUG 26", day: "WED", times: ["10:00 AM", "2:05 PM"] },
  { date: "AUG 31", day: "MON", times: ["10:20 AM", "2:25 PM"] },
  { date: "SEP 01", day: "TUE", times: ["10:00 AM", "2:05 PM", "6:10 PM"] },
  { date: "SEP 02", day: "WED", times: ["10:30 AM", "2:35 PM"] },
  { date: "SEP 03", day: "THU", times: ["10:00 AM", "2:05 PM"] },
  { date: "SEP 04", day: "FRI", times: ["9:45 AM", "1:50 PM", "5:55 PM"] },
  { date: "SEP 05", day: "SAT", times: ["10:15 AM", "2:20 PM", "6:25 PM"] },
  { date: "SEP 06", day: "SUN", times: ["10:00 AM", "2:05 PM", "6:10 PM"] },
  { date: "SEP 07", day: "MON", times: ["10:30 AM", "2:35 PM"] },
  { date: "SEP 08", day: "TUE", times: ["10:00 AM", "2:05 PM"] },
  { date: "SEP 09", day: "WED", times: ["10:20 AM", "2:25 PM"] },
  { date: "SEP 10", day: "THU", times: ["10:00 AM", "2:05 PM", "6:10 PM"] },
  { date: "SEP 11", day: "FRI", times: ["9:45 AM", "1:50 PM", "5:55 PM"] },
  { date: "SEP 12", day: "SAT", times: ["10:15 AM", "2:20 PM", "6:25 PM"] },
  { date: "SEP 13", day: "SUN", times: ["10:00 AM", "2:05 PM"] },
  { date: "SEP 14", day: "MON", times: ["10:30 AM", "2:35 PM"] },
  { date: "SEP 15", day: "TUE", times: ["10:00 AM", "2:05 PM"] },
  { date: "SEP 16", day: "WED", times: ["10:20 AM", "2:25 PM"] },
];

const rows = ["A", "B", "C", "D", "E", "F", "G", "H", "J"];
const seatNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const unavailable = new Set(["C3", "D7", "E6", "E7", "F8", "G5", "H10", "J2"]);

export default function Home() {
  const [selected, setSelected] = useState("AUG 21 · 10:00 AM");
  const [morning, setMorning] = useState(false);
  const [seat, setSeat] = useState<string | null>(null);
  const visible = useMemo(() => morning ? showings.map(s => ({ ...s, times: s.times.filter(t => /^(9:|10:)/.test(t)) })).filter(s => s.times.length) : showings, [morning]);

  return <main>
    <section className="hero">
      <div className="eyebrow"><span className="dot" /> PERSONAL DASHBOARD</div>
      <h1>Odyssey<br /><em>Seat Tracker</em></h1>
      <p>One seat. The best 70mm IMAX showing at Lincoln Square.</p>
      <div className="date-range">AUG 21 — SEP 16, 2026 <span>·</span> EXCLUDES AUG 27–30</div>
    </section>

    <section className="status-card">
      <div><span className="status-label">DATA SOURCE</span><strong>Not connected</strong><p>AMC availability is not being monitored yet.</p></div>
      <div className="status-side"><span className="chip muted">OFFLINE</span><small>Last checked<br />—</small></div>
    </section>

    <section className="intro">
      <div><span className="section-kicker">THE ODYSSEY</span><h2>AMC Lincoln Square 13</h2><p>IMAX 70mm only · 1 ticket</p></div>
      <div className="format">IMAX<br /><b>70MM</b></div>
    </section>

    <div className="preference"><span>PRIORITY</span><b>Earlier showtimes preferred</b><button className={morning ? "toggle on" : "toggle"} onClick={() => setMorning(!morning)} aria-label="Prioritize morning showtimes"><i /></button></div>

    <section className="showings"><div className="section-heading"><h2>Eligible showings</h2><span>{morning ? "10 AM & earlier" : "Aug 21 – Sep 16"}</span></div>
      <div className="showing-list">{visible.map((s) => <article className="day-card" key={s.date}><div className="day"><b>{s.day}</b><span>{s.date}</span></div><div className="times">{s.times.map(t => { const value = `${s.date} · ${t}`; const early = /^(9:|10:)/.test(t); return <button key={t} className={`${selected === value ? "selected " : ""}${early ? "early" : ""}`} onClick={() => { setSelected(value); setSeat(null); }}>{t}{early && <small>EARLY</small>}</button>; })}</div></article>)}</div>
    </section>

    <section className="seat-panel">
      <div className="seat-head"><div><span className="section-kicker">SELECTED PERFORMANCE</span><h2>{selected}</h2></div><span className="sample-chip">SAMPLE MAP</span></div>
      <p className="disclaimer">Illustrative layout only — connect an approved AMC data source to see live availability.</p>
      <div className="screen">SCREEN</div>
      <div className="seat-map" role="grid" aria-label="Sample seating map">{rows.map(row => <div className="seat-row" key={row}><span>{row}</span>{seatNumbers.map(n => { const id = `${row}${n}`; const bad = row === "A" || row === "B"; const lower = row === "C"; const taken = unavailable.has(id); const preferred = !bad && !lower && n >= 5 && n <= 10; return <button key={id} disabled={bad || taken} onClick={() => setSeat(id)} className={`${bad ? "avoid" : ""} ${lower ? "lower" : ""} ${preferred ? "preferred" : ""} ${taken ? "taken" : ""} ${seat === id ? "chosen" : ""}`} aria-label={`Row ${row}, seat ${n}`}>{n}</button>; })}</div>)}</div>
      <div className="legend"><span><i className="available" /> Eligible</span><span><i className="preferred-dot" /> Preferred</span><span><i className="avoid-dot" /> Avoid</span><span><i className="taken-dot" /> Unavailable</span></div>
      <div className="selection">{seat ? <>Seat <b>{seat}</b> is eligible in this sample layout.</> : <>Tap an eligible seat to preview your choice.</>}</div>
    </section>

    <section className="rules"><span className="section-kicker">SEAT RULES</span><div><p><b>Preferred</b>Rows D–J, centered seats</p><p><b>Lower priority</b>Row C</p><p><b>Exclude</b>Rows A & B</p></div></section>
    <footer>V1 DASHBOARD · MANUAL CHECKING · NO LIVE MONITORING</footer>
  </main>;
}
