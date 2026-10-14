import type { Db } from "./db";

/** One counted page view, as stored. */
export interface PageView {
  day: string;
  visitor: string;
  ts: number;
  path: string;
  ref_host: string | null;
  from_path: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  device: string;
  lang: string | null;
}

/**
 * One visitor's pages on one day, in order, with a reload counted once. A new
 * session starts after 30 minutes without a page. The visitor hash changes daily,
 * so a session never spans days and nothing is added to the stored data.
 */
export interface Session {
  /** Epoch ms of the first page. */
  start: number;
  /** Epoch ms of the last page view, reloads included. */
  end: number;
  pages: string[];
  /** Epoch ms of each entry in `pages`. */
  times: number[];
  /** The first page view: the one that arrived from somewhere. */
  entry: PageView;
}

export const SESSION_GAP_MS = 30 * 60_000;

/**
 * Sessions for the UTC days `from` (inclusive) up to `to` (exclusive, default:
 * everything newer). Streams the rows once, in storage order.
 */
export function* readSessions(db: Db, from: string, to?: string): Generator<Session> {
  const rows = db
    .prepare(
      `SELECT day, visitor, ts, path, ref_host, from_path, utm_source, utm_medium, utm_campaign,
              device, lang
         FROM pageviews WHERE day >= @from AND (@to IS NULL OR day < @to)
        ORDER BY day, visitor, ts`,
    )
    .iterate({ from, to: to ?? null }) as IterableIterator<PageView>;

  let key = "";
  let last = 0;
  let current: Session | null = null;

  for (const r of rows) {
    const k = `${r.day}:${r.visitor}`;
    if (current && (k !== key || r.ts - last > SESSION_GAP_MS)) {
      yield current;
      current = null;
    }
    key = k;
    last = r.ts;
    if (!current) {
      current = { start: r.ts, end: r.ts, pages: [r.path], times: [r.ts], entry: r };
      continue;
    }
    current.end = r.ts;
    // A reload is not a step.
    if (current.pages[current.pages.length - 1] !== r.path) {
      current.pages.push(r.path);
      current.times.push(r.ts);
    }
  }
  if (current) yield current;
}
