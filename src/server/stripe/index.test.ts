import { afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { createFakeStripeAdapter, createRealStripeAdapter } from "./index";
import { WebhookSignatureError, type CreateInvoiceInput } from "@/contracts";

const input: CreateInvoiceInput = { organisationId: "org_demo", billingRunId: "run_1", billingKey: "bill:org_demo:cus_acme:ms_acme_migration", customerId: "cus_acme", stripeCustomerId: "cus_test", currency: "gbp", daysUntilDue: 14, correlationId: "corr_1", lines: [{ milestoneId: "ms_acme_migration", description: "Website migration", quantity: 1, unitAmountMinor: 120000, amountMinor: 120000, priceSource: { kind: "contract", id: "ctr_1" }, evidenceIds: ["ev_1"] }] };
const iterable = <T>(values: T[]) => (async function* () { yield* values; })();
function stripeHarness() {
  const invoices: any[] = [], items: any[] = [];
  let failFinalize = false;
  const client = {
    customers: { retrieve: vi.fn(async () => ({ id: "cus_test", livemode: false })), list: vi.fn(() => iterable([])), create: vi.fn(async () => ({ id: "cus_test", livemode: false })) },
    invoices: {
      list: vi.fn(() => iterable(invoices)),
      create: vi.fn(async (p) => { const v = { ...p, id: "in_test", livemode: false, status: "draft", number: null, total: 0, amount_due: 0, amount_paid: 0, amount_remaining: 0, due_date: 1793296800, hosted_invoice_url: null }; invoices.push(v); return v; }),
      retrieve: vi.fn(async () => invoices[0]),
      listLineItems: vi.fn(() => iterable(items.map(i => ({ id: `il_${i.id}`, parent: { invoice_item_details: { invoice_item: i.id } }, description: i.description, amount: i.amount })))),
      finalizeInvoice: vi.fn(async () => { if (failFinalize) { failFinalize = false; throw new Error("connection lost"); } const v = invoices[0]; v.status = "open"; v.number = "DUE-1"; return v; }),
    },
    invoiceItems: {
      list: vi.fn(() => iterable(items)),
      create: vi.fn(async (p) => { const v = { ...p, id: "ii_1", livemode: false }; items.push(v); invoices[0].total += p.amount; invoices[0].amount_due += p.amount; invoices[0].amount_remaining += p.amount; return v; }),
    },
  };
  return { client, invoices, items, adapter: createRealStripeAdapter(client as unknown as Stripe), failNextFinalize: () => { failFinalize = true; } };
}
afterEach(() => vi.unstubAllEnvs());

describe("Stripe adapter", () => {
  it("recovers from finalization failure without creating another invoice or item", async () => {
    const h = stripeHarness(); h.failNextFinalize();
    await expect(h.adapter.createInvoice(input)).rejects.toThrow("connection lost");
    const retry = await h.adapter.createInvoice(input);
    expect(retry).toMatchObject({ stripeInvoiceId: "in_test", status: "open", totalMinor: 120000, amountRemainingMinor: 120000 });
    expect(retry.lines[0]?.stripeInvoiceItemId).toBe("ii_1");
    expect(h.client.invoices.create).toHaveBeenCalledTimes(1);
    expect(h.client.invoiceItems.create).toHaveBeenCalledTimes(1);
    expect(h.client.invoiceItems.create.mock.calls[0]?.[0].invoice).toBe("in_test");
    expect(h.client.invoices.create.mock.calls[0]?.[0]).toMatchObject({ collection_method: "send_invoice", days_until_due: 14, pending_invoice_items_behavior: "exclude", auto_advance: false });
    expect((await h.adapter.createInvoice({ ...input, billingRunId: "retry_new_run" })).stripeInvoiceId).toBe("in_test");
    expect(h.items).toHaveLength(1);
    await expect(h.adapter.createInvoice({...input,lines:[{...input.lines[0]!,description:"Changed terms"}]})).rejects.toThrow("different lines");
  });
  it("refreshes authoritative balances rather than returning a cached snapshot", async () => {
    const h = stripeHarness(); await h.adapter.createInvoice(input);
    Object.assign(h.invoices[0], { status: "paid", amount_paid: 120000, amount_remaining: 0 });
    expect(await h.adapter.refreshInvoice("in_test")).toMatchObject({ status: "paid", amountRemainingMinor: 0 });
  });
  it("refuses live objects and inconsistent lines before finalization", async () => {
    const h = stripeHarness(); await h.adapter.createInvoice(input);
    h.invoices[0].livemode = true;
    await expect(h.adapter.refreshInvoice("in_test")).rejects.toMatchObject({ code: "LIVE_MODE_REFUSED" });
    await expect(h.adapter.createInvoice({ ...input, lines: [{ ...input.lines[0]!, unitAmountMinor: 1 }] })).rejects.toThrow("Invalid validated");
  });
  it("reuses an existing customer and rejects a deleted mapping", async () => {
    const h = stripeHarness(); const customer = { organisationId: "org_demo", customerId: "cus_acme", displayName: "Acme", email: null, existingStripeCustomerId: "cus_test" };
    expect(await h.adapter.ensureCustomer(customer)).toEqual({ stripeCustomerId: "cus_test" });
    expect(h.client.customers.create).not.toHaveBeenCalled();
    h.client.customers.retrieve.mockResolvedValueOnce({ id: "cus_test", deleted: true } as never);
    await expect(h.adapter.ensureCustomer(customer)).rejects.toThrow("deleted");
  });
  it("the fake is idempotent, isolated from callers, and can settle a payment", async () => {
    const fake = createFakeStripeAdapter(); const a = await fake.createInvoice(input);
    a.lines.splice(0);
    const b = await fake.createInvoice(input);
    expect(b.lines).toHaveLength(1);
    expect(b.hostedInvoiceUrl).toBeNull();
    fake.payInvoice(b.stripeInvoiceId);
    expect(await fake.refreshInvoice(b.stripeInvoiceId)).toMatchObject({ status: "paid", amountRemainingMinor: 0 });
  });
  it("authenticates signed raw bodies and rejects tampering, missing signatures and live events", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret");
    const fake = createFakeStripeAdapter();
    const payload = (livemode = false) => JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", created: Math.floor(Date.now() / 1000), livemode, data: { object: { id: "in_1", object: "invoice" } } });
    const raw = payload(); const sign = (s: string) => Stripe.webhooks.generateTestHeaderString({ payload: s, secret: "whsec_test_secret" });
    expect(fake.verifyWebhook(raw, sign(raw))).toMatchObject({ eventId: "evt_1", stripeInvoiceId: "in_1", livemode: false });
    expect(() => fake.verifyWebhook(raw + " ", sign(raw))).toThrow(WebhookSignatureError);
    expect(() => fake.verifyWebhook(raw, null)).toThrow(WebhookSignatureError);
    expect(() => fake.verifyWebhook(payload(true), sign(payload(true)))).toThrow(WebhookSignatureError);
  });
});
