import Stripe from "stripe";
import { createHash } from "node:crypto";
import { WebhookSignatureError, type CreateInvoiceInput, type StripeAdapter, type StripeInvoiceSnapshot, type StripeWebhookEvent } from "@/contracts";
import { env } from "@/server/config/env";

function refuseLive(object: { livemode?: boolean }) {
  if (object.livemode !== false) throw Object.assign(new Error("Stripe live mode refused"), { code: "LIVE_MODE_REFUSED" });
}
function validate(input: CreateInvoiceInput) {
  if (![input.organisationId, input.billingRunId, input.billingKey, input.customerId, input.stripeCustomerId].every(v => typeof v === "string" && v.length > 0)) throw new Error("Missing invoice identity");
  if (input.currency !== "gbp" || !input.lines.length || !Number.isInteger(input.daysUntilDue) || input.daysUntilDue < 1) throw new Error("Invalid invoice currency, lines or terms");
  const ids = new Set<string>();
  for (const line of input.lines) {
    if (ids.has(line.milestoneId) || line.quantity !== 1 || !Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0 || line.unitAmountMinor !== line.amountMinor) throw new Error("Invalid validated invoice line");
    ids.add(line.milestoneId);
  }
  if (!Number.isSafeInteger(input.lines.reduce((n, l) => n + l.amountMinor, 0))) throw new Error("Invalid invoice total");
}
const idempotency = (value: string) => `due:${createHash("sha256").update(value).digest("hex")}`;
const fingerprint = (i: CreateInvoiceInput) => idempotency(JSON.stringify({ currency: i.currency, lines: i.lines.map(l => [l.milestoneId, l.description, l.amountMinor]) }));
const metadataFor = (i: CreateInvoiceInput) => ({ billingRunId: i.billingRunId, billingKey: i.billingKey, organisationId: i.organisationId, customerId: i.customerId, lineFingerprint: fingerprint(i) });

function verifyWebhook(raw: string, signature: string | null): StripeWebhookEvent {
  try {
    if (!signature) throw new Error("Missing signature");
    const event = Stripe.webhooks.constructEvent(raw, signature, env.stripeWebhookSecret());
    refuseLive(event);
    const object = event.data.object;
    return { eventId: event.id, type: event.type, createdAt: new Date(event.created * 1000).toISOString(), stripeInvoiceId: object.object === "invoice" ? object.id : null, livemode: false };
  } catch {
    throw new WebhookSignatureError("STRIPE_SIGNATURE_INVALID");
  }
}

export function createRealStripeAdapter(client = new Stripe(env.stripeSecretKey())): StripeAdapter {
  async function snapshot(id: string): Promise<StripeInvoiceSnapshot> {
    const invoice = await client.invoices.retrieve(id);
    refuseLive(invoice);
    if (invoice.currency !== "gbp" || !["draft", "open", "paid", "void", "uncollectible"].includes(invoice.status ?? "")) throw new Error("Unsupported invoice currency or status");
    const lines = [];
    for await (const line of client.invoices.listLineItems(id, { limit: 100 })) {
      lines.push({ stripeLineId: line.id, stripeInvoiceItemId: line.parent?.invoice_item_details?.invoice_item ?? null, description: line.description ?? "", amountMinor: line.amount });
    }
    return { stripeInvoiceId: invoice.id, stripeInvoiceNumber: invoice.number, stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? "", status: invoice.status as StripeInvoiceSnapshot["status"], currency: "gbp", totalMinor: invoice.total, amountDueMinor: invoice.amount_due, amountPaidMinor: invoice.amount_paid, amountRemainingMinor: invoice.amount_remaining, dueAt: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null, hostedInvoiceUrl: invoice.hosted_invoice_url ?? null, livemode: false, lines, metadata: invoice.metadata ?? {}, retrievedAt: new Date().toISOString() };
  }
  return {
    async ensureCustomer(input) {
      if (input.existingStripeCustomerId) {
        const customer = await client.customers.retrieve(input.existingStripeCustomerId);
        if (customer.deleted) throw new Error("Stripe customer deleted");
        refuseLive(customer);
        return { stripeCustomerId: customer.id };
      }
      // Recover a prior customer even after Stripe's idempotency-key retention window.
      for await (const customer of client.customers.list({ limit: 100 })) {
        refuseLive(customer);
        if (customer.metadata.organisationId === input.organisationId && customer.metadata.customerId === input.customerId) return { stripeCustomerId: customer.id };
      }
      const customer = await client.customers.create({ name: input.displayName, ...(input.email ? { email: input.email } : {}), metadata: { organisationId: input.organisationId, customerId: input.customerId } }, { idempotencyKey: idempotency(`cust:${input.organisationId}:${input.customerId}`) });
      refuseLive(customer);
      return { stripeCustomerId: customer.id };
    },
    async createInvoice(input) {
      validate(input);
      let invoice: Stripe.Invoice | undefined;
      for await (const candidate of client.invoices.list({ customer: input.stripeCustomerId, limit: 100 })) {
        refuseLive(candidate);
        const m = candidate.metadata;
        if (m?.organisationId === input.organisationId && m.customerId === input.customerId && (m.billingRunId === input.billingRunId || m.billingKey === input.billingKey)) {
          if (invoice) throw new Error("Multiple invoices match this billing key");
          invoice = candidate;
        }
      }
      if (invoice?.metadata?.lineFingerprint && invoice.metadata.lineFingerprint !== fingerprint(input)) throw new Error("Existing billing key has different lines");
      invoice ??= await client.invoices.create({ customer: input.stripeCustomerId, currency: input.currency, collection_method: "send_invoice", days_until_due: input.daysUntilDue, auto_advance: false, pending_invoice_items_behavior: "exclude", automatic_tax: { enabled: false }, default_tax_rates: [], payment_settings: { payment_method_types: ["card"] }, metadata: metadataFor(input) }, { idempotencyKey: idempotency(`${input.organisationId}:${input.billingKey}:invoice`) });
      refuseLive(invoice);
      if (invoice.status === "draft") {
        const attached = [];
        for await (const item of client.invoiceItems.list({ invoice: invoice.id, limit: 100 })) { refuseLive(item); attached.push(item); }
        for (const line of input.lines) {
          const existing = attached.filter(i => i.metadata?.milestoneId === line.milestoneId);
          if (existing.length > 1 || (existing[0] && (existing[0].amount !== line.amountMinor || existing[0].currency !== input.currency))) throw new Error("Existing invoice line mismatch");
          if (!existing.length) await client.invoiceItems.create({ customer: input.stripeCustomerId, invoice: invoice.id, currency: input.currency, amount: line.amountMinor, description: line.description, metadata: { milestoneId: line.milestoneId } }, { idempotencyKey: idempotency(`${invoice.id}:item:${line.milestoneId}`) });
        }
        const draft = await snapshot(invoice.id);
        if (draft.totalMinor !== input.lines.reduce((n, l) => n + l.amountMinor, 0) || draft.lines.length !== input.lines.length) throw new Error("Invoice total or lines mismatch");
        await client.invoices.finalizeInvoice(invoice.id, { auto_advance: false }, { idempotencyKey: idempotency(`${invoice.id}:finalize`) });
      }
      const result = await snapshot(invoice.id);
      if (result.totalMinor !== input.lines.reduce((n, l) => n + l.amountMinor, 0) || result.lines.length !== input.lines.length || result.status === "void" || result.status === "uncollectible") throw new Error("Existing invoice cannot satisfy billing run");
      return result;
    },
    refreshInvoice: snapshot,
    verifyWebhook,
  };
}

/** Explicit in-memory fake. It never supplies a real-looking hosted payment URL. */
export function createFakeStripeAdapter() {
  const invoices = new Map<string, StripeInvoiceSnapshot>();
  const adapter: StripeAdapter & { payInvoice(id: string): void } = {
    async ensureCustomer(i) { return { stripeCustomerId: i.existingStripeCustomerId ?? `cus_fake_${idempotency(`${i.organisationId}:${i.customerId}`).slice(-20)}` }; },
    async createInvoice(i) {
      validate(i);
      const existing = [...invoices.values()].find(v => v.metadata.organisationId === i.organisationId && v.metadata.billingKey === i.billingKey);
      if (existing) {
        if (existing.metadata.lineFingerprint !== fingerprint(i)) throw new Error("Existing billing key has different lines");
        return structuredClone(existing);
      }
      const id = `in_fake_${idempotency(`${i.organisationId}:${i.billingKey}`).slice(-24)}`;
      const total = i.lines.reduce((n, l) => n + l.amountMinor, 0);
      const value: StripeInvoiceSnapshot = { stripeInvoiceId: id, stripeInvoiceNumber: `FAKE-${invoices.size + 1}`, stripeCustomerId: i.stripeCustomerId, status: "open", currency: "gbp", totalMinor: total, amountDueMinor: total, amountPaidMinor: 0, amountRemainingMinor: total, dueAt: new Date(Date.now() + i.daysUntilDue * 86400000).toISOString(), hostedInvoiceUrl: null, livemode: false, lines: i.lines.map((l, n) => ({ stripeLineId: `${id}_line_${n}`, stripeInvoiceItemId: `${id}_item_${n}`, description: l.description, amountMinor: l.amountMinor })), metadata: metadataFor(i), retrievedAt: new Date().toISOString() };
      invoices.set(id, value);
      return structuredClone(value);
    },
    async refreshInvoice(id) { const v = invoices.get(id); if (!v) throw new Error("Unknown fake invoice"); return { ...structuredClone(v), retrievedAt: new Date().toISOString() }; },
    payInvoice(id) { const v = invoices.get(id); if (!v) throw new Error("Unknown fake invoice"); v.status = "paid"; v.amountPaidMinor = v.totalMinor; v.amountRemainingMinor = 0; },
    verifyWebhook,
  };
  return adapter;
}
const fake = createFakeStripeAdapter();
export function getStripeAdapter(): StripeAdapter {
  return env.adapterMode("stripe") === "real" ? createRealStripeAdapter() : fake;
}
