import compression from "compression";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import helmet from "helmet";
import path from "node:path";
import { REDIRECTS } from "../src/redirects.js";
import type { Config } from "./config";
import { createCounter } from "./count";
import type { Db } from "./db";
import { type DatacenterCheck, loadMatcher } from "./datacenter";
import { assetHeaders, listPages, normalizeUrl, servePages } from "./pages";
import { reportPaths, reportRouter } from "./report";

interface Deps {
  db: Db;
  cfg: Config;
  now?: () => number;
  /** Is this address a data centre? Defaults to the bundled ranges when DATACENTER_FILTER is on. */
  isDatacenter?: DatacenterCheck;
}

export function createApp({
  db,
  cfg,
  now = Date.now,
  isDatacenter = cfg.DATACENTER_FILTER === "on" ? loadMatcher() : () => false,
}: Deps) {
  const dist = path.resolve(cfg.DIST_DIR);
  const pages = listPages(dist, REDIRECTS);
  const app = express();

  // One proxy hop (Railway's edge). Without this every visitor shares one IP,
  // the visitor count collapses and the report limiter becomes global.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Method, path, status, time. No IP, no query string, no headers. Hashed assets
  // are skipped so the log stays readable.
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/_astro/") || req.path.startsWith("/fonts/")) return;
      console.log(`📨 ${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  // Above the host redirect, so Railway's probe (which uses the internal hostname) passes.
  app.get("/healthz", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ success: true });
  });

  if (cfg.CANONICAL_HOST) {
    const host = cfg.CANONICAL_HOST;
    app.use((req, res, next) => {
      if (req.hostname === host) return next();
      res.redirect(301, `https://${host}${req.originalUrl}`);
    });
  }

  app.use(compression());

  // Two policies: the site's pages need their own scripts and styles, the TidyCal
  // embed and the form endpoint; the numbers page needs nothing but its inline CSS.
  const sitePolicy = helmet({
    // Browsers then send the referrer to our own pages only, so a click to the
    // booking page can be traced to the page it was on. Other sites, TidyCal's
    // iframe included, still get no referrer at all.
    referrerPolicy: { policy: "same-origin" },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://asset-tidycal.b-cdn.net"],
        "style-src": ["'self'", "'unsafe-inline'"], // 88 inline style="" attributes in the pages
        "img-src": ["'self'", "data:"],
        "font-src": ["'self'"],
        "connect-src": ["'self'", "https://forms.veryklear.com"],
        "form-action": ["'self'", "https://forms.veryklear.com"],
        "frame-src": ["https://tidycal.com"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
      },
    },
  });
  const reportPolicy = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "style-src": ["'unsafe-inline'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
        "frame-ancestors": ["'none'"],
      },
    },
  });
  const forReport = new Set(reportPaths(cfg));
  const policy: RequestHandler = (req, res, next) =>
    (forReport.has(req.path) ? reportPolicy : sitePolicy)(req, res, next);
  app.use(policy);

  app.use(reportRouter(db, cfg, now));
  app.use(normalizeUrl(REDIRECTS));
  app.use(express.static(dist, { index: false, redirect: false, setHeaders: assetHeaders(dist) }));
  app.use(servePages({ dist, pages, count: createCounter(db, now, isDatacenter) }));

  const errors: ErrorRequestHandler = (err, req, res, _next) => {
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status >= 500) console.error(`❌ [${req.method} ${req.path}]`, err);
    res
      .status(status)
      .type("text")
      .send(status < 500 ? "Bad request" : "Something broke on our side. Try again in a minute.");
  };
  app.use(errors);

  return app;
}
