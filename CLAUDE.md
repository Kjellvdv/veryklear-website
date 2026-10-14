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
npm test             # vitest + supertest against tests/fixtures/dist
```

## Deployment
Railway builds and runs it on every push to `main`. Domains, variables, volume and the cutover checklist are in [DEPLOY.md](DEPLOY.md). The contact form is separate: `forms/contact.php` on SiteGround, uploaded by hand (`forms/README.md`).

## Architecture
- `src/layouts/Base.astro`: every page; canonical, `og:url` and `og:image` come from `Astro.site`.
- `src/redirects.js`: the one map of retired URLs. Astro builds stubs from it, the server 301s from it.
- `server/app.ts`: wiring, in order: request log → `/healthz` → canonical-host 301 → compression → helmet (strict policy on the numbers page, site policy elsewhere) → numbers router → URL normaliser → static assets with cache headers → pages → error handler.
- `server/pages.ts`: `listPages()` reads every `*/index.html` once at boot into a Set; `normalizeUrl()` 301s slashes, `index.html`, encodings and retired URLs; `servePages()` counts and sends, or sends `404.html` with 404.
- `server/count.ts`: `isNavigation()` decides what counts; `createCounter()` writes path, referrer (another site's host, or the path of our own page the click came from), UTM, device, language, daily visitor hash.
- `server/visitor.ts`: one random salt per UTC day, HMAC of ip|ua, salts older than yesterday deleted.
- `server/report.ts`: `/numeros` and `/numeros.json`, HTTP Basic, one calendar-day window for everything. Every table shows visitors (unique per day) first, then views. The "clicks to contact and the booking page" table groups visits to `TARGET_PATHS` by the page they came from.
- `server/config.ts`: env via Zod; errors name keys, never values.
- `server/db.ts`: schema plus `migrate()`, one guarded `ALTER TABLE` per column added after the first deploy.

## Key invariants
- **The IP address is never stored or logged.** It exists on one line in `count.ts`. The request log is method, path, status, time. A test dumps every table and asserts the IP and user agent aren't in it.
- **Nothing on the pages measures.** Adding a script that sends data would put the site back under ePrivacy 5(3) and need a banner. The privacy page describes what `count.ts` does; change both or neither.
- **Only real navigations count:** GET, `Accept: text/html`, a non-bot user agent, no DNT/GPC, `Sec-Fetch-Dest` absent or `document`, a known page, status 200.
- **One URL per page, no trailing slash.** `trailingSlash: 'never'` in Astro, links written without slash, the server 301s every other spelling. Canonical, sitemap and links agree by construction (the sitemap writes the home as `https://www.veryklear.com` without slash; same URL to search engines).
- **Retention 400 days** in code, "14 maanden" on the privacy page. Change both.
- Retired URLs go in `src/redirects.js` and nowhere else.

## Legitimate-interest note (the documented assessment, 2026-10-14)
Purpose: see which pages and channels work and improve the site. Data per visit: page path, referring site (host only), UTM tags, device class, browser language, and a visitor hash that changes daily. Necessity: there is no less intrusive way to count visits. Balancing: no cookies or device storage, no cross-day identity, no IP stored, Do Not Track and Global Privacy Control honoured, 14-month retention, described on `/privacy`. Basis: Article 6(1)(f) GDPR. ePrivacy 5(3) does not apply: the server reads the request the browser makes for the page the visitor asked for; nothing instructs the device to send anything else. Kjell reviewed the privacy copy on 2026-10-14. A lawyer's half-hour would turn this from "strongest footing available" into a settled position.

## Gotchas
- `res.sendFile` treats any dotted path segment as a hidden file. Pages are sent relative to `root: dist`, because dist may sit under `.claude/worktrees/`.
- `trust proxy` is 1 (Railway's edge). If visitors collapse into one in `/numeros`, the hop count is wrong.
- Crawlers do fetch HTML, unlike with a script tracker. The user-agent list in `server/bots.ts` and the `Sec-Fetch-Dest` check carry the filtering; expect a little noise.
- Every deploy, content publishes included, means a few seconds of downtime (one deployment at a time may hold the volume).
- The site's Content-Security-Policy in `app.ts` allows TidyCal (`asset-tidycal.b-cdn.net` script, `tidycal.com` frame) and the form endpoint. A new third-party resource needs a line there, and a sentence on `/privacy`.
- `forms/contact.php` allows `http://localhost:3011` as origin, so the form can be tested against the served build.
- `@astrojs/sitemap` is pinned `~3.4.1` (zod 3) next to the server's zod 4. Two zods, no conflict; `src/content/config.ts` must keep importing `z` from `astro:content`.
- Days in the numbers are UTC.
- The site sends `Referrer-Policy: same-origin`, on purpose: that is how the server learns which of our pages a booking click came from. Other sites, TidyCal's iframe included, get no referrer. Don't tighten it to `no-referrer` without dropping the routes table.
- `const PREVIEW` in `Base.astro`: `true` hides the whole site from search. `false` since 2026-10-06.
