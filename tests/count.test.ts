import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { isNavigation, primaryLanguage, referrerOf } from "../server/count";
import { migrate, purge } from "../server/db";
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

  it("records a click from one of our own pages as the source page, not as a referring site", async () => {
    const { app, db } = setup();
    await nav(app, "/contact", {
      ua: UA,
      headers: { Referer: "https://www.veryklear.com/diensten/" },
    });
    expect(rows(db)[0]).toMatchObject({
      path: "/contact",
      ref_host: null,
      from_path: "/diensten",
      device: "desktop",
    });
  });

  it("asks browsers to send the referrer to our own pages only", async () => {
    const { app } = setup();
    expect((await nav(app, "/")).headers["referrer-policy"]).toBe("same-origin");
    const { default: request } = await import("supertest");
    const report = await request(app).get("/numeros").set("Host", "www.veryklear.com");
    expect(report.headers["referrer-policy"]).toBe("no-referrer");
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

  it("splits a referrer into another site's host or one of our own pages", () => {
    const own = "www.veryklear.com";
    expect(referrerOf("https://www.linkedin.com/feed/", own)).toEqual({
      host: "linkedin.com",
      fromPath: null,
    });
    expect(referrerOf("https://veryklear.com/x/?a=1#b", own)).toEqual({
      host: null,
      fromPath: "/x",
    });
    expect(referrerOf("https://www.veryklear.com/", own)).toEqual({ host: null, fromPath: "/" });
    expect(referrerOf("android-app://com.linkedin.android", own)).toEqual({
      host: null,
      fromPath: null,
    });
    expect(referrerOf("not a url", own)).toEqual({ host: null, fromPath: null });
    expect(referrerOf(undefined, own)).toEqual({ host: null, fromPath: null });
  });

  it("adds the from_path column to a database from before it existed", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE pageviews (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, day TEXT NOT NULL,
      path TEXT NOT NULL, ref_host TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
      utm_content TEXT, utm_term TEXT, device TEXT NOT NULL, lang TEXT, visitor TEXT NOT NULL)`);
    migrate(db);
    migrate(db); // idempotent
    const cols = (db.prepare("PRAGMA table_info(pageviews)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("from_path");
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
