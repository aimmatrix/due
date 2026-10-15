/**
 * Payment reconciliation (A0-06). Stripe is authoritative: every webhook triggers a FRESH retrieve,
 * and the repository refuses to regress a paid invoice. Full payment cancels pending collections.
 */
import { formatMoney, type AppTime, type DemoPolicy, type Invoice, type StripeAdapter, type StripeWebhookEvent } from "@/contracts";
import type { Repositories } from "@/server/db";
import { promiseStatusUpdates } from "@/server/collections";
import { newCorrelationId } from "@/server/http/respond";

export interface ReconcileRuntime {
  repos: Repositories;
  stripe: StripeAdapter;
  policy: DemoPolicy;
  appTime: () => AppTime;
}

export interface ReconcileResult {
  invoice: Invoice | null;
  changed: boolean;
  cancelledActionIds: string[];
}

/** Refresh one invoice from Stripe and apply side effects. Unknown invoices are ignored (not ours). */
export async function reconcileStripeInvoice(
  rt: ReconcileRuntime,
  org: string,
  stripeInvoiceId: string,
  trigger: { kind: "webhook"; eventId: string; type: string } | { kind: "manual_refresh" },
): Promise<ReconcileResult> {
  const { repos } = rt;
  const existing = repos.invoices.getByStripeId(org, stripeInvoiceId);
  if (!existing) return { invoice: null, changed: false, cancelledActionIds: [] };

  const snapshot = await rt.stripe.refreshInvoice(stripeInvoiceId);
  if (snapshot.livemode !== false) throw Object.assign(new Error("live"), { code: "LIVE_MODE_REFUSED" });

  return repos.transaction(() => {
    const applied = repos.invoices.applySnapshot(org, snapshot);
    if (!applied) return { invoice: null, changed: false, cancelledActionIds: [] };
    const inv = applied.invoice;
    const t = rt.appTime();
    const correlationId = newCorrelationId();
    let cancelled: string[] = [];

    const settled = inv.stripeStatus === "paid" || inv.amountRemainingMinor === 0;
    if (settled || inv.stripeStatus === "void" || inv.stripeStatus === "uncollectible") {
      cancelled = repos.actions.cancelQueued(org, inv.id, `Invoice ${inv.stripeStatus}; collections stopped`);
    }
    for (const u of promiseStatusUpdates(repos.promises.listByInvoice(org, inv.id), inv, t.now)) {
      repos.promises.setStatus(org, u.promiseId, u.status);
    }

    if (applied.changed || cancelled.length) {
      const how = trigger.kind === "webhook" ? `Stripe event ${trigger.type} (${trigger.eventId})` : "manual refresh";
      repos.audit.append({
        organisationId: org,
        correlationId,
        action: settled ? "stripe.payment_reconciled" : "stripe.invoice_refreshed",
        decisionCode: settled ? "PAID" : `STRIPE_${inv.stripeStatus.toUpperCase()}`,
        result: "ok",
        customerId: inv.customerId,
        invoiceId: inv.id,
        evidenceIds: [],
        policyVersion: rt.policy.version,
        calculation: null,
        explanation: settled
          ? `Stripe confirms the invoice is paid (${formatMoney(inv.amountPaidMinor)} received, ${formatMoney(inv.amountRemainingMinor)} remaining) after ${how}.${cancelled.length ? ` Cancelled ${cancelled.length} pending follow-up(s).` : ""}`
          : `Refreshed from Stripe after ${how}: status ${inv.stripeStatus}, ${formatMoney(inv.amountRemainingMinor)} remaining.`,
        externalIds: { stripeInvoiceId, ...(trigger.kind === "webhook" ? { stripeEventId: trigger.eventId } : {}) },
        appTime: t.now,
        simulatedTime: t.simulated,
      });
    }
    return { invoice: inv, changed: applied.changed, cancelledActionIds: cancelled };
  });
}

/** Webhook entry: dedupe by event ID; on failure release the mark so Stripe's retry is processed. */
export async function handleStripeEvent(rt: ReconcileRuntime, org: string, event: StripeWebhookEvent): Promise<"processed" | "duplicate" | "ignored"> {
  if (event.livemode !== false) return "ignored";
  if (!rt.repos.webhooks.markProcessed("stripe", event.eventId)) return "duplicate";
  try {
    if (!event.stripeInvoiceId) return "ignored";
    const res = await reconcileStripeInvoice(rt, org, event.stripeInvoiceId, { kind: "webhook", eventId: event.eventId, type: event.type });
    return res.invoice ? "processed" : "ignored";
  } catch (e) {
    rt.repos.webhooks.unmark("stripe", event.eventId);
    throw e;
  }
}
