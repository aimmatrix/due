import { beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_ORGANISATION_ID as ORG,
  DEMO_POLICY,
  NotImplementedError,
  billingKeyFor,
  type BillingDecision,
  type ClassifyCustomerMessage,
  type EvaluateBilling,
  type StripeAdapter,
  type StripeInvoiceSnapshot,
} from "@/contracts";
import { createRepositories, openDatabase, seedDemoData, type Repositories } from "@/server/db";
import { unavailableLlm } from "@/server/llm";
import { ingestCompletion, processBillingRun, type BillingRuntime } from "./billing";
import { recordCustomerMessage, type MessageRuntime } from "./messages";

const APP_TIME = { now: "2026-10-15T18:42:00.000Z", simulated: false, offsetMs: 0 };

/** Fake A1: bills a known milestone reference at the stored price; anything else → review. */
const fakeEvaluate: EvaluateBilling = async (ctx) => {
  const ms = ctx.milestones.find((m) => ctx.evidence.text.includes(m.reference));
  if (!ms) {
    return { kind: "review", decisionCode: "MILESTONE_UNRESOLVED", reason: "No known milestone", customerId: null, milestoneId: null, evidenceIds: [ctx.evidence.id], extraction: null };
  }
  const key = billingKeyFor(ctx.organisationId, ms.customerId, ms.id);
  if (ctx.existingBillingKeys.includes(key)) return { kind: "ignore", decisionCode: "ALREADY_BILLED", reason: "Already billed", billingKey: key, evidenceIds: [ctx.evidence.id] };
  const line = { description: ms.title, quantity: 1 as const, unitAmountMinor: ms.amountMinor, amountMinor: ms.amountMinor, milestoneId: ms.id, priceSource: ms.sourceRef, evidenceIds: [ctx.evidence.id] };
  const decision: BillingDecision = {
    kind: "bill",
    decisionCode: "BILL_VALIDATED",
    customerId: ms.customerId,
    milestoneId: ms.id,
    billingKey: key,
    lines: [line],
    calculation: { lines: [line], subtotalMinor: ms.amountMinor, taxMinor: 0, totalMinor: ms.amountMinor, currency: "gbp", notes: [] },
    evidenceIds: [ctx.evidence.id],
    explanation: `Matched ${ms.reference} at ${ms.amountMinor}`,
    extraction: { customerName: null, completedItems: [], contradictions: [], mentionedAmounts: [] },
  };
  return decision;
};

/** Fake A2: idempotent per billing run, can fail the next N createInvoice calls *after* creating. */
function fakeStripe() {
  const byRun = new Map<string, StripeInvoiceSnapshot>();
  const state = { createCalls: 0, failAfterCreate: 0 };
  const adapter: StripeAdapter = {
    async ensureCustomer(i) {
      return { stripeCustomerId: i.existingStripeCustomerId ?? `cus_fake_${i.customerId}` };
    },
    async createInvoice(i) {
      state.createCalls++;
      let inv = byRun.get(i.billingRunId);
      if (!inv) {
        const total = i.lines.reduce((s, l) => s + l.amountMinor, 0);
        inv = {
          stripeInvoiceId: `in_fake_${byRun.size + 1}`, stripeInvoiceNumber: `DUE-000${byRun.size + 1}`, stripeCustomerId: i.stripeCustomerId,
          status: "open", currency: "gbp", totalMinor: total, amountDueMinor: total, amountPaidMinor: 0, amountRemainingMinor: total,
          dueAt: "2026-10-29T18:42:00.000Z", hostedInvoiceUrl: "https://invoice.stripe.com/i/fake", livemode: false,
          lines: i.lines.map((l, n) => ({ stripeLineId: `il_${n}`, stripeInvoiceItemId: `ii_${n}`, description: l.description, amountMinor: l.amountMinor })),
          metadata: { billingRunId: i.billingRunId }, retrievedAt: APP_TIME.now,
        };
        byRun.set(i.billingRunId, inv);
      }
      if (state.failAfterCreate > 0) {
        state.failAfterCreate--;
        throw Object.assign(new Error("network"), { code: "STRIPE_NETWORK_ERROR" });
      }
      return inv;
    },
    async refreshInvoice() {
      throw new NotImplementedError("refresh");
    },
    verifyWebhook() {
      throw new NotImplementedError("verify");
    },
  };
  return { adapter, byRun, state };
}

let repos: Repositories;
let stripe: ReturnType<typeof fakeStripe>;
let rt: BillingRuntime;

const ACME_TEXT = "Confirming the Acme website migration (M2-website-migration) is complete. Please bill £5,000.";

async function submit(externalEventId: string, text = ACME_TEXT) {
  const ingest = await ingestCompletion(rt, {
    organisationId: ORG, externalEventId, sourceType: "completion_form", sourceRef: `form:${externalEventId}`,
    customerRef: "Acme Ltd", text, receivedAt: APP_TIME.now,
  });
  return { ingest, run: await processBillingRun(rt, ORG, ingest.billingRunId) };
}

beforeEach(() => {
  const db = openDatabase(":memory:");
  seedDemoData(db);
  repos = createRepositories(db);
  stripe = fakeStripe();
  rt = { repos, evaluateBilling: fakeEvaluate, stripe: stripe.adapter, llm: unavailableLlm, policy: DEMO_POLICY, appTime: () => APP_TIME };
});

describe("completion → invoice", () => {
  it("a valid event creates one finalised invoice at the stored price with no approval step", async () => {
    const { ingest, run } = await submit("sub-1");
    expect(ingest.status).toBe("accepted");
    expect(run.state).toBe("invoiced");
    const inv = repos.invoices.get(ORG, run.invoiceId!)!;
    expect(inv.totalMinor).toBe(120000); // not the £5,000 in the text
    expect(inv.lines[0]?.stripeInvoiceItemId).toBe("ii_0");
    expect(repos.milestones.get(ORG, "ms_acme_migration")?.state).toBe("billed");
    expect(repos.customers.get(ORG, "cus_acme")?.stripeCustomerId).toBe("cus_fake_cus_acme");
    const actions = repos.audit.listByInvoice(ORG, inv.id).map((a) => a.action);
    expect(actions).toContain("stripe.invoice_finalised");
    expect(repos.audit.listByCorrelation(run.correlationId).map((a) => a.action)).toEqual(["evidence.received", "billing.evaluated", "stripe.invoice_finalised"]);
  });

  it("a replayed event returns the original result without a second invoice", async () => {
    const first = await submit("sub-1");
    const replay = await submit("sub-1");
    expect(replay.ingest.status).toBe("duplicate");
    expect(replay.run.id).toBe(first.run.id);
    expect(replay.run.invoiceId).toBe(first.run.invoiceId);
    expect(stripe.state.createCalls).toBe(1);
    expect(repos.invoices.list(ORG)).toHaveLength(1);
  });

  it("an alternate event for the same milestone is blocked", async () => {
    await submit("sub-1");
    const second = await submit("sub-2");
    expect(second.run.state).toBe("ignored");
    expect(["ALREADY_BILLED", "DUPLICATE_MILESTONE"]).toContain(second.run.decisionCode);
    expect(repos.invoices.list(ORG)).toHaveLength(1);
  });

  it("a crash after Stripe creation recovers the same invoice on retry", async () => {
    stripe.state.failAfterCreate = 1;
    const { run } = await submit("sub-1");
    expect(run.state).toBe("failed_retryable");
    expect(run.lastError?.code).toBe("STRIPE_NETWORK_ERROR");
    expect(repos.invoices.list(ORG)).toHaveLength(0);
    // A competing event cannot steal the claimed milestone while the first run is retrying.
    const competitor = await submit("sub-2");
    expect(competitor.run.state).toBe("ignored");
    const retried = await processBillingRun(rt, ORG, run.id);
    expect(retried.state).toBe("invoiced");
    expect(stripe.byRun.size).toBe(1);
    expect(repos.invoices.list(ORG)).toHaveLength(1);
  });

  it("unresolved evidence opens a review and creates no invoice", async () => {
    const { run } = await submit("sub-1", "We finished something for Acme, not sure what.");
    expect(run.state).toBe("review_required");
    expect(repos.reviews.listOpen(ORG)[0]?.decisionCode).toBe("MILESTONE_UNRESOLVED");
    expect(stripe.state.createCalls).toBe(0);
  });

  it("a module that is not ready leaves the run retryable, not lost", async () => {
    rt = { ...rt, evaluateBilling: async () => { throw new NotImplementedError("billing"); } };
    const { run } = await submit("sub-1");
    expect(run.state).toBe("failed_retryable");
    expect(run.lastError?.code).toBe("MODULE_NOT_READY");
    rt = { ...rt, evaluateBilling: fakeEvaluate };
    expect((await processBillingRun(rt, ORG, run.id)).state).toBe("invoiced");
  });
});

describe("customer messages", () => {
  async function invoiceWithQueuedCall() {
    const { run } = await submit("sub-1");
    const inv = repos.invoices.get(ORG, run.invoiceId!)!;
    repos.actions.insertOrGet({
      organisationId: ORG, invoiceId: inv.id, customerId: inv.customerId, correlationId: "corr_x", kind: "voice_call", sequence: 1,
      dueAt: "2026-10-31T09:00:00.000Z", state: "queued", decisionCode: "CALL_NO_RESPONSE", reason: "no response", evidenceIds: [],
      externalReceiptId: null, deliveryState: "not_applicable", deliveredAt: null, cancelledReason: null, lastError: null,
    });
    return inv;
  }
  const mrt = (classify: ClassifyCustomerMessage): MessageRuntime => ({ repos, classifyCustomerMessage: classify, llm: unavailableLlm, policy: DEMO_POLICY, appTime: () => APP_TIME });
  const msg = (invoiceId: string, id = "msg-1", customerRef = "Acme Ltd") => ({
    organisationId: ORG, externalEventId: id, sourceType: "email" as const, sourceRef: `<${id}@mail.example>`, customerRef, invoiceId,
    text: "We'll pay on the 7th of November.", receivedAt: "2026-10-30T12:00:00.000Z",
  });

  it("a reply cancels the queued call and records a promise", async () => {
    const inv = await invoiceWithQueuedCall();
    const out = await recordCustomerMessage(mrt(async () => ({ kind: "promise", promisedDate: "2026-11-07", quote: "We'll pay on the 7th of November" })), msg(inv.id));
    expect(out.ok && out.classification).toBe("promise");
    expect(out.ok && out.cancelledActionIds).toHaveLength(1);
    expect(repos.actions.listByInvoice(ORG, inv.id)[0]?.state).toBe("cancelled");
    expect(repos.promises.listByInvoice(ORG, inv.id)[0]?.promisedDate).toBe("2026-11-07");
  });

  it("an unclassifiable reply still cancels the call and goes to review", async () => {
    const inv = await invoiceWithQueuedCall();
    const out = await recordCustomerMessage(mrt(async () => { throw new NotImplementedError("classify"); }), msg(inv.id));
    expect(out.ok && out.classification).toBe("needs_review");
    expect(repos.actions.listByInvoice(ORG, inv.id)[0]?.state).toBe("cancelled");
    expect(repos.reviews.listOpen(ORG).some((r) => r.kind === "customer_message")).toBe(true);
  });

  it("a claimed payment requests reconciliation and does not mark the invoice paid", async () => {
    const inv = await invoiceWithQueuedCall();
    await recordCustomerMessage(mrt(async () => ({ kind: "claimed_payment", quote: "I paid yesterday" })), msg(inv.id));
    expect(repos.invoices.get(ORG, inv.id)?.stripeStatus).toBe("open");
    expect(repos.reviews.listOpen(ORG).some((r) => r.decisionCode === "CLAIMED_PAYMENT")).toBe(true);
  });

  it("rejects a message whose customer does not match the invoice", async () => {
    const inv = await invoiceWithQueuedCall();
    const out = await recordCustomerMessage(mrt(async () => ({ kind: "other", reason: "x" })), msg(inv.id, "msg-2", "Globex Partners"));
    expect(out).toEqual({ ok: false, code: "CUSTOMER_MISMATCH" });
    expect(repos.actions.listByInvoice(ORG, inv.id)[0]?.state).toBe("queued");
  });
});
