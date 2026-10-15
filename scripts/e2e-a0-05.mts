/**
 * A0-05/A0-06 end-to-end check against Stripe TEST mode (never prints secrets).
 * Uses the £450 SEO-audit milestone so the £1,200 migration stays unbilled for the live demo:
 * once a billing key is invoiced in Stripe, every later run reuses that invoice.
 *
 *   completion form → automatic billing run → finalised Stripe invoice → replay/duplicate blocked
 *   → test payment in Stripe → signed webhook → Due balance reaches zero.
 *
 * Expects a Due server at E2E_BASE_URL running with ADAPTER_STRIPE=real and a `stripe listen`
 * forwarding to it. Run: node --env-file=.env.local --import tsx scripts/e2e-a0-05.mts
 */
import Stripe from "stripe";
import { randomUUID } from "node:crypto";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3010";
const key = process.env.STRIPE_SECRET_KEY ?? "";
const accessCode = process.env.FORM_ACCESS_CODE ?? "";
if (!key.startsWith("sk_test_")) throw new Error("A Stripe TEST key is required.");
if (!accessCode) throw new Error("FORM_ACCESS_CODE is required.");
const stripe = new Stripe(key);

type Json = { data?: any; error?: { code: string; message: string }; correlationId: string };
async function call(path: string, init?: RequestInit): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return { status: res.status, json: (await res.json()) as Json };
}
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
  return ok;
}
const submit = (submissionId: string, notes: string) =>
  call("/api/forms/completion", {
    method: "POST",
    body: JSON.stringify({ submissionId, accessCode, reporterName: "Priya (delivery lead)", customer: "Acme Ltd", milestoneReference: "M3-seo-audit", notes }),
  });

const NOTES = "Confirming the Acme post-migration SEO audit M3-seo-audit is complete. The redirect report was delivered and the client signed off.";

// 1. Real trigger: the service-completion form.
const sub = randomUUID();
const first = await submit(sub, NOTES);
const d = first.json.data;
check("completion form accepted and processed automatically", first.status === 202 && d?.status === "accepted", `state=${d?.billingRunState} code=${d?.decisionCode ?? first.json.error?.code}`);
if (!check("billing run reached 'invoiced' with no approval step", d?.billingRunState === "invoiced", d?.lastError ? `${d.lastError.code}: ${d.lastError.message}` : "")) process.exit(1);
const invoiceId: string = d.invoiceId;

// 2. The invoice exists in Stripe test mode, finalised, at the stored price.
const detail = (await call(`/api/invoices/${invoiceId}`)).json.data;
const stripeInvoiceId: string = detail.invoice.stripeInvoiceId;
const remote = await stripe.invoices.retrieve(stripeInvoiceId);
check("Stripe invoice is test mode, finalised (open), £450.00 GBP", remote.livemode === false && remote.status === "open" && remote.total === 45000 && remote.currency === "gbp", `${stripeInvoiceId} ${remote.number}`);
check("Stripe metadata ties the invoice to the billing run", remote.metadata?.billingRunId === d.billingRunId, remote.metadata?.billingKey ?? "");
check("hosted payment link present", !!remote.hosted_invoice_url);
check("'Why £450?' traces to the contract", detail.calculation.totalMinor === 45000 && detail.milestone.sourceLabel.includes("§4.3"), detail.milestone.sourceLabel);
check("timeline shows evidence → evaluation → finalisation", ["evidence.received", "billing.evaluated", "stripe.invoice_finalised"].every((a) => detail.timeline.some((t: any) => t.action === a)));

// 3. Duplicate protection.
const replay = await submit(sub, NOTES);
check("replayed submission returns the original result", replay.json.data?.status === "duplicate" && replay.json.data?.invoiceId === invoiceId);
const alternate = await submit(randomUUID(), NOTES);
check("alternate event for the same milestone creates no second invoice", alternate.json.data?.billingRunState === "ignored", alternate.json.data?.decisionCode);
const acmeInvoices = (await stripe.invoices.list({ customer: remote.customer as string, limit: 100 })).data.filter((i) => i.metadata?.billingKey === remote.metadata?.billingKey);
check("exactly one Stripe invoice carries this billing key", acmeInvoices.length === 1, `${acmeInvoices.length}`);

// 4. Test payment in Stripe (test card), then wait for the signed webhook to reconcile Due.
const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
await stripe.paymentMethods.attach(pm.id, { customer: remote.customer as string });
const paid = await stripe.invoices.pay(stripeInvoiceId, { payment_method: pm.id });
check("Stripe test payment succeeded", paid.status === "paid" && paid.amount_remaining === 0);

let reconciled: any = null;
for (let i = 0; i < 30 && !reconciled; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const now = (await call(`/api/invoices/${invoiceId}`)).json.data;
  if (now.invoice.stripeStatus === "paid") reconciled = now;
}
check("signed Stripe webhook reconciled Due to paid / £0.00", !!reconciled && reconciled.invoice.amountRemainingMinor === 0);
const entry = reconciled?.timeline.find((t: any) => t.action === "stripe.payment_reconciled");
check("reconciliation came from a verified webhook event (not a manual refresh)", !!entry?.externalIds?.stripeEventId, entry?.externalIds?.stripeEventId ?? "no webhook entry");
const dash = (await call("/api/dashboard")).json.data;
const row = dash.invoices.find((i: any) => i.id === invoiceId);
check("dashboard agrees with Stripe", row?.collectionStatus === "paid" && row?.amountRemainingMinor === 0);

console.log(`\nInvoice ${invoiceId} → Stripe ${stripeInvoiceId} (${remote.number}) https://dashboard.stripe.com/test/invoices/${stripeInvoiceId}`);
