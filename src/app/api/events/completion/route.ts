/**
 * POST /api/events/completion — authenticated external completion ingestion (A0-04).
 * Persists evidence first, then processes the billing run automatically (no approval step).
 * No trusted client-supplied price: any price/amount field is rejected.
 */
import { DEMO_ORGANISATION_ID, type CompletionEventResponse } from "@/contracts";
import { ConfigError, env } from "@/server/config/env";
import { hasBearer } from "@/server/http/auth";
import { completionEventSchema, containsPriceField, readJson, toUtc } from "@/server/http/events";
import { fail, ok } from "@/server/http/respond";
import { ingestCompletion, processBillingRun } from "@/server/orchestration/billing";
import { getRuntime } from "@/server/orchestration/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let token: string;
  try {
    token = env.ingestToken();
  } catch (e) {
    if (e instanceof ConfigError) return fail({ code: "NOT_CONFIGURED", message: "Ingestion is not configured", retryable: false }, 503);
    throw e;
  }
  if (!hasBearer(req, token)) return fail({ code: "UNAUTHORISED", message: "Missing or invalid bearer token", retryable: false }, 401);

  const parsed = await readJson(req);
  if (!parsed.ok) return fail({ code: "INVALID_JSON", message: "Body must be JSON", retryable: false }, 400);
  if (containsPriceField(parsed.body)) {
    return fail({ code: "PRICE_NOT_ACCEPTED", message: "Completion events report work done; prices come from the stored contract", retryable: false }, 400);
  }
  const body = completionEventSchema.safeParse(parsed.body);
  if (!body.success) return fail({ code: "INVALID_EVENT", message: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), retryable: false }, 400);

  const rt = getRuntime();
  // Organisation comes from the server, never from the event.
  const ingest = await ingestCompletion(rt, { ...body.data, organisationId: DEMO_ORGANISATION_ID, receivedAt: toUtc(body.data.receivedAt) });
  const run = await processBillingRun(rt, DEMO_ORGANISATION_ID, ingest.billingRunId);
  const data: CompletionEventResponse = {
    evidenceId: ingest.evidenceId,
    billingRunId: ingest.billingRunId,
    status: ingest.status,
    billingRunState: run.state,
    invoiceId: run.invoiceId,
  };
  return ok(data, ingest.correlationId, { status: ingest.status === "accepted" ? 202 : 200 });
}
