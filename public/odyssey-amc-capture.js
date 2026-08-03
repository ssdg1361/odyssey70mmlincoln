/*
 * Run this only in a normal, user-controlled browser while on amctheatres.com.
 * Set window.ODYSSEY_COLLECTOR = { publishUrl, token } first. This script uses
 * ordinary same-origin page loads, rate limits itself, and stops on Queue-it or
 * CAPTCHA pages. It neither reads cookies nor attempts to solve/access-control
 * challenges.
 */
(() => {
  const config = window.ODYSSEY_COLLECTOR;
  const dates = [
    "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26",
    "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05",
    "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
    "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16",
  ];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const blocked = (text) => /queue-it|queueit|captcha|verify you are human|access denied/i.test(text);
  const normalise = (text) => text.replace(/\\\\"/g, '"').replace(/\\\\\\\\/g, "\\\\");
  const jsonBlock = (text, start) => {
    const open = text.indexOf("{", start);
    if (open < 0) return null;
    let quote = false, escape = false, depth = 0;
    for (let i = open; i < text.length; i += 1) {
      const char = text[i];
      if (quote) { if (escape) escape = false; else if (char === "\\\\") escape = true; else if (char === '"') quote = false; continue; }
      if (char === '"') quote = true;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) return text.slice(open, i + 1);
    }
    return null;
  };
  const seating = (html, id) => {
    const text = normalise(html);
    const marker = '"seatingLayout":';
    const object = jsonBlock(text, text.indexOf(marker));
    if (!object) throw new Error(`No rendered seating layout for ${id}.`);
    const layout = JSON.parse(object);
    if (!Array.isArray(layout.seats) || !layout.rows || !layout.columns) throw new Error(`Invalid rendered seating layout for ${id}.`);
    const around = text.slice(Math.max(0, text.indexOf(`"showtimeId":${id}`) - 1000), text.indexOf(`"showtimeId":${id}`) + 3000);
    const utc = around.match(/"showDateTimeUtc":"([^"]+)"/)?.[1];
    if (!utc) throw new Error(`No actual start time for ${id}.`);
    return { utc, rows: Number(layout.rows), columns: Number(layout.columns), seats: layout.seats.map((seat) => ({ available: Boolean(seat.available), row: Number(seat.row), column: Number(seat.column), name: String(seat.seatName ?? seat.name ?? ""), type: String(seat.type ?? "NotASeat") })) };
  };
  const idsOnListing = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const result = new Set();
    for (const link of doc.querySelectorAll('a[href*="/showtimes/"][href$="/seats"]')) {
      let area = link;
      let text = "";
      for (let level = 0; level < 6 && area; level += 1, area = area.parentElement) text += ` ${area.textContent || ""}`;
      const id = link.getAttribute("href")?.match(/\/showtimes\/(\d+)\/seats/)?.[1];
      if (id && /IMAX\s*70\s*MM/i.test(text)) result.add(id);
    }
    return [...result];
  };
  const fetchPage = async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    const text = await response.text();
    if (!response.ok) throw new Error(`AMC returned ${response.status} for ${url}`);
    if (blocked(text)) throw new Error("AMC displayed Queue-it, CAPTCHA, or another access-control page. Capture stopped; nothing was published.");
    return text;
  };
  if (!config?.publishUrl || !config?.token) throw new Error("Set window.ODYSSEY_COLLECTOR = { publishUrl: 'https://…/api/collector/publish', token: 'your private token' } before running this capture.");
  if (!/amctheatres\.com$/.test(location.hostname)) throw new Error("Open an ordinary AMC page first, then run this capture there.");
  (async () => {
    const snapshot = { version: 1, source: "normal_browser", checkedAt: new Date().toISOString(), showtimes: [], seatsByShowtime: {} };
    for (const listingDate of dates) {
      console.info(`[Odyssey collector] Reading AMC listing ${listingDate}`);
      const listing = await fetchPage(`/movies/the-odyssey-76238/showtimes?date=${listingDate}`);
      const ids = idsOnListing(listing);
      for (const id of ids) {
        await wait(1400);
        console.info(`[Odyssey collector] Reading seat map ${id}`);
        const layout = seating(await fetchPage(`/showtimes/${id}/seats`), id);
        snapshot.showtimes.push({ id: Number(id), listingDate, showDateTimeUtc: layout.utc, isSoldOut: false, purchaseUrl: `https://www.amctheatres.com/showtimes/${id}/seats` });
        snapshot.seatsByShowtime[id] = { rows: layout.rows, columns: layout.columns, seats: layout.seats, checkedAt: new Date().toISOString() };
      }
      await wait(1400);
    }
    snapshot.checkedAt = new Date().toISOString();
    const response = await fetch(config.publishUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` }, body: JSON.stringify(snapshot) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Tracker rejected the snapshot.");
    console.info("[Odyssey collector] Published", result);
  })().catch((error) => console.error("[Odyssey collector]", error.message || error));
})();
