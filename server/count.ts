import type { Request } from "express";
import { deviceOf, isBot } from "./bots";
import type { Db } from "./db";
import { dayOf, saltFor, visitorHash } from "./visitor";

// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1F\x7F]+/g;

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const out = v.replace(CONTROL, " ").trim().slice(0, max);
  return out === "" ? null : out;
};

/**
 * A real person opening a page, as far as a server can tell. Everything else
 * (assets, crawlers, prefetches, people who asked not to be tracked) is skipped.
 * Old Safari sends no Sec-Fetch headers at all, so their absence must not drop a visit.
 */
export function isNavigation(req: Request): boolean {
  if (req.method !== "GET") return false;
  if (!(req.get("accept") ?? "").includes("text/html")) return false;
  if (isBot(req.get("user-agent") ?? "")) return false;
  if (req.get("dnt") === "1" || req.get("sec-gpc") === "1") return false;
  const dest = req.get("sec-fetch-dest");
  if (dest && dest !== "document") return false;
  if (req.get("sec-purpose") || req.get("purpose")) return false; // prefetch, prerender
  return true;
}

/** Referring site as a hostname. Our own pages and non-web schemes count as direct. */
export function referrerHost(raw: string | undefined, ownHost: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.replace(/^www\./, "");
    if (host === "" || host === ownHost.replace(/^www\./, "")) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
}

/** First language tag of Accept-Language, e.g. "nl-BE". */
export function primaryLanguage(header: string | undefined): string | null {
  const first = (header ?? "").split(",")[0]?.split(";")[0]?.trim() ?? "";
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(first) ? first.slice(0, 16) : null;
}

export type Counter = (req: Request, path: string) => void;

export function createCounter(db: Db, now: () => number): Counter {
  const insert = db.prepare(`
    INSERT INTO pageviews
      (ts, day, path, ref_host, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       device, lang, visitor)
    VALUES (@ts, @day, @path, @ref_host, @utm_source, @utm_medium, @utm_campaign, @utm_content,
            @utm_term, @device, @lang, @visitor)`);

  return (req, path) => {
    if (!isNavigation(req)) return;
    try {
      const ts = now();
      const day = dayOf(ts);
      const ua = req.get("user-agent") ?? "";
      const q = req.query as Record<string, unknown>;
      insert.run({
        ts,
        day,
        path,
        ref_host: referrerHost(req.get("referer"), req.hostname),
        utm_source: clean(q.utm_source, 100),
        utm_medium: clean(q.utm_medium, 100),
        utm_campaign: clean(q.utm_campaign, 100),
        utm_content: clean(q.utm_content, 100),
        utm_term: clean(q.utm_term, 100),
        device: deviceOf(ua),
        lang: primaryLanguage(req.get("accept-language")),
        // The IP exists on this one line and nowhere else.
        visitor: visitorHash(saltFor(db, day), req.ip ?? "", ua),
      });
    } catch (err) {
      // A counting fault must never cost a visitor the page. Message only: no request data.
      console.error("❌ [count]", err instanceof Error ? err.message : String(err));
    }
  };
}
