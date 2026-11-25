import type { Request } from "express";

/**
 * A measuring aid, switched on with SIGNAL_TALLY=on. It keeps daily totals of how
 * counted requests look at the header level, so the traffic that passes every
 * filter can be told apart from the people it imitates. Nothing identifies a
 * request: no address, no visitor hash, no path, no user agent. Each header is
 * reduced to a short value from a fixed list, and the values are joined into a
 * "signature" that is only ever counted per day and group.
 */
export const MAX_SIGNATURES_PER_DAY = 400;

export type SignalGroup = "en-US" | "local" | "other" | "datacenter";

/** en-US is the crowd under suspicion, local (Dutch, French, German) is mostly people. */
export function languageGroup(lang: string | null): Exclude<SignalGroup, "datacenter"> {
  if (lang?.toLowerCase() === "en-us") return "en-US";
  if (lang && /^(nl|fr|de)(-|$)/i.test(lang)) return "local";
  return "other";
}

function family(ua: string): { fam: string; ver: string } {
  const tries: [string, RegExp][] = [
    ["edge", /\bEdg(?:e|A|iOS)?\/(\d{1,3})/],
    ["opera", /\bOPR\/(\d{1,3})/],
    ["samsung", /\bSamsungBrowser\/(\d{1,3})/],
    ["firefox", /\b(?:Firefox|FxiOS)\/(\d{1,3})/],
    ["chrome", /\b(?:Chrome|CriOS)\/(\d{1,3})/],
    ["safari", /\bVersion\/(\d{1,3})\.\d+.*\bSafari\//],
  ];
  for (const [fam, re] of tries) {
    const m = re.exec(ua);
    if (m) return { fam, ver: m[1] ?? "-" };
  }
  return { fam: "other", ver: "-" };
}

function uaPlatform(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/CrOS/.test(ua)) return "chromeos";
  if (/Linux|X11/.test(ua)) return "linux";
  return "other";
}

function hintPlatform(raw: string | undefined): string {
  if (!raw) return "-";
  const v = raw.replace(/"/g, "").trim().toLowerCase();
  if (v === "chrome os" || v === "chromium os") return "chromeos";
  return ["windows", "macos", "linux", "android", "ios"].includes(v) ? v : "other";
}

function oneOf(v: string | undefined, allowed: readonly string[]): string {
  if (v === undefined) return "-";
  return allowed.includes(v) ? v : "other";
}

function encoding(raw: string | undefined): string {
  const v = (raw ?? "").toLowerCase();
  if (/\bzstd\b/.test(v)) return "zstd";
  if (/\bbr\b/.test(v)) return "br";
  if (/\bgzip\b/.test(v)) return "gzip";
  return "-";
}

/** Which browser's default Accept header this resembles. A mismatch with the family is a tell. */
function acceptStyle(raw: string | undefined): string {
  const v = raw ?? "";
  if (v.includes("image/apng")) return "chrome";
  if (v.includes("image/svg+xml")) return "firefox";
  if (v.startsWith("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"))
    return "safari";
  return "other";
}

export interface SignalContext {
  /** d = direct, o = one of our own pages, x = another site. */
  ref: "d" | "o" | "x";
  device: string;
}

/** The ordered parts of a signature. Every value comes from a short fixed list or a version number. */
export function signalParts(req: Request, ctx: SignalContext): [string, string][] {
  const ua = req.get("user-agent") ?? "";
  const { fam, ver } = family(ua);
  const hints = req.get("sec-ch-ua");
  return [
    ["fam", fam],
    ["ver", ver],
    ["uaos", uaPlatform(ua)],
    ["chos", hintPlatform(req.get("sec-ch-ua-platform"))],
    ["chua", hints === undefined ? "-" : /headless/i.test(hints) ? "headless" : "y"],
    ["sfs", oneOf(req.get("sec-fetch-site"), ["none", "same-origin", "same-site", "cross-site"])],
    ["sfu", req.get("sec-fetch-user") === "?1" ? "1" : "-"],
    ["enc", encoding(req.get("accept-encoding"))],
    ["prio", req.get("priority") === undefined ? "-" : "y"],
    ["uir", req.get("upgrade-insecure-requests") === "1" ? "1" : "-"],
    ["acc", acceptStyle(req.get("accept"))],
    ["ref", ctx.ref],
    ["dev", oneOf(ctx.device, ["desktop", "mobile", "tablet"])],
  ];
}

export const signatureOf = (req: Request, ctx: SignalContext): string =>
  signalParts(req, ctx)
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
