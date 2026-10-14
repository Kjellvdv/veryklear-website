# veryklear-website

Very Klear's site, `www.veryklear.com`: an Astro static build in Dutch, served by a small Express server in `server/` that also counts visits on the server. No measuring script, no cookies, no banner.

## Tech stack
- **Site:** Astro 4.16, content collections for page copy (`src/content/copy/*.yaml`, read with `getCopy()` from `src/lib/copy.js`) and artikels (`src/content/artikels/*.md`, helpers in `src/lib/articles.js`). Plain CSS, Inter self-hosted. Share images rendered at build time with satori and resvg (`src/og/`).
- **Server:** Express 5 + TypeScript run by `tsx`, `better-sqlite3`, Zod 4, helmet, compression. Serves `dist/`, counts page requests, shows the numbers page. No client code.
- **Ports:** Astro dev **4324** (gitignored `.claude/launch.json`), server **3011**.
- **Node:** 24 (`.nvmrc`, `engines`). This Mac also has 22; both run everything.

## Running
```bash
npm run dev          # Astro dev server, for content and design work
npm run build        # dist/, sitemap and share images included
npm run serve        # build, then the server on :3011 (needs .env, see .env.example)
npm run dev:server   # server only, against the existing dist/
npm run check        # tsc on server/ and tests/
npm run lint
npm test             # vitest + supertest against tests/fixtures/site
```

## Deployment
Railway builds and runs it on every push to `main`. Domains, variables, volume and the cutover checklist are in [DEPLOY.md](DEPLOY.md). The contact form is separate: `forms/contact.php` on SiteGround, uploaded by hand (`forms/README.md`).

## Architecture
- `src/layouts/Base.astro`: every page; canonical, `og:url` and `og:image` come from `Astro.site`.
- `src/redirects.js`: the one map of retired URLs. Astro builds stubs from it, the server 301s from it.
- `server/app.ts`: wiring, in order: request log → `/healthz` → canonical-host 301 → compression → helmet (strict policy on the numbers page, site policy elsewhere) → numbers router → URL normaliser → static assets with cache headers → pages → error handler.
- `server/pages.ts`: `listPages()` reads every `*/index.html` once at boot into a Set; `normalizeUrl()` 301s slashes, `index.html`, encodings and retired URLs; `servePages()` counts and sends, or sends `404.html` with 404.
- `server/count.ts`: `classify()` judges a request on its headers (count, ignore, or the reason it is automated); `createCounter()` adds the network check, then writes path, referrer (another site's host, or the path of our own page the click came from), UTM, device, language, daily visitor hash, or adds one to the day's `filtered` total for that reason.
- `server/datacenter.ts` and `server/data/datacenter-ranges.json`: cloud and hosting networks, as sorted ranges with a binary-search lookup. Refreshed by `npm run ranges:update` (AWS, Google Cloud, Oracle, DigitalOcean lists plus RIPE data for the hosters and Microsoft in the script's `ASNS`), reviewed by diff, committed. A missing file switches the rule off with a warning.
- `server/visitor.ts`: one random salt per UTC day, HMAC of ip|ua, salts older than yesterday deleted.
- `server/report.ts`: `/numeros` and `/numeros.json`, HTTP Basic, one calendar-day window for everything. Every table shows visitors (unique per day) first, then views. The "clicks to contact and the booking page" table groups visits to `TARGET_PATHS` by the page they came from. `buildFlows()` makes sessions out of the stored rows (one visitor-day, new session after 30 minutes, reloads collapsed) for entries, next-page steps, common routes and exits; nothing extra is stored for it. The last table shows the `filtered` totals.
- `server/config.ts`: env via Zod; errors name keys, never values.
- `server/db.ts`: schema plus `migrate()`, one guarded `ALTER TABLE` per column added after the first deploy.

## Key invariants
- **The IP address is never stored or logged.** In `count.ts` it is compared to the datacenter ranges and hashed, and that is all. The request log is method, path, status, time. A test dumps every table, `filtered` included, and asserts the IP and user agent aren't in it.
- **`filtered` holds totals only:** day, reason, number. No visitor hash, no path, no user agent. Keep it that way: it is what lets the numbers page show what the filter caught without keeping anything about the machines.
- **Nothing on the pages measures.** Adding a script that sends data would put the site back under ePrivacy 5(3) and need a banner. The privacy page describes what `count.ts` does; change both or neither.
- **Only real navigations count:** GET, `Accept: text/html`, a known page, status 200, no DNT/GPC, no prefetch, `Sec-Fetch-Dest` absent or `document`, and then four more tests, each tallied in `filtered` when it fails: a non-bot user agent; a user agent claiming Chrome 80+, Firefox 90+ or Safari 16.4+ must send `Sec-Fetch-Dest: document` and `Sec-Fetch-Mode: navigate`; an `Accept-Language` header; an address outside the datacenter ranges. Older and unknown agents are not judged on Sec-Fetch headers. Railway's edge forwards Sec-Fetch headers (checked 2026-10-14); if that ever changes the second rule would drop every visitor, so check after any edge or proxy change.
- **One URL per page, no trailing slash.** `trailingSlash: 'never'` in Astro, links written without slash, the server 301s every other spelling. Canonical, sitemap and links agree by construction (the sitemap writes the home as `https://www.veryklear.com` without slash; same URL to search engines).
- **Retention 400 days** in code, "14 maanden" on the privacy page. Change both.
- Retired URLs go in `src/redirects.js` and nowhere else.

## Legitimate-interest note (the documented assessment, 2026-10-14)
Purpose: see which pages and channels work and improve the site. Data per visit: page path, referring site (host only), UTM tags, device class, browser language, and a visitor hash that changes daily; pages of one visitor-day are read in order for the flow tables. The IP is also compared to hosting-network ranges at that moment and forgotten. Necessity: there is no less intrusive way to count visits. Balancing: no cookies or device storage, no cross-day identity, no IP stored, Do Not Track and Global Privacy Control honoured, 14-month retention, described on `/privacy`. Basis: Article 6(1)(f) GDPR. ePrivacy 5(3) does not apply: the server reads the request the browser makes for the page the visitor asked for; nothing instructs the device to send anything else. Kjell reviewed the privacy copy on 2026-10-14. A lawyer's half-hour would turn this from "strongest footing available" into a settled position.

## Gotchas
- `res.sendFile` treats any dotted path segment as a hidden file. Pages are sent relative to `root: dist`, because dist may sit under `.claude/worktrees/`.
- `DATA_DIR` must sit on the Railway volume. `loadConfig` defaults it to `RAILWAY_VOLUME_MOUNT_PATH` and refuses anything else, because a typo (`/data,`) once sent the database to the container's own disk, where every deploy erased it. Locally there is no volume variable and any folder goes.
- **The visitor's address comes from `X-Real-IP`** (`app.ts`). Railway's edge sends `X-Forwarded-For: <client>, <edge node>` and `X-Real-IP: <client>` and overwrites client-supplied values (checked 2026-10-14 with `/numeros/whoami`). Express's `req.ip` with `trust proxy 1` is the edge node: with it, visitors behind one node and the same browser merged into one, and every request looked like a datacenter. Check `/numeros/whoami` after any proxy change; it must show your own address in `ip`.
- `trust proxy` is 1 and only the fallback now; `X-Real-IP` decides the address. If visitors collapse into one in `/numeros`, look at `/numeros/whoami` first.
- Crawlers do fetch HTML, unlike with a script tracker. `server/bots.ts`, the Sec-Fetch and language checks and the datacenter ranges carry the filtering. It is a filter, not a proof: a scanner on a home or small-hoster connection with a real browser engine still gets through, and the numbers page's "Left out" table shows what each rule caught.
- Corporate proxies that strip Sec-Fetch headers, and visitors on a VPN that exits in a datacenter, are not counted. Accepted.
- Every deploy, content publishes included, means a few seconds of downtime (one deployment at a time may hold the volume).
- The site's Content-Security-Policy in `app.ts` allows TidyCal (`asset-tidycal.b-cdn.net` script, `tidycal.com` frame) and the form endpoint. A new third-party resource needs a line there, and a sentence on `/privacy`.
- `forms/contact.php` allows `http://localhost:3011` as origin, so the form can be tested against the served build.
- `@astrojs/sitemap` is pinned `~3.4.1` (zod 3) next to the server's zod 4. Two zods, no conflict; `src/content/config.ts` must keep importing `z` from `astro:content`.
- Days in the numbers are UTC.
- The site sends `Referrer-Policy: same-origin`, on purpose: that is how the server learns which of our pages a booking click came from. Other sites, TidyCal's iframe included, get no referrer. Don't tighten it to `no-referrer` without dropping the routes table.
- `const PREVIEW` in `Base.astro`: `true` hides the whole site from search. `false` since 2026-10-06.
