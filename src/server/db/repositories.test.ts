import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_ORGANISATION_ID as ORG, DEMO_POLICY, billingKeyFor, type StripeInvoiceSnapshot } from "@/contracts";
import { createRepositories, openDatabase, seedDemoData, type Repositories } from "./index";

let repos: Repositories;

const KEY = billingKeyFor(ORG, "cus_acme", "ms_acme_migration");

function evidence(externalEventId = "evt-1") {
  return repos.evidence.insertOrGet({
    organisationId: ORG,
    externalEventId,
    sourceType: "email",
    sourceRef: `<${externalEventId}@mail.example>`,
    customerRef: "Acme Ltd",
    customerId: null,
    invoiceId: null,
    receivedAt: "2026-10-15T18:42:00.000Z",
    text: "Migration complete",
  });
}

function run(evId: string) {
  return repos.billingRuns.createOrGet({ organisationId: ORG, correlationId: "corr_t", primaryEvidenceId: evId, policyVersion: DEMO_POLICY.version });
}

function snapshot(over: Partial<StripeInvoiceSnapshot> = {}): StripeInvoiceSnapshot {
  return {
    stripeInvoiceId: "in_test_1",
    stripeInvoiceNumber: "DUE-0001",
    stripeCustomerId: "cus_stripe_1",
    status: "open",
    currency: "gbp",
    totalMinor: 120000,
    amountDueMinor: 120000,
    amountPaidMinor: 0,
    amountRemainingMinor: 120000,
    dueAt: "2026-10-29T18:43:00.000Z",
    hostedInvoiceUrl: "https://invoice.stripe.com/i/test",
    livemode: false,
    lines: [],
    metadata: {},
    retrievedAt: "2026-10-15T18:43:05.000Z",
    ...over,
  };
}

function invoiceFor(runId: string, over: Partial<StripeInvoiceSnapshot> = {}) {
  return repos.invoices.upsertFromSnapshot({
    organisationId: ORG,
    customerId: "cus_acme",
    milestoneId: "ms_acme_migration",
    billingRunId: runId,
    billingKey: KEY,
    lines: [],
    snapshot: snapshot(over),
  });
}

beforeEach(() => {
  const db = openDatabase(":memory:");
  seedDemoData(db, { emails: ["team@example.test"], phones: ["+447700900000"] });
  repos = createRepositories(db);
});

describe("seed", () => {
  it("is idempotent and keeps the authoritative £1,200 price", () => {
    seedDemoData(repos.db);
    expect(repos.customers.list(ORG)).toHaveLength(2);
    expect(repos.milestones.get(ORG, "ms_acme_migration")?.amountMinor).toBe(120000);
    expect(repos.customers.get(ORG, "cus_acme")?.allowedPhoneNumbers).toEqual(["+447700900000"]);
  });

  it("scopes reads by organisation", () => {
    expect(repos.customers.list("org_other")).toHaveLength(0);
    expect(repos.milestones.get("org_other", "ms_acme_migration")).toBeNull();
  });
});

describe("duplicate protection", () => {
  it("re-delivered events return the original evidence and billing run", () => {
    const a = evidence();
    const b = evidence();
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.evidence.id).toBe(a.evidence.id);
    const r1 = run(a.evidence.id);
    const r2 = run(b.evidence.id);
    expect(r2.created).toBe(false);
    expect(r2.run.id).toBe(r1.run.id);
  });

  it("only one run can claim a milestone billing key", () => {
    const r1 = run(evidence("evt-1").evidence.id).run;
    const r2 = run(evidence("evt-2").evidence.id).run;
    const claim = { billingKey: KEY, customerId: "cus_acme", milestoneId: "ms_acme_migration", decisionCode: "BILL_VALIDATED" };
    expect(repos.billingRuns.claimBillingKey(ORG, r1.id, claim)).toEqual({ ok: true });
    // Retrying the same run is fine (crash recovery).
    expect(repos.billingRuns.claimBillingKey(ORG, r1.id, claim)).toEqual({ ok: true });
    // An alternate event for the same milestone is refused.
    expect(repos.billingRuns.claimBillingKey(ORG, r2.id, claim)).toEqual({ ok: false, existingRunId: r1.id });
  });

  it("one invoice per billing key and per Stripe invoice ID", () => {
    const r1 = run(evidence().evidence.id).run;
    const first = invoiceFor(r1.id);
    const again = invoiceFor(r1.id);
    expect(again.invoice.id).toBe(first.invoice.id);
    expect(() => invoiceFor(r1.id, { stripeInvoiceId: "in_test_2" })).toThrow(/refusing second Stripe invoice/);
    expect(repos.invoices.list(ORG)).toHaveLength(1);
  });

  it("webhook events are processed once", () => {
    expect(repos.webhooks.markProcessed("stripe", "evt_1")).toBe(true);
    expect(repos.webhooks.markProcessed("stripe", "evt_1")).toBe(false);
    expect(repos.webhooks.markProcessed("elevenlabs", "evt_1")).toBe(true);
    repos.webhooks.unmark("stripe", "evt_1");
    expect(repos.webhooks.markProcessed("stripe", "evt_1")).toBe(true);
  });

  it("collection actions are unique per invoice/kind/sequence and reserve atomically", () => {
    const inv = invoiceFor(run(evidence().evidence.id).run.id).invoice;
    const base = {
      organisationId: ORG, invoiceId: inv.id, customerId: "cus_acme", correlationId: "corr_t", kind: "reminder_email" as const,
      sequence: 1, dueAt: "2026-10-30T09:00:00.000Z", state: "queued" as const, decisionCode: "REMIND_OVERDUE", reason: "overdue",
      evidenceIds: [], externalReceiptId: null, deliveryState: "pending" as const, deliveredAt: null, cancelledReason: null, lastError: null,
    };
    const a = repos.actions.insertOrGet(base);
    const b = repos.actions.insertOrGet(base);
    expect(b.created).toBe(false);
    expect(b.action.id).toBe(a.action.id);
    expect(repos.actions.listDue(ORG, "2026-10-29T00:00:00.000Z")).toHaveLength(0);
    expect(repos.actions.listDue(ORG, "2026-10-30T09:00:00.000Z")).toHaveLength(1);
    expect(repos.actions.transition(ORG, a.action.id, ["queued"], "reserved")).not.toBeNull();
    // A second worker cannot reserve the same action, and a reserved action is not cancelled as "queued".
    expect(repos.actions.transition(ORG, a.action.id, ["queued"], "reserved")).toBeNull();
    expect(repos.actions.cancelQueued(ORG, inv.id, "paid")).toEqual([]);
    const sent = repos.actions.transition(ORG, a.action.id, ["reserved"], "sent", { externalReceiptId: "msg_1", deliveryState: "pending" });
    expect(sent?.state).toBe("sent");
    expect(repos.actions.markDelivery(ORG, a.action.id, "delivered", "2026-10-30T09:00:04.000Z")?.deliveryState).toBe("delivered");
    // Delivery is confirmed once; a later failure event cannot flip it.
    expect(repos.actions.markDelivery(ORG, a.action.id, "failed", "2026-10-30T09:01:00.000Z")).toBeNull();
  });
});

describe("payment state", () => {
  it("never regresses a paid invoice from a stale or out-of-order snapshot", () => {
    const r1 = run(evidence().evidence.id).run;
    invoiceFor(r1.id);
    const paid = repos.invoices.applySnapshot(ORG, snapshot({ status: "paid", amountPaidMinor: 120000, amountRemainingMinor: 0, retrievedAt: "2026-10-15T19:00:00.000Z" }));
    expect(paid?.invoice.amountRemainingMinor).toBe(0);
    const stale = repos.invoices.applySnapshot(ORG, snapshot({ retrievedAt: "2026-10-15T19:01:00.000Z" }));
    expect(stale?.changed).toBe(false);
    expect(repos.invoices.getByStripeId(ORG, "in_test_1")?.stripeStatus).toBe("paid");
  });

  it("keeps a partial payment's remaining balance", () => {
    const r1 = run(evidence().evidence.id).run;
    invoiceFor(r1.id);
    repos.invoices.applySnapshot(ORG, snapshot({ amountPaidMinor: 60000, amountRemainingMinor: 60000 }));
    const stale = repos.invoices.applySnapshot(ORG, snapshot());
    expect(stale?.changed).toBe(false);
    expect(repos.invoices.getByStripeId(ORG, "in_test_1")?.amountRemainingMinor).toBe(60000);
  });
});

describe("promises", () => {
  it("a new promise supersedes the previous one and replays are idempotent", () => {
    const inv = invoiceFor(run(evidence().evidence.id).run.id).invoice;
    const e1 = evidence("msg-1").evidence;
    const e2 = evidence("msg-2").evidence;
    const p1 = repos.promises.record({ organisationId: ORG, invoiceId: inv.id, customerId: "cus_acme", promisedDate: "2026-11-07", evidenceId: e1.id, quote: "7th" });
    expect(repos.promises.record({ organisationId: ORG, invoiceId: inv.id, customerId: "cus_acme", promisedDate: "2026-11-07", evidenceId: e1.id, quote: "7th" }).id).toBe(p1.id);
    const p2 = repos.promises.record({ organisationId: ORG, invoiceId: inv.id, customerId: "cus_acme", promisedDate: "2026-11-14", evidenceId: e2.id, quote: "14th" });
    const all = repos.promises.listByInvoice(ORG, inv.id);
    expect(all.find((p) => p.id === p1.id)?.status).toBe("superseded");
    expect(all.find((p) => p.id === p2.id)?.status).toBe("active");
  });
});

describe("audit", () => {
  it("returns entries in write order with simulated-time labels", () => {
    const base = {
      organisationId: ORG, correlationId: "corr_a", decisionCode: "X", result: "ok" as const, customerId: "cus_acme", invoiceId: "inv_x",
      evidenceIds: [], policyVersion: DEMO_POLICY.version, calculation: null, explanation: "e", externalIds: {}, appTime: "2026-10-30T09:00:00.000Z",
    };
    repos.audit.append({ ...base, action: "a.first", simulatedTime: false });
    repos.audit.append({ ...base, action: "a.second", simulatedTime: true });
    const entries = repos.audit.listByInvoice(ORG, "inv_x");
    expect(entries.map((e) => e.action)).toEqual(["a.first", "a.second"]);
    expect(entries[1]?.simulatedTime).toBe(true);
  });
});
