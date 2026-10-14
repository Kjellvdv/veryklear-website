import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDb, purge } from "./db";

const cfg = loadConfig();
const dist = path.resolve(cfg.DIST_DIR);
if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error(`❌ No build at ${dist}. Run \`npm run build\` first.`);
  process.exit(1);
}

const dbFile = path.resolve(cfg.DATA_DIR, "analytics.db");
const db = openDb(dbFile);

const runPurge = () => {
  const removed = purge(db, Date.now(), cfg.RETENTION_DAYS);
  if (removed > 0) console.log(`📊 Purged ${removed} expired rows`);
};
runPurge();
setInterval(runPurge, 6 * 60 * 60 * 1000).unref();

const server = createApp({ db, cfg }).listen(cfg.PORT, () => {
  console.log(`🚀 veryklear-website on :${cfg.PORT}, serving ${dist}`);
  console.log(`🔌 SQLite: ${dbFile}`);
  console.log(`📊 Numbers at ${cfg.REPORT_PATH}, retention ${cfg.RETENTION_DAYS} days`);
  console.log(`🔑 REPORT_PASSWORD: Set. CANONICAL_HOST: ${cfg.CANONICAL_HOST ?? "not set"}`);
});

// Railway sends SIGTERM on every redeploy. Finish in-flight requests, then close the file.
process.on("SIGTERM", () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
