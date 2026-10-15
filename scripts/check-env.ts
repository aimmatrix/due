/** npm run check:env — prints which configuration names are set (never values). */
import { configReport } from "../src/server/config/env";

const report = configReport();
for (const r of report) console.log(`${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail}`);
process.exit(report.every((r) => r.ok) ? 0 : 1);
