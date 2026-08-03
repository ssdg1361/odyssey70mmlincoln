/** Cloudflare Worker entry point for Odyssey Seat Tracker. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface BrowserRun {
  quickAction(action: "content", options: { url: string; gotoOptions?: { waitUntil?: string; timeout?: number } }): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  /** Optional Cloudflare Browser Run binding. It is not an AMC credential. */
  BROWSER?: BrowserRun;
  /** Secret used only by a private, user-run browser capture to publish a snapshot. */
  COLLECTOR_TOKEN?: string;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } };
  };
}

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }

const THEATRE_NUMBER = 2116;
const MOVIE_ID = 76238;
const SNAPSHOT_PATH = "/__odyssey_seat_snapshot_v1";
const TRACKED_DATES = [
  "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26",
  "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05",
  "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
  "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16",
];

type Seat = { available: boolean; row: number; column: number; name: string; type: string };
type Showtime = { id: number; performanceNumber?: number; listingDate: string; showDateTimeUtc: string; isSoldOut: boolean; purchaseUrl: string };
type Snapshot = { version: 1; source: "chrome_extension" | "normal_browser" | "cloudflare_browser_run"; checkedAt: string; showtimes: Showtime[]; seatsByShowtime: Record<string, { rows: number; columns: number; seats: Seat[]; checkedAt: string }> };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/amc/showtimes") return getShowtimes(request);
    if (url.pathname === "/api/amc/seats") return getSeats(url, request);
    if (url.pathname === "/api/collector/publish") return publishSnapshot(request, env);
    if (url.pathname === "/api/collector/browser-run") return collectWithBrowserRun(request, env);
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => (await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality })).response(),
      }, allowedWidths);
    }
    return handler.fetch(request, env, ctx);
  },
};
export default worker;

function json(data: unknown, status = 200, cache = "no-store", extra: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache, ...extra } });
}
function cacheKey(request: Request) { return new Request(new URL(SNAPSHOT_PATH, request.url).toString()); }
async function readSnapshot(request: Request): Promise<Snapshot | null> {
  if (typeof caches === "undefined") return null;
  const response = await caches.default.match(cacheKey(request));
  if (!response) return null;
  try { return await response.json() as Snapshot; } catch { return null; }
}
async function writeSnapshot(request: Request, snapshot: Snapshot) {
  if (typeof caches === "undefined") throw new Error("Cloudflare Cache API is unavailable in this runtime.");
  await caches.default.put(cacheKey(request), json(snapshot, 200, "public, max-age=604800"));
}
function noSnapshot() {
  return json({ state: "no_snapshot", message: "No AMC seat snapshot has been published yet. This tracker never invents showtimes or availability.", collector: "Finish the one-time Chrome monitor setup, then it checks AMC automatically on its schedule." }, 503);
}
function cors(request: Request, response: Response) {
  if (request.method === "OPTIONS" || request.headers.get("origin")) {
    const headers = new Headers(response.headers);
    // The endpoint remains bearer-token protected. A wildcard lets the owner’s
    // local Chrome extension publish without exposing its token to the site.
    headers.set("access-control-allow-origin", "*");
    headers.set("access-control-allow-headers", "authorization, content-type");
    headers.set("vary", "Origin");
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}
function authorized(request: Request, env: Env) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(env?.COLLECTOR_TOKEN && supplied && supplied === env.COLLECTOR_TOKEN);
}
function validDate(date: unknown) { return typeof date === "string" && TRACKED_DATES.includes(date); }

async function getShowtimes(request: Request) {
  const snapshot = await readSnapshot(request);
  if (!snapshot) return noSnapshot();
  return json({ state: "snapshot", source: snapshot.source, checkedAt: snapshot.checkedAt, showtimes: snapshot.showtimes }, 200, "no-store");
}
async function getSeats(url: URL, request: Request) {
  const showtimeId = url.searchParams.get("showtimeId") ?? "";
  const snapshot = await readSnapshot(request);
  if (!snapshot) return noSnapshot();
  const map = snapshot.seatsByShowtime[showtimeId];
  if (!map) return json({ state: "not_collected", message: "This showing has not been captured in the latest snapshot." }, 404);
  return json({ state: "snapshot", source: snapshot.source, ...map }, 200, "no-store");
}

async function publishSnapshot(request: Request, env: Env) {
  if (request.method === "OPTIONS") return cors(request, new Response(null, { headers: { "access-control-allow-methods": "POST, OPTIONS", "access-control-max-age": "600" } }));
  if (request.method !== "POST") return json({ state: "method_not_allowed" }, 405);
  if (!authorized(request, env)) return cors(request, json({ state: "unauthorized", message: "Set COLLECTOR_TOKEN as a Worker secret, then supply it from the private capture." }, 401));
  try {
    const snapshot = await request.json() as Snapshot;
    const validated = validateSnapshot(snapshot);
    if (!validated) return cors(request, json({ state: "bad_snapshot", message: "The capture payload did not contain valid AMC showtimes and seat maps.", detail: snapshotDiagnostics(snapshot) }, 400));
    await writeSnapshot(request, validated);
    return cors(request, json({ state: "published", checkedAt: validated.checkedAt, performances: validated.showtimes.length }));
  } catch { return cors(request, json({ state: "bad_json", message: "The capture payload was not valid JSON." }, 400)); }
}

function snapshotDiagnostics(value: any) {
  const showtimes = Array.isArray(value?.showtimes) ? value.showtimes : [];
  const validShowtimes = showtimes.filter((showtime: any) => Number.isInteger(showtime?.id) && validDate(showtime?.listingDate) && typeof showtime?.showDateTimeUtc === "string" && /^https:\/\/www\.amctheatres\.com\/showtimes\/\d+\/seats$/.test(showtime?.purchaseUrl));
  const maps = value?.seatsByShowtime && typeof value.seatsByShowtime === "object" ? value.seatsByShowtime : {};
  const usableMaps = validShowtimes.filter((showtime: any) => {
    const map = maps[String(showtime.id)];
    return Number.isInteger(map?.rows) && Number.isInteger(map?.columns) && Array.isArray(map?.seats) && map.seats.some((seat: any) => Number.isInteger(seat?.row) && Number.isInteger(seat?.column) && typeof seat?.name === "string" && typeof seat?.type === "string" && typeof seat?.available === "boolean");
  });
  return { source: value?.source ?? null, showtimesReceived: showtimes.length, validShowtimes: validShowtimes.length, usableSeatMaps: usableMaps.length };
}

function validateSnapshot(value: any): Snapshot | null {
  if (!value || !Array.isArray(value.showtimes) || !value.seatsByShowtime || !["chrome_extension", "normal_browser", "cloudflare_browser_run"].includes(value.source)) return null;
  const showtimes = value.showtimes.filter((showtime: any) => Number.isInteger(showtime?.id) && validDate(showtime?.listingDate) && typeof showtime?.showDateTimeUtc === "string" && /^https:\/\/www\.amctheatres\.com\/showtimes\/\d+\/seats$/.test(showtime?.purchaseUrl));
  const seatsByShowtime: Snapshot["seatsByShowtime"] = {};
  for (const showtime of showtimes) {
    const map = value.seatsByShowtime[String(showtime.id)];
    if (!map || !Number.isInteger(map.rows) || !Number.isInteger(map.columns) || !Array.isArray(map.seats) || map.rows < 1 || map.columns < 1) continue;
    const seats = map.seats.filter((seat: any) => Number.isInteger(seat?.row) && Number.isInteger(seat?.column) && typeof seat?.name === "string" && typeof seat?.type === "string" && typeof seat?.available === "boolean");
    if (seats.length === 0) continue;
    seatsByShowtime[String(showtime.id)] = { rows: map.rows, columns: map.columns, seats, checkedAt: typeof map.checkedAt === "string" ? map.checkedAt : value.checkedAt };
  }
  const complete = showtimes.filter((showtime: Showtime) => seatsByShowtime[String(showtime.id)]);
  if (!complete.length) return null;
  return { version: 1, source: value.source, checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : new Date().toISOString(), showtimes: complete, seatsByShowtime };
}

/**
 * Optional one-date Cloudflare Browser Run collector. It intentionally makes no
 * attempt to change identity, solve a challenge, or continue after a Queue-it/
 * CAPTCHA page. Browser Run identifies itself as a bot, so a block is expected
 * to be possible and leaves the last good snapshot intact.
 */
async function collectWithBrowserRun(request: Request, env: Env) {
  if (request.method !== "POST") return json({ state: "method_not_allowed" }, 405);
  if (!authorized(request, env)) return json({ state: "unauthorized" }, 401);
  if (!env?.BROWSER) return json({ state: "browser_unavailable", message: "Add the BROWSER Cloudflare Browser Run binding before using this collector." }, 503);
  const body = await request.json().catch(() => ({})) as { listingDate?: string };
  if (!validDate(body.listingDate)) return json({ state: "bad_request", message: "Provide one eligible listingDate (YYYY-MM-DD)." }, 400);
  const landing = `https://www.amctheatres.com/movies/the-odyssey-${MOVIE_ID}/showtimes?date=${body.listingDate}`;
  try {
    const rendered = await env.BROWSER.quickAction("content", { url: landing, gotoOptions: { waitUntil: "networkidle2", timeout: 20_000 } });
    const text = await rendered.text();
    if (isAccessBlocked(text)) return json({ state: "access_blocked", message: "AMC returned Queue-it, CAPTCHA, or another access-control page. No snapshot was changed." }, 409);
    return json({ state: "browser_rendered", message: "The public page rendered. Use the normal-browser capture for parsing and publishing; automated parsing is intentionally disabled until AMC consistently permits Browser Run." }, 202);
  } catch (error) {
    return json({ state: "browser_error", message: error instanceof Error ? error.message : "Browser Run could not render AMC." }, 502);
  }
}
function isAccessBlocked(text: string) { return /queue-it|queueit|captcha|verify you are human|access denied/i.test(text); }
