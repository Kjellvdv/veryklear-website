import { describe, expect, it } from "vitest";
import { isNavigation, primaryLanguage, referrerHost } from "../server/count";
import { purge } from "../server/db";
import { DAY, nav, PHONE_UA, rows, setup, UA } from "./helpers";

describe("what a page visit records", () => {
  it("stores path, referring site, campaign, device and language, and nothing about the person", async () => {
    const { app, db } = setup();
    const res = await nav(
      app,
      "/diensten?utm_source=linkedin&utm_medium=social&utm_campaign=launch&token=secret",
      {
        ua: PHONE_UA,
        headers: { Referer: "https://www.linkedin.com/in/someone-private/" },
      },
    );
    expect(res.status).toBe(200);
    const [row] = rows(db);
    expect(row).toMatchObject({
      path: "/diensten",
      ref_host: "linkedin.com",
      utm_source: "linkedin",
      utm_medium: "social",
      utm_campaign: "launch",
      utm_content: null,
      utm_term: null,
      device: "mobile",
      lang: "nl-BE",
      day: "2026-10-13",
    });
    const dump = JSON.stringify(row);
    expect(dump).not.toContain("secret");
    expect(dump).not.toContain("someone-private");
    expect(dump).not.toContain("203.0.113.7");
    expect(dump).not.toContain("iPhone");
  });

  it("counts our own pages as direct, and desktop as desktop", async () => {
    const { app, db } = setup();
    await nav(app, "/", { ua: UA, headers: { Referer: "https://www.veryklear.com/diensten" } });
    expect(rows(db)[0]).toMatchObject({ ref_host: null, device: "desktop" });
  });

  it("truncates long campaign values and strips control characters", async () => {
    const { app, db } = setup();
    await nav(app, "/?utm_source=" + encodeURIComponent("a\u0000b\u0007" + "x".repeat(200)));
    const src = rows(db)[0]?.utm_source as string;
    expect(src.length).toBe(100);
    // eslint-disable-next-line no-control-regex
    expect(src).not.toMatch(/[\u0000-\u001f]/);
  });

  it("still counts a browser that sends no Sec-Fetch headers", async () => {
    const { app, db } = setup();
    await nav(app, "/", { headers: { "Sec-Fetch-Dest": null, "Sec-Fetch-Mode": null } });
    expect(rows(db)).toHaveLength(1);
  });
});

describe("what is not counted", () => {
  const cases: [string, string, Parameters<typeof nav>[2]][] = [
    [
      "a crawler",
      "/",
      { ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
    ],
    [
      "an AI crawler",
      "/",
      { ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)" },
    ],
    ["curl", "/", { ua: "curl/8.4.0" }],
    ["no user agent", "/", { ua: "" }],
    ["Do Not Track", "/", { headers: { DNT: "1" } }],
    ["Global Privacy Control", "/", { headers: { "Sec-GPC": "1" } }],
    ["a non-HTML accept", "/", { headers: { Accept: "*/*" } }],
    ["an image fetch", "/", { headers: { "Sec-Fetch-Dest": "image" } }],
    ["a prefetch", "/", { headers: { "Sec-Purpose": "prefetch" } }],
    ["a redirect", "/diensten/", {}],
    ["a retired URL", "/strategie", {}],
    ["a missing page", "/nope", {}],
    ["the numbers page", "/numeros", {}],
    ["a share image", "/og/home.png", {}],
    ["a script", "/_astro/a.js", {}],
  ];
  it.each(cases)("%s", async (_label, url, opts) => {
    const { app, db } = setup();
    await nav(app, url, opts);
    expect(rows(db)).toHaveLength(0);
  });

  it("a HEAD request", async () => {
    const { app, db } = setup();
    const { default: request } = await import("supertest");
    await request(app)
      .head("/")
      .set("Host", "www.veryklear.com")
      .set("User-Agent", UA)
      .set("Accept", "text/html");
    expect(rows(db)).toHaveLength(0);
  });
});

describe("privacy", () => {
  it("never writes the IP address or the user agent to the database", async () => {
    const { app, db } = setup();
    const ip = "198.51.100.23";
    await nav(app, "/", { ip });
    await nav(app, "/diensten", { ip });
    const dump = JSON.stringify([rows(db), rows(db, "salts")]);
    expect(dump).not.toContain(ip);
    expect(dump).not.toContain("Macintosh");
    expect(dump).not.toContain("Safari");
  });

  it("gives the same visitor the same hash on one day, and a new one the next day", async () => {
    const { app, db, advance } = setup();
    await nav(app, "/", { ip: "198.51.100.1" });
    await nav(app, "/diensten", { ip: "198.51.100.1" });
    await nav(app, "/", { ip: "198.51.100.2" });
    advance(DAY);
    await nav(app, "/", { ip: "198.51.100.1" });
    const v = rows(db).map((r) => r.visitor as string);
    expect(v[0]).toBe(v[1]);
    expect(v[0]).not.toBe(v[2]);
    expect(v[0]).not.toBe(v[3]);
    expect(v[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  it("deletes salts older than yesterday and rows past retention", async () => {
    const { app, db, advance, now } = setup();
    await nav(app, "/");
    expect(rows(db, "salts")).toHaveLength(1);
    advance(3 * DAY);
    await nav(app, "/");
    expect(rows(db, "salts")).toHaveLength(2);
    purge(db, now(), 400);
    expect(rows(db, "salts")).toHaveLength(1);
    expect(rows(db)).toHaveLength(2);
    purge(db, now(), 2);
    expect(rows(db)).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("reads the first language tag", () => {
    expect(primaryLanguage("nl-BE,nl;q=0.9,en;q=0.8")).toBe("nl-BE");
    expect(primaryLanguage("en")).toBe("en");
    expect(primaryLanguage("*")).toBeNull();
    expect(primaryLanguage(undefined)).toBeNull();
    expect(primaryLanguage("<script>")).toBeNull();
  });

  it("reduces a referrer to its host", () => {
    expect(referrerHost("https://www.linkedin.com/feed/", "www.veryklear.com")).toBe(
      "linkedin.com",
    );
    expect(referrerHost("https://veryklear.com/x", "www.veryklear.com")).toBeNull();
    expect(referrerHost("android-app://com.linkedin.android", "www.veryklear.com")).toBeNull();
    expect(referrerHost("not a url", "www.veryklear.com")).toBeNull();
  });

  it("isNavigation is a pure function of the request", () => {
    const fake = (h: Record<string, string>, method = "GET") =>
      ({ method, get: (k: string) => h[k.toLowerCase()] }) as never;
    expect(isNavigation(fake({ accept: "text/html", "user-agent": UA }))).toBe(true);
    expect(isNavigation(fake({ accept: "text/html", "user-agent": UA }, "HEAD"))).toBe(false);
    expect(
      isNavigation(fake({ accept: "text/html", "user-agent": UA, "sec-fetch-dest": "iframe" })),
    ).toBe(false);
  });
});
