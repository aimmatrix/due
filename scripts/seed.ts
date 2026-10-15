/** npm run db:seed — migrate and seed synthetic demo data into DATABASE_PATH. Safe to re-run. */
import { env } from "../src/server/config/env";
import { openDatabase, seedDemoData } from "../src/server/db";

const path = env.databasePath();
const db = openDatabase(path);
const result = seedDemoData(db, { emails: env.demoEmailAllowlist(), phones: env.demoPhoneAllowlist() });
console.log(`Seeded ${path}:`, result);
db.close();
