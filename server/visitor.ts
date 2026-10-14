import { createHmac, randomBytes } from "node:crypto";
import type { Db } from "./db";

export function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * One random salt per UTC day. Salts older than yesterday are deleted by
 * purge(), so a visitor hash can't be recomputed from an IP address afterwards,
 * and the same person can't be followed from one day to the next.
 */
export function saltFor(db: Db, day: string): string {
  const read = db.prepare("SELECT salt FROM salts WHERE day = ?");
  const existing = read.get(day) as { salt: string } | undefined;
  if (existing) return existing.salt;
  db.prepare("INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)").run(
    day,
    randomBytes(32).toString("hex"),
  );
  return (read.get(day) as { salt: string }).salt;
}

/** The IP only ever lives inside this function call. It is never stored or logged. */
export function visitorHash(salt: string, ip: string, userAgent: string): string {
  return createHmac("sha256", salt).update(`${ip}|${userAgent}`).digest("hex").slice(0, 16);
}
