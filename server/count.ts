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
 * Why a page request is not counted as a visit. "ignore" is silent: assets,
 * prefetches and people who asked not to be tracked leave no trace at all. The
 * other reasons are automated traffic, kept as plain daily totals so the numbers
 * page can show what the filter caught. No identifier is attached to any of them.
 */
export type Verdict = "count" | "ignore" | "bot" | "not-a-browser" | "no-language" | "datacenter";

/**
 * Browsers that send Sec-Fetch-Mode and Sec-Fetch-Dest on every navigation:
 * Chrome (and everything built on it) from 80, Firefox from 90, Safari from 16.4.
 * A user agent that claims one of these but sends neither header is an HTTP
 * client wearing a browser's name. Older versions and other agents (in-app
 * browsers, Firefox on iOS) send nothing predictable, so they are not judged.
 */
export function claimsModernBrowser(ua: string): boolean {
  const chrome = /\bChrome\/(\d+)/.exec(ua);
  if (chrome) return Number(chrome[1]) >= 80;
  const firefox = /\bFirefox\/(\d+)/.exec(ua);
  if (firefox) return Number(firefox[1]) >= 90;
  const safari = /\bVersion\/(\d+)\.(\d+).*\bSafari\//.exec(ua);
  if (safari) {
    const major = Number(safari[1]);
    return major > 16 || (major === 16 && Number(safari[2]) >= 4);
  }
  return false;
}

/**
 * What a request is, judged on its headers alone. The network check comes after,
 * in the counter, because it needs the IP address.
 */
export function classify(req: Request): Verdict {
  if (req.method !== "GET") return "ignore";
  if (!(req.get("accept") ?? "").includes("text/html")) return "ignore";
  if (req.get("dnt") === "1" || req.get("sec-gpc") === "1") return "ignore";
  if (req.get("sec-purpose") || req.get("purpose")) return "ignore"; // prefetch, prerender
  const dest = req.get("sec-fetch-dest");
  if (dest && dest !== "document") return "ignore";

  const ua = req.get("user-agent") ?? "";
  if (isBot(ua)) return "bot";
  if (claimsModernBrowser(ua) && (dest !== "document" || req.get("sec-fetch-mode") !== "navigate"))
    return "not-a-browser";
  // Every real browser sends a language. A script that borrowed a browser's
  // headers usually forgot this one.
  if ((req.get("accept-language") ?? "").trim() === "") return "no-language";
  return "count";
}

export interface Referrer {
  /** Another site, hostname only. */
  host: string | null;
  /** One of our own pages, when the visitor clicked through from it. */
  fromPath: string | null;
}

const NO_REFERRER: Referrer = { host: null, fromPath: null };

/**
 * Where the request came from: another site (host only, nothing more) or one of
 * our own pages (its path, so clicks to the booking page can be traced to the page
 * they were on). Non-web schemes count as direct.
 */
export function referrerOf(raw: string | undefined, ownHost: string): Referrer {
  if (!raw) return NO_REFERRER;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return NO_REFERRER;
    const host = url.hostname.replace(/^www\./, "");
    if (host === "") return NO_REFERRER;
    if (host === ownHost.replace(/^www\./, "")) {
      return { host: null, fromPath: clean(url.pathname.replace(/\/+$/, "") || "/", 300) };
    }
    return { host: host.slice(0, 100), fromPath: null };
  } catch {
    return NO_REFERRER;
  }
}

/** First language tag of Accept-Language, e.g. "nl-BE". */
export function primaryLanguage(header: string | undefined): string | null {
  const first = (header ?? "").split(",")[0]?.split(";")[0]?.trim() ?? "";
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(first) ? first.slice(0, 16) : null;
}

export type Counter = (req: Request, path: string) => void;

export function createCounter(
  db: Db,
  now: () => number,
  isDatacenter: (ip: string) => boolean = () => false,
): Counter {
  const insert = db.prepare(`
    INSERT INTO pageviews
      (ts, day, path, ref_host, from_path, utm_source, utm_medium, utm_campaign, utm_content,
       utm_term, device, lang, visitor)
    VALUES (@ts, @day, @path, @ref_host, @from_path, @utm_source, @utm_medium, @utm_campaign,
            @utm_content, @utm_term, @device, @lang, @visitor)`);
  const tally = db.prepare(`
    INSERT INTO filtered (day, reason, n) VALUES (?, ?, 1)
    ON CONFLICT (day, reason) DO UPDATE SET n = n + 1`);

  return (req, path) => {
    let verdict = classify(req);
    if (verdict === "ignore") return;
    try {
      const ts = now();
      const day = dayOf(ts);
      // The IP is compared to the ranges here and hashed below. Nowhere else.
      if (verdict === "count" && isDatacenter(req.ip ?? "")) verdict = "datacenter";
      if (verdict !== "count") {
        tally.run(day, verdict);
        return;
      }
      const ua = req.get("user-agent") ?? "";
      const q = req.query as Record<string, unknown>;
      const ref = referrerOf(req.get("referer"), req.hostname);
      insert.run({
        ts,
        day,
        path,
        ref_host: ref.host,
        from_path: ref.fromPath,
        utm_source: clean(q.utm_source, 100),
        utm_medium: clean(q.utm_medium, 100),
        utm_campaign: clean(q.utm_campaign, 100),
        utm_content: clean(q.utm_content, 100),
        utm_term: clean(q.utm_term, 100),
        device: deviceOf(ua),
        lang: primaryLanguage(req.get("accept-language")),
        visitor: visitorHash(saltFor(db, day), req.ip ?? "", ua),
      });
    } catch (err) {
      // A counting fault must never cost a visitor the page. Message only: no request data.
      console.error("❌ [count]", err instanceof Error ? err.message : String(err));
    }
  };
}
