/** A0 database entry point. Only orchestration, jobs and API routes import this. */
import { getDb } from "./connection";
import { createRepositories, type Repositories } from "./repositories";

export { openDatabase, migrate, getDb, type Db } from "./connection";
export { createRepositories, newId, type Repositories } from "./repositories";
export { seedDemoData } from "./seed";

const globalForRepos = globalThis as unknown as { __dueRepos?: Repositories };

export function getRepositories(): Repositories {
  if (!globalForRepos.__dueRepos) globalForRepos.__dueRepos = createRepositories(getDb());
  return globalForRepos.__dueRepos;
}
