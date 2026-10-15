import {
  DEMO_POLICY, type AuditResult, type CollectionAction, type FollowUpDecision,
  type NotificationsAdapter, type RunDueActionsResponse, type SafeError, type VoiceAdapter,
} from "@/contracts";
import { decideFollowUp, promiseStatusUpdates } from "@/server/collections";
import { env } from "@/server/config/env";
import { newCorrelationId } from "@/server/http/respond";
import { buildFollowUpInput } from "@/server/orchestration/read-models";
import { reconcileStripeInvoice, type ReconcileRuntime } from "@/server/orchestration/reconcile";

export interface SchedulerRuntime extends ReconcileRuntime {
  notifications: NotificationsAdapter;
  /** Absent unless configured in production, or explicitly injected by a test. */
  voice?: VoiceAdapter;
}
type Result = RunDueActionsResponse["results"][number];
const error = (code: string, message: string, retryable = false): SafeError => ({ code, message, retryable });

/** A timeout cannot prove the provider did not act. Its reservation must never be retried. */
async function bounded<T>(send: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([send(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Provider outcome unknown")), 20_000);
    })]);
  } finally { clearTimeout(timer); }
}

function audit(rt: SchedulerRuntime, a: CollectionAction, action: string, result: AuditResult, explanation: string, d?: FollowUpDecision) {
  const t = rt.appTime();
  rt.repos.audit.append({
    organisationId: a.organisationId, correlationId: a.correlationId, action,
    decisionCode: d?.decisionCode ?? a.decisionCode, result, customerId: a.customerId, invoiceId: a.invoiceId,
    evidenceIds: d?.evidenceIds ?? a.evidenceIds, policyVersion: DEMO_POLICY.version, calculation: null,
    explanation, externalIds: { actionId: a.id, ...(a.externalReceiptId ? { receiptId: a.externalReceiptId } : {}) },
    appTime: t.now, simulatedTime: t.simulated,
  });
}

/** The only entry to external contact: CAS reservation, fresh Stripe retrieve, then a fresh policy check. */
export async function dispatchAction(rt: SchedulerRuntime, org: string, action: CollectionAction): Promise<Result> {
  const { repos } = rt;
  const kind = action.kind === "voice_call" ? "call" : "remind";
  const row = (decisionCode: string, detail: string, executed = false): Result => ({
    invoiceId: action.invoiceId, actionId: action.id, action: kind, decisionCode, detail, executed,
  });
  if (!repos.actions.transition(org, action.id, ["queued"], "reserved")) {
    return row("ACTION_ALREADY_CLAIMED", "Action already claimed or completed.");
  }
  const cancel = (code: string, reason: string, d?: FollowUpDecision) => {
    repos.transaction(() => {
      const a = repos.actions.transition(org, action.id, ["reserved"], "cancelled", { cancelledReason: code, reason });
      if (a) audit(rt, a, "collections.action_cancelled", "cancelled", reason, d);
    });
    return row(code, reason);
  };
  let refreshed;
  try {
    refreshed = await reconcileStripeInvoice(rt, org, repos.invoices.get(org, action.invoiceId)!.stripeInvoiceId, { kind: "manual_refresh" });
  } catch {
    const err = error("STRIPE_REFRESH_UNAVAILABLE", "Fresh Stripe state unavailable; no contact sent.", true);
    repos.transaction(() => {
      const a = repos.actions.transition(org, action.id, ["reserved"], "queued", { lastError: err });
      if (a) audit(rt, a, "collections.refresh_unavailable", "error", err.message);
    });
    return row(err.code, err.message);
  }
  const t = rt.appTime();
  const invoice = refreshed.invoice;
  const input = invoice && buildFollowUpInput(repos, invoice, t);
  if (!input || !invoice) return cancel("CUSTOMER_MISSING", "Invoice or customer record missing; no contact sent.");
  input.actions = input.actions.filter((a) => a.id !== action.id);
  const d = decideFollowUp(input);
  if (d.action !== kind) return cancel(d.decisionCode, d.reason, d);
  const customer = input.customer;
  if (kind === "remind") {
    const to = customer.contactEmails[0];
    if (!to) return cancel("NO_TEAM_CONTROLLED_EMAIL", "No team-controlled reminder destination configured.");
    let sent;
    try {
      sent = await bounded(() => rt.notifications.sendReminder({
        actionId: action.id, organisationId: org, invoiceId: invoice.id, to, customerName: customer.displayName,
        invoiceNumber: invoice.stripeInvoiceNumber, amountRemainingMinor: invoice.amountRemainingMinor,
        currency: invoice.currency, dueAt: invoice.dueAt, hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      }));
    } catch {
      sent = { state: "unknown" as const, providerMessageId: null, at: t.now, error: error("EMAIL_OUTCOME_UNKNOWN", "Reminder outcome unknown; reconcile before further contact.") };
    }
    repos.transaction(() => {
      const a = repos.actions.transition(org, action.id, ["reserved"], sent.state === "accepted" || sent.state === "delivered" ? "sent" : sent.state, {
        externalReceiptId: sent.providerMessageId, lastError: sent.error,
        deliveryState: sent.state === "failed" ? "failed" : sent.state === "unknown" ? "unknown" : "pending",
      });
      if (!a) return;
      if (sent.state === "delivered") repos.actions.markDelivery(org, a.id, "delivered", t.now);
      audit(rt, a, `collections.reminder_${a.state}`, a.state === "sent" ? "ok" : "error",
        sent.state === "delivered" ? "Reminder delivery confirmed by the adapter." : sent.state === "accepted" ? "Reminder accepted by the provider; awaiting delivery confirmation." : `Reminder ${sent.state}; no delivery confirmed.`);
    });
    return row(d.decisionCode, `Reminder ${sent.state}.`, sent.state === "accepted" || sent.state === "delivered");
  }
  if (!rt.voice) return cancel("CALL_NOT_CONFIGURED", "Voice adapter is not configured.");
  const toNumber = customer.allowedPhoneNumbers[0];
  if (!toNumber || !env.demoPhoneAllowlist().includes(toNumber)) return cancel("PHONE_NOT_ALLOWLISTED", "Phone destination is not on the demo allowlist.");
  const attempt = repos.voice.insert({
    organisationId: org, actionId: action.id, invoiceId: invoice.id, customerId: customer.id,
    providerConversationId: null, callSid: null, dispatchState: "reserved", outcome: null,
    transcriptRef: null, summary: null, promisedDate: null, initiatedAt: null, completedAt: null,
  });
  let sent;
  try {
    sent = await bounded(() => rt.voice!.startCollectionCall({
      actionId: action.id, correlationId: action.correlationId, organisationId: org,
      customerId: customer.id, invoiceId: invoice.id, customerName: customer.displayName, toNumber,
      invoiceNumber: invoice.stripeInvoiceNumber, currency: invoice.currency, amountRemainingMinor: invoice.amountRemainingMinor,
      dueAt: invoice.dueAt, policyVersion: DEMO_POLICY.version, checkedAt: t.now, approvedPlanOptions: [],
    }));
  } catch {
    sent = { status: "unknown" as const, providerConversationId: null, callSid: null, at: t.now, error: error("CALL_OUTCOME_UNKNOWN", "Call initiation outcome unknown; reconcile before further contact.") };
  }
  repos.transaction(() => {
    repos.voice.update(org, attempt.id, {
      dispatchState: sent.status, providerConversationId: sent.providerConversationId, callSid: sent.callSid,
      initiatedAt: sent.status === "accepted" ? new Date(Date.parse(sent.at) + rt.appTime().offsetMs).toISOString() : null,
    });
    const a = repos.actions.transition(org, action.id, ["reserved"], sent.status === "accepted" ? "sent" : sent.status, {
      externalReceiptId: sent.providerConversationId, lastError: sent.error,
    });
    if (a) audit(rt, a, sent.status === "accepted" ? "voice.call_started" : `voice.call_${sent.status}`, sent.status === "accepted" ? "ok" : "error",
      sent.status === "accepted" ? "Collection call initiated by the provider." : `Call initiation ${sent.status}; no automatic redial.`);
  });
  return row(d.decisionCode, sent.status === "accepted" ? "Call initiated." : `Call initiation ${sent.status}.`, sent.status === "accepted");
}

export async function runDueActions(rt: SchedulerRuntime, org: string): Promise<RunDueActionsResponse> {
  const { repos } = rt;
  const response: RunDueActionsResponse = { appTime: rt.appTime(), evaluatedInvoices: 0, results: [] };
  for (const invoice of repos.invoices.list(org)) {
    // Reconcile promise lifecycle even for an invoice already paid locally.
    for (const u of promiseStatusUpdates(repos.promises.listByInvoice(org, invoice.id), invoice, rt.appTime().now)) {
      repos.promises.setStatus(org, u.promiseId, u.status);
    }
    const queued = repos.actions.listByInvoice(org, invoice.id).filter((a) => a.state === "queued" && a.dueAt <= rt.appTime().now);
    if (invoice.stripeStatus !== "open" && !queued.length) continue;
    response.evaluatedInvoices++;
    if (queued.length) {
      for (const a of queued) response.results.push(await dispatchAction(rt, org, a));
      continue;
    }
    const input = buildFollowUpInput(repos, invoice, rt.appTime());
    if (!input) {
      response.results.push({ invoiceId: invoice.id, decisionCode: "CUSTOMER_MISSING", action: "none", executed: false, actionId: null, detail: "Customer record missing." });
      continue;
    }
    const d = decideFollowUp(input);
    if ((d.action !== "remind" && d.action !== "call") || (d.action === "call" && !rt.voice)) {
      response.results.push({ invoiceId: invoice.id, action: d.action, executed: false, actionId: null,
        decisionCode: d.action === "call" ? "CALL_NOT_CONFIGURED" : d.decisionCode,
        detail: d.action === "call" ? "Voice adapter is not configured; no attempt consumed." : d.reason });
      continue;
    }
    const { action } = repos.actions.insertOrGet({
      organisationId: org, invoiceId: invoice.id, customerId: invoice.customerId, correlationId: newCorrelationId(),
      kind: d.action === "call" ? "voice_call" : "reminder_email",
      sequence: d.action === "call" ? 1 : input.actions.filter((a) => a.kind === "reminder_email").length + 1,
      dueAt: input.appTime.now, state: "queued", decisionCode: d.decisionCode, reason: d.reason, evidenceIds: d.evidenceIds,
      externalReceiptId: null, deliveryState: d.action === "call" ? "not_applicable" : "pending",
      deliveredAt: null, cancelledReason: null, lastError: null,
    });
    response.results.push(await dispatchAction(rt, org, action));
  }
  return response;
}
