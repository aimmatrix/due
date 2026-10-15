/** GET /api/dashboard — A0-06 real read model (summary totals, invoices, reviews, service health). */
import { DEMO_ORGANISATION_ID } from "@/contracts";
import { getRepositories } from "@/server/db";
import { ok } from "@/server/http/respond";
import { getAppTime } from "@/server/jobs/clock";
import { buildDashboard } from "@/server/orchestration/read-models";

export const dynamic = "force-dynamic";

export async function GET() {
  const repos = getRepositories();
  return ok(buildDashboard(repos, DEMO_ORGANISATION_ID, getAppTime(repos)));
}
