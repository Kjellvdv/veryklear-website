import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config";
import { basic, HOST, nav, PASSWORD, rows, setup } from "./helpers";

const get = (app: ReturnType<typeof setup>["app"], url: string, auth = basic("kjell", PASSWORD)) =>
  request(app).get(url).set("Host", HOST).set("Authorization", auth);

describe("access", () => {
  it("asks for a password and refuses a wrong one", async () => {
    const { app } = setup();
    const none = await request(app).get("/numeros.json").set("Host", HOST);
    expect(none.status).toBe(401);
    expect(none.headers["www-authenticate"]).toContain("Basic");
    expect((await get(app, "/numeros", basic("kjell", "nope"))).status).toBe(401);
  });

  it("accepts the right password with any username, on both forms", async () => {
    const { app } = setup();
    expect((await get(app, "/numeros.json")).body.success).toBe(true);
    const html = await get(app, "/numeros", basic("", PASSWORD));
    expect(html.status).toBe(200);
    expect(html.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(html.headers["x-robots-tag"]).toContain("noindex");
    expect(html.headers["cache-control"]).toBe("no-store");
  });

  it("tells an authorised caller which address and headers the server sees, and nobody else", async () => {
    const { app, db } = setup();
    const none = await request(app).get("/numeros/whoami").set("Host", HOST);
    expect(none.status).toBe(401);
    const res = await get(app, "/numeros/whoami").set("X-Forwarded-For", "198.51.100.9");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ip: "198.51.100.9", forwardedFor: "198.51.100.9" });
    expect(res.headers["cache-control"]).toBe("no-store");
    // Shown to the caller; never kept.
    expect(JSON.stringify([rows(db), rows(db, "filtered")])).not.toContain("198.51.100.9");
  });

  it("lives where REPORT_PATH says, and nowhere else", async () => {
    const { app } = setup({ env: { REPORT_PATH: "/cijfers" } });
    expect((await get(app, "/cijfers.json")).status).toBe(200);
    expect((await get(app, "/numeros")).status).toBe(404);
  });

  it("limits the report to 30 requests a minute per IP, without touching the site", async () => {
    const { app } = setup();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await get(app, "/numeros.json")).status;
    expect(last).toBe(429);
    for (let i = 0; i < 31; i++) last = (await nav(app, "/")).status;
    expect(last).toBe(200);
  });
});

describe("numbers", () => {
  async function seeded() {
    const ctx = setup({ start: Date.UTC(2026, 9, 13, 0, 30) }); // 00:30 UTC today
    const { app, set } = ctx;
    const a = { ip: "198.51.100.1" };
    const b = { ip: "198.51.100.2" };
    await nav(app, "/", a);
    await nav(app, "/diensten", { ...a, headers: { Referer: "https://www.linkedin.com/feed/" } });
    await nav(app, "/?utm_source=linkedin&utm_medium=social&utm_campaign=launch", b);
    // Six days ago at 23:00 still falls inside a 7-day window; seven days ago does not.
    set(Date.UTC(2026, 9, 7, 23, 0));
    await nav(app, "/diensten", a);
    set(Date.UTC(2026, 9, 6, 23, 0));
    await nav(app, "/diensten", a);
    set(Date.UTC(2026, 9, 13, 0, 30));
    // Two clicks through to the contact page: one from /diensten, one typed in.
    await nav(app, "/contact", {
      ...a,
      headers: { Referer: "https://www.veryklear.com/diensten" },
    });
    await nav(app, "/contact", b);
    return ctx;
  }

  it("adds up views, visitors, pages, referrers, campaigns, devices and languages over calendar days", async () => {
    const { app } = await seeded();
    const r = (await get(app, "/numeros.json?days=7")).body.data;
    expect(r.from).toBe("2026-10-07");
    expect(r.to).toBe("2026-10-13");
    expect(r.totals).toEqual({ visitors: 3, views: 6 });
    expect(r.daily).toHaveLength(7);
    expect(r.daily.reduce((n: number, d: { views: number }) => n + d.views, 0)).toBe(
      r.totals.views,
    );
    expect(r.daily[0]).toEqual({ day: "2026-10-07", views: 1, visitors: 1 });
    expect(r.daily.at(-1)).toEqual({ day: "2026-10-13", views: 5, visitors: 2 });
    expect(r.pages).toHaveLength(3);
    expect(r.pages).toContainEqual({ path: "/diensten", visitors: 2, views: 2 });
    expect(r.pages).toContainEqual({ path: "/contact", visitors: 2, views: 2 });
    expect(r.routes).toEqual([
      { target: "/contact", source: "(direct)", visitors: 1, views: 1 },
      { target: "/contact", source: "/diensten", visitors: 1, views: 1 },
    ]);
    expect(r.referrers).toContainEqual({ source: "linkedin.com", visitors: 1, views: 1 });
    expect(r.referrers).toContainEqual({ source: "(direct)", visitors: 3, views: 5 });
    expect(r.campaigns).toEqual([
      { source: "linkedin", medium: "social", campaign: "launch", visitors: 1, views: 1 },
    ]);
    expect(r.devices).toEqual([{ device: "desktop", visitors: 3, views: 6 }]);
    expect(r.languages).toEqual([{ lang: "nl-BE", visitors: 3, views: 6 }]);
  });

  it("falls back to 30 days for an unknown range", async () => {
    const { app } = await seeded();
    const r = (await get(app, "/numeros.json?days=3")).body.data;
    expect(r.days).toBe(30);
    expect(r.totals.views).toBe(7);
  });

  it("escapes everything it prints", async () => {
    const { app } = setup();
    await nav(app, "/?utm_campaign=" + encodeURIComponent("<script>alert(1)</script>"), {
      headers: { Referer: "https://evil.example/<img src=x onerror=alert(1)>" },
    });
    const res = await get(app, "/numeros");
    expect(res.text).not.toContain("<script>alert(1)");
    expect(res.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(res.text).not.toContain("<img src=x");
  });
});

describe("config", () => {
  it("names the bad keys and never prints their values", () => {
    expect(() => loadConfig({ REPORT_PASSWORD: "short" } as NodeJS.ProcessEnv)).toThrow(
      /REPORT_PASSWORD/,
    );
    try {
      loadConfig({
        REPORT_PASSWORD: "super-secret-value-123",
        REPORT_PATH: "numeros",
      } as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain("REPORT_PATH");
      expect(String(e)).not.toContain("super-secret-value-123");
    }
  });

  it("keeps the database on the Railway volume", () => {
    const base = { REPORT_PASSWORD: "correct-horse-battery", RAILWAY_VOLUME_MOUNT_PATH: "/data" };
    expect(loadConfig({ ...base } as NodeJS.ProcessEnv).DATA_DIR).toBe("/data");
    expect(loadConfig({ ...base, DATA_DIR: "/data/" } as NodeJS.ProcessEnv).DATA_DIR).toBe(
      "/data/",
    );
    expect(loadConfig({ ...base, DATA_DIR: "/data/db" } as NodeJS.ProcessEnv).DATA_DIR).toBe(
      "/data/db",
    );
    expect(() => loadConfig({ ...base, DATA_DIR: "/data," } as NodeJS.ProcessEnv)).toThrow(
      /vanish/,
    );
    expect(() => loadConfig({ ...base, DATA_DIR: "data" } as NodeJS.ProcessEnv)).toThrow(
      /DATA_DIR/,
    );
    expect(() => loadConfig({ ...base, DATA_DIR: "/database" } as NodeJS.ProcessEnv)).toThrow(
      /vanish/,
    );
    // Without a volume (local dev) any folder is fine and "data" is the default.
    expect(
      loadConfig({ REPORT_PASSWORD: "correct-horse-battery" } as NodeJS.ProcessEnv).DATA_DIR,
    ).toBe("data");
  });

  it("defaults the report path and treats an empty canonical host as unset", () => {
    const cfg = loadConfig({
      REPORT_PASSWORD: "correct-horse-battery",
      CANONICAL_HOST: "",
    } as NodeJS.ProcessEnv);
    expect(cfg.REPORT_PATH).toBe("/numeros");
    expect(cfg.CANONICAL_HOST).toBeUndefined();
    expect(cfg.RETENTION_DAYS).toBe(400);
  });
});

describe("session flows", () => {
  const MIN = 60_000;
  const A = { ip: "198.51.100.1" };
  const B = { ip: "198.51.100.2" };
  const C = { ip: "198.51.100.3" };
  const D = { ip: "198.51.100.4" };

  async function walked() {
    const ctx = setup({ start: Date.UTC(2026, 9, 13, 9, 0) });
    const { app, advance } = ctx;
    // A: home, diensten, a reload of diensten, contact
    await nav(app, "/", A);
    advance(MIN);
    await nav(app, "/diensten", A);
    advance(MIN);
    await nav(app, "/diensten", A);
    advance(MIN);
    await nav(app, "/contact", A);
    // B: the same route without the reload
    await nav(app, "/", B);
    advance(MIN);
    await nav(app, "/diensten", B);
    advance(MIN);
    await nav(app, "/contact", B);
    // C: one page only
    await nav(app, "/artikels/ai", C);
    // D: two sessions, 45 minutes apart
    await nav(app, "/", D);
    advance(45 * MIN);
    await nav(app, "/", D);
    advance(MIN);
    await nav(app, "/artikels/ai", D);
    return ctx;
  }

  it("builds sessions per visitor and day, and a reload is not a step", async () => {
    const { app } = await walked();
    const f = (await get(app, "/numeros.json?days=7")).body.data.flows;
    // A, B and C: one session each. D: a session of one page, then one of two.
    expect(f.sessions).toBe(5);
    expect(f.singlePage).toBe(2); // C, and D's first
    expect(f.pagesPerSession).toBe(2); // (3 + 3 + 1 + 1 + 2) / 5
    expect(f.paths).toEqual([
      { pages: ["/", "/diensten", "/contact"], more: false, sessions: 2 },
      { pages: ["/", "/artikels/ai"], more: false, sessions: 1 },
    ]);
  });

  it("counts entries, exits and the page opened next", async () => {
    const { app } = await walked();
    const f = (await get(app, "/numeros.json?days=7")).body.data.flows;
    expect(f.entries[0]).toEqual({ path: "/", sessions: 4 });
    expect(f.exits).toContainEqual({ path: "/contact", sessions: 2 });
    expect(f.steps).toEqual([
      { from: "/", to: "/diensten", sessions: 2 },
      { from: "/diensten", to: "/contact", sessions: 2 },
      { from: "/", to: "/artikels/ai", sessions: 1 },
    ]);
  });

  it("never joins one visitor's pages across days", async () => {
    const { app, advance } = setup({ start: Date.UTC(2026, 9, 13, 23, 50) });
    await nav(app, "/", A);
    advance(20 * MIN); // past midnight UTC: a new day, a new hash, a new session
    await nav(app, "/contact", A);
    const f = (await get(app, "/numeros.json?days=7")).body.data.flows;
    expect(f.sessions).toBe(2);
    expect(f.steps).toEqual([]);
  });

  it("cuts long routes at five pages and says so", async () => {
    const { app, db } = setup();
    const insert = db.prepare(
      "INSERT INTO pageviews (ts, day, path, device, visitor) VALUES (?, '2026-10-13', ?, 'desktop', 'v1')",
    );
    const start = Date.UTC(2026, 9, 13, 9, 0);
    ["/", "/diensten", "/ai", "/contact", "/privacy", "/partners", "/fractioneel"].forEach(
      (path, i) => insert.run(start + i * MIN, path),
    );
    const f = (await get(app, "/numeros.json?days=7")).body.data.flows;
    expect(f.paths).toEqual([
      { pages: ["/", "/diensten", "/ai", "/contact", "/privacy"], more: true, sessions: 1 },
    ]);
    expect(f.steps).toHaveLength(6); // steps are counted over the whole session
  });

  it("shows flows and the automated-traffic totals on the page", async () => {
    const { app } = await walked();
    await nav(app, "/", { headers: { "Accept-Language": null } });
    const html = (await get(app, "/numeros?days=7")).text;
    expect(html).toContain("How visitors move through the site");
    expect(html).toContain("/ &rarr; /diensten &rarr; /contact");
    expect(html).toContain("Left out as automated traffic");
    expect(html).toContain("Sends no browser language");
    const json = (await get(app, "/numeros.json?days=7")).body.data;
    expect(json.filtered).toEqual([{ reason: "no-language", requests: 1 }]);
  });

  it("copes with no data at all", async () => {
    const { app } = setup();
    const f = (await get(app, "/numeros.json")).body.data.flows;
    expect(f).toMatchObject({
      sessions: 0,
      singlePage: 0,
      pagesPerSession: 0,
      entries: [],
      steps: [],
    });
    expect((await get(app, "/numeros")).text).toContain("No sessions yet.");
  });
});
