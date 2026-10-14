import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config";
import { basic, HOST, nav, PASSWORD, PHONE_UA, rows, setup } from "./helpers";

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
    expect(r.totals).toEqual({ visitors: 3, views: 6, sessions: 3 });
    expect(r.daily).toHaveLength(7);
    expect(r.daily.reduce((n: number, d: { views: number }) => n + d.views, 0)).toBe(
      r.totals.views,
    );
    expect(r.daily[0]).toEqual({ day: "2026-10-07", views: 1, visitors: 1 });
    expect(r.daily.at(-1)).toEqual({ day: "2026-10-13", views: 5, visitors: 2 });
    expect(r.pages).toHaveLength(3);
    expect(r.pages).toContainEqual(
      expect.objectContaining({ path: "/diensten", visitors: 2, views: 2 }),
    );
    expect(r.pages).toContainEqual(
      expect.objectContaining({ path: "/contact", visitors: 2, views: 2 }),
    );
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

  it("escapes everything it prints, on every tab", async () => {
    const { app } = setup();
    await nav(app, "/?utm_campaign=" + encodeURIComponent("<script>alert(1)</script>"), {
      headers: { Referer: "https://evil.example/<img src=x onerror=alert(1)>" },
    });
    for (const tab of ["overview", "sources", "pages", "journeys", "audience", "quality"]) {
      const res = await get(app, `/numeros?tab=${tab}`);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain("<script>alert(1)");
      expect(res.text).not.toContain("<img src=x");
    }
    expect((await get(app, "/numeros?tab=sources")).text).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
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
    const journeys = (await get(app, "/numeros?tab=journeys&days=7")).text;
    expect(journeys).toContain("How visitors move through the site");
    expect(journeys).toContain("/ &rarr; /diensten &rarr; /contact");
    const quality = (await get(app, "/numeros?tab=quality&days=7")).text;
    expect(quality).toContain("Left out as automated traffic");
    expect(quality).toContain("No browser language");
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
    expect((await get(app, "/numeros?tab=journeys")).text).toContain("No sessions yet.");
  });

  describe("sessions one by one", () => {
    it("shows who each session belongs to: source, campaign, language, device, timing", async () => {
      const { app, advance } = setup({ start: Date.UTC(2026, 9, 13, 9, 0) });
      // A phone user from LinkedIn with a tagged link: home, an article, contact.
      const lead = {
        ip: "198.51.100.1",
        ua: PHONE_UA,
        headers: { "Accept-Language": "fr-BE,fr;q=0.9", Referer: "https://www.linkedin.com/feed/" },
      };
      await nav(app, "/?utm_source=linkedin&utm_medium=social&utm_campaign=launch", lead);
      advance(45_000);
      await nav(app, "/artikels/ai", {
        ...lead,
        headers: { ...lead.headers, Referer: "https://www.veryklear.com/" },
      });
      advance(75_000);
      await nav(app, "/contact", {
        ...lead,
        headers: { ...lead.headers, Referer: "https://www.veryklear.com/artikels/ai" },
      });
      // Later, a desktop visitor who typed the address.
      advance(60 * 60_000);
      await nav(app, "/diensten", { ip: "198.51.100.2" });

      const { recent } = (await get(app, "/numeros.json?days=7")).body.data.flows;
      expect(recent).toHaveLength(2);
      // Newest first.
      expect(recent[0]).toMatchObject({
        pageCount: 1,
        from: "(direct)",
        campaign: "",
        lang: "nl-BE",
        device: "desktop",
        pages: [{ path: "/diensten", at: 0 }],
      });
      expect(recent[1]).toMatchObject({
        pageCount: 3,
        seconds: 120,
        from: "linkedin.com",
        campaign: "linkedin / social / launch",
        lang: "fr-BE",
        device: "mobile",
        more: false,
        pages: [
          { path: "/", at: 0 },
          { path: "/artikels/ai", at: 45 },
          { path: "/contact", at: 120 },
        ],
      });
    });

    it("lists them on the page with the timing beside each step", async () => {
      const { app, advance } = setup();
      await nav(app, "/", { ip: "198.51.100.1", headers: { "Accept-Language": "zh-CN" } });
      advance(95_000);
      await nav(app, "/contact", { ip: "198.51.100.1", headers: { "Accept-Language": "zh-CN" } });
      const html = (await get(app, "/numeros?tab=journeys&days=7")).text;
      expect(html).toContain("Sessions, one by one");
      expect(html).toContain("zh-CN");
      expect(html).toContain("+1:35");
      expect(html).toContain("(direct)");
    });

    it("keeps only the newest 50 and cuts a long session at eight pages", async () => {
      const { app, db } = setup();
      const insert = db.prepare(
        "INSERT INTO pageviews (ts, day, path, device, visitor) VALUES (?, '2026-10-13', ?, 'desktop', ?)",
      );
      const base = Date.UTC(2026, 9, 13, 0, 0);
      for (let i = 0; i < 60; i++)
        insert.run(base + i * 60_000, "/", `v${String(i).padStart(2, "0")}`);
      for (let i = 0; i < 10; i++) insert.run(base + 3_600_000 + i * 1000, `/p${i}`, "long");
      const { recent } = (await get(app, "/numeros.json?days=7")).body.data.flows;
      expect(recent).toHaveLength(50);
      expect(recent[0]).toMatchObject({ pageCount: 10, more: true });
      expect(recent[0].pages).toHaveLength(8);
      expect(recent[0].start).toBeGreaterThan(recent[1].start);
    });
  });
});

describe("tabs and charts", () => {
  const MIN = 60_000;
  type Db = ReturnType<typeof setup>["db"];
  const put = (
    db: Db,
    at: number,
    path: string,
    visitor: string,
    extra: { ref?: string; utm?: string } = {},
  ) =>
    db
      .prepare(
        `INSERT INTO pageviews (ts, day, path, ref_host, utm_source, device, lang, visitor)
         VALUES (?, ?, ?, ?, ?, 'desktop', 'nl-BE', ?)`,
      )
      .run(
        at,
        new Date(at).toISOString().slice(0, 10),
        path,
        extra.ref ?? null,
        extra.utm ?? null,
        visitor,
      );

  it("renders each tab, keeps the range in the links, and falls back to the overview", async () => {
    const { app } = setup();
    const overview = (await get(app, "/numeros?days=7")).text;
    expect(overview).toContain("Visitors per day");
    for (const tab of ["overview", "sources", "pages", "journeys", "audience", "quality"]) {
      expect(overview).toContain(`/numeros?tab=${tab}&amp;days=7`);
    }
    const sources = await get(app, "/numeros?tab=sources&days=90");
    expect(sources.text).toContain("Which sources lead to contact or booking");
    expect(sources.text).not.toContain("Sessions, one by one");
    expect(sources.text).toContain('aria-current="page"');
    expect((await get(app, "/numeros?tab=nonsense")).text).toContain("Visitors per day");
  });

  it("compares with the equal window before, and says so when there is none", async () => {
    const { app, db, now } = setup();
    const day = 86_400_000;
    // Last 7 days: three visitors. The 7 days before: two.
    for (const [i, who] of ["a", "b", "c"].entries()) put(db, now() - day * (i + 1), "/", who);
    for (const [i, who] of ["d", "e"].entries()) put(db, now() - day * (8 + i), "/", who);
    const r = (await get(app, "/numeros.json?days=7")).body.data;
    expect(r.previous).toEqual({ visitors: 2, views: 2, sessions: 2 });
    expect((await get(app, "/numeros?days=7")).text).toContain("+50% against the previous 7 days");

    const fresh = setup();
    put(fresh.db, fresh.now() - day, "/", "a");
    expect((await get(fresh.app, "/numeros.json?days=7")).body.data.previous).toBeNull();
    expect((await get(fresh.app, "/numeros?days=7")).text).toContain(
      "no data yet for the 7 days before",
    );
  });

  it("counts what sessions did and which sources lead to contact or booking", async () => {
    const { app, db, now } = setup();
    const t = now() - 3 * 3_600_000;
    // Typed address: home, a service page, contact.
    put(db, t, "/", "direct");
    put(db, t + MIN, "/diensten", "direct");
    put(db, t + 2 * MIN, "/contact", "direct");
    // LinkedIn campaign tag: one article, no further.
    put(db, t, "/artikels/ai", "tagged", { utm: "LinkedIn" });
    // Google: a service page, then the booking page.
    put(db, t, "/ai", "google", { ref: "google.com" });
    put(db, t + MIN, "/strategiesessie", "google", { ref: "google.com" });

    const r = (await get(app, "/numeros.json?days=7")).body.data;
    expect(r.behaviour).toEqual({ sessions: 3, multiPage: 2, service: 2, article: 1, reached: 2 });
    expect(r.sources).toEqual(
      expect.arrayContaining([
        { source: "(direct)", kind: "direct", sessions: 1, reached: 1 },
        { source: "linkedin", kind: "campaign", sessions: 1, reached: 0 },
        { source: "google.com", kind: "referrer", sessions: 1, reached: 1 },
      ]),
    );
    const html = (await get(app, "/numeros?tab=sources&days=7")).text;
    expect(html).toContain("campaign tag");
    expect(html).toContain("100%");
  });

  it("adds entries and exits to the pages table", async () => {
    const { app, db, now } = setup();
    const t = now() - 3_600_000;
    put(db, t, "/", "a");
    put(db, t + MIN, "/diensten", "a");
    put(db, t, "/", "b");
    const { pages } = (await get(app, "/numeros.json?days=7")).body.data;
    expect(pages).toContainEqual({ path: "/", visitors: 2, views: 2, entries: 2, exits: 1 });
    expect(pages).toContainEqual({
      path: "/diensten",
      visitors: 1,
      views: 1,
      entries: 0,
      exits: 1,
    });
  });

  it("buckets page views by hour and weekday in Belgian time, summer time included", async () => {
    const { app, db } = setup();
    put(db, Date.UTC(2026, 6, 1, 10, 30), "/", "summer"); // Wednesday, CEST: 12:30
    put(db, Date.UTC(2026, 0, 15, 10, 30), "/", "winter"); // Thursday, CET: 11:30
    const r = (await get(app, "/numeros.json?days=365")).body.data;
    expect(r.hours[12]).toBe(1);
    expect(r.hours[11]).toBe(1);
    expect(r.hours.reduce((a: number, b: number) => a + b, 0)).toBe(2);
    expect(r.weekdays[2]).toBe(1); // Wednesday
    expect(r.weekdays[3]).toBe(1); // Thursday
  });

  it("shows the automated share and the left-out traffic per day", async () => {
    const { app } = setup();
    await nav(app, "/"); // counted
    await nav(app, "/", { headers: { "Accept-Language": null } }); // no language
    await nav(app, "/diensten", { ua: "curl/8.4.0" }); // announced tool
    const r = (await get(app, "/numeros.json?days=7")).body.data;
    expect(r.automated.requests).toBe(2);
    expect(r.automated.share).toBeCloseTo(2 / 3);
    const today = r.filteredDaily[r.filteredDaily.length - 1];
    expect(today.reasons).toEqual({ "no-language": 1, bot: 1 });
    const html = (await get(app, "/numeros?tab=quality&days=7")).text;
    expect(html).toContain("67%");
    expect(html).toContain("How these numbers are made");
    // Each reason keeps its own colour in the stacked chart, not the generic bar colour.
    expect(html).toContain("background:var(--k-no-language)");
    expect(html).toContain("background:var(--k-bot)");
  });

  it("draws the hour and weekday charts on the audience tab", async () => {
    const { app } = setup();
    await nav(app, "/");
    const html = (await get(app, "/numeros?tab=audience&days=7")).text;
    expect(html).toContain("Page views by hour of the day");
    expect(html).toContain("Page views by weekday");
    expect(html).toContain("Languages");
  });
});
