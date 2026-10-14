import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";
import { openDb } from "../server/db";
import {
  createMatcher,
  loadMatcher,
  RANGES_FILE,
  type RangeFile,
  v6Top,
} from "../server/datacenter";
import { FIXTURE, nav, PASSWORD, rows } from "./helpers";

// 10.0.0.0/8, 192.0.2.0/24 and the IPv6 block 2001:db8:aaaa::/48.
const SAMPLE = {
  v4: [
    [167_772_160, 184_549_375],
    [3_221_225_984, 3_221_226_239],
  ] as [number, number][],
  v6: [["20010db8aaaa0000", "20010db8aaaaffff"]] as [string, string][],
};

describe("datacenter matcher", () => {
  const isFarm = createMatcher(SAMPLE);

  it("matches addresses inside a range, edges included, and nothing outside", () => {
    expect(isFarm("10.0.0.0")).toBe(true);
    expect(isFarm("10.255.255.255")).toBe(true);
    expect(isFarm("11.0.0.0")).toBe(false);
    expect(isFarm("9.255.255.255")).toBe(false);
    expect(isFarm("192.0.2.77")).toBe(true);
    expect(isFarm("192.0.3.1")).toBe(false);
  });

  it("matches IPv6 on the first 64 bits, in any spelling", () => {
    expect(isFarm("2001:db8:aaaa::1")).toBe(true);
    expect(isFarm("2001:0db8:aaaa:0042:ffff:ffff:ffff:ffff")).toBe(true);
    expect(isFarm("2001:db8:bbbb::1")).toBe(false);
    expect(isFarm("::1")).toBe(false);
  });

  it("sees through an IPv4 address mapped into IPv6", () => {
    expect(isFarm("::ffff:10.1.2.3")).toBe(true);
    expect(isFarm("::ffff:11.1.2.3")).toBe(false);
  });

  it("treats anything unparseable as not a data centre", () => {
    for (const junk of ["", "not-an-ip", "999.1.1.1", "1.2.3", "2001:::1", "1:2:3:4:5:6:7:8:9"]) {
      expect(isFarm(junk)).toBe(false);
    }
  });

  it("parses IPv6 shorthand", () => {
    expect(v6Top("::")).toBe(0n);
    expect(v6Top("1::")).toBe(0x0001_0000_0000_0000n);
    expect(v6Top("2001:db8::ff00:42:8329")).toBe(0x2001_0db8_0000_0000n);
    expect(v6Top("fe80::1%eth0")).toBe(0xfe80_0000_0000_0000n);
  });

  it("turns the rule off, loudly, when the ranges file is missing or broken", () => {
    expect(loadMatcher("/nonexistent/ranges.json")("3.4.12.4")).toBe(false);
  });
});

describe("the bundled ranges", () => {
  const data = JSON.parse(fs.readFileSync(RANGES_FILE, "utf8")) as RangeFile;
  const isFarm = createMatcher(data);

  it("are sorted and do not overlap, which the lookup relies on", () => {
    for (let i = 1; i < data.v4.length; i++) {
      expect((data.v4[i] as [number, number])[0]).toBeGreaterThan(
        (data.v4[i - 1] as [number, number])[1],
      );
    }
    for (let i = 1; i < data.v6.length; i++) {
      const prev = BigInt("0x" + (data.v6[i - 1] as [string, string])[1]);
      expect(BigInt("0x" + (data.v6[i] as [string, string])[0])).toBeGreaterThan(prev);
    }
  });

  it("flag cloud providers and leave ordinary access networks alone", () => {
    expect(isFarm("3.4.12.4")).toBe(true); // AWS
    expect(isFarm("95.216.0.1")).toBe(true); // Hetzner
    expect(isFarm("34.120.0.1")).toBe(true); // Google Cloud
    for (const ip of ["8.8.8.8", "1.1.1.1", "104.16.0.1", "17.253.144.10", "81.82.12.34"]) {
      expect(isFarm(ip)).toBe(false); // Google DNS, Cloudflare, Apple, a Belgian ISP
    }
  });
});

describe("the server's default wiring", () => {
  it("leaves out a visit from a cloud network and counts one from a home connection", async () => {
    const db = openDb(":memory:");
    const cfg = loadConfig({
      REPORT_PASSWORD: PASSWORD,
      DIST_DIR: FIXTURE,
      DATACENTER_FILTER: "on",
    } as NodeJS.ProcessEnv);
    const app = createApp({ db, cfg }); // no isDatacenter given: the bundled ranges
    await nav(app, "/", { ip: "3.4.12.4" }); // AWS
    await nav(app, "/", { ip: "81.82.12.34" }); // a Belgian ISP
    expect(rows(db)).toHaveLength(1);
    expect(rows(db, "filtered")).toMatchObject([{ reason: "datacenter", n: 1 }]);
  });

  it("does nothing unless DATACENTER_FILTER is on", async () => {
    const db = openDb(":memory:");
    const cfg = loadConfig({ REPORT_PASSWORD: PASSWORD, DIST_DIR: FIXTURE } as NodeJS.ProcessEnv);
    expect(cfg.DATACENTER_FILTER).toBe("off");
    const app = createApp({ db, cfg });
    await nav(app, "/", { ip: "3.4.12.4" }); // AWS, but the rule is off
    expect(rows(db)).toHaveLength(1);
    expect(rows(db, "filtered")).toHaveLength(0);
  });
});
