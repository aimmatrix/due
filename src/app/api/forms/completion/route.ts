/**
 * POST /api/forms/completion — backend for the service-completion form (A0-04 real event source).
 * The person completing the work reports it; they cannot supply a price. The submission ID is minted
 * once per form load, so resubmitting the same form is idempotent.
 */
import { z } from "zod";
import { DEMO_ORGANISATION_ID } from "@/contracts";
import { ConfigError, env } from "@/server/config/env";
import { safeEqual } from "@/server/http/auth";
import { containsPriceField, readJson } from "@/server/http/events";
import { fail, ok } from "@/server/http/respond";
import { ingestCompletion, processBillingRun } from "@/server/orchestration/billing";
import { getRuntime } from "@/server/orchestration/runtime";

export const dynamic = "force-dynamic";

const formSchema = z
  .object({
    submissionId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
    accessCode: z.string().min(1).max(200),
    reporterName: z.string().trim().min(1).max(100),
    customer: z.string().trim().min(1).max(200),
    milestoneReference: z.string().trim().max(100).optional().default(""),
    notes: z.string().trim().min(1).max(5000),
  })
  .strict();

export async function POST(req: Request) {
  let code: string;
  try {
    code = env.formAccessCode();
  } catch (e) {
    if (e instanceof ConfigError) return fail({ code: "NOT_CONFIGURED", message: "The completion form is not configured", retryable: false }, 503);
    throw e;
  }
  const parsed = await readJson(req);
  if (!parsed.ok) return fail({ code: "INVALID_JSON", message: "Body must be JSON", retryable: false }, 400);
  if (containsPriceField(parsed.body)) return fail({ code: "PRICE_NOT_ACCEPTED", message: "Prices come from the stored contract", retryable: false }, 400);
  const body = formSchema.safeParse(parsed.body);
  if (!body.success) return fail({ code: "INVALID_FORM", message: "Please fill in every required field", retryable: false }, 400);
  if (!safeEqual(body.data.accessCode, code)) return fail({ code: "UNAUTHORISED", message: "Access code is incorrect", retryable: false }, 401);

  const f = body.data;
  const text = [
    `Service completion reported by ${f.reporterName} for ${f.customer}.`,
    f.milestoneReference ? `Milestone: ${f.milestoneReference}.` : "",
    `Notes: ${f.notes}`,
  ].filter(Boolean).join("\n");

  const rt = getRuntime();
  const ingest = await ingestCompletion(rt, {
    organisationId: DEMO_ORGANISATION_ID,
    externalEventId: `form-${f.submissionId}`,
    sourceType: "completion_form",
    sourceRef: `form:completion/${f.submissionId}`,
    customerRef: f.customer,
    text,
    receivedAt: new Date().toISOString(),
  });
  const run = await processBillingRun(rt, DEMO_ORGANISATION_ID, ingest.billingRunId);
  return ok(
    { billingRunId: ingest.billingRunId, status: ingest.status, billingRunState: run.state, decisionCode: run.decisionCode, invoiceId: run.invoiceId, lastError: run.lastError },
    ingest.correlationId,
    { status: ingest.status === "accepted" ? 202 : 200 },
  );
}
