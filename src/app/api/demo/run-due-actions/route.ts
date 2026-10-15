import { DEMO_ORGANISATION_ID } from "@/contracts";
import { env } from "@/server/config/env";
import { fail, ok } from "@/server/http/respond";
import { runDueActions } from "@/server/jobs/scheduler";
import { getSchedulerRuntime } from "@/server/jobs/scheduler-runtime";
import { processBillingRun } from "@/server/orchestration/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!env.demoMode()) return fail({ code: "DEMO_MODE_DISABLED", message: "Demo mode is disabled.", retryable: false }, 403);
  try {
    const rt = getSchedulerRuntime();
    for (const run of rt.repos.billingRuns.listRetryable(DEMO_ORGANISATION_ID)) await processBillingRun(rt, DEMO_ORGANISATION_ID, run.id);
    return ok(await runDueActions(rt, DEMO_ORGANISATION_ID));
  } catch {
    return fail({ code: "COLLECTIONS_RUN_FAILED", message: "Collections run failed; inspect persisted action states before retrying.", retryable: false }, 500);
  }
}
