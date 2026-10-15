/**
 * SQLite connection + migration runner (A0-03). The ONLY place a database connection is opened.
 * Single-instance demo design: UI, routes and worker share one file on one machine.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "@/server/config/env";
import { MIGRATIONS } from "./migrations";

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Db): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((r) => (r as { id: number }).id));
  const ran: number[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, new Date().toISOString());
    })();
    ran.push(m.id);
  }
  return ran;
}

// Survive Next.js dev hot reloads without opening a second handle.
const globalForDb = globalThis as unknown as { __dueDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__dueDb) globalForDb.__dueDb = openDatabase(env.databasePath());
  return globalForDb.__dueDb;
}
