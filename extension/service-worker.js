const DATES = [
  "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26",
  "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05",
  "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
  "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16",
];
const ALARM = "odyssey-seat-monitor";

chrome.runtime.onInstalled.addListener(async () => {
  const { intervalMinutes } = await chrome.storage.local.get("intervalMinutes");
  await configureAlarm(intervalMinutes || 60);
  await setStatus({ state: "needs_setup", message: "Add the dashboard publishing token, then start monitoring." });
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) runMonitor(); });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "save_settings") {
    chrome.storage.local.set(message.settings).then(async () => { await configureAlarm(message.settings.intervalMinutes); await setStatus({ state: "ready", message: "Monitor scheduled." }); sendResponse({ ok: true }); });
    return true;
  }
  if (message.type === "run_now") { runMonitor().then(() => sendResponse({ ok: true })); return true; }
  if (message.type === "status") { chrome.storage.local.get("monitorStatus").then(({ monitorStatus }) => sendResponse(monitorStatus || { state: "needs_setup" })); return true; }
});

async function configureAlarm(minutes) { await chrome.alarms.clear(ALARM); chrome.alarms.create(ALARM, { periodInMinutes: Math.max(30, Number(minutes) || 60) }); }
async function setStatus(status) { await chrome.storage.local.set({ monitorStatus: { ...status, updatedAt: new Date().toISOString() } }); }
function waitForTab(tabId) { return new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("AMC page did not finish loading.")); }, 30_000);
  const listener = (id, info) => { if (id === tabId && info.status === "complete") { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
  chrome.tabs.onUpdated.addListener(listener);
}); }

async function runMonitor() {
  const { publishUrl, token } = await chrome.storage.local.get(["publishUrl", "token"]);
  if (!publishUrl || !token) return setStatus({ state: "needs_setup", message: "Add the dashboard publishing token before monitoring." });
  await setStatus({ state: "running", message: "Checking AMC in a temporary background tab…" });
  let tab;
  try {
    tab = await chrome.tabs.create({ url: `https://www.amctheatres.com/movies/the-odyssey-76238/showtimes?date=${DATES[0]}`, active: false });
    if (tab.status !== "complete") await waitForTab(tab.id);
    // MAIN world makes the requests behave like normal navigation from the
    // user's AMC tab, rather than an extension-origin scrape.
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: collectFromAmc, args: [DATES] });
    const snapshot = result.result;
    const response = await fetch(publishUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(snapshot) });
    const published = await response.json();
    if (!response.ok) {
      const detail = published.detail ? ` [showtimes: ${published.detail.showtimesReceived}/${published.detail.validShowtimes}; maps: ${published.detail.usableSeatMaps}; source: ${published.detail.source}]` : "";
      throw new Error((published.message || "Dashboard rejected the snapshot.") + detail);
    }
    await setStatus({ state: "ok", message: `Published ${published.performances} performance${published.performances === 1 ? "" : "s"}.`, checkedAt: snapshot.checkedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const accessBlocked = /^AMC_ACCESS_BLOCKED:/.test(message);
    await setStatus({ state: accessBlocked ? "action_required" : "error", message: accessBlocked ? "AMC displayed Queue-it/CAPTCHA/access control. Open AMC normally, complete any required step yourself, then use Run now." : message });
  } finally { if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {}); }
}

async function collectFromAmc(dates) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const blocked = (text) => /queue-it|queueit|captcha|verify you are human|access denied/i.test(text);
  const normalise = (text) => text.replaceAll('\\"', '"').replaceAll('\\\\', '\\');
  const jsonBlock = (text, start) => { const open = text.indexOf("{", start); if (open < 0) return null; let quote = false, escape = false, depth = 0; for (let i = open; i < text.length; i += 1) { const char = text[i]; if (quote) { if (escape) escape = false; else if (char === "\\") escape = true; else if (char === '"') quote = false; continue; } if (char === '"') quote = true; else if (char === "{") depth += 1; else if (char === "}" && --depth === 0) return text.slice(open, i + 1); } return null; };
  const fetchPage = async (url) => { const response = await fetch(url, { credentials: "same-origin" }); const text = await response.text(); if (!response.ok) throw new Error(`AMC request failed (${response.status}).`); if (blocked(text)) throw new Error("AMC_ACCESS_BLOCKED: AMC returned an access-control page."); return text; };
  const idsOnListing = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ids = new Set();
    // AMC's listing links point to /showtimes/{id}; its seat page is a
    // separate /showtimes/{id}/seats URL. The surrounding card carries format.
    for (const link of doc.querySelectorAll('a[href*="/showtimes/"]')) {
      // The closest labelled list item is the individual premium-format group.
      // Looking all the way up to the theatre container incorrectly labels its
      // separate plain-70mm performance as IMAX 70MM.
      const group = link.closest('li[role="listitem"][aria-label]');
      const text = `${group?.getAttribute("aria-label") || ""} ${group?.textContent || ""}`;
      const id = link.getAttribute("href")?.match(/\/showtimes\/(\d+)(?:\/seats)?(?:[?#]|$)/)?.[1];
      if (id && /IMAX\s*70\s*MM/i.test(text)) ids.add(id);
    }
    return [...ids];
  };
  const parseSeatPage = (html, id) => { const text = normalise(html); const layoutText = jsonBlock(text, text.indexOf('"seatingLayout":')); if (!layoutText) throw new Error(`No seating layout for ${id}.`); const layout = JSON.parse(layoutText); const position = text.indexOf(`"showtimeId":${id}`); const around = text.slice(Math.max(0, position - 1200), position + 3500); const utc = around.match(/"showDateTimeUtc":"([^"]+)"/)?.[1]; if (!utc || !Array.isArray(layout.seats)) throw new Error(`No usable showtime data for ${id}.`); return { utc, rows: Number(layout.rows), columns: Number(layout.columns), seats: layout.seats.map((seat) => ({ available: Boolean(seat.available), row: Number(seat.row), column: Number(seat.column), name: String(seat.seatName ?? seat.name ?? ""), type: String(seat.type ?? "NotASeat") })) }; };
  const snapshot = { version: 1, source: "chrome_extension", checkedAt: new Date().toISOString(), showtimes: [], seatsByShowtime: {} };
  for (const listingDate of dates) { const listing = await fetchPage(`/movies/the-odyssey-76238/showtimes?date=${listingDate}`); for (const id of idsOnListing(listing)) { await wait(1400); const layout = parseSeatPage(await fetchPage(`/showtimes/${id}/seats`), id); snapshot.showtimes.push({ id: Number(id), listingDate, showDateTimeUtc: layout.utc, isSoldOut: false, purchaseUrl: `https://www.amctheatres.com/showtimes/${id}/seats` }); snapshot.seatsByShowtime[id] = { rows: layout.rows, columns: layout.columns, seats: layout.seats, checkedAt: new Date().toISOString() }; } await wait(1400); }
  if (!snapshot.showtimes.length) throw new Error("No IMAX 70mm showtimes were found in AMC's rendered listings. No snapshot was published.");
  snapshot.checkedAt = new Date().toISOString(); return snapshot;
}
