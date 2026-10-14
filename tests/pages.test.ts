import request from "supertest";
import { describe, expect, it } from "vitest";
import { HOST, nav, setup } from "./helpers";

describe("serving pages", () => {
  it("serves the home page and a nested page with no-cache and the site policy", async () => {
    const { app } = setup();
    const home = await nav(app, "/");
    expect(home.status).toBe(200);
    expect(home.text).toContain("<h1>home</h1>");
    expect(home.headers["cache-control"]).toBe("no-cache");
    expect(home.headers["content-security-policy"]).toContain("default-src 'self'");
    const csp = home.headers["content-security-policy"] as string;
    // The booking calendar is Google's, in a frame; the site loads no third-party script.
    expect(csp).toContain("frame-src https://calendar.google.com");
    expect(csp).toMatch(/script-src 'self';/);
    expect(csp).not.toContain("tidycal");
    expect(home.headers["x-powered-by"]).toBeUndefined();
    const nested = await nav(app, "/artikels/ai");
    expect(nested.status).toBe(200);
    expect(nested.text).toContain("<h1>ai</h1>");
  });

  it("answers HEAD like GET without a body", async () => {
    const { app } = setup();
    const res = await request(app).head("/diensten").set("Host", HOST);
    expect(res.status).toBe(200);
    expect(res.text).toBeFalsy();
  });

  it("compresses HTML when the browser accepts it", async () => {
    const { app } = setup();
    const res = await nav(app, "/", { headers: { "Accept-Encoding": "gzip" } });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });
});

describe("one URL per page", () => {
  it.each([
    ["/diensten/", "/diensten"],
    ["/diensten/index.html", "/diensten"],
    ["//diensten", "/diensten"],
    ["/diensten//", "/diensten"],
    ["/index.html", "/"],
    ["/diensten/?utm_source=x", "/diensten?utm_source=x"],
    ["/%64iensten", "/diensten"],
  ])("301s %s to %s", async (from, to) => {
    const { app } = setup();
    const res = await nav(app, from);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(to);
  });

  it("301s a retired URL straight to its target, slash or not", async () => {
    const { app } = setup();
    expect((await nav(app, "/strategie")).headers.location).toBe("/marketing-strategie");
    expect((await nav(app, "/strategie/")).headers.location).toBe("/marketing-strategie");
    expect((await nav(app, "/strategie")).status).toBe(301);
  });

  it("never redirects to another site", async () => {
    const { app } = setup();
    for (const url of ["//evil.com/", "/\\evil.com/", "/\\\\evil.com", "///evil.com"]) {
      const res = await nav(app, url);
      if (res.status === 301) expect(res.headers.location).not.toMatch(/^(https?:)?\/\//);
    }
  });

  it("serves the 404 page with status 404 for unknown paths and bad encoding", async () => {
    const { app } = setup();
    const res = await nav(app, "/nope");
    expect(res.status).toBe(404);
    expect(res.text).toContain("Deze pagina bestaat niet.");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect((await nav(app, "/_stats")).status).toBe(404);
    expect((await nav(app, "/%2e%2e/package.json")).status).toBe(404);
    expect((await nav(app, "/%zz")).status).toBe(400);
  });

  it("refuses other methods", async () => {
    const { app } = setup();
    const res = await request(app).post("/").set("Host", HOST).send("x");
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, HEAD");
  });
});

describe("assets", () => {
  it("caches hashed assets and fonts for a year, share images for a day, the rest an hour", async () => {
    const { app } = setup();
    expect((await nav(app, "/_astro/a.js")).headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect((await nav(app, "/fonts/x.woff2")).headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect((await nav(app, "/og/home.png")).headers["cache-control"]).toBe("public, max-age=86400");
    expect((await nav(app, "/robots.txt")).headers["cache-control"]).toBe("public, max-age=3600");
  });
});

describe("hosts and health", () => {
  it("reports health as JSON", async () => {
    const { app } = setup();
    const res = await request(app).get("/healthz");
    expect(res.body).toEqual({ success: true });
  });

  it("redirects every other host to the canonical one, except the health check", async () => {
    const { app } = setup({ env: { CANONICAL_HOST: "www.veryklear.com" } });
    const other = await nav(app, "/diensten?x=1", { host: "veryklear-production.up.railway.app" });
    expect(other.status).toBe(301);
    expect(other.headers.location).toBe("https://www.veryklear.com/diensten?x=1");
    expect((await nav(app, "/diensten")).status).toBe(200);
    expect((await request(app).get("/healthz").set("Host", "internal")).status).toBe(200);
  });

  it("sends frame and CSP headers on every response, redirects and the health check included", async () => {
    const { app } = setup({ env: { CANONICAL_HOST: "www.veryklear.com" } });
    const responses = [
      await nav(app, "/diensten"), // a page
      await nav(app, "/diensten/"), // a slash redirect
      await nav(app, "/nope"), // the 404 page
      await nav(app, "/diensten", { host: "veryklear-production.up.railway.app" }), // host redirect
      await request(app).get("/healthz").set("Host", "internal"),
    ];
    for (const res of responses) {
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("keeps the referrer on the way to the canonical host", async () => {
    const { app } = setup({ env: { CANONICAL_HOST: "www.veryklear.com" } });
    const hop = await nav(app, "/", { host: "veryklear-production.up.railway.app" });
    expect(hop.status).toBe(301);
    expect(hop.headers["referrer-policy"]).toBeUndefined();
    // ...while the site itself still asks for same-origin.
    expect((await nav(app, "/")).headers["referrer-policy"]).toBe("same-origin");
  });

  it("serves any host when no canonical host is set", async () => {
    const { app } = setup();
    expect((await nav(app, "/", { host: "veryklear-production.up.railway.app" })).status).toBe(200);
  });
});
