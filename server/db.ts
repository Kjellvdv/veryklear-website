import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Db = Database.Database;

// Append-only page log. Rows are hard-deleted when they age out: that is the
// retention promise on the privacy page, so there is no soft delete here, and
// no created_at/updated_at pair (ts is the only time that matters).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS pageviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,        -- epoch ms, UTC
  day          TEXT NOT NULL,           -- YYYY-MM-DD, UTC
  path         TEXT NOT NULL,           -- a page path from the build, no query or hash
  ref_host     TEXT,                    -- referring site, hostname only
  from_path    TEXT,                    -- our own page the visitor came from, if any
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,
  device       TEXT NOT NULL,           -- mobile | tablet | desktop
  lang         TEXT,                    -- first Accept-Language tag
  visitor      TEXT NOT NULL            -- hash that changes every day, never the IP
);
CREATE INDEX IF NOT EXISTS pageviews_day ON pageviews (day);
CREATE INDEX IF NOT EXISTS pageviews_ts ON pageviews (ts);

CREATE TABLE IF NOT EXISTS salts (
  day  TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
`;

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Columns added after the first deploy. CREATE TABLE IF NOT EXISTS leaves an
// existing table alone, so each later column gets its own guarded ALTER here.
export function migrate(db: Db): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(pageviews)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!columns.has("from_path")) db.exec("ALTER TABLE pageviews ADD COLUMN from_path TEXT");
}

const DAY_MS = 86_400_000;

/** Deletes expired rows and every salt older than yesterday. Returns how many rows went. */
export function purge(db: Db, now: number, retentionDays: number): number {
  const cutoff = now - retentionDays * DAY_MS;
  const yesterday = new Date(now - DAY_MS).toISOString().slice(0, 10);
  const a = db.prepare("DELETE FROM pageviews WHERE ts < ?").run(cutoff).changes;
  const b = db.prepare("DELETE FROM salts WHERE day < ?").run(yesterday).changes;
  return a + b;
}
