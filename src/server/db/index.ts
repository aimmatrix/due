/** A0 database entry point. Only orchestration, jobs and API routes import this. */
import { env } from "@/server/config/env";
import { getDb } from "./connection";
import { createRepositories, type Repositories } from "./repositories";
import { seedDemoData } from "./seed";

export { openDatabase, migrate, getDb, type Db } from "./connection";
export { createRepositories, newId, type Repositories } from "./repositories";
export { seedDemoData } from "./seed";

const globalForRepos = globalThis as unknown as { __dueRepos?: Repositories };

export function getRepositories(): Repositories {
  if (!globalForRepos.__dueRepos) {
    const db = getDb();
    // Seed synthetic demo data on first use of an empty database (demo mode only).
    const empty = (db.prepare("SELECT COUNT(*) AS c FROM customers").get() as { c: number }).c === 0;
    if (empty && env.demoMode()) seedDemoData(db, { emails: env.demoEmailAllowlist(), phones: env.demoPhoneAllowlist() });
    globalForRepos.__dueRepos = createRepositories(db);
  }
  return globalForRepos.__dueRepos;
}
