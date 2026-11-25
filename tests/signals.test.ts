import request from "supertest";
import { describe, expect, it } from "vitest";
import { purge } from "../server/db";
import { languageGroup, MAX_SIGNATURES_PER_DAY, signatureOf } from "../server/signals";
import { basic, CHROME_UA, DAY, HOST, nav, PASSWORD, PHONE_UA, rows, setup, UA } from "./helpers";

const fake = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] }) as never;

const CHROME_131 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("what a signature is made of", () => {
  it("reduces a real Chrome navigation to short values", () => {
    const sig = signatureOf(
      fake({
        "user-agent": CHROME_131,
        "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "accept-encoding": "gzip, deflate, br, zstd",
        priority: "u=0, i",
        "upgrade-insecure-requests": "1",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      }),
      { ref: "d", device: "desktop" },
    );
    expect(sig).toBe(
      "fam=chrome|ver=131|uaos=windows|chos=windows|chua=y|sfs=none|sfu=1|enc=zstd|prio=y|uir=1|acc=chrome|ref=d|dev=desktop",
    );
  });

  it("exposes a headless browser that borrowed a Windows user agent", () => {
    const sig = signatureOf(
      fake({
        "user-agent": CHROME_131,
        "sec-ch-ua": '"HeadlessChrome";v="131", "Chromium";v="131"',
        "sec-ch-ua-platform": '"Linux"',
        "sec-fetch-site": "same-origin",
        "accept-encoding": "gzip, deflate",
        accept: "text/html,*/*",
      }),
      { ref: "o", device: "desktop" },
    );
    expect(sig).toContain("uaos=windows|chos=linux|chua=headless");
    expect(sig).toContain("sfs=same-origin|sfu=-|enc=gzip|prio=-|uir=-|acc=other|ref=o");
  });

  it("marks what a browser did not send as a dash, and unknown values as other", () => {
    const sig = signatureOf(
      fake({
        "user-agent": UA,
        "sec-fetch-site": "something-new",
        "sec-ch-ua-platform": '"Plan 9"',
      }),
      { ref: "x", device: "robot" },
    );
    expect(sig).toBe(
      "fam=safari|ver=17|uaos=macos|chos=other|chua=-|sfs=other|sfu=-|enc=-|prio=-|uir=-|acc=other|ref=x|dev=other",
    );
  });

  it("holds nothing but short fixed tokens and numbers", () => {
    const sig = signatureOf(fake({ "user-agent": PHONE_UA }), { ref: "d", device: "mobile" });
    expect(sig).toMatch(/^([a-z]+=[a-z0-9-]+)(\|[a-z]+=[a-z0-9-]+)*$/);
    expect(sig).not.toContain("AppleWebKit");
    expect(sig).not.toContain("605.1.15");
    expect(sig).not.toContain("iPhone");
  });

  it("groups languages", () => {
    expect(languageGroup("en-US")).toBe("en-US");
    expect(languageGroup("EN-us")).toBe("en-US");
    expect(languageGroup("nl-BE")).toBe("local");
    expect(languageGroup("fr")).toBe("local");
    expect(languageGroup("de-AT")).toBe("local");
    expect(languageGroup("en-GB")).toBe("other");
    expect(languageGroup("zh-CN")).toBe("other");
    expect(languageGroup(null)).toBe("other");
  });
});

describe("tallying signatures", () => {
  const on = { env: { SIGNAL_TALLY: "on" } };
  const signals = (db: ReturnType<typeof setup>["db"]) => rows(db, "signals");

  it("is off by default and writes nothing", async () => {
    const { app, db } = setup();
    await nav(app, "/");
    expect(signals(db)).toHaveLength(0);
  });

  it("tallies a counted visit under its language group, per day", async () => {
    const { app, db } = setup(on);
    await nav(app, "/", { headers: { "Accept-Language": "en-US,en;q=0.9" } });
    await nav(app, "/diensten", { headers: { "Accept-Language": "en-US,en;q=0.9" } });
    await nav(app, "/", { ua: CHROME_UA, headers: { "Accept-Language": "nl-BE,nl;q=0.9" } });
    const all = signals(db);
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.grp === "en-US")).toMatchObject({ day: "2026-10-13", n: 2 });
    expect(all.find((r) => r.grp === "local")).toMatchObject({ n: 1 });
    expect(all.every((r) => String(r.sig).startsWith("fam="))).toBe(true);
  });

  it("tallies a datacenter visit as its own group, for comparison, and nothing else filtered", async () => {
    const { app, db } = setup({ ...on, isDatacenter: (ip) => ip === "198.51.100.99" });
    await nav(app, "/", { ip: "198.51.100.99" });
    await nav(app, "/", { ua: "curl/8.4.0" }); // announced tool
    await nav(app, "/", { headers: { "Accept-Language": null } }); // no language
    await nav(app, "/", { headers: { DNT: "1" } }); // asked not to be tracked
    expect(signals(db).map((r) => r.grp)).toEqual(["datacenter"]);
  });

  it("never keeps an address, a visitor hash, a path or a user agent", async () => {
    const { app, db } = setup(on);
    await nav(app, "/diensten?utm_source=secret", { ip: "198.51.100.23", ua: PHONE_UA });
    const dump = JSON.stringify(signals(db));
    for (const forbidden of [
      "198.51.100.23",
      "diensten",
      "secret",
      "iPhone",
      "AppleWebKit",
      "15E148",
    ]) {
      expect(dump).not.toContain(forbidden);
    }
    const visitor = (rows(db)[0] as { visitor: string }).visitor;
    expect(dump).not.toContain(visitor);
  });

  it("stops adding new signatures past the daily cap and keeps counting them in one bucket", async () => {
    const { app, db } = setup(on);
    const over = 6;
    for (let v = 1; v <= MAX_SIGNATURES_PER_DAY + over; v++) {
      await nav(app, "/", {
        ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
      });
    }
    const all = signals(db);
    expect(all).toHaveLength(MAX_SIGNATURES_PER_DAY + 1);
    expect(all.find((r) => r.sig === "(overflow)")).toMatchObject({ n: over });
  }, 30_000);

  it("is purged with the rest after retention", async () => {
    const { app, db, advance, now } = setup(on);
    await nav(app, "/");
    advance(3 * DAY);
    await nav(app, "/");
    expect(signals(db)).toHaveLength(2);
    purge(db, now(), 2);
    expect(signals(db)).toHaveLength(1);
  });
});

describe("the signals in the report", () => {
  const get = (app: ReturnType<typeof setup>["app"], url: string) =>
    request(app).get(url).set("Host", HOST).set("Authorization", basic("kjell", PASSWORD));

  it("turns the totals into one small table per header feature, per group", async () => {
    const { app } = setup({ env: { SIGNAL_TALLY: "on" } });
    for (let i = 0; i < 3; i++) {
      await nav(app, "/", {
        ua: CHROME_UA,
        headers: { "Accept-Language": "en-US", "Sec-Fetch-User": "?1" },
      });
    }
    await nav(app, "/", { ua: UA, headers: { "Accept-Language": "nl-BE" } });
    const { signals } = (await get(app, "/numeros.json?days=7")).body.data;
    expect(signals.groups).toEqual([
      { grp: "en-US", requests: 3 },
      { grp: "local", requests: 1 },
    ]);
    const fam = signals.components.find((c: { key: string }) => c.key === "fam");
    expect(fam.values).toEqual([
      { value: "chrome", counts: { "en-US": 3 } },
      { value: "safari", counts: { local: 1 } },
    ]);
    const html = (await get(app, "/numeros?tab=quality&days=7")).text;
    expect(html).toContain("Request signals (measuring phase)");
    expect(html).toContain("Sec-Fetch-User");
  });

  it("shows nothing about signals while none were tallied", async () => {
    const { app } = setup();
    await nav(app, "/");
    expect((await get(app, "/numeros.json?days=7")).body.data.signals).toBeNull();
    expect((await get(app, "/numeros?tab=quality&days=7")).text).not.toContain("measuring phase");
  });
});
