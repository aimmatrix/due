import { beforeEach, describe, expect, it } from "vitest";
import {
  DEMO_ORGANISATION_ID as ORG,
  DEMO_POLICY,
  WebhookSignatureError,
  billingKeyFor,
  type AppTime,
  type EvaluateBilling,
  type StripeAdapter,
  type StripeInvoiceSnapshot,
} from "@/contracts";
import { createRepositories, openDatabase, seedDemoData, type Repositories } from "@/server/db";
import { unavailableLlm } from "@/server/llm";
import { ingestCompletion, processBillingRun, type BillingRuntime } from "./billing";
import { buildDashboard, buildInvoiceDetail } from "./read-models";
import { handleStripeEvent, reconcileStripeInvoice } from "./reconcile";

/** Fake Stripe whose "server" state can be paid/partially paid, with failures on demand. */
function fakeStripe() {
  const invoices = new Map<string, StripeInvoiceSnapshot>();
  const ctl = { refreshFails: false };
  const adapter: StripeAdapter = {
    async ensureCustomer(i) {
      return { stripeCustomerId: `cus_fake_${i.customerId}` };
    },
    async createInvoice(i) {
      const existing = [...invoices.values()].find((x) => x.metadata.billingRunId === i.billingRunId);
      if (existing) return existing;
      const total = i.lines.reduce((s, l) => s + l.amountMinor, 0);
      const inv: StripeInvoiceSnapshot = {
        stripeInvoiceId: `in_fake_${invoices.size + 1}`, stripeInvoiceNumber: `DUE-000${invoices.size + 1}`, stripeCustomerId: i.stripeCustomerId,
        status: "open", currency: "gbp", totalMinor: total, amountDueMinor: total, amountPaidMinor: 0, amountRemainingMinor: total,
        dueAt: "2026-10-29T18:42:00.000Z", hostedInvoiceUrl: "https://invoice.stripe.com/i/fake", livemode: false,
        lines: i.lines.map((l, n) => ({ stripeLineId: `il_${n}`, stripeInvoiceItemId: `ii_${n}`, description: l.description, amountMinor: l.amountMinor })),
        metadata: { billingRunId: i.billingRunId }, retrievedAt: "2026-10-15T18:43:00.000Z",
      };
      invoices.set(inv.stripeInvoiceId, inv);
      return inv;
    },
    async refreshInvoice(id) {
      if (ctl.refreshFails) throw Object.assign(new Error("down"), { code: "STRIPE_UNAVAILABLE" });
      const inv = invoices.get(id);
      if (!inv) throw new Error("no such invoice");
      return { ...inv, retrievedAt: new Date().toISOString() };
    },
    verifyWebhook(raw, sig) {
      if (sig !== "valid") throw new WebhookSignatureError("STRIPE_SIGNATURE_INVALID");
      return JSON.parse(raw);
    },
  };
  const pay = (id: string, amountMinor: number) => {
    const inv = invoices.get(id)!;
    const paid = inv.amountPaidMinor + amountMinor;
    invoices.set(id, { ...inv, amountPaidMinor: paid, amountRemainingMinor: inv.totalMinor - paid, status: paid >= inv.totalMinor ? "paid" : "open" });
  };
  return { adapter, invoices, ctl, pay };
}

const evaluate: EvaluateBilling = async (ctx) => {
  const ms = ctx.milestones.find((m) => m.id === "ms_acme_migration")!;
  const line = { description: ms.title, quantity: 1 as const, unitAmountMinor: ms.amountMinor, amountMinor: ms.amountMinor, milestoneId: ms.id, priceSource: ms.sourceRef, evidenceIds: [ctx.evidence.id] };
  return {
    kind: "bill", decisionCode: "BILL_VALIDATED", customerId: ms.customerId, milestoneId: ms.id, billingKey: billingKeyFor(ORG, ms.customerId, ms.id),
    lines: [line], calculation: { lines: [line], subtotalMinor: 120000, taxMinor: 0, totalMinor: 120000, currency: "gbp", notes: [DEMO_POLICY.tax.note] },
    evidenceIds: [ctx.evidence.id], explanation: "Matched Acme M2 at £1,200.00", extraction: { customerName: null, completedItems: [], contradictions: [], mentionedAmounts: [] },
  };
};

let repos: Repositories;
let stripe: ReturnType<typeof fakeStripe>;
let rt: BillingRuntime;
let appTime: AppTime;

async function invoiced() {
  const ing = await ingestCompletion(rt, { organisationId: ORG, externalEventId: "sub-1", sourceType: "completion_form", sourceRef: "form:sub-1", customerRef: "Acme Ltd", text: "M2 done", receivedAt: "2026-10-15T18:42:00.000Z" });
  const run = await processBillingRun(rt, ORG, ing.billingRunId);
  return repos.invoices.get(ORG, run.invoiceId!)!;
}

const event = (id: string, stripeInvoiceId: string | null, type = "invoice.paid") => ({ eventId: id, type, createdAt: "2026-10-15T19:00:00.000Z", stripeInvoiceId, livemode: false as const });

beforeEach(() => {
  const db = openDatabase(":memory:");
  seedDemoData(db, { phones: ["+447700900000"] });
  repos = createRepositories(db);
  stripe = fakeStripe();
  appTime = { now: "2026-10-15T18:45:00.000Z", simulated: false, offsetMs: 0 };
  rt = { repos, evaluateBilling: evaluate, stripe: stripe.adapter, llm: unavailableLlm, policy: DEMO_POLICY, appTime: () => appTime };
});

describe("payment reconciliation", () => {
  it("a verified payment event refreshes from Stripe, zeroes the balance and stops collections", async () => {
    const inv = await invoiced();
    repos.actions.insertOrGet({
      organisationId: ORG, invoiceId: inv.id, customerId: inv.customerId, correlationId: "c", kind: "reminder_email", sequence: 1, dueAt: "2026-10-30T09:00:00.000Z",
      state: "queued", decisionCode: "REMIND_OVERDUE", reason: "r", evidenceIds: [], externalReceiptId: null, deliveryState: "pending", deliveredAt: null, cancelledReason: null, lastError: null,
    });
    stripe.pay(inv.stripeInvoiceId, 120000);
    expect(await handleStripeEvent(rt, ORG, event("evt_1", inv.stripeInvoiceId))).toBe("processed");
    const after = repos.invoices.get(ORG, inv.id)!;
    expect([after.stripeStatus, after.amountRemainingMinor]).toEqual(["paid", 0]);
    expect(repos.actions.listByInvoice(ORG, inv.id)[0]?.state).toBe("cancelled");
    expect(repos.audit.listByInvoice(ORG, inv.id).some((a) => a.action === "stripe.payment_reconciled")).toBe(true);
  });

  it("duplicate events are acknowledged without reprocessing", async () => {
    const inv = await invoiced();
    stripe.pay(inv.stripeInvoiceId, 120000);
    await handleStripeEvent(rt, ORG, event("evt_1", inv.stripeInvoiceId));
    const auditCount = repos.audit.listByInvoice(ORG, inv.id).length;
    expect(await handleStripeEvent(rt, ORG, event("evt_1", inv.stripeInvoiceId))).toBe("duplicate");
    expect(repos.audit.listByInvoice(ORG, inv.id)).toHaveLength(auditCount);
  });

  it("an out-of-order 'finalized' event after payment cannot regress the invoice", async () => {
    const inv = await invoiced();
    stripe.pay(inv.stripeInvoiceId, 120000);
    await handleStripeEvent(rt, ORG, event("evt_paid", inv.stripeInvoiceId));
    // The late event triggers a fresh retrieve, which still says paid.
    await handleStripeEvent(rt, ORG, event("evt_finalized", inv.stripeInvoiceId, "invoice.finalized"));
    expect(repos.invoices.get(ORG, inv.id)?.stripeStatus).toBe("paid");
  });

  it("a partial payment keeps the remaining balance", async () => {
    const inv = await invoiced();
    stripe.pay(inv.stripeInvoiceId, 50000);
    await reconcileStripeInvoice(rt, ORG, inv.stripeInvoiceId, { kind: "manual_refresh" });
    const after = repos.invoices.get(ORG, inv.id)!;
    expect([after.stripeStatus, after.amountPaidMinor, after.amountRemainingMinor]).toEqual(["open", 50000, 70000]);
  });

  it("a processing failure releases the event so Stripe's retry is handled; manual refresh repairs a missed webhook", async () => {
    const inv = await invoiced();
    stripe.pay(inv.stripeInvoiceId, 120000);
    stripe.ctl.refreshFails = true;
    await expect(handleStripeEvent(rt, ORG, event("evt_1", inv.stripeInvoiceId))).rejects.toThrow();
    stripe.ctl.refreshFails = false;
    expect(await handleStripeEvent(rt, ORG, event("evt_1", inv.stripeInvoiceId))).toBe("processed");
    // Missed webhook entirely: manual refresh still converges.
    const inv2 = repos.invoices.get(ORG, inv.id)!;
    expect(inv2.stripeStatus).toBe("paid");
    expect((await reconcileStripeInvoice(rt, ORG, inv.stripeInvoiceId, { kind: "manual_refresh" })).changed).toBe(false);
  });

  it("events for unknown invoices or without an invoice are ignored", async () => {
    expect(await handleStripeEvent(rt, ORG, event("evt_x", "in_not_ours"))).toBe("ignored");
    expect(await handleStripeEvent(rt, ORG, event("evt_y", null, "customer.created"))).toBe("ignored");
  });

  it("a fulfilled promise is closed when Stripe confirms payment", async () => {
    const inv = await invoiced();
    const ev = repos.evidence.insertOrGet({ organisationId: ORG, externalEventId: "m1", sourceType: "email", sourceRef: "<m1>", customerRef: "Acme Ltd", customerId: inv.customerId, invoiceId: inv.id, receivedAt: "2026-10-31T10:00:00.000Z", text: "Paying 7 Nov" }).evidence;
    const p = repos.promises.record({ organisationId: ORG, invoiceId: inv.id, customerId: inv.customerId, promisedDate: "2026-11-07", evidenceId: ev.id, quote: "Paying 7 Nov" });
    stripe.pay(inv.stripeInvoiceId, 120000);
    await reconcileStripeInvoice(rt, ORG, inv.stripeInvoiceId, { kind: "manual_refresh" });
    expect(repos.promises.listByInvoice(ORG, inv.id).find((x) => x.id === p.id)?.status).toBe("fulfilled");
  });
});

describe("read models", () => {
  it("dashboard totals and statuses follow Stripe state", async () => {
    const inv = await invoiced();
    let d = buildDashboard(repos, ORG, appTime);
    expect(d.totals).toMatchObject({ invoicedMinor: 120000, collectedMinor: 0, outstandingMinor: 120000, overdueMinor: 0, invoiceCount: 1 });
    expect(d.invoices[0]).toMatchObject({ collectionStatus: "not_due", stripeDashboardUrl: `https://dashboard.stripe.com/test/invoices/${inv.stripeInvoiceId}` });
    expect(d.recentRuns[0]).toMatchObject({ state: "invoiced", sourceType: "completion_form", customerName: "Acme Ltd" });

    appTime = { now: "2026-10-30T09:00:00.000Z", simulated: true, offsetMs: 1 };
    d = buildDashboard(repos, ORG, appTime);
    expect(d.totals.overdueMinor).toBe(120000);
    expect(d.invoices[0]?.collectionStatus).toBe("overdue");

    stripe.pay(inv.stripeInvoiceId, 120000);
    await reconcileStripeInvoice(rt, ORG, inv.stripeInvoiceId, { kind: "manual_refresh" });
    d = buildDashboard(repos, ORG, appTime);
    expect(d.totals).toMatchObject({ collectedMinor: 120000, outstandingMinor: 0, overdueMinor: 0 });
    expect(d.invoices[0]?.collectionStatus).toBe("paid");
  });

  it("invoice detail explains the amount and shows the full timeline", async () => {
    const inv = await invoiced();
    const detail = buildInvoiceDetail(repos, ORG, inv.id, appTime)!;
    expect(detail.calculation.totalMinor).toBe(120000);
    expect(detail.milestone).toMatchObject({ reference: "M2-website-migration", sourceLabel: "Acme SOW 2026-07 §4.2 — £1,200" });
    expect(detail.evidence.map((e) => e.sourceType)).toEqual(["completion_form"]);
    expect(detail.timeline.map((a) => a.action)).toEqual(["evidence.received", "billing.evaluated", "stripe.invoice_finalised"]);
    expect(detail.memory.provider).toBe("not_used");
    expect(detail.callEligibility.eligible).toBe(false);
    expect(buildInvoiceDetail(repos, "org_other", inv.id, appTime)).toBeNull();
  });

  it("a reply recorded after the demo clock moved counts as after the reminder", async () => {
    const inv = await invoiced();
    repos.actions.insertOrGet({
      organisationId: ORG, invoiceId: inv.id, customerId: inv.customerId, correlationId: "c", kind: "reminder_email", sequence: 1, dueAt: "2026-10-30T09:00:00.000Z",
      state: "sent", decisionCode: "REMIND_OVERDUE", reason: "r", evidenceIds: [], externalReceiptId: "msg_1", deliveryState: "delivered", deliveredAt: "2026-10-30T09:00:04.000Z", cancelledReason: null, lastError: null,
    });
    // Real wall-clock time is 15 Oct, but the app clock says 30 Oct 15:00 when the reply is recorded.
    repos.evidence.insertOrGet({ organisationId: ORG, externalEventId: "m1", sourceType: "email", sourceRef: "<m1>", customerRef: "Acme Ltd", customerId: inv.customerId, invoiceId: inv.id, receivedAt: "2026-10-15T19:30:00.000Z", receivedAppAt: "2026-10-30T15:00:00.000Z", text: "Will check with finance" });
    appTime = { now: "2026-11-01T10:00:00.000Z", simulated: true, offsetMs: 1 };
    const detail = buildInvoiceDetail(repos, ORG, inv.id, appTime)!;
    expect(detail.callEligibility.decisionCode).toBe("RESPONSE_RECEIVED");
    expect(detail.callEligibility.eligible).toBe(false);
  });
});
