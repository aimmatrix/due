import { beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_ORGANISATION_ID as ORG,
  DEMO_POLICY,
  billingKeyFor,
  type StripeAdapter,
  type StripeInvoiceSnapshot,
  type VerifiedCallEvent,
} from "@/contracts";
import { createRepositories, openDatabase, seedDemoData, type Repositories } from "@/server/db";
import { decideFollowUp } from "@/server/collections";
import { applyCallEvent } from "./calls";
import { buildFollowUpInput } from "./read-models";
import type { ReconcileRuntime } from "./reconcile";

const APP_TIME = { now: "2026-11-02T10:00:00.000Z", simulated: true, offsetMs: 86_400_000 };

const snapshot = (over: Partial<StripeInvoiceSnapshot> = {}): StripeInvoiceSnapshot => ({
  stripeInvoiceId: "in_fake_1", stripeInvoiceNumber: "DUE-0001", stripeCustomerId: "cus_fake", status: "open", currency: "gbp",
  totalMinor: 120000, amountDueMinor: 120000, amountPaidMinor: 0, amountRemainingMinor: 120000, dueAt: "2026-10-29T18:42:00.000Z",
  hostedInvoiceUrl: "https://invoice.stripe.com/i/fake", livemode: false,
  lines: [{ stripeLineId: "il_0", stripeInvoiceItemId: "ii_0", description: "Website migration", amountMinor: 120000 }],
  metadata: {}, retrievedAt: APP_TIME.now, ...over,
});

let repos: Repositories;
let refreshes: number;
let refreshFails: boolean;
let rt: ReconcileRuntime;
let invoiceId: string;

const stripe: StripeAdapter = {
  async ensureCustomer() { throw new Error("unused"); },
  async createInvoice() { throw new Error("unused"); },
  async refreshInvoice() {
    refreshes++;
    if (refreshFails) throw new Error("stripe down");
    return snapshot();
  },
  verifyWebhook() { throw new Error("unused"); },
};

function event(over: Partial<VerifiedCallEvent> = {}): VerifiedCallEvent {
  return {
    dedupeKey: "elevenlabs:post_call_transcription:conv_1", providerConversationId: "conv_1", actionId: "act_call", eventAt: "2026-11-01T09:30:00.000Z",
    outcome: "promise", transcriptRef: "elevenlabs:conv_1#2", summary: "Customer promised to pay on 7 November.", promisedDate: "2026-11-07",
    supportingQuote: "We'll pay on the 7th of November", failure: null, ...over,
  };
}

beforeEach(() => {
  const db = openDatabase(":memory:");
  seedDemoData(db);
  repos = createRepositories(db);
  refreshes = 0;
  refreshFails = false;
  rt = { repos, stripe, policy: DEMO_POLICY, appTime: () => APP_TIME };

  const { evidence } = repos.evidence.insertOrGet({
    organisationId: ORG, externalEventId: "sub-1", sourceType: "completion_form", sourceRef: "form:sub-1", customerRef: "Acme Ltd",
    customerId: "cus_acme", receivedAt: "2026-10-15T18:00:00.000Z", text: "Migration complete", invoiceId: null,
  });
  const { run } = repos.billingRuns.createOrGet({ organisationId: ORG, correlationId: "corr_b", primaryEvidenceId: evidence.id, policyVersion: DEMO_POLICY.version });
  const line = {
    description: "Website migration", quantity: 1, unitAmountMinor: 120000, amountMinor: 120000, milestoneId: "ms_acme_migration",
    priceSource: "contract" as never, evidenceIds: [evidence.id], stripeInvoiceItemId: "ii_0",
  };
  invoiceId = repos.invoices.upsertFromSnapshot({
    organisationId: ORG, customerId: "cus_acme", milestoneId: "ms_acme_migration", billingRunId: run.id,
    billingKey: billingKeyFor(ORG, "cus_acme", "ms_acme_migration"), lines: [line], snapshot: snapshot(),
  }).invoice.id;

  // The scheduler persists the voice attempt before dialling, so the callback can be correlated.
  repos.actions.insertOrGet({
    id: "act_call", organisationId: ORG, invoiceId, customerId: "cus_acme", correlationId: "corr_c", kind: "voice_call", sequence: 1,
    dueAt: "2026-11-01T09:00:00.000Z", state: "sent", decisionCode: "CALL_NO_RESPONSE", reason: "no response", evidenceIds: [],
    externalReceiptId: "conv_1", deliveryState: "not_applicable", deliveredAt: null, cancelledReason: null, lastError: null,
  });
  repos.voice.insert({
    organisationId: ORG, actionId: "act_call", invoiceId, customerId: "cus_acme", providerConversationId: "conv_1", callSid: "CA1",
    dispatchState: "accepted", outcome: null, transcriptRef: null, summary: null, promisedDate: null, initiatedAt: "2026-11-01T09:00:03.000Z", completedAt: null,
  });
});

describe("applyCallEvent", () => {
  it("records a confirmed promise as evidence and a promise, and stores the outcome on the attempt", async () => {
    const out = await applyCallEvent(rt, ORG, event());
    expect(out).toMatchObject({ status: "applied", outcome: "promise" });
    const [p] = repos.promises.listByInvoice(ORG, invoiceId);
    expect([p?.promisedDate, p?.quote]).toEqual(["2026-11-07", "We'll pay on the 7th of November"]);
    expect(repos.evidence.get(ORG, p!.evidenceId)?.sourceType).toBe("call_outcome");
    expect(repos.evidence.listInboundResponses(ORG, invoiceId)).toHaveLength(1);
    const attempt = repos.voice.getByAction(ORG, "act_call")!;
    expect([attempt.outcome, attempt.promisedDate, attempt.transcriptRef]).toEqual(["promise", "2026-11-07", "elevenlabs:conv_1#2"]);
    // Provider time is real time; the stored completion time is on the application clock.
    expect(attempt.completedAt).toBe("2026-11-02T09:30:00.000Z");
    expect(repos.audit.listByInvoice(ORG, invoiceId).map((a) => a.action)).toContain("voice.call_outcome_recorded");
  });

  it("a promise defers collections: the decision becomes defer until the day after", async () => {
    await applyCallEvent(rt, ORG, event());
    const d = decideFollowUp(buildFollowUpInput(repos, repos.invoices.get(ORG, invoiceId)!, APP_TIME)!);
    expect([d.action, d.decisionCode]).toEqual(["defer", "PROMISE_ACTIVE"]);
  });

  it("applies a repeated callback once", async () => {
    await applyCallEvent(rt, ORG, event());
    expect(await applyCallEvent(rt, ORG, event())).toEqual({ status: "duplicate" });
    expect(repos.promises.listByInvoice(ORG, invoiceId)).toHaveLength(1);
    expect(repos.audit.listByInvoice(ORG, invoiceId).filter((a) => a.action === "voice.call_outcome_recorded")).toHaveLength(1);
  });

  it("a promise without a date or quote goes to review and defers nothing", async () => {
    await applyCallEvent(rt, ORG, event({ promisedDate: null }));
    expect(repos.promises.listByInvoice(ORG, invoiceId)).toHaveLength(0);
    expect(repos.reviews.listOpen(ORG).map((r) => r.decisionCode)).toEqual(["CALL_NEEDS_REVIEW"]);
    expect(repos.voice.getByAction(ORG, "act_call")?.outcome).toBe("needs_review");
  });

  it("silence is not a response: no answer stores no evidence and opens no review", async () => {
    await applyCallEvent(rt, ORG, event({ outcome: "no_answer", promisedDate: null, supportingQuote: null, summary: "Voicemail." }));
    expect(repos.evidence.listInboundResponses(ORG, invoiceId)).toHaveLength(0);
    expect(repos.reviews.listOpen(ORG)).toHaveLength(0);
    expect(repos.voice.getByAction(ORG, "act_call")?.outcome).toBe("no_answer");
  });

  it("a failed call opens a provider-error review and is never redialled here", async () => {
    await applyCallEvent(rt, ORG, event({ outcome: "failed", promisedDate: null, supportingQuote: null, failure: { code: "PROVIDER_REJECTED", message: "rejected", retryable: false } }));
    expect(repos.reviews.listOpen(ORG)[0]).toMatchObject({ kind: "provider_error", decisionCode: "CALL_FAILED" });
    expect(repos.evidence.listInboundResponses(ORG, invoiceId)).toHaveLength(0);
  });

  it("a dispute pauses collections, cancels queued actions and opens a review", async () => {
    repos.actions.insertOrGet({
      organisationId: ORG, invoiceId, customerId: "cus_acme", correlationId: "corr_r", kind: "reminder_email", sequence: 2,
      dueAt: "2026-11-03T09:00:00.000Z", state: "queued", decisionCode: "REMIND_OVERDUE", reason: "r", evidenceIds: [],
      externalReceiptId: null, deliveryState: "pending", deliveredAt: null, cancelledReason: null, lastError: null,
    });
    await applyCallEvent(rt, ORG, event({ outcome: "dispute", promisedDate: null, supportingQuote: "The migration isn't finished", summary: "Work incomplete" }));
    expect(repos.disputes.listByInvoice(ORG, invoiceId)[0]).toMatchObject({ status: "open", summary: "Work incomplete" });
    expect(repos.actions.listByInvoice(ORG, invoiceId).find((a) => a.kind === "reminder_email")?.state).toBe("cancelled");
    expect(repos.reviews.listOpen(ORG)[0]?.decisionCode).toBe("DISPUTE_OPEN");
  });

  it("a claimed payment triggers one Stripe refresh and never marks the invoice paid itself", async () => {
    await applyCallEvent(rt, ORG, event({ outcome: "claimed_payment", promisedDate: null, supportingQuote: "I already paid last week" }));
    expect(refreshes).toBe(1);
    expect(repos.invoices.get(ORG, invoiceId)?.stripeStatus).toBe("open");
    expect(repos.reviews.listOpen(ORG)[0]?.decisionCode).toBe("CLAIMED_PAYMENT");
  });

  it("keeps the review and audits an error when the Stripe refresh fails", async () => {
    refreshFails = true;
    await applyCallEvent(rt, ORG, event({ outcome: "claimed_payment", promisedDate: null, supportingQuote: "I already paid" }));
    expect(repos.reviews.listOpen(ORG)).toHaveLength(1);
    expect(repos.audit.listByInvoice(ORG, invoiceId).some((a) => a.action === "voice.stripe_refresh_failed")).toBe(true);
  });

  it("ignores an event whose action has no persisted voice attempt", async () => {
    expect(await applyCallEvent(rt, ORG, event({ actionId: "act_nope" }))).toEqual({ status: "unknown_action" });
    expect(repos.evidence.listInboundResponses(ORG, invoiceId)).toHaveLength(0);
  });
});
