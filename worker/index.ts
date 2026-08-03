/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  AMC_VENDOR_KEY?: string;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/amc/showtimes") {
      return getAmcShowtimes(env);
    }

    if (url.pathname === "/api/amc/seats") {
      return getAmcSeats(url, env);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

const AMC_API = "https://api.amctheatres.com";
const THEATRE_NUMBER = 2116;
const MOVIE_ID = 76238;
const TRACKED_DATES = [
  "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26",
  "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05",
  "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
  "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16",
];

function json(data: unknown, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}

function apiHeaders(env: Env) {
  return { accept: "application/json", "X-AMC-Vendor-Key": env.AMC_VENDOR_KEY ?? "" };
}

function missingKey(env: Env) {
  if (env.AMC_VENDOR_KEY) return null;
  return json({
    state: "needs_key",
    message: "Add AMC_VENDOR_KEY as a Cloudflare Worker secret to enable live showtimes and seating.",
  }, 503);
}

function apiDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${month}-${day}-${year}`;
}

function embeddedShowtimes(payload: any): any[] {
  return payload?._embedded?.showtimes ?? payload?.showtimes ?? [];
}

function movieMatches(showtime: any) {
  const directId = showtime?.movieId ?? showtime?.movie?.movieId ?? showtime?.movie?.id;
  if (Number(directId) === MOVIE_ID) return true;
  const movieLink = showtime?._links?.["https://api.amctheatres.com/rels/v2/movie"]?.href ?? "";
  return movieLink.endsWith(`/movies/${MOVIE_ID}`);
}

function formatNames(showtime: any): string[] {
  const values = [showtime?.format, ...(showtime?.attributes ?? [])].flatMap((entry: any) => {
    if (!entry) return [];
    if (typeof entry === "string") return [entry];
    if (Array.isArray(entry?.edges)) return entry.edges.flatMap((edge: any) => [edge?.node?.code, edge?.node?.name]);
    return [entry.code, entry.name, entry.description];
  });
  return values.filter(Boolean).map((value: unknown) => String(value).toLowerCase());
}

function isImax70mm(showtime: any) {
  const formats = formatNames(showtime);
  return formats.some((value) => value === "imax70mm" || value.includes("imax 70mm"));
}

async function getAmcShowtimes(env: Env) {
  const unavailable = missingKey(env);
  if (unavailable) return unavailable;

  try {
    const results = await mapWithConcurrency(TRACKED_DATES, 4, async (listingDate) => {
      const endpoint = `${AMC_API}/v2/theatres/${THEATRE_NUMBER}/showtimes/${apiDate(listingDate)}?page-size=100`;
      const response = await fetch(endpoint, { headers: apiHeaders(env) });
      if (!response.ok) throw new Error(`AMC showtime request failed (${response.status})`);
      const payload = await response.json();
      return embeddedShowtimes(payload)
        .filter((showtime) => movieMatches(showtime) && isImax70mm(showtime) && !showtime.isCanceled)
        .map((showtime) => ({
          id: Number(showtime.id ?? showtime.showtimeId),
          performanceNumber: Number(showtime.performanceNumber),
          listingDate,
          showDateTimeLocal: showtime.showDateTimeLocal ?? showtime.showDateTimeUtc,
          showDateTimeUtc: showtime.showDateTimeUtc,
          isSoldOut: Boolean(showtime.isSoldOut),
          purchaseUrl: showtime.purchaseUrl ?? `https://www.amctheatres.com/showtimes/${showtime.id ?? showtime.showtimeId}/seats`,
        }));
    });

    const showtimes = results.flat().filter((showtime) => showtime.id && showtime.performanceNumber)
      .sort((a, b) => String(a.showDateTimeLocal).localeCompare(String(b.showDateTimeLocal)));
    const authorizedShowtimes = await Promise.all(showtimes.map(async (showtime) => ({
      ...showtime,
      accessToken: await signShowtime(env, showtime.id, showtime.performanceNumber),
    })));
    return json({ state: "live", checkedAt: new Date().toISOString(), showtimes: authorizedShowtimes }, 200, "private, max-age=60");
  } catch (error) {
    return json({ state: "api_error", message: error instanceof Error ? error.message : "AMC API request failed" }, 502);
  }
}

async function getAmcSeats(url: URL, env: Env) {
  const unavailable = missingKey(env);
  if (unavailable) return unavailable;
  const performanceNumber = Number(url.searchParams.get("performanceNumber"));
  const showtimeId = Number(url.searchParams.get("showtimeId"));
  const accessToken = url.searchParams.get("accessToken") ?? "";
  if (!Number.isInteger(performanceNumber) || performanceNumber <= 0 || !Number.isInteger(showtimeId) || showtimeId <= 0) {
    return json({ state: "bad_request", message: "A valid showtime is required." }, 400);
  }
  if (accessToken !== await signShowtime(env, showtimeId, performanceNumber)) {
    return json({ state: "forbidden", message: "This performance is outside the authorized tracker results." }, 403);
  }

  try {
    const endpoint = `${AMC_API}/v3/seating-layouts/${THEATRE_NUMBER}/${performanceNumber}`;
    const response = await fetch(endpoint, { headers: apiHeaders(env) });
    if (!response.ok) throw new Error(`AMC seating request failed (${response.status})`);
    const payload: any = await response.json();
    return json({
      state: "live",
      checkedAt: new Date().toISOString(),
      rows: Number(payload.rows),
      columns: Number(payload.columns),
      seats: (payload.seats ?? []).map((seat: any) => ({
        available: Boolean(seat.available),
        row: Number(seat.row),
        column: Number(seat.column),
        name: String(seat.seatName ?? seat.name ?? ""),
        type: String(seat.type ?? "NotASeat"),
      })),
    });
  } catch (error) {
    return json({ state: "api_error", message: error instanceof Error ? error.message : "AMC seating request failed" }, 502);
  }
}

async function signShowtime(env: Env, showtimeId: number, performanceNumber: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.AMC_VENDOR_KEY ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${showtimeId}:${performanceNumber}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
