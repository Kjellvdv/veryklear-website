// Rebuilds server/data/datacenter-ranges.json from the providers' own published
// lists and RIPE's routing data. Run it now and then (`npm run ranges:update`),
// review the diff, commit. Stale ranges only let a few more machines through.
// It refuses to write anything if one source fails, so a half list never ships.

import fs from "node:fs";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "..", "server", "data", "datacenter-ranges.json");

// Networks that are servers, not homes or offices. Deliberately absent: Cloudflare
// and Apple's relay partners (people browse through those), Google's own AS15169
// (Chrome, Search and the public DNS sit there; Google Cloud has its own list).
const ASNS = {
  24940: "Hetzner",
  16276: "OVH",
  51167: "Contabo",
  20473: "Vultr",
  63949: "Akamai Connected Cloud (Linode)",
  12876: "Scaleway",
  60781: "Leaseweb NL",
  28753: "Leaseweb DE",
  9009: "M247",
  45102: "Alibaba Cloud",
  37963: "Alibaba (China)",
  45090: "Tencent Cloud",
  132203: "Tencent Cloud (China)",
  136907: "Huawei Cloud",
  8075: "Microsoft (Azure and its link scanners)",
  197540: "netcup",
  47583: "Hostinger",
  398324: "Censys",
  60068: "Datacamp",
};

const get = async (url, as = "json") => {
  const res = await fetch(url, { headers: { "user-agent": "veryklear-ranges-update" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === "json" ? res.json() : res.text();
};

const sources = {
  aws: async () => {
    const d = await get("https://ip-ranges.amazonaws.com/ip-ranges.json");
    return [...d.prefixes.map((p) => p.ip_prefix), ...d.ipv6_prefixes.map((p) => p.ipv6_prefix)];
  },
  gcp: async () => {
    const d = await get("https://www.gstatic.com/ipranges/cloud.json");
    return d.prefixes.map((p) => p.ipv4Prefix ?? p.ipv6Prefix).filter(Boolean);
  },
  oracle: async () => {
    const d = await get("https://docs.oracle.com/iaas/tools/public_ip_ranges.json");
    return d.regions.flatMap((r) => r.cidrs.map((c) => c.cidr));
  },
  digitalocean: async () => {
    const t = await get("https://digitalocean.com/geo/google.csv", "text");
    return t
      .split("\n")
      .map((l) => l.split(",")[0]?.trim())
      .filter((c) => c && /^[0-9a-f:.]+\/\d+$/i.test(c));
  },
};
for (const [asn, name] of Object.entries(ASNS)) {
  sources[`AS${asn} ${name}`] = async () => {
    const d = await get(
      `https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${asn}`,
    );
    const list = d.data.prefixes.map((p) => p.prefix);
    if (list.length === 0) throw new Error(`AS${asn} returned no prefixes`);
    return list;
  };
}

// ---- CIDR to ranges ------------------------------------------------------

function v4Range(cidr) {
  const [addr, bits] = cidr.split("/");
  const len = Number(bits);
  const n = addr.split(".").reduce((acc, p) => acc * 256 + Number(p), 0);
  const size = 2 ** (32 - len);
  const first = Math.floor(n / size) * size;
  return [first, first + size - 1];
}

function v6Top(addr) {
  const [head, tail = ""] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = addr.includes("::")
    ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t]
    : h;
  return BigInt(
    "0x" +
      groups
        .slice(0, 4)
        .map((g) => g.padStart(4, "0"))
        .join(""),
  );
}

function v6Range(cidr) {
  const [addr, bits] = cidr.split("/");
  const len = Number(bits);
  const top = v6Top(addr);
  if (len >= 64) return [top, top];
  const size = 1n << BigInt(64 - len);
  const first = (top / size) * size;
  return [first, first + size - 1n];
}

function merge(ranges) {
  ranges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out = [];
  for (const [first, last] of ranges) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push([first, last]);
      continue;
    }
    // Overlapping or directly adjacent: one range.
    const adjacent = typeof first === "bigint" ? prev[1] + 1n : prev[1] + 1;
    if (first <= adjacent) {
      if (last > prev[1]) prev[1] = last;
    } else out.push([first, last]);
  }
  return out;
}

const counts = {};
const v4 = [];
const v6 = [];
for (const [name, load] of Object.entries(sources)) {
  const cidrs = await load();
  counts[name] = cidrs.length;
  for (const c of cidrs) {
    if (!/^[0-9a-f:.]+\/\d+$/i.test(c)) throw new Error(`${name}: unexpected entry "${c}"`);
    (c.includes(":") ? v6 : v4).push(c.includes(":") ? v6Range(c) : v4Range(c));
  }
  console.log(`${name}: ${cidrs.length}`);
}

const hex = (n) => n.toString(16).padStart(16, "0");
const out = {
  generatedAt: new Date().toISOString(),
  sources: counts,
  v4: merge(v4),
  v6: merge(v6).map(([a, b]) => [hex(a), hex(b)]),
};
fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(
  `Wrote ${out.v4.length} IPv4 and ${out.v6.length} IPv6 ranges to ${path.relative(process.cwd(), OUT)}`,
);
