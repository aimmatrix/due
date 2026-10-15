/**
 * GET /api/dashboard — A0. Serves the frozen MOCK fixture (header x-due-mock: true) until the
 * read models are wired in A0-06. The response shape is final.
 */
import { FIXTURE_DASHBOARD } from "@/contracts/fixtures";
import { ok } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(FIXTURE_DASHBOARD, undefined, { headers: { "x-due-mock": "true" } });
}
