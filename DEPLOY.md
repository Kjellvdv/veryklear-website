# Deploying Very Klear

The site is an Astro build served by its own small Express server (`server/`) on
Railway. That server also counts page visits, on the server, into SQLite on a
Railway volume: no script on the pages, no cookies. Railway builds and deploys on
every push to `main`, so a content-desk publish goes live by itself.

## Why it looks like this (2026-10-14)

- Counting visits from the page request a visitor's browser makes anyway is the
  one way to have numbers without a consent banner: a measuring script falls
  under Article 5(3) ePrivacy (EDPB Guidelines 2/2023, para 33), and Belgium has
  no audience-measurement exemption. GitHub Pages has no logs, hence Railway. The
  legitimate-interest note lives in `CLAUDE.md`.
- `www.veryklear.com` is canonical because Railway only takes a CNAME and
  SiteGround's DNS can't alias the bare domain. `veryklear.com` and
  `veryklear.be` 301 to www from SiteGround.

## Domains and DNS (SiteGround, Site Tools → Domain → DNS Zone Editor)

| Name | Record | Points to |
|---|---|---|
| `www.veryklear.com` | CNAME + TXT | Railway (both values come from the service's custom-domain dialog; the domain only verifies with both) |
| `veryklear.com` | A | SiteGround's own server, which 301s to `https://www.veryklear.com` with the path kept (Domain → Redirects). Needs a Let's Encrypt certificate for the apex (Security → SSL Manager). |
| `veryklear.be` | its own zone | SiteGround 301 to `https://www.veryklear.com`, path kept |
| `forms.veryklear.com` | A | SiteGround, the contact-form backend (`forms/README.md`) |

MX records for both domains stay on SiteGround, so `kjell@veryklear.be` keeps working.

## The Railway service

- Project from GitHub `Kjellvdv/veryklear-website`, branch `main`. Railpack runs
  `npm ci`, `npm run build` (Astro, share images included) and `npm start`.
- **Region EU West (Amsterdam), set before adding the volume.** Moving a volume
  later means downtime.
- **Volume** mounted at `/data`. **Health check** path `/healthz`.
- **Variables:**

  | Variable | Value |
  |---|---|
  | `DATA_DIR` | `/data` |
  | `REPORT_PASSWORD` | long and random, e.g. `openssl rand -base64 24` |
  | `RETENTION_DAYS` | `400` (the privacy page says 14 months; change both together) |
  | `CANONICAL_HOST` | `www.veryklear.com`, but only once that domain is verified. Every other Host header then 301s there. |

  Never set `NODE_ENV=production` as a variable: it makes the build skip dev
  dependencies. `npm start` sets it at runtime. Railway injects `PORT`.
- **Each deploy means a few seconds of downtime**, because one deployment at a
  time may hold the volume. Content publishes trigger deploys too.
- **Volume backups** on in the dashboard. **DPA**: Railway's needs a DocuSign
  (railway.com/legal/dpa); the DPA names the EU SCCs for transfers.

## Cutover checklist (first time only)

1. Merge the `railway` branch to `main`. GitHub Pages keeps serving the last build
   on the apex until step 6.
2. Create the Railway service as above. Let it build. Open the
   `*.up.railway.app` address: pages, `/strategiesessie` with the calendar and a
   clean console, `/numeros` with the password.
3. Phone on mobile data plus laptop on wifi, then `/numeros` → 2 visitors. If it
   says 1, Railway's proxy sits more than one hop away and `trust proxy` in
   `server/app.ts` needs the real count.
4. Railway → Networking → custom domain `www.veryklear.com`. SiteGround: remove
   the old `www` CNAME (`kjellvdv.github.io`), add Railway's CNAME and TXT. Wait
   for the green check and the certificate. Then set `CANONICAL_HOST`.
5. Sign the DPA, switch on volume backups.
6. Quiet hour: apex A records to SiteGround, Let's Encrypt for the apex, 301 to
   www. Retarget the `.be` redirect to www. GitHub → Settings → Pages: remove
   the custom domain, source None. HTTPS on the apex errors until the certificate
   is issued, so expect a short gap.
7. Google Search Console: Domain property `veryklear.com`, submit
   `https://www.veryklear.com/sitemap-index.xml`. Update LinkedIn and signature
   links to www.

## Operating

- **Numbers:** `https://www.veryklear.com/numeros`, any username, `REPORT_PASSWORD`.
  Ranges 7, 30, 90, 365 days. `/numeros.json` gives the same as JSON; that is
  what Claude reads: `curl -u x:$REPORT_PASSWORD 'https://www.veryklear.com/numeros.json?days=30'`.
- **Logs** (Railway → service → Logs): method, path, status, time. Never an IP.
- **Retired URLs:** add them to `src/redirects.js`. The server 301s them; Astro
  builds a stub from the same map.
- **Preview mode:** `const PREVIEW` in `src/layouts/Base.astro`, `false` since
  2026-10-06. `true` ships `noindex, nofollow` and no canonical on every page.
- **Rollback:** Railway → Deployments → redeploy the previous one.
- **Locally:** `npm run dev` (Astro, port 4324) for content; `npm run serve`
  (build plus server on 3011, `.env` from `.env.example`) to test the server.
