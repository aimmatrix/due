import { DEMO_POLICY, WebhookSignatureError, type NotificationsAdapter } from "@/contracts";
import type { Repositories } from "@/server/db";
import { fail, newCorrelationId, ok } from "@/server/http/respond";
import { getAppTime } from "./clock";

export interface EmailDeliveryRuntime { repos: Repositories; notifications: NotificationsAdapter }

export function handleEmailDelivery(rt: EmailDeliveryRuntime, org: string, raw: string, headers: Record<string, string>): "processed" | "duplicate" | "ignored" {
  const event = rt.notifications.verifyDeliveryEvent(raw, headers);
  if (!event) return "ignored";
  const { repos } = rt;
  if (!repos.webhooks.markProcessed("email", event.providerEventId)) return "duplicate";
  try {
    return repos.transaction(() => {
      const action = repos.actions.findByReceipt(org, "reminder_email", event.providerMessageId);
      if (!action) return "ignored";
      const t = getAppTime(repos);
      const at = new Date(Date.parse(event.at) + t.offsetMs).toISOString();
      const changed = repos.actions.markDelivery(org, action.id, event.state, at);
      if (changed) repos.audit.append({
        organisationId: org, correlationId: action.correlationId, action: `collections.reminder_delivery_${event.state}`,
        decisionCode: action.decisionCode, result: event.state === "delivered" ? "ok" : "error",
        customerId: action.customerId, invoiceId: action.invoiceId, evidenceIds: action.evidenceIds,
        policyVersion: DEMO_POLICY.version, calculation: null, explanation: `Email provider confirmed reminder delivery ${event.state}.`,
        externalIds: { actionId: action.id, providerEventId: event.providerEventId, providerMessageId: event.providerMessageId },
        appTime: t.now, simulatedTime: t.simulated,
      });
      return "processed";
    });
  } catch (e) { repos.webhooks.unmark("email", event.providerEventId); throw e; }
}

/** Kept injectable so signature rejection and retry responses can be tested without production adapters. */
export async function emailDeliveryResponse(req: Request, rt: EmailDeliveryRuntime, org: string): Promise<Response> {
  const correlationId = newCorrelationId();
  try {
    const status = handleEmailDelivery(rt, org, await req.text(), Object.fromEntries(req.headers.entries()));
    return ok({ received: true, status, ignored: status === "ignored" }, correlationId);
  } catch (e) {
    if (e instanceof WebhookSignatureError) return fail({ code: e.code, message: "Invalid email signature", retryable: false }, 400, correlationId);
    return fail({ code: "EMAIL_DELIVERY_PROCESSING_FAILED", message: "Email delivery processing failed; retry the webhook.", retryable: true }, 500, correlationId);
  }
}
