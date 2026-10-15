/**
 * Voice call outcomes (A0-07/B1-05). Applies a verified, de-duplicated ElevenLabs callback to canonical
 * records. The provider already normalised the outcome, so nothing is re-classified here:
 *  - a spoken promise/dispute/claimed payment is stored as inbound evidence (it counts as a response);
 *  - silence (no answer, voicemail, failure) is NEVER stored as a response, so it cannot suppress collections;
 *  - "I paid" never marks an invoice paid; it triggers a fresh Stripe refresh instead.
 */
import type { CallOutcome, VerifiedCallEvent } from "@/contracts";
import { reconcileStripeInvoice, type ReconcileRuntime } from "./reconcile";
import { newCorrelationId } from "@/server/http/respond";

export type CallEventResult =
  | { status: "unknown_action" }
  | { status: "duplicate" }
  | { status: "applied"; outcome: CallOutcome; recordedAs: string; correlationId: string };

export async function applyCallEvent(rt: ReconcileRuntime, org: string, event: VerifiedCallEvent): Promise<CallEventResult> {
  const { repos } = rt;
  const attempt = event.actionId ? repos.voice.getByAction(org, event.actionId) : null;
  if (!attempt) return { status: "unknown_action" };
  const invoice = repos.invoices.get(org, attempt.invoiceId);
  const customer = repos.customers.get(org, attempt.customerId);
  if (!invoice || !customer) return { status: "unknown_action" };
  // One terminal outcome per attempt: a redelivered or repeated callback must not apply twice.
  if (attempt.completedAt) return { status: "duplicate" };

  const t = rt.appTime();
  // Provider timestamps are real time; the decision function reads the application clock.
  const eventAppAt = new Date(Date.parse(event.eventAt) + t.offsetMs).toISOString();
  const correlationId = newCorrelationId();

  // A promise is only acted on when the provider gave an explicit date AND a supporting quote.
  let outcome: CallOutcome = event.outcome;
  let summary = event.summary;
  if (outcome === "promise" && (!event.promisedDate || !event.supportingQuote)) {
    outcome = "needs_review";
    summary = `${summary} (promise without a confirmed date and quote)`;
  }
  const quote = event.supportingQuote ?? summary;

  // Only something the customer actually said becomes inbound evidence.
  const customerSpoke = outcome === "promise" || outcome === "dispute" || outcome === "claimed_payment" || outcome === "needs_review";
  const evidenceIds: string[] = [];
  if (customerSpoke) {
    const { evidence } = repos.evidence.insertOrGet({
      organisationId: org,
      externalEventId: event.dedupeKey,
      sourceType: "call_outcome",
      sourceRef: event.transcriptRef ?? event.providerConversationId,
      customerRef: customer.displayName,
      customerId: customer.id,
      invoiceId: invoice.id,
      receivedAt: event.eventAt,
      receivedAppAt: eventAppAt,
      text: quote,
    });
    evidenceIds.push(evidence.id);
  }

  const audit = (action: string, decisionCode: string, result: "ok" | "deferred" | "paused" | "review" | "error", explanation: string) =>
    repos.audit.append({
      organisationId: org, correlationId, action, decisionCode, result, customerId: customer.id, invoiceId: invoice.id,
      evidenceIds, policyVersion: rt.policy.version, calculation: null, explanation,
      externalIds: { conversationId: event.providerConversationId, ...(attempt.callSid ? { callSid: attempt.callSid } : {}) },
      appTime: t.now, simulatedTime: t.simulated,
    });
  const review = (kind: "call_outcome" | "reconciliation" | "provider_error" | "customer_message", decisionCode: string, reason: string) =>
    repos.reviews.open({ organisationId: org, kind, decisionCode, reason, customerId: customer.id, invoiceId: invoice.id, billingRunId: null, evidenceIds });

  repos.voice.update(org, attempt.id, {
    providerConversationId: attempt.providerConversationId ?? event.providerConversationId,
    outcome,
    transcriptRef: event.transcriptRef,
    summary,
    promisedDate: outcome === "promise" ? event.promisedDate : null,
    completedAt: eventAppAt,
  });

  let recordedAs: string;
  switch (outcome) {
    case "promise": {
      const p = repos.promises.record({
        organisationId: org, invoiceId: invoice.id, customerId: customer.id, promisedDate: event.promisedDate!, evidenceId: evidenceIds[0]!, quote,
      });
      audit("voice.call_outcome_recorded", "CALL_PROMISE", "deferred", `Call outcome: customer promised payment on ${p.promisedDate} ("${quote}"). Next contact deferred.`);
      recordedAs = "promise";
      break;
    }
    case "dispute": {
      repos.disputes.record({ organisationId: org, invoiceId: invoice.id, customerId: customer.id, evidenceId: evidenceIds[0]!, summary, quote });
      repos.actions.cancelQueued(org, invoice.id, "Dispute raised on call; collections paused");
      review("customer_message", "DISPUTE_OPEN", summary);
      audit("voice.call_outcome_recorded", "CALL_DISPUTE", "paused", `Call outcome: customer disputed the invoice ("${quote}"). Collections paused and review opened.`);
      recordedAs = "dispute";
      break;
    }
    case "claimed_payment": {
      review("reconciliation", "CLAIMED_PAYMENT", "Customer says they have paid on the call; Stripe refresh requested.");
      audit("voice.call_outcome_recorded", "CALL_CLAIMED_PAYMENT", "review", "Call outcome: customer says they already paid. Only Stripe can confirm it; refreshing.");
      if (invoice.stripeInvoiceId) {
        try {
          await reconcileStripeInvoice(rt, org, invoice.stripeInvoiceId, { kind: "manual_refresh" });
        } catch {
          audit("voice.stripe_refresh_failed", "STRIPE_REFRESH_UNAVAILABLE", "error", "Stripe refresh after a claimed payment failed; the review item remains open.");
        }
      }
      recordedAs = "claimed_payment";
      break;
    }
    case "no_answer": {
      audit("voice.call_outcome_recorded", "CALL_NO_ANSWER", "ok", "Call outcome: no answer or voicemail. The single allowed call is used; no phone retry.");
      recordedAs = "no_answer";
      break;
    }
    case "failed": {
      review("provider_error", "CALL_FAILED", event.failure ? `${event.failure.code}: ${event.failure.message}` : "The call failed before a conversation took place.");
      audit("voice.call_outcome_recorded", "CALL_FAILED", "error", "Call outcome: the call failed. No automatic redial; review opened.");
      recordedAs = "failed";
      break;
    }
    case "needs_review": {
      review("call_outcome", "CALL_NEEDS_REVIEW", summary);
      audit("voice.call_outcome_recorded", "CALL_NEEDS_REVIEW", "review", `Call outcome could not be classified automatically: ${summary}`);
      recordedAs = "needs_review";
      break;
    }
  }
  return { status: "applied", outcome, recordedAs, correlationId };
}
