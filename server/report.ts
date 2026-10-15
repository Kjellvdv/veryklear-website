import { createHash, timingSafeEqual } from "node:crypto";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import type { Config } from "./config";
import type { Db } from "./db";
import { renderHtml } from "./report-view";
import {
  type Flows,
  RANGES,
  type Report,
  type SessionRow,
  SERVICE_PATHS,
  TABS,
  TARGET_PATHS,
  type TabId,
} from "./report-types";
import { type PageView, readSessions, type Session } from "./sessions";
import { dayOf } from "./visitor";

export { RANGES, TARGET_PATHS } from "./report-types";
export { renderHtml } from "./report-view";
export { SESSION_GAP_MS } from "./sessions";

const DAY_MS = 86_400_000;
const PATH_STEPS = 5;
const RECENT_SESSIONS = 50;
const SESSION_PAGES_SHOWN = 8;

type Raw = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
// Visitors are unique per day: nothing identifies a person across days.
const COUNTS = "COUNT(DISTINCT day || ':' || visitor) AS visitors, COUNT(*) AS views";
const counts = (r: Raw) => ({ visitors: num(r.visitors), views: num(r.views) });

const top = <T>(m: Map<string, T>, n: number, by: (v: T) => number) =>
  [...m.entries()].sort((a, b) => by(b[1]) - by(a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, n);

const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);

const isTarget = (p: string) => (TARGET_PATHS as readonly string[]).includes(p);
const isService = (p: string) => (SERVICE_PATHS as readonly string[]).includes(p);
const isArticle = (p: string) => p.startsWith("/artikels/");

/** Where a session started: a campaign tag wins, then the referring site, then direct. */
function sourceOf(e: PageView): { source: string; kind: "campaign" | "referrer" | "direct" } {
  if (e.utm_source) return { source: e.utm_source.toLowerCase(), kind: "campaign" };
  if (e.ref_host) return { source: e.ref_host, kind: "referrer" };
  return { source: e.from_path ? "(own site)" : "(direct)", kind: "direct" };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const brussels = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

/** Hour (0 to 23) and weekday (0 = Monday) of a moment in Belgian time, summer time included. */
export function brusselsClock(ts: number): { hour: number; weekday: number } {
  const parts = brussels.formatToParts(new Date(ts));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "Mon");
  return { hour, weekday: Math.max(0, weekday) };
}

const HOUR_MS = 3_600_000;
const wallClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Belgian time's distance from UTC at a moment, in ms (3,600,000 or 7,200,000). */
function brusselsOffset(ts: number): number {
  const p = Object.fromEntries(wallClock.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** The UTC instant of Belgian midnight, `daysBack` days before the Belgian day `ts` falls in. */
export function brusselsMidnight(ts: number, daysBack = 0): number {
  const p = Object.fromEntries(wallClock.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) - daysBack);
  // The offset at that midnight can differ from the one now (summer time ends or starts in between).
  let guess = wall - brusselsOffset(ts);
  guess = wall - brusselsOffset(guess);
  return guess;
}

/**
 * One window for everything: the last `days` UTC calendar days including today.
 * Totals, tables and charts all read `day >= from`, so they always agree.
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

  // When people visit, in Belgian time. Grouped by UTC hour in SQL, so the zone
  // work happens once per hour bucket, not once per row.
  const hours = Array<number>(24).fill(0);
  const weekdays = Array<number>(7).fill(0);
  for (const r of all(
    `SELECT CAST(ts / 3600000 AS INTEGER) AS bucket, COUNT(*) AS views
       FROM pageviews WHERE day >= @from GROUP BY bucket`,
  )) {
    const { hour, weekday } = brusselsClock(num(r.bucket) * 3_600_000);
    hours[hour] = (hours[hour] ?? 0) + num(r.views);
    weekdays[weekday] = (weekdays[weekday] ?? 0) + num(r.views);
  }

  // The last seven Belgian days hour by hour, fixed whatever range is picked.
  const hourFrom = Math.floor(brusselsMidnight(now, 6) / HOUR_MS);
  const hourTo = Math.floor(now / HOUR_MS);
  const perHour = new Map(
    (
      db
        .prepare(
          `SELECT CAST(ts / 3600000 AS INTEGER) AS bucket, COUNT(DISTINCT visitor) AS visitors,
                  COUNT(*) AS views
             FROM pageviews WHERE ts >= @since GROUP BY bucket`,
        )
        .all({ since: hourFrom * HOUR_MS }) as Raw[]
    ).map((r) => [num(r.bucket), r]),
  );
  const hourly: Report["hourly"] = [];
  for (let h = hourFrom; h <= hourTo; h++) {
    const r = perHour.get(h);
    hourly.push({ start: h * HOUR_MS, visitors: num(r?.visitors), views: num(r?.views) });
  }

  // One pass over this window's sessions feeds the flows, the page entry and exit
  // columns, the sources table and the "what sessions did" bars.
  let sessions = 0;
  let singlePage = 0;
  let pageTotal = 0;
  const behaviour = { sessions: 0, multiPage: 0, service: 0, article: 0, reached: 0 };
  const entries = new Map<string, number>();
  const exits = new Map<string, number>();
  const steps = new Map<string, { from: string; to: string; sessions: number }>();
  const paths = new Map<string, { pages: string[]; more: boolean; sessions: number }>();
  const sources = new Map<
    string,
    { source: string; kind: "campaign" | "referrer" | "direct"; sessions: number; reached: number }
  >();
  let recent: SessionRow[] = [];
  const keepNewest = (rows: SessionRow[], n: number) =>
    rows.sort((a, b) => b.start - a.start).slice(0, n);

  const take = (s: Session) => {
    sessions++;
    pageTotal += s.pages.length;
    const firstPage = s.pages[0] as string;
    const lastPage = s.pages[s.pages.length - 1] as string;
    bump(entries, firstPage);
    bump(exits, lastPage);

    const reached = s.pages.some(isTarget);
    behaviour.sessions++;
    if (s.pages.length >= 2) behaviour.multiPage++;
    if (s.pages.some(isService)) behaviour.service++;
    if (s.pages.some(isArticle)) behaviour.article++;
    if (reached) behaviour.reached++;

    const src = sourceOf(s.entry);
    const skey = `${src.kind}:${src.source}`;
    const row = sources.get(skey) ?? { ...src, sessions: 0, reached: 0 };
    row.sessions++;
    if (reached) row.reached++;
    sources.set(skey, row);

    if (s.pages.length === 1) {
      singlePage++;
    } else {
      for (let i = 0; i < s.pages.length - 1; i++) {
        const a = s.pages[i] as string;
        const b = s.pages[i + 1] as string;
        const key = `${a}\u0000${b}`;
        const hit = steps.get(key);
        if (hit) hit.sessions++;
        else steps.set(key, { from: a, to: b, sessions: 1 });
      }
      const shown = s.pages.slice(0, PATH_STEPS);
      const key = shown.join("\u0000") + (s.pages.length > PATH_STEPS ? "\u0000…" : "");
      const hit = paths.get(key);
      if (hit) hit.sessions++;
      else paths.set(key, { pages: shown, more: s.pages.length > PATH_STEPS, sessions: 1 });
    }

    const e = s.entry;
    recent.push({
      start: s.start,
      seconds: Math.round((s.end - s.start) / 1000),
      pageCount: s.pages.length,
      pages: s.pages
        .slice(0, SESSION_PAGES_SHOWN)
        .map((path, i) => ({ path, at: Math.round(((s.times[i] as number) - s.start) / 1000) })),
      more: s.pages.length > SESSION_PAGES_SHOWN,
      from: e.ref_host ?? (e.from_path ? "(own site)" : "(direct)"),
      campaign: [e.utm_source, e.utm_medium, e.utm_campaign].filter(Boolean).join(" / "),
      lang: e.lang ?? "(unknown)",
      device: e.device,
    });
    if (recent.length >= 2000) recent = keepNewest(recent, RECENT_SESSIONS);
  };
  for (const s of readSessions(db, from)) take(s);

  // The equal-length window just before this one, for the change indicators.
  const prevFrom = dayOf(now - (2 * days - 1) * DAY_MS);
  const p = (db
    .prepare(`SELECT ${COUNTS} FROM pageviews WHERE day >= @prevFrom AND day < @from`)
    .get({ prevFrom, from }) ?? {}) as Raw;
  let prevSessions = 0;
  const earlier = readSessions(db, prevFrom, from);
  while (!earlier.next().done) prevSessions++;
  const previous = num(p.views) === 0 ? null : { ...counts(p), sessions: prevSessions };

  const pageRows = all(
    `SELECT path, ${COUNTS} FROM pageviews WHERE day >= @from
      GROUP BY path ORDER BY visitors DESC, views DESC, path LIMIT 25`,
  ).map((r) => ({
    path: str(r.path),
    ...counts(r),
    entries: entries.get(str(r.path)) ?? 0,
    exits: exits.get(str(r.path)) ?? 0,
  }));

  const filtered = all(
    `SELECT reason, SUM(n) AS requests FROM filtered WHERE day >= @from
      GROUP BY reason ORDER BY requests DESC, reason`,
  ).map((r) => ({ reason: str(r.reason), requests: num(r.requests) }));

  const filteredByDay = new Map<string, Record<string, number>>();
  for (const r of all(`SELECT day, reason, n FROM filtered WHERE day >= @from ORDER BY day`)) {
    const reasons = filteredByDay.get(str(r.day)) ?? {};
    reasons[str(r.reason)] = num(r.n);
    filteredByDay.set(str(r.day), reasons);
  }
  const filteredDaily = daily.map((d) => ({ day: d.day, reasons: filteredByDay.get(d.day) ?? {} }));
  const automatedRequests = filtered.reduce((sum, f) => sum + f.requests, 0);
  const requestTotal = automatedRequests + num(t.views);

  const flows: Flows = {
    sessions,
    singlePage,
    pagesPerSession: sessions === 0 ? 0 : Math.round((pageTotal / sessions) * 10) / 10,
    entries: top(entries, 10, (n) => n).map(([path, n]) => ({ path, sessions: n })),
    exits: top(exits, 10, (n) => n).map(([path, n]) => ({ path, sessions: n })),
    steps: top(steps, 15, (v) => v.sessions).map(([, v]) => v),
    paths: top(paths, 10, (v) => v.sessions).map(([, v]) => v),
    recent: keepNewest(recent, RECENT_SESSIONS),
  };

  return {
    days,
    from,
    to,
    totals: { ...counts(t), sessions },
    previous,
    daily,
    hourly,
    hours,
    weekdays,
    pages: pageRows,
    routes: all(
      `SELECT path AS target, COALESCE(from_path, '(direct)') AS source, ${COUNTS}
         FROM pageviews WHERE day >= @from AND path IN (${TARGET_PATHS.map((x) => `'${x}'`).join(", ")})
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
    sources: top(sources, 15, (v) => v.sessions).map(([, v]) => v),
    behaviour,
    devices: all(
      `SELECT device, ${COUNTS} FROM pageviews WHERE day >= @from
        GROUP BY device ORDER BY visitors DESC, views DESC`,
    ).map((r) => ({ device: str(r.device), ...counts(r) })),
    languages: all(
      `SELECT COALESCE(lang, '(unknown)') AS lang, ${COUNTS} FROM pageviews WHERE day >= @from
        GROUP BY lang ORDER BY visitors DESC, views DESC, lang LIMIT 10`,
    ).map((r) => ({ lang: str(r.lang), ...counts(r) })),
    flows,
    filtered,
    filteredDaily,
    automated: {
      requests: automatedRequests,
      share: requestTotal === 0 ? 0 : automatedRequests / requestTotal,
    },
  };
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

export function reportPaths(cfg: Config): [string, string, string] {
  return [cfg.REPORT_PATH, `${cfg.REPORT_PATH}.json`, `${cfg.REPORT_PATH}/whoami`];
}

export function reportRouter(db: Db, cfg: Config, now: () => number): Router {
  const router = express.Router();
  const [htmlPath, jsonPath, whoamiPath] = reportPaths(cfg);

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

  // Which address and headers the server gets for the caller, to settle which one
  // carries a visitor's own address behind Railway's proxy. Answers the caller
  // only, behind the password; nothing is stored or logged.
  router.get(whoamiPath, limiter, headers, (req, res) => {
    if (!guard(req, res)) return;
    res.json({
      success: true,
      data: {
        ip: req.ip ?? null,
        ips: req.ips,
        socket: req.socket.remoteAddress ?? null,
        forwardedFor: req.get("x-forwarded-for") ?? null,
        realIp: req.get("x-real-ip") ?? null,
        edge: req.get("x-railway-edge") ?? null,
      },
    });
  });

  router.get(htmlPath, limiter, headers, (req, res) => {
    if (!guard(req, res)) return;
    const tab = TABS.find((x) => x.id === req.query.tab)?.id ?? ("overview" as TabId);
    res.type("html").send(renderHtml(buildReport(db, daysOf(req), now()), htmlPath, tab));
  });

  return router;
}
