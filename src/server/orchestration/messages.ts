/**
 * Inbound customer messages (A0-04). A0-owned orchestration around A3's classifier.
 * Any inbound response cancels a queued non-response call. Promises and disputes are stored with
 * their source evidence; anything ambiguous becomes a review item. "I paid" never marks an invoice paid.
 */
import type { AppTime, ClassifyCustomerMessage, CustomerMessageClassification, DemoPolicy, IsoUtc, StructuredLlm } from "@/contracts";
import type { Repositories } from "@/server/db";
import { newCorrelationId } from "@/server/http/respond";

export interface MessageRuntime {
  repos: Repositories;
  classifyCustomerMessage: ClassifyCustomerMessage;
  llm: StructuredLlm;
  policy: DemoPolicy;
  appTime: () => AppTime;
}

export interface CustomerMessageInput {
  organisationId: string;
  externalEventId: string;
  sourceType: "email" | "customer_message";
  sourceRef: string;
  customerRef: string;
  invoiceId: string;
  text: string;
  receivedAt: IsoUtc;
}

export type CustomerMessageOutcome =
  | { ok: false; code: "INVOICE_NOT_FOUND" | "CUSTOMER_MISMATCH" }
  | {
      ok: true;
      evidenceId: string;
      status: "accepted" | "duplicate";
      classification: CustomerMessageClassification["kind"];
      cancelledActionIds: string[];
      correlationId: string;
    };

const norm = (v: string) => v.trim().toLowerCase();

export async function recordCustomerMessage(rt: MessageRuntime, input: CustomerMessageInput): Promise<CustomerMessageOutcome> {
  const { repos } = rt;
  const org = input.organisationId;
  const invoice = repos.invoices.get(org, input.invoiceId);
  if (!invoice) return { ok: false, code: "INVOICE_NOT_FOUND" };
  const customer = repos.customers.get(org, invoice.customerId);
  const ref = norm(input.customerRef);
  if (!customer || !(customer.matchKeys.map(norm).includes(ref) || norm(customer.displayName) === ref || customer.id === input.customerRef)) {
    return { ok: false, code: "CUSTOMER_MISMATCH" };
  }

  const { evidence, created } = repos.evidence.insertOrGet({
    organisationId: org,
    externalEventId: input.externalEventId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    customerRef: input.customerRef,
    customerId: customer.id,
    invoiceId: invoice.id,
    receivedAt: input.receivedAt,
    receivedAppAt: rt.appTime().now,
    text: input.text,
  });

  if (!created) {
    const kind = repos.promises.listByInvoice(org, invoice.id).some((p) => p.evidenceId === evidence.id)
      ? "promise"
      : repos.disputes.listByInvoice(org, invoice.id).some((d) => d.evidenceId === evidence.id)
        ? "dispute"
        : "needs_review";
    return { ok: true, evidenceId: evidence.id, status: "duplicate", classification: kind, cancelledActionIds: [], correlationId: newCorrelationId() };
  }

  const correlationId = newCorrelationId();
  const audit = (action: string, decisionCode: string, result: "ok" | "cancelled" | "deferred" | "paused" | "review", explanation: string) => {
    const t = rt.appTime();
    repos.audit.append({
      organisationId: org, correlationId, action, decisionCode, result, customerId: customer.id, invoiceId: invoice.id,
      evidenceIds: [evidence.id], policyVersion: rt.policy.version, calculation: null, explanation, externalIds: {},
      appTime: t.now, simulatedTime: t.simulated,
    });
  };

  // 1. A response of any kind cancels a queued non-response call before anything else happens.
  const cancelled = repos.actions.cancelQueued(org, invoice.id, "Customer responded before the call was dispatched", ["voice_call"]);
  audit("collections.response_received", "RESPONSE_RECEIVED", cancelled.length ? "cancelled" : "ok",
    cancelled.length ? `Customer message received; cancelled ${cancelled.length} queued call(s).` : "Customer message received.");

  // 2. Classify. Failure or an unavailable classifier means review, never a guess.
  let c: CustomerMessageClassification;
  try {
    c = await rt.classifyCustomerMessage(
      { organisationId: org, customerId: customer.id, invoiceId: invoice.id, evidence, appTime: rt.appTime() },
      { llm: rt.llm },
    );
  } catch {
    c = { kind: "needs_review", reason: "Message could not be classified automatically." };
  }

  // 3. Persist the canonical result.
  switch (c.kind) {
    case "promise": {
      const p = repos.promises.record({ organisationId: org, invoiceId: invoice.id, customerId: customer.id, promisedDate: c.promisedDate, evidenceId: evidence.id, quote: c.quote });
      audit("collections.promise_recorded", "PROMISE_RECORDED", "deferred", `Customer promised payment on ${p.promisedDate} ("${c.quote}"). Contact deferred until after that date.`);
      break;
    }
    case "dispute": {
      repos.disputes.record({ organisationId: org, invoiceId: invoice.id, customerId: customer.id, evidenceId: evidence.id, summary: c.summary, quote: c.quote });
      cancelled.push(...repos.actions.cancelQueued(org, invoice.id, "Dispute opened; collections paused"));
      repos.reviews.open({ organisationId: org, kind: "customer_message", decisionCode: "DISPUTE_OPEN", reason: c.summary, customerId: customer.id, invoiceId: invoice.id, billingRunId: null, evidenceIds: [evidence.id] });
      audit("collections.dispute_opened", "DISPUTE_OPEN", "paused", `Dispute recorded ("${c.quote}"). Collections paused and review opened.`);
      break;
    }
    case "claimed_payment": {
      repos.reviews.open({ organisationId: org, kind: "reconciliation", decisionCode: "CLAIMED_PAYMENT", reason: "Customer says they have paid; refresh from Stripe to confirm.", customerId: customer.id, invoiceId: invoice.id, billingRunId: null, evidenceIds: [evidence.id] });
      audit("collections.claimed_payment", "CLAIMED_PAYMENT", "review", "Customer claims payment. Only Stripe can confirm it; reconciliation requested.");
      break;
    }
    case "needs_review":
    case "other": {
      repos.reviews.open({ organisationId: org, kind: "customer_message", decisionCode: c.kind === "other" ? "MESSAGE_UNCLASSIFIED" : "MESSAGE_NEEDS_REVIEW", reason: c.reason, customerId: customer.id, invoiceId: invoice.id, billingRunId: null, evidenceIds: [evidence.id] });
      audit("collections.message_review", "MESSAGE_NEEDS_REVIEW", "review", `Message sent to review: ${c.reason}`);
      break;
    }
  }

  return { ok: true, evidenceId: evidence.id, status: "accepted", classification: c.kind, cancelledActionIds: cancelled, correlationId };
}
