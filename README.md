# Odyssey Seat Tracker

Private, mobile-first dashboard for one IMAX 70mm ticket to *The Odyssey* at AMC Lincoln Square 13. It tracks only Aug 21–Sep 16, 2026, excluding Aug 27–30, and treats AMC's listing date separately from the real Eastern start date.

## Data model

This project deliberately does **not** use an AMC vendor key or fabricate data. The dashboard displays the most recent compact snapshot captured from AMC's normal public pages:

- only `IMAX 70MM` performances are included;
- each seat map keeps AMC's real row, column, seat type, and availability values;
- rows A/B are disabled, C is marked lower priority, and centered D–J are highlighted;
- new openings are calculated in the dashboard by comparing snapshots in the visitor's browser.

The verified reference is AMC listing date **Aug 22**, showtime ID **145701522**, whose actual start is **Sun, Aug 23, 2026 at 2:00 AM ET**. Its auditorium is 42 columns by 12 rows (A–H, J–M; no I).

## Capture options

### Normal-browser capture (recommended fallback)

This is the consumer-feasible path. It runs in the user's already-open normal AMC browser, loads the ordinary public date and seat pages at roughly one request per 1.4 seconds, then posts one compact snapshot to this Worker. It stops without publishing if AMC returns Queue-it, CAPTCHA, access denied, or an unexpected page. It does not read cookies, solve a challenge, or bypass access controls.

1. In the Cloudflare Worker dashboard, add a random Worker secret named `COLLECTOR_TOKEN`.
2. Open an ordinary `amctheatres.com` Odyssey showtimes page in the browser where you normally access AMC.
3. In DevTools Console, set the private configuration (replace both values):

```js
window.ODYSSEY_COLLECTOR = {
  publishUrl: "https://odyssey70mmlincoln.sjs05k.workers.dev/api/collector/publish",
  token: "your-COLLECTOR_TOKEN-value",
};
```

4. Paste and run the contents of [`public/odyssey-amc-capture.js`](public/odyssey-amc-capture.js). The console logs each listing and seat page. On success it logs `Published`; then reload the dashboard.

The token is only an authorization key for writing to this private dashboard. Do not paste it into a public page, commit it, or reuse an AMC password/token.

### Optional Cloudflare Browser Run probe

`vite.config.ts` declares an optional `BROWSER` Browser Run binding. After that binding is enabled in the Worker deployment and `COLLECTOR_TOKEN` is configured, an owner can POST `{ "listingDate": "2026-08-22" }` to `/api/collector/browser-run` with `Authorization: Bearer <COLLECTOR_TOKEN>`.

The route deliberately does only a one-date render probe and leaves the last snapshot unchanged if AMC responds with Queue-it, CAPTCHA, or another access-control page. Cloudflare documents that Browser Run requests are identifiable as bots, so it is not relied on as a guaranteed unattended collector.

## API

- `GET /api/amc/showtimes` — latest captured IMAX 70mm performances.
- `GET /api/amc/seats?showtimeId=145701522` — seat geometry and state from that snapshot.
- `POST /api/collector/publish` — authenticated normal-browser snapshot publication.
- `POST /api/collector/browser-run` — authenticated, optional one-date Browser Run render probe.

Snapshots are stored in Cloudflare's edge cache for up to seven days. A new successful capture replaces the old snapshot; if a capture is blocked, the prior good snapshot is retained.

## Development

```bash
pnpm install
pnpm run build
```

The worker has no database requirement. Browser Run requires Cloudflare's browser binding; the normal-browser capture does not.
