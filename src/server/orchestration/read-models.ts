/**
 * API read models (A0-06): canonical records → the frozen UI contract in src/contracts/api.ts.
 * Collection status and call eligibility come from the same pure A3 functions the scheduler uses,
 * so the dashboard never disagrees with what the worker would do.
 */
import {
  DEMO_POLICY,
  type AppTime,
  type BillingDecision,
  type BillingRunSummary,
  type Calculation,
  type CollectionStatus,
  type DashboardData,
  type FollowUpInput,
  type Invoice,
  type InvoiceDetailData,
  type InvoiceSummary,
  type ServiceHealth,
} from "@/contracts";
import { callEligibility, decideFollowUp } from "@/server/collections";
import { env } from "@/server/config/env";
import type { Repositories } from "@/server/db";

const policyView = { version: DEMO_POLICY.version, rules: DEMO_POLICY.rules };

export const stripeDashboardUrl = (stripeInvoiceId: string) => `https://dashboard.stripe.com/test/invoices/${stripeInvoiceId}`;

/** The exact input the scheduler will pass to decideFollowUp for this invoice (app-clock times). */
export function buildFollowUpInput(repos: Repositories, invoice: Invoice, appTime: AppTime): FollowUpInput | null {
  const org = invoice.organisationId;
  const customer = repos.customers.get(org, invoice.customerId);
  if (!customer) return null;
  return {
    organisationId: org,
    invoice,
    customer,
    promises: repos.promises.listByInvoice(org, invoice.id),
    disputes: repos.disputes.listByInvoice(org, invoice.id),
    actions: repos.actions.listByInvoice(org, invoice.id),
    inboundResponses: repos.evidence.listInboundResponses(org, invoice.id),
    memory: null,
    approvedPlanOptions: [],
    policy: DEMO_POLICY,
    appTime,
  };
}

function collectionStatus(repos: Repositories, invoice: Invoice, input: FollowUpInput | null): CollectionStatus {
  if (invoice.stripeStatus === "paid" || invoice.amountRemainingMinor === 0) return "paid";
  if (!input) return "needs_review";
  const actions = input.actions;
  if (actions.some((a) => a.kind === "voice_call" && a.state === "reserved")) return "call_in_progress";
  const call = repos.voice.listByInvoice(invoice.organisationId, invoice.id).at(-1);
  if (call && call.dispatchState === "accepted" && call.outcome === null) return "call_in_progress";
  if (actions.some((a) => a.kind === "voice_call" && a.state === "queued")) return "call_queued";
  const d = decideFollowUp(input);
  switch (d.decisionCode) {
    case "NOT_YET_DUE":
    case "NOT_FINALISED":
      return "not_due";
    case "DISPUTE_OPEN":
      return "paused_dispute";
    case "PROMISE_ACTIVE":
      return "promise_active";
    case "RESPONSE_WINDOW_OPEN":
    case "AWAITING_DELIVERY_CONFIRMATION":
      return "awaiting_response";
    case "RECONCILE_UNKNOWN":
    case "RESPONSE_RECEIVED":
    case "CONTACT_CAP_REACHED":
      return "needs_review";
    case "CALL_NO_RESPONSE":
      return "call_queued";
    default:
      return actions.some((a) => a.kind === "reminder_email" && a.state === "sent") ? "reminder_sent" : "overdue";
  }
}

export function invoiceSummary(repos: Repositories, invoice: Invoice, appTime: AppTime): InvoiceSummary {
  const org = invoice.organisationId;
  const input = buildFollowUpInput(repos, invoice, appTime);
  const next = repos.actions
    .listByInvoice(org, invoice.id)
    .filter((a) => a.state === "queued" || a.state === "reserved")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return {
    id: invoice.id,
    customerId: invoice.customerId,
    customerName: repos.customers.get(org, invoice.customerId)?.displayName ?? "Unknown customer",
    milestoneTitle: repos.milestones.get(org, invoice.milestoneId)?.title ?? invoice.milestoneId,
    stripeInvoiceId: invoice.stripeInvoiceId,
    stripeInvoiceNumber: invoice.stripeInvoiceNumber,
    stripeStatus: invoice.stripeStatus,
    stripeDashboardUrl: stripeDashboardUrl(invoice.stripeInvoiceId),
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    currency: invoice.currency,
    totalMinor: invoice.totalMinor,
    amountPaidMinor: invoice.amountPaidMinor,
    amountRemainingMinor: invoice.amountRemainingMinor,
    dueAt: invoice.dueAt,
    collectionStatus: collectionStatus(repos, invoice, input),
    nextAction: next ? { kind: next.kind, dueAt: next.dueAt, state: next.state } : null,
    createdAt: invoice.createdAt,
    lastRefreshedAt: invoice.lastRefreshedAt,
  };
}

export function serviceHealth(now: string): ServiceHealth[] {
  const mode = (n: Parameters<typeof env.adapterMode>[0]) => env.adapterMode(n);
  const h = (service: ServiceHealth["service"], state: ServiceHealth["state"], detail: string): ServiceHealth => ({ service, state, detail, checkedAt: now });
  let stripe: ServiceHealth;
  if (mode("stripe") === "real") {
    try {
      env.stripeSecretKey();
      stripe = h("stripe", "ok", "Test-mode key configured");
    } catch {
      stripe = h("stripe", "not_configured", "ADAPTER_STRIPE=real but no valid test-mode key");
    }
  } else stripe = h("stripe", "degraded", "Fake Stripe adapter — no real Stripe objects");
  return [
    stripe,
    mode("llm") === "real" && env.anthropicApiKey() ? h("llm", "ok", `Structured extraction (${env.anthropicModel()})`) : h("llm", "unavailable", "No LLM configured — evidence goes to review"),
    h("cognee", "unavailable", "Not connected — structured-record fallback in use"),
    mode("email") === "real" ? h("email", "ok", "Resend, team-controlled destinations only") : h("email", "degraded", "Fake email adapter — deliveries are simulated (fake_msg_ IDs)"),
    mode("voice") === "real" && env.elevenLabsApiKey() ? h("elevenlabs", "ok", "Allowlisted demo numbers only") : h("elevenlabs", "not_configured", "Voice calls not configured"),
    h("database", "ok", "SQLite (single-instance demo)"),
  ];
}

export function buildDashboard(repos: Repositories, org: string, appTime: AppTime): DashboardData {
  const invoices = repos.invoices.list(org);
  const summaries = invoices.map((i) => invoiceSummary(repos, i, appTime));
  const reviews = repos.reviews.listOpen(org);
  const live = invoices.filter((i) => i.stripeStatus !== "void" && i.stripeStatus !== "draft");
  const recentRuns: BillingRunSummary[] = repos.billingRuns.listRecent(org, 20).map((r) => {
    const ev = repos.evidence.get(org, r.evidenceIds[0] ?? "");
    return {
      id: r.id,
      state: r.state,
      decisionCode: r.decisionCode,
      sourceType: ev?.sourceType ?? "email",
      sourceRef: ev?.sourceRef ?? "unknown",
      customerName: r.customerId ? (repos.customers.get(org, r.customerId)?.displayName ?? null) : null,
      receivedAt: ev?.receivedAt ?? r.createdAt,
      invoiceId: r.invoiceId,
      lastError: r.lastError,
    };
  });
  return {
    testMode: true,
    appTime,
    totals: {
      currency: "gbp",
      invoicedMinor: live.reduce((s, i) => s + i.totalMinor, 0),
      collectedMinor: live.reduce((s, i) => s + i.amountPaidMinor, 0),
      outstandingMinor: live.filter((i) => i.stripeStatus === "open").reduce((s, i) => s + i.amountRemainingMinor, 0),
      overdueMinor: live.filter((i) => i.stripeStatus === "open" && i.dueAt <= appTime.now).reduce((s, i) => s + i.amountRemainingMinor, 0),
      invoiceCount: invoices.length,
      openReviewCount: reviews.length,
    },
    invoices: summaries,
    recentRuns,
    reviews,
    services: serviceHealth(new Date().toISOString()),
    policy: policyView,
  };
}

export function buildInvoiceDetail(repos: Repositories, org: string, invoiceId: string, appTime: AppTime): InvoiceDetailData | null {
  const invoice = repos.invoices.get(org, invoiceId);
  if (!invoice) return null;
  const customer = repos.customers.get(org, invoice.customerId);
  const milestone = repos.milestones.get(org, invoice.milestoneId);
  const run = repos.billingRuns.get(org, invoice.billingRunId);
  const decision = repos.billingRuns.getDecision<Extract<BillingDecision, { kind: "bill" }>>(org, invoice.billingRunId);
  const calculation: Calculation = decision?.calculation ?? {
    lines: invoice.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitAmountMinor: l.unitAmountMinor, amountMinor: l.amountMinor, priceSource: l.priceSource })),
    subtotalMinor: invoice.totalMinor,
    taxMinor: 0,
    totalMinor: invoice.totalMinor,
    currency: invoice.currency,
    notes: [DEMO_POLICY.tax.note],
  };

  const evidenceIds = new Set<string>([...(run?.evidenceIds ?? []), ...invoice.lines.flatMap((l) => l.evidenceIds)]);
  const inbound = repos.evidence.listInboundForInvoice(org, invoice.id);
  const evidence = [...repos.evidence.listByIds(org, [...evidenceIds]), ...inbound.filter((e) => !evidenceIds.has(e.id))];

  // Pre-invoice entries (evidence received, billing evaluated) share the run's correlation ID.
  const seen = new Set<string>();
  const timeline = [...(run ? repos.audit.listByCorrelation(run.correlationId) : []), ...repos.audit.listByInvoice(org, invoice.id)].filter((a) =>
    seen.has(a.id) ? false : (seen.add(a.id), true),
  );
  timeline.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const input = buildFollowUpInput(repos, invoice, appTime);
  const summary = invoiceSummary(repos, invoice, appTime);
  return {
    invoice: { ...summary, lines: invoice.lines },
    customer: { id: invoice.customerId, displayName: customer?.displayName ?? "Unknown customer" },
    milestone: {
      id: invoice.milestoneId,
      reference: milestone?.reference ?? invoice.milestoneId,
      title: milestone?.title ?? invoice.milestoneId,
      amountMinor: milestone?.amountMinor ?? invoice.totalMinor,
      sourceLabel: milestone?.sourceRef.label ?? milestone?.reference ?? "",
    },
    calculation,
    evidence,
    policy: policyView,
    promises: repos.promises.listByInvoice(org, invoice.id),
    disputes: repos.disputes.listByInvoice(org, invoice.id),
    actions: repos.actions.listByInvoice(org, invoice.id).map((a) => ({
      id: a.id, kind: a.kind, sequence: a.sequence, state: a.state, deliveryState: a.deliveryState, dueAt: a.dueAt, deliveredAt: a.deliveredAt,
      decisionCode: a.decisionCode, reason: a.reason, cancelledReason: a.cancelledReason, externalReceiptId: a.externalReceiptId,
    })),
    voiceAttempts: repos.voice.listByInvoice(org, invoice.id).map((v) => ({
      id: v.id, actionId: v.actionId, dispatchState: v.dispatchState, outcome: v.outcome, summary: v.summary, promisedDate: v.promisedDate,
      transcriptRef: v.transcriptRef, providerConversationId: v.providerConversationId, initiatedAt: v.initiatedAt, completedAt: v.completedAt,
    })),
    callEligibility: input
      ? callEligibility(input)
      : { eligible: false, decisionCode: "CUSTOMER_MISSING", reason: "Customer record missing", windowClosesAt: null, checks: [] },
    // Memory (A3-01, P1) is not wired; say so rather than implying retrieval happened.
    memory: { provider: "not_used", availability: "not_used", facts: [] },
    timeline,
    appTime,
  };
}
