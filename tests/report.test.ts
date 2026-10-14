import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config";
import { basic, HOST, nav, PASSWORD, setup } from "./helpers";

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
