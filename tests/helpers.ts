import path from "node:path";
import request from "supertest";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import { openDb } from "../server/db";

export const PASSWORD = "correct-horse-battery";
export const FIXTURE = path.join(import.meta.dirname, "fixtures", "site");
export const HOST = "www.veryklear.com";
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
export const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
export const DAY = 86_400_000;
/** A Chrome that must send Sec-Fetch headers, and an old Safari that predates them. */
export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
export const OLD_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15";

export function setup(
  opts: {
    start?: number;
    env?: Record<string, string>;
    isDatacenter?: (ip: string) => boolean;
  } = {},
) {
  let now = opts.start ?? Date.UTC(2026, 9, 13, 12, 0, 0);
  const db = openDb(":memory:");
  const cfg = loadConfig({
    REPORT_PASSWORD: PASSWORD,
    DIST_DIR: FIXTURE,
    ...opts.env,
  } as NodeJS.ProcessEnv);
  const app = createApp({
    db,
    cfg,
    now: () => now,
    isDatacenter: opts.isDatacenter ?? (() => false),
  });
  return {
    app,
    db,
    cfg,
    now: () => now,
    set: (ms: number) => void (now = ms),
    advance: (ms: number) => void (now += ms),
  };
}

type App = ReturnType<typeof createApp>;

interface NavOptions {
  ua?: string;
  ip?: string;
  host?: string;
  /** Extra headers; `null` removes one of the browser defaults below. */
  headers?: Record<string, string | null>;
}

/** A GET the way a browser makes it when a person opens a page. */
export function nav(
  app: App,
  url: string,
  { ua = UA, ip = "203.0.113.7", host = HOST, headers = {} }: NavOptions = {},
) {
  const defaults: Record<string, string> = {
    Host: host,
    "User-Agent": ua,
    "X-Forwarded-For": ip,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "nl-BE,nl;q=0.9,en;q=0.8",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
  };
  for (const [k, v] of Object.entries(headers)) {
    if (v === null) delete defaults[k];
    else defaults[k] = v;
  }
  let req = request(app).get(url);
  for (const [k, v] of Object.entries(defaults)) req = req.set(k, v);
  return req;
}

export const basic = (user: string, pass: string) =>
  "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

export const rows = (db: ReturnType<typeof openDb>, table = "pageviews") =>
  db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
