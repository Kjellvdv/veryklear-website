import fs from "node:fs";
import path from "node:path";

/**
 * Networks that rent out servers (cloud providers, hosters) and the scanners that
 * run on them. A person reading a Belgian consultancy's site does not do so from a
 * data centre, so a hit from one of these is a machine however its headers look.
 *
 * The IP is only compared to these ranges and then forgotten: it is never stored
 * or logged. The ranges come from the providers' own published lists and RIPE's
 * routing data, refreshed by `npm run ranges:update`.
 */
export interface RangeFile {
  generatedAt: string;
  /** How many networks each source contributed, for the record. */
  sources: Record<string, number>;
  /** Sorted, non-overlapping [first, last] IPv4 addresses as unsigned integers. */
  v4: [number, number][];
  /** The same for IPv6, on the first 64 bits only, as 16 hex digits. */
  v6: [string, string][];
}

export type DatacenterCheck = (ip: string) => boolean;

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

/** The first 64 bits of an IPv6 address, which is as much as any provider range needs. */
export function v6Top(ip: string): bigint | null {
  let s = ip.split("%")[0] ?? "";
  const tail4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail4) {
    const n = v4ToInt(tail4[2] ?? "");
    if (n === null) return null;
    s = `${tail4[1]}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return BigInt(
    "0x" +
      groups
        .slice(0, 4)
        .map((g) => g.padStart(4, "0"))
        .join(""),
  );
}

/** `::ffff:1.2.3.4` is an IPv4 address that arrived over a dual-stack socket. */
function unmap(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? (m[1] ?? ip) : ip;
}

function search<T extends number | bigint>(ranges: [T, T][], n: T): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [first, last] = ranges[mid] as [T, T];
    if (n < first) hi = mid - 1;
    else if (n > last) lo = mid + 1;
    else return true;
  }
  return false;
}

export function createMatcher(data: Pick<RangeFile, "v4" | "v6">): DatacenterCheck {
  const v6 = data.v6.map(([a, b]) => [BigInt("0x" + a), BigInt("0x" + b)] as [bigint, bigint]);
  return (rawIp) => {
    const ip = unmap(rawIp.trim());
    if (ip.includes(":")) {
      const top = v6Top(ip);
      return top !== null && search(v6, top);
    }
    const n = v4ToInt(ip);
    return n !== null && search(data.v4, n);
  };
}

export const RANGES_FILE = path.join(import.meta.dirname, "data", "datacenter-ranges.json");

/**
 * Reads the bundled ranges. A missing or broken file turns the rule off with a
 * warning: counting must never stop a page from loading.
 */
export function loadMatcher(file = RANGES_FILE): DatacenterCheck {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as RangeFile;
    const check = createMatcher(data);
    console.log(
      `🛡️ Datacenter ranges: ${data.v4.length} IPv4 and ${data.v6.length} IPv6 blocks, from ${data.generatedAt.slice(0, 10)}`,
    );
    return check;
  } catch (err) {
    console.warn(
      "⚠️ [datacenter] ranges not loaded, rule off:",
      err instanceof Error ? err.message : String(err),
    );
    return () => false;
  }
}
