# Odyssey Seat Tracker

Mobile dashboard for one IMAX 70mm ticket to *The Odyssey* at AMC Lincoln Square 13. It monitors Aug 21–Sep 16, 2026, excluding Aug 27–30, preserves AMC listing-date versus actual-start-date rollover, and never displays substitute/fabricated data.

## Automated no-key monitor

The primary collector is the included Chrome extension in [`extension/`](extension/). It needs one initial setup in the user's regular desktop Chrome profile, then checks automatically every 30, 60, or 120 minutes.

It creates a temporary inactive AMC tab, reads only the ordinary public Odyssey listing and seat pages, filters `IMAX 70MM`, and captures each matching map. One successful run publishes a compact snapshot for the dashboard. The snapshot retains AMC’s actual row/column/type/availability values, including the verified 42 × 12 auditorium and the Aug 22 listing → Aug 23 2:00 AM showtime rollover for ID `145701522`.

It does **not** use an AMC vendor key/API, solve CAPTCHA, evade Queue-it, extract cookies, or pretend a blocked check succeeded. If AMC presents Queue-it, CAPTCHA, or another access-control page, it leaves the last good snapshot in place and changes the extension status to **action required**. Open AMC normally, complete any required AMC step yourself, and click **Run now** in the extension.

### One-time setup

1. In the Cloudflare Worker dashboard, create a random secret named `COLLECTOR_TOKEN`.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, select **Load unpacked**, and choose this repository’s `extension` folder.
3. Open the **Odyssey Monitor** extension. Paste the private token, keep the prefilled dashboard URL, select the interval, and choose **Save & schedule**.
4. Click **Run now** once while normally able to view AMC. The popup shows the checked/published or action-required result.

The token authorizes writes to this dashboard only; it is stored in Chrome’s extension-local storage. Never put it in AMC, source code, or a public page.

## Dashboard behavior

- Rows A/B are excluded, C is lower-priority, and centered D–J seats are highlighted.
- A visitor’s dashboard compares consecutive seat-map reads and highlights newly opened seats.
- `GET /api/amc/showtimes` and `GET /api/amc/seats?showtimeId=…` serve only the latest monitor snapshot.
- Snapshots use Cloudflare edge cache for up to seven days. A failed or blocked run does not replace the last good data.

## Development

```bash
pnpm install
pnpm run build
```

Chrome extension files are plain Manifest V3 files and do not need a package install.
