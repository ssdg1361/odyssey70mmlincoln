const DATES = [
  "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26",
  "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05",
  "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
  "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16",
];
const ALARM = "odyssey-seat-monitor";
const AMC_ORIGIN = "https://www.amctheatres.com";
const RUN_KEY = "monitorRun";

chrome.runtime.onInstalled.addListener(async () => {
  await ensureSchedule();
  await chrome.storage.local.remove(RUN_KEY);
  await setStatus({ state: "needs_setup", message: "Add the dashboard publishing token, then start monitoring." });
});
chrome.runtime.onStartup.addListener(recoverOnStartup);
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) startOrResumeMonitor(false); });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "save_settings") {
    chrome.storage.local.set(message.settings).then(async () => {
      await configureAlarm(message.settings.intervalMinutes);
      await setStatus({ state: "ready", message: "Monitor scheduled." });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "run_now") { startOrResumeMonitor(true).then(() => sendResponse({ ok: true })); return true; }
  if (message.type === "status") { chrome.storage.local.get("monitorStatus").then(({ monitorStatus }) => sendResponse(monitorStatus || { state: "needs_setup" })); return true; }
});
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  processCompletedNavigation(details).catch(failRun);
});
chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId !== 0) return;
  getRun().then((run) => { if (run?.running && run.tabId === details.tabId) failRun(new Error(`AMC navigation failed: ${details.error}`)); });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  getRun().then((run) => { if (run?.running && run.tabId === tabId) failRun(new Error("The AMC monitor tab was closed before the check finished."), false); });
});

async function ensureSchedule() {
  const { intervalMinutes } = await chrome.storage.local.get("intervalMinutes");
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) await configureAlarm(intervalMinutes || 60);
}
async function recoverOnStartup() {
  await ensureSchedule();
  const run = await getRun();
  if (!run?.running) return;
  const tab = await chrome.tabs.get(run.tabId).catch(() => null);
  if (!tab) {
    await chrome.storage.local.remove(RUN_KEY);
    await setStatus({ state: "error", message: "Chrome closed during the previous check. Use Run now to start a fresh check." });
    return;
  }
  await setStatus({ state: "running", message: "Resuming the AMC page interrupted by Chrome restart…", progress: progressLabel(run) });
  await chrome.tabs.update(run.tabId, { url: run.expectedUrl });
}
async function configureAlarm(minutes) {
  await chrome.alarms.clear(ALARM);
  chrome.alarms.create(ALARM, { periodInMinutes: Math.max(30, Number(minutes) || 60) });
}
async function setStatus(status) {
  await chrome.storage.local.set({ monitorStatus: { ...status, updatedAt: new Date().toISOString() } });
}
async function getRun() { return (await chrome.storage.local.get(RUN_KEY))[RUN_KEY] || null; }
async function saveRun(run) { await chrome.storage.local.set({ [RUN_KEY]: run }); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function listingUrl(date) { return `${AMC_ORIGIN}/movies/the-odyssey-76238/showtimes?date=${date}`; }
function seatUrl(id) { return `${AMC_ORIGIN}/showtimes/${id}/seats`; }
function isQueueUrl(url) { return /queue-it|queueit/i.test(url); }

async function startOrResumeMonitor(userInitiated) {
  const settings = await chrome.storage.local.get(["publishUrl", "token"]);
  if (!settings.publishUrl || !settings.token) return setStatus({ state: "needs_setup", message: "Add the dashboard publishing token before monitoring." });
  const existing = await getRun();
  if (existing?.running) return setStatus({ state: "running", message: "A monitor check is already in progress.", progress: progressLabel(existing) });
  if (existing?.paused && userInitiated) {
    const tab = await chrome.tabs.get(existing.tabId).catch(() => null);
    if (tab) {
      existing.running = true;
      existing.paused = false;
      await saveRun(existing);
      await setStatus({ state: "running", message: "Resuming the interrupted AMC page…", progress: progressLabel(existing) });
      await chrome.tabs.reload(existing.tabId);
      return;
    }
  }
  if (existing?.paused && !userInitiated) return;
  if (existing?.tabId) await chrome.tabs.remove(existing.tabId).catch(() => {});
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  const run = {
    id: crypto.randomUUID(), tabId: tab.id, running: true, paused: false,
    phase: "listing", dateIndex: 0, seatIndex: 0, showtimeQueue: [],
    snapshot: { version: 1, source: "chrome_extension", checkedAt: new Date().toISOString(), showtimes: [], seatsByShowtime: {} },
    expectedUrl: listingUrl(DATES[0]),
  };
  await saveRun(run);
  await setStatus({ state: "running", message: `Opening AMC listing ${DATES[0]}…`, progress: progressLabel(run) });
  await chrome.tabs.update(tab.id, { url: run.expectedUrl });
}

function progressLabel(run) {
  if (run.phase === "listing") return `Listings ${Math.min(run.dateIndex + 1, DATES.length)}/${DATES.length}`;
  return `Seat maps ${Math.min(run.seatIndex + 1, Math.max(1, run.showtimeQueue.length))}/${run.showtimeQueue.length}`;
}

async function processCompletedNavigation(details) {
  const run = await getRun();
  if (!run?.running || run.tabId !== details.tabId) return;
  if (isQueueUrl(details.url)) return pauseForAccessControl(run, "AMC/Queue-it waiting room");
  if (details.url === "about:blank" || details.url.startsWith("chrome://")) return;
  if (!details.url.startsWith(AMC_ORIGIN)) return pauseForAccessControl(run, `AMC redirected to ${new URL(details.url).hostname}`);
  await delay(900);

  if (run.phase === "listing") {
    const listing = await runScript(run.tabId, readRenderedListing);
    if (listing.blocked) return pauseForAccessControl(run, listing.blocked);
    if (listing.error) throw new Error(listing.error);
    if (DATES[run.dateIndex] === "2026-08-22" && !listing.showtimeIds.includes("145701522")) {
      throw new Error("AMC’s Aug 22 IMAX 70mm reference showing 145701522 was not present in the rendered listing.");
    }
    const known = new Set(run.showtimeQueue.map((item) => String(item.id)));
    for (const id of listing.showtimeIds) if (!known.has(String(id))) run.showtimeQueue.push({ id: Number(id), listingDate: DATES[run.dateIndex] });
    run.dateIndex += 1;
    if (run.dateIndex < DATES.length) {
      run.expectedUrl = listingUrl(DATES[run.dateIndex]);
      await saveRun(run);
      await setStatus({ state: "running", message: `Opening AMC listing ${DATES[run.dateIndex]}…`, progress: progressLabel(run) });
      await delay(1500);
      await chrome.tabs.update(run.tabId, { url: run.expectedUrl });
      return;
    }
    if (!run.showtimeQueue.length) throw new Error("AMC rendered no IMAX 70mm showtimes in the tracked window.");
    run.phase = "seats";
    run.seatIndex = 0;
    run.expectedUrl = seatUrl(run.showtimeQueue[0].id);
    await saveRun(run);
    await setStatus({ state: "running", message: `Opening AMC seat map ${run.showtimeQueue[0].id}…`, progress: progressLabel(run) });
    await delay(1500);
    await chrome.tabs.update(run.tabId, { url: run.expectedUrl });
    return;
  }

  const item = run.showtimeQueue[run.seatIndex];
  const map = await runScript(run.tabId, readRenderedSeatMap, [item.id]);
  if (map.blocked) return pauseForAccessControl(run, map.blocked);
  if (map.error) throw new Error(map.error);
  if (item.id === 145701522) {
    const referenceTime = new Date(map.showDateTimeUtc).toISOString();
    if (map.rows !== 12 || map.columns !== 42 || referenceTime !== "2026-08-23T06:00:00.000Z") {
      throw new Error("AMC’s reference 2:00 AM performance did not match the verified 42×12 auditorium and Aug 23 start time.");
    }
  }
  run.snapshot.showtimes.push({ id: item.id, listingDate: item.listingDate, showDateTimeUtc: map.showDateTimeUtc, isSoldOut: false, purchaseUrl: seatUrl(item.id) });
  run.snapshot.seatsByShowtime[String(item.id)] = { rows: map.rows, columns: map.columns, seats: map.seats, checkedAt: new Date().toISOString() };
  run.seatIndex += 1;
  if (run.seatIndex < run.showtimeQueue.length) {
    run.expectedUrl = seatUrl(run.showtimeQueue[run.seatIndex].id);
    await saveRun(run);
    await setStatus({ state: "running", message: `Opening AMC seat map ${run.showtimeQueue[run.seatIndex].id}…`, progress: progressLabel(run) });
    await delay(1500);
    await chrome.tabs.update(run.tabId, { url: run.expectedUrl });
    return;
  }
  await publishRun(run);
}

async function runScript(tabId, func, args = []) {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!injection?.result) throw new Error("Chrome did not return the rendered AMC page data.");
  return injection.result;
}
async function publishRun(run) {
  const { publishUrl, token } = await chrome.storage.local.get(["publishUrl", "token"]);
  run.snapshot.checkedAt = new Date().toISOString();
  const response = await fetch(publishUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(run.snapshot) });
  const published = await response.json();
  if (!response.ok) throw new Error(published.message || "Dashboard rejected the snapshot.");
  await chrome.storage.local.remove(RUN_KEY);
  await chrome.tabs.remove(run.tabId).catch(() => {});
  await setStatus({ state: "ok", message: `Published ${published.performances} performance${published.performances === 1 ? "" : "s"}.`, checkedAt: run.snapshot.checkedAt });
}
async function pauseForAccessControl(run, reason) {
  run.running = false;
  run.paused = true;
  await saveRun(run);
  await chrome.tabs.update(run.tabId, { active: true }).catch(() => {});
  await setStatus({ state: "action_required", message: `${reason}. Complete the visible AMC step in the open tab, then choose Run now to resume.`, progress: progressLabel(run) });
}
async function failRun(error, keepTab = true) {
  const run = await getRun();
  if (!run) return;
  run.running = false;
  run.paused = false;
  await saveRun(run);
  if (!keepTab && run.tabId) await chrome.tabs.remove(run.tabId).catch(() => {});
  await setStatus({ state: "error", message: error instanceof Error ? error.message : String(error), progress: progressLabel(run) });
}

function readRenderedListing() {
  const visible = `${document.title || ""}\n${(document.body?.innerText || "").slice(0, 10000)}`;
  const blocked = /you are now in line|virtual waiting room|estimated wait time/i.test(visible) ? "AMC/Queue-it waiting room"
    : /verify you are human|complete the captcha|security check required/i.test(visible) ? "AMC verification challenge"
      : /access denied|request blocked|you have been blocked/i.test(visible) ? "AMC access-denied page" : null;
  if (blocked) return { blocked, showtimeIds: [] };
  const theatreLink = document.querySelector('a[href*="/amc-lincoln-square-13"]');
  const theatreGroup = theatreLink?.closest('[role="group"]');
  if (!theatreGroup) return { error: "AMC’s Lincoln Square showtime section did not render." };
  const ids = new Set();
  for (const link of theatreGroup.querySelectorAll('a[href*="/showtimes/"]')) {
    const formatGroup = link.closest('li[role="listitem"][aria-label]');
    const format = `${formatGroup?.getAttribute("aria-label") || ""} ${formatGroup?.querySelector("h3")?.textContent || ""}`;
    const id = link.getAttribute("href")?.match(/\/showtimes\/(\d+)(?:\/seats)?(?:[?#]|$)/)?.[1];
    if (id && /IMAX\s*70\s*MM/i.test(format)) ids.add(id);
  }
  return { blocked: null, showtimeIds: [...ids] };
}

function readRenderedSeatMap(showtimeId) {
  const visible = `${document.title || ""}\n${(document.body?.innerText || "").slice(0, 10000)}`;
  const blocked = /you are now in line|virtual waiting room|estimated wait time/i.test(visible) ? "AMC/Queue-it waiting room"
    : /verify you are human|complete the captcha|security check required/i.test(visible) ? "AMC verification challenge"
      : /access denied|request blocked|you have been blocked/i.test(visible) ? "AMC access-denied page" : null;
  if (blocked) return { blocked };
  const text = document.documentElement.innerHTML.replaceAll('\\"', '"').replaceAll('\\\\', '\\');
  const markerIndex = text.indexOf('"seatingLayout":');
  const open = text.indexOf("{", markerIndex);
  if (markerIndex < 0 || open < 0) return { error: `AMC rendered no seating layout for ${showtimeId}.` };
  let quote = false, escape = false, depth = 0, end = -1;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) { if (escape) escape = false; else if (char === "\\") escape = true; else if (char === '"') quote = false; continue; }
    if (char === '"') quote = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) { end = index; break; }
  }
  if (end < 0) return { error: `AMC seating layout for ${showtimeId} was incomplete.` };
  let layout;
  try { layout = JSON.parse(text.slice(open, end + 1)); } catch { return { error: `AMC seating layout for ${showtimeId} could not be parsed.` }; }
  const position = text.indexOf(`"showtimeId":${showtimeId}`);
  const around = text.slice(Math.max(0, position - 1200), position + 3500);
  const showDateTimeUtc = around.match(/"showDateTimeUtc":"([^"]+)"/)?.[1];
  if (!showDateTimeUtc || !Array.isArray(layout.seats)) return { error: `AMC rendered incomplete showtime data for ${showtimeId}.` };
  return { blocked: null, rows: Number(layout.rows), columns: Number(layout.columns), showDateTimeUtc, seats: layout.seats.map((seat) => ({ available: Boolean(seat.available), row: Number(seat.row), column: Number(seat.column), name: String(seat.seatName ?? seat.name ?? ""), type: String(seat.type ?? "NotASeat") })) };
}
