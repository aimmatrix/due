import { DEMO_ORGANISATION_ID } from "../src/contracts";
import { runDueActions } from "../src/server/jobs/scheduler";
import { getSchedulerRuntime } from "../src/server/jobs/scheduler-runtime";
import { processBillingRun } from "../src/server/orchestration/billing";

async function main() {
  if (process.env.WORKER_ENABLED !== "true") {
    console.log("Worker disabled. Set WORKER_ENABLED=true only in the integration checkout to enable dispatch.");
    return;
  }
  let stopped = false;
  let wake: (() => void) | undefined;
  const stop = () => { stopped = true; wake?.(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const rt = getSchedulerRuntime();
    while (!stopped) {
      try {
        for (const run of rt.repos.billingRuns.listRetryable(DEMO_ORGANISATION_ID)) {
          if (stopped) break;
          await processBillingRun(rt, DEMO_ORGANISATION_ID, run.id);
        }
        if (!stopped) {
          const result = await runDueActions(rt, DEMO_ORGANISATION_ID);
          console.log(JSON.stringify({ evaluatedInvoices: result.evaluatedInvoices, executed: result.results.filter((r) => r.executed).length,
            decisionCodes: result.results.map((r) => r.decisionCode), simulatedTime: result.appTime.simulated }));
        }
      } catch { console.error("Worker iteration failed; persisted reservations prevent blind retries."); }
      if (!stopped) await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { wake = undefined; resolve(); }, 30_000);
        wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
      });
    }
    console.log("Worker stopped.");
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
main().catch(() => { console.error("Worker could not start. Check adapter configuration."); process.exitCode = 1; });
