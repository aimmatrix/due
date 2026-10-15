/** GET /api/health — A0. Reports configuration state by name only; never returns secret values. */
import { configReport } from "@/server/config/env";
import { ok } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = configReport();
  return ok({ ready: checks.every((c) => c.ok), checks });
}
