/** POST /api/demo/clock — demo mode only. Moves the clearly labelled SIMULATED application clock. */
import type { DemoClockResponse } from "@/contracts";
import { env } from "@/server/config/env";
import { getRepositories } from "@/server/db";
import { demoClockSchema, readJson } from "@/server/http/events";
import { fail, ok } from "@/server/http/respond";
import { getAppTime, setAppClock } from "@/server/jobs/clock";

export const dynamic = "force-dynamic";

export async function GET() {
  const data: DemoClockResponse = getAppTime(getRepositories());
  return ok(data);
}

export async function POST(req: Request) {
  if (!env.demoMode()) return fail({ code: "DEMO_MODE_DISABLED", message: "Demo controls are disabled", retryable: false }, 403);
  const parsed = await readJson(req);
  const body = parsed.ok ? demoClockSchema.safeParse(parsed.body) : null;
  if (!body?.success) return fail({ code: "INVALID_CLOCK_REQUEST", message: "Send {advanceHours}, {setTo} or {reset:true}", retryable: false }, 400);
  try {
    const data: DemoClockResponse = setAppClock(getRepositories(), body.data);
    return ok(data);
  } catch (e) {
    return fail({ code: "INVALID_CLOCK_REQUEST", message: e instanceof RangeError ? e.message : "Clock change rejected", retryable: false }, 400);
  }
}
