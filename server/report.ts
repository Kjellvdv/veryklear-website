import { createHash, timingSafeEqual } from "node:crypto";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import type { Config } from "./config";
import type { Db } from "./db";
import { dayOf } from "./visitor";

const DAY_MS = 86_400_000;
export const RANGES = [7, 30, 90, 365] as const;

export interface Report {
  days: number;
  from: string;
  to: string;
  totals: { views: number; visitors: number };
  daily: { day: string; views: number; visitors: number }[];
  pages: { path: string; visitors: number; views: number }[];
  /** Visits to the contact and booking pages, by the page of ours they came from. */
  routes: { target: string; source: string; visitors: number; views: number }[];
  referrers: { source: string; visitors: number; views: number }[];
  campaigns: {
    source: string;
    medium: string;
    campaign: string;
    visitors: number;
    views: number;
  }[];
  devices: { device: string; visitors: number; views: number }[];
  languages: { lang: string; visitors: number; views: number }[];
}

/** The pages a visitor lands on when they act. The "where did they come from" table is about these. */
export const TARGET_PATHS = ["/strategiesessie", "/contact"] as const;

type Raw = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
// Visitors are unique per day: nothing identifies a person across days.
const COUNTS = "COUNT(DISTINCT day || ':' || visitor) AS visitors, COUNT(*) AS views";
const counts = (r: Raw) => ({ visitors: num(r.visitors), views: num(r.views) });

/**
 * One window for everything: the last `days` UTC calendar days including today.
 * Totals, tables and the chart all read `day >= from`, so they always agree.
 */
export function buildReport(db: Db, days: number, now: number): Report {
  const to = dayOf(now);
  const from = dayOf(now - (days - 1) * DAY_MS);
  const args = { from };
  const all = (sql: string) => db.prepare(sql).all(args) as Raw[];

  const t = (db.prepare(`SELECT ${COUNTS} FROM pageviews WHERE day >= @from`).get(args) ??
    {}) as Raw;

  const byDay = new Map(
    all(
      `SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
         FROM pageviews WHERE day >= @from GROUP BY day`,
    ).map((r) => [str(r.day), r]),
  );
  const daily: Report["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(now - i * DAY_MS);
    const r = byDay.get(day);
    daily.push({ day, views: num(r?.views), visitors: num(r?.visitors) });
  }

  return {
    days,
    from,
    to,
    totals: { views: num(t.views), visitors: num(t.visitors) },
    daily,
    pages: all(
      `SELECT path, ${COUNTS} FROM pageviews WHERE day >= @from
        GROUP BY path ORDER BY visitors DESC, views DESC, path LIMIT 25`,
    ).map((r) => ({ path: str(r.path), ...counts(r) })),
    routes: all(
      `SELECT path AS target, COALESCE(from_path, '(direct)') AS source, ${COUNTS}
         FROM pageviews WHERE day >= @from AND path IN (${TARGET_PATHS.map((t) => `'${t}'`).join(", ")})
        GROUP BY target, source ORDER BY target, visitors DESC, views DESC, source`,
    ).map((r) => ({ target: str(r.target), source: str(r.source), ...counts(r) })),
    referrers: all(
      `SELECT COALESCE(ref_host, '(direct)') AS source, ${COUNTS} FROM pageviews WHERE day >= @from
        GROUP BY source ORDER BY visitors DESC, views DESC, source LIMIT 15`,
    ).map((r) => ({ source: str(r.source), ...counts(r) })),
    campaigns: all(
      `SELECT COALESCE(utm_source, '') AS source, COALESCE(utm_medium, '') AS medium,
              COALESCE(utm_campaign, '') AS campaign, ${COUNTS}
         FROM pageviews
        WHERE day >= @from
          AND (utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)
        GROUP BY source, medium, campaign ORDER BY visitors DESC, views DESC LIMIT 15`,
    ).map((r) => ({
      source: str(r.source),
      medium: str(r.medium),
      campaign: str(r.campaign),
      ...counts(r),
    })),
    devices: all(
      `SELECT device, ${COUNTS} FROM pageviews WHERE day >= @from
        GROUP BY device ORDER BY visitors DESC, views DESC`,
    ).map((r) => ({ device: str(r.device), ...counts(r) })),
    languages: all(
      `SELECT COALESCE(lang, '(unknown)') AS lang, ${COUNTS} FROM pageviews WHERE day >= @from
        GROUP BY lang ORDER BY visitors DESC, views DESC, lang LIMIT 10`,
    ).map((r) => ({ lang: str(r.lang), ...counts(r) })),
  };
}

// ---- HTML ----------------------------------------------------------------

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const CSS = `
:root{--bg:#fff;--fg:#14110f;--muted:#6d6862;--line:#e7e3dd;--accent:#d6361f;--card:#faf8f5}
@media (prefers-color-scheme:dark){:root{--bg:#141210;--fg:#f3efe9;--muted:#a39d95;--line:#2c2825;--accent:#ff6b52;--card:#1b1815}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 Inter,system-ui,-apple-system,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1.05rem;margin:36px 0 10px}
p.sub{margin:0;color:var(--muted)}
nav{display:flex;flex-wrap:wrap;gap:8px 20px;margin:12px 0 0;color:var(--muted)}
nav a{color:var(--muted);text-decoration:none}nav a.on{color:var(--fg);font-weight:600;border-bottom:2px solid var(--accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card b{display:block;font-size:1.6rem;line-height:1.2}.card span{color:var(--muted);font-size:.85rem}
.bars{display:flex;align-items:flex-end;gap:2px;height:120px;border-bottom:1px solid var(--line)}
.bars i{flex:1;background:var(--accent);min-height:1px;border-radius:2px 2px 0 0;opacity:.85}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:.8rem;margin-top:4px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
th{color:var(--muted);font-weight:500;font-size:.85rem}td.n,th.n{text-align:right;white-space:nowrap}
.empty{color:var(--muted);padding:12px 0}
footer{margin-top:40px;color:var(--muted);font-size:.85rem}
`;

function table(head: string[], rows: string[][], numeric: number[] = []): string {
  if (rows.length === 0) return `<p class="empty">Nothing yet.</p>`;
  const cell = (tag: string, v: string, i: number) =>
    `<${tag}${numeric.includes(i) ? ' class="n"' : ""}>${v}</${tag}>`;
  return `<table><thead><tr>${head.map((h, i) => cell("th", esc(h), i)).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((v, i) => cell("td", v, i)).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

export function renderHtml(r: Report, reportPath: string): string {
  const peak = Math.max(1, ...r.daily.map((d) => d.visitors));
  const bars = r.daily
    .map(
      (d) =>
        `<i title="${esc(d.day)}: ${d.visitors} visitors, ${d.views} views" style="height:${Math.round(
          (d.visitors / peak) * 100,
        )}%"></i>`,
    )
    .join("");
  const rangeLinks = RANGES.map(
    (d) =>
      `<a href="${esc(reportPath)}?days=${d}"${d === r.days ? ' class="on"' : ""}>${d} days</a>`,
  ).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Numbers</title><style>${CSS}</style></head>
<body><main>
<h1>veryklear.com in numbers</h1>
<p class="sub">${esc(r.from)} to ${esc(r.to)}, UTC</p>
<nav aria-label="Range">${rangeLinks}</nav>
<div class="cards">
<div class="card"><b>${r.totals.visitors}</b><span>Visitors</span></div>
<div class="card"><b>${r.totals.views}</b><span>Pageviews</span></div>
<div class="card"><b>${r.days}</b><span>Days</span></div>
</div>
<h2>Visitors per day</h2>
<div class="bars" role="img" aria-label="Visitors per day">${bars}</div>
<div class="axis"><span>${esc(r.from)}</span><span>${esc(r.to)}</span></div>
<h2>Pages</h2>
${table(
  ["Page", "Visitors", "Views"],
  r.pages.map((p) => [esc(p.path), String(p.visitors), String(p.views)]),
  [1, 2],
)}
<h2>Clicks to contact and the booking page, by the page they came from</h2>
${table(
  ["Reached", "From", "Visitors", "Views"],
  r.routes.map((x) => [esc(x.target), esc(x.source), String(x.visitors), String(x.views)]),
  [2, 3],
)}
<h2>Where visitors come from</h2>
${table(
  ["Source", "Visitors", "Views"],
  r.referrers.map((x) => [esc(x.source), String(x.visitors), String(x.views)]),
  [1, 2],
)}
<h2>Campaigns</h2>
${table(
  ["Source", "Medium", "Campaign", "Visitors", "Views"],
  r.campaigns.map((c) => [
    esc(c.source),
    esc(c.medium),
    esc(c.campaign),
    String(c.visitors),
    String(c.views),
  ]),
  [3, 4],
)}
<h2>Devices</h2>
${table(
  ["Device", "Visitors", "Views"],
  r.devices.map((d) => [esc(d.device), String(d.visitors), String(d.views)]),
  [1, 2],
)}
<h2>Languages</h2>
${table(
  ["Language", "Visitors", "Views"],
  r.languages.map((l) => [esc(l.lang), String(l.visitors), String(l.views)]),
  [1, 2],
)}
<footer>Counted on the server from the page requests browsers make anyway: no script, no cookies. Visitors are per day: someone who comes on three days counts three times, because nothing identifies a person across days. "From" is the page of ours the visitor was on when they clicked; a typed address or a link from elsewhere shows as (direct). Known crawlers, Do Not Track and Global Privacy Control are left out. Days are UTC.</footer>
</main></body></html>`;
}

// ---- Routes --------------------------------------------------------------

function authorised(header: string | undefined, password: string): boolean {
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const given = decoded.slice(decoded.indexOf(":") + 1);
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(password).digest();
  return timingSafeEqual(a, b);
}

export function reportPaths(cfg: Config): [string, string] {
  return [cfg.REPORT_PATH, `${cfg.REPORT_PATH}.json`];
}

export function reportRouter(db: Db, cfg: Config, now: () => number): Router {
  const router = express.Router();
  const [htmlPath, jsonPath] = reportPaths(cfg);

  // Scoped to the two report routes only. `validate.ip` off: its check logs the
  // raw X-Forwarded-For value on malformed input, and that header can carry IPs.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: false,
    legacyHeaders: false,
    validate: { ip: false },
    handler: (_req, res) => void res.status(429).end(),
  });
  const headers: RequestHandler = (_req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Cache-Control", "no-store");
    next();
  };
  const guard = (req: Request, res: Response): boolean => {
    if (authorised(req.get("authorization"), cfg.REPORT_PASSWORD)) return true;
    res.set("WWW-Authenticate", 'Basic realm="numbers", charset="UTF-8"').status(401).end();
    return false;
  };
  const daysOf = (req: Request): number => {
    const asked = Number(req.query.days);
    return (RANGES as readonly number[]).includes(asked) ? asked : 30;
  };

  router.get(jsonPath, limiter, headers, (req, res) => {
    if (!guard(req, res)) return;
    res.json({ success: true, data: buildReport(db, daysOf(req), now()) });
  });

  router.get(htmlPath, limiter, headers, (req, res) => {
    if (!guard(req, res)) return;
    res.type("html").send(renderHtml(buildReport(db, daysOf(req), now()), htmlPath));
  });

  return router;
}
