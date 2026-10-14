import type { RequestHandler } from "express";
import fs from "node:fs";
import path from "node:path";
import type { Counter } from "./count";

/**
 * Every page in the build, as "/", "/diensten", "/artikels/ai/slug": each folder
 * with an index.html, minus the redirect stubs. Read once at boot, so a request
 * never touches the file system to decide what exists, and no path a visitor
 * sends can reach anything outside this set.
 */
export function listPages(dist: string, redirects: Record<string, string>): Set<string> {
  const pages = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
      else if (entry.name === "index.html") pages.add(prefix || "/");
    }
  };
  walk(dist, "");
  for (const from of Object.keys(redirects)) pages.delete(from);
  return pages;
}

const query = (originalUrl: string) => {
  const i = originalUrl.indexOf("?");
  return i >= 0 ? originalUrl.slice(i) : "";
};

/**
 * One URL per page. Anything else that means the same page gets a 301 to it:
 * a trailing slash, /index.html, doubled slashes, percent-encoding, and the
 * retired URLs in src/redirects.js. Runs before static files, so
 * /diensten/index.html redirects instead of being served as a file.
 */
export function normalizeUrl(redirects: Record<string, string>): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.set("Allow", "GET, HEAD");
      return void res.status(405).end();
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(req.path);
    } catch {
      return void res.status(400).end();
    }
    // Backslashes first: a browser reads "/\evil.com" as "//evil.com", which would
    // turn the redirect below into a hop to another site.
    let target = decoded.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    // "." and ".." segments never appear in a real link. No redirect: the page
    // lookup below has no such path, so the visitor gets the 404 page.
    if (target.split("/").some((seg) => seg === "." || seg === "..")) return next();
    if (target.endsWith("/index.html")) target = target.slice(0, -"/index.html".length) || "/";
    if (target.length > 1) target = target.replace(/\/+$/, "");
    target = redirects[target] ?? target;
    if (target !== req.path) return void res.redirect(301, target + query(req.originalUrl));
    next();
  };
}

interface PagesOptions {
  dist: string;
  pages: Set<string>;
  count: Counter;
}

/** Serves a page from the set, counting it, or the 404 page with status 404. */
export function servePages({ dist, pages, count }: PagesOptions): RequestHandler {
  // Paths are relative to `root`: sendFile treats any dotted segment of the path it
  // is given as a hidden file, and dist may well sit under one (a git worktree in
  // .claude/, for instance). cacheControl off keeps our own header.
  const opts = { root: dist, cacheControl: false };
  return (req, res) => {
    const p = req.path; // already normalised and known-decodable
    res.set("Cache-Control", "no-cache"); // always revalidate HTML, so a deploy shows at once
    if (pages.has(p)) {
      count(req, p);
      return void res.sendFile(p === "/" ? "index.html" : `${p.slice(1)}/index.html`, opts);
    }
    res.status(404).sendFile("404.html", opts);
  };
}

/** Long-lived caching for hashed and rarely changing assets. */
export function assetHeaders(dist: string) {
  return (res: { set: (k: string, v: string) => unknown }, filePath: string) => {
    const rel = path.relative(dist, filePath).split(path.sep).join("/");
    if (rel.startsWith("_astro/") || rel.startsWith("fonts/")) {
      res.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if (rel.startsWith("og/")) {
      res.set("Cache-Control", "public, max-age=86400");
    } else {
      res.set("Cache-Control", "public, max-age=3600");
    }
  };
}
