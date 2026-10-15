/**
 * POST /api/events/customer-message — authenticated promise/dispute/reply ingestion (A0-04).
 * Any response cancels a queued non-response call.
 */
import { DEMO_ORGANISATION_ID, type CustomerMessageResponse } from "@/contracts";
import { ConfigError, env } from "@/server/config/env";
import { hasBearer } from "@/server/http/auth";
import { customerMessageSchema, readJson, toUtc } from "@/server/http/events";
import { fail, ok } from "@/server/http/respond";
import { recordCustomerMessage } from "@/server/orchestration/messages";
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
  const body = customerMessageSchema.safeParse(parsed.body);
  if (!body.success) return fail({ code: "INVALID_EVENT", message: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), retryable: false }, 400);

  const result = await recordCustomerMessage(getRuntime(), { ...body.data, organisationId: DEMO_ORGANISATION_ID, receivedAt: toUtc(body.data.receivedAt) });
  if (!result.ok) {
    return fail({ code: result.code, message: result.code === "INVOICE_NOT_FOUND" ? "Invoice not found" : "Customer does not match the invoice", retryable: false }, 404);
  }
  const data: CustomerMessageResponse = {
    evidenceId: result.evidenceId,
    status: result.status,
    classification: result.classification,
    cancelledActionIds: result.cancelledActionIds,
  };
  return ok(data, result.correlationId, { status: result.status === "accepted" ? 202 : 200 });
}
