/**
 * Ingestion + billing-run orchestration (A0-04 ingestion, A0-05 groundwork). A0-owned.
 *
 * received → evaluating → review_required | ignored | creating_invoice → invoiced
 * with failed_retryable for transient errors. Domain modules are injected; this file owns persistence.
 * No human approval step exists on the valid path, and no client-supplied price is ever accepted.
 */
import {
  NotImplementedError,
  type AppTime,
  type BillingDecision,
  type BillingRun,
  type CompletionEventInput,
  type DemoPolicy,
  type EvaluateBilling,
  type IngestResult,
  type InvoiceLine,
  type SafeError,
  type StripeAdapter,
  type StructuredLlm,
} from "@/contracts";
import type { Repositories } from "@/server/db";
import { newCorrelationId } from "@/server/http/respond";

export interface BillingRuntime {
  repos: Repositories;
  evaluateBilling: EvaluateBilling;
  stripe: StripeAdapter;
  llm: StructuredLlm;
  policy: DemoPolicy;
  appTime: () => AppTime;
}

type BillDecision = Extract<BillingDecision, { kind: "bill" }>;

/** Converts any thrown error into a SafeError: no stack traces or provider payloads. */
export function toSafeError(e: unknown, fallbackCode = "BILLING_STEP_FAILED"): SafeError {
  if (e instanceof NotImplementedError) return { code: "MODULE_NOT_READY", message: e.message, retryable: true };
  const code = (e as { code?: unknown })?.code;
  return {
    code: typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : fallbackCode,
    message: "A billing step failed; it will be retried without creating duplicates.",
    retryable: true,
  };
}

export async function ingestCompletion(rt: BillingRuntime, input: CompletionEventInput): Promise<IngestResult> {
  const { repos } = rt;
  const correlationId = newCorrelationId();
  return repos.transaction(() => {
    const { evidence, created } = repos.evidence.insertOrGet({
      organisationId: input.organisationId,
      externalEventId: input.externalEventId,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      customerRef: input.customerRef,
      customerId: null,
      invoiceId: null,
      receivedAt: input.receivedAt,
      text: input.text,
    });
    const { run } = repos.billingRuns.createOrGet({
      organisationId: input.organisationId,
      correlationId,
      primaryEvidenceId: evidence.id,
      policyVersion: rt.policy.version,
    });
    if (created) {
      const t = rt.appTime();
      repos.audit.append({
        organisationId: input.organisationId,
        correlationId: run.correlationId,
        action: "evidence.received",
        decisionCode: "EVIDENCE_PERSISTED",
        result: "ok",
        customerId: null,
        invoiceId: null,
        evidenceIds: [evidence.id],
        policyVersion: rt.policy.version,
        calculation: null,
        explanation: `${labelSource(input.sourceType)} received (${input.sourceRef}) and stored before processing.`,
        externalIds: { externalEventId: input.externalEventId },
        appTime: t.now,
        simulatedTime: t.simulated,
      });
    }
    return { evidenceId: evidence.id, billingRunId: run.id, status: created ? "accepted" : "duplicate", correlationId: run.correlationId };
  });
}

function labelSource(t: CompletionEventInput["sourceType"]): string {
  return t === "email" ? "Completion email" : t === "completion_form" ? "Service-completion form" : "FIXTURE replay (not a real trigger)";
}

const TERMINAL: BillingRun["state"][] = ["invoiced", "ignored", "review_required", "failed"];

/** Idempotent: safe to call repeatedly (inline after ingest, from the worker, or after a crash). */
export async function processBillingRun(rt: BillingRuntime, org: string, runId: string): Promise<BillingRun> {
  const { repos } = rt;
  let run = repos.billingRuns.get(org, runId);
  if (!run) throw new Error(`Unknown billing run ${runId}`);
  if (TERMINAL.includes(run.state)) return run;

  const audit = (p: { action: string; decisionCode: string; result: Parameters<Repositories["audit"]["append"]>[0]["result"]; explanation: string; customerId?: string | null; invoiceId?: string | null; calculation?: BillDecision["calculation"] | null; externalIds?: Record<string, string> }) => {
    const t = rt.appTime();
    repos.audit.append({
      organisationId: org,
      correlationId: run!.correlationId,
      action: p.action,
      decisionCode: p.decisionCode,
      result: p.result,
      customerId: p.customerId ?? run!.customerId,
      invoiceId: p.invoiceId ?? null,
      evidenceIds: run!.evidenceIds,
      policyVersion: run!.policyVersion,
      calculation: p.calculation ?? null,
      explanation: p.explanation,
      externalIds: p.externalIds ?? {},
      appTime: t.now,
      simulatedTime: t.simulated,
    });
  };

  // ── 1. Evaluate (only if no billing key has been claimed yet) ──
  let decision = repos.billingRuns.getDecision<BillDecision>(org, runId);
  // Resume straight to Stripe only when a validated decision AND a claimed key already exist.
  const resumeAtStripe = !!decision && !!run.billingKey && (run.state === "creating_invoice" || run.state === "failed_retryable");
  if (!resumeAtStripe) {
    run = repos.billingRuns.update(org, runId, { state: "evaluating", attempts: run.attempts + 1 });
    const evidence = repos.evidence.listByIds(org, run.evidenceIds);
    const primary = evidence[0];
    if (!primary) throw new Error(`Billing run ${runId} has no evidence`);
    const invoiceKeys = repos.invoices.list(org).map((i) => repos.billingRuns.get(org, i.billingRunId)?.billingKey).filter((k): k is string => !!k);
    const claimedKeys = repos.billingRuns.listRetryable(org).filter((r) => r.id !== runId && r.billingKey).map((r) => r.billingKey!);

    let result: BillingDecision;
    try {
      result = await rt.evaluateBilling(
        {
          organisationId: org,
          evidence: primary,
          customers: repos.customers.list(org),
          contracts: repos.contracts.list(org),
          milestones: repos.milestones.list(org),
          existingBillingKeys: [...new Set([...invoiceKeys, ...claimedKeys])],
          policy: rt.policy,
          appTime: rt.appTime(),
        },
        { llm: rt.llm },
      );
    } catch (e) {
      const err = toSafeError(e, "BILLING_EVALUATION_FAILED");
      run = repos.billingRuns.update(org, runId, { state: "failed_retryable", lastError: err });
      audit({ action: "billing.evaluation_failed", decisionCode: err.code, result: "error", explanation: err.message });
      return run;
    }

    if (result.kind === "review") {
      repos.transaction(() => {
        run = repos.billingRuns.update(org, runId, { state: "review_required", decisionCode: result.decisionCode, customerId: result.customerId, milestoneId: result.milestoneId, lastError: null });
        repos.reviews.open({ organisationId: org, kind: "billing", decisionCode: result.decisionCode, reason: result.reason, customerId: result.customerId, invoiceId: null, billingRunId: runId, evidenceIds: result.evidenceIds });
        audit({ action: "billing.evaluated", decisionCode: result.decisionCode, result: "review", explanation: `Review required, no invoice created: ${result.reason}`, customerId: result.customerId });
      });
      return run!;
    }
    if (result.kind === "ignore") {
      run = repos.billingRuns.update(org, runId, { state: "ignored", decisionCode: result.decisionCode, billingKey: result.billingKey, lastError: null });
      audit({ action: "billing.evaluated", decisionCode: result.decisionCode, result: "blocked", explanation: `No invoice created: ${result.reason}` });
      return run;
    }

    // ── 2. Claim the milestone billing key atomically. A second event for the same milestone stops here. ──
    const existingInvoice = repos.invoices.getByBillingKey(org, result.billingKey);
    const claim = existingInvoice
      ? ({ ok: false, existingRunId: existingInvoice.billingRunId } as const)
      : repos.billingRuns.claimBillingKey(org, runId, { billingKey: result.billingKey, customerId: result.customerId, milestoneId: result.milestoneId, decisionCode: result.decisionCode });
    if (!claim.ok) {
      run = repos.billingRuns.update(org, runId, { state: "ignored", decisionCode: "DUPLICATE_MILESTONE", customerId: result.customerId, milestoneId: result.milestoneId, lastError: null });
      audit({ action: "billing.duplicate_blocked", decisionCode: "DUPLICATE_MILESTONE", result: "blocked", explanation: `Milestone already billed or being billed by run ${claim.existingRunId ?? "unknown"}; no second invoice created.`, customerId: result.customerId, invoiceId: existingInvoice?.id ?? null });
      return run;
    }
    repos.billingRuns.saveDecision(org, runId, result);
    decision = result;
    run = repos.billingRuns.get(org, runId)!;
    audit({ action: "billing.evaluated", decisionCode: result.decisionCode, result: "ok", explanation: result.explanation, customerId: result.customerId, calculation: result.calculation });
  }
  if (!decision) throw new Error(`Billing run ${runId} lost its validated decision`);

  // ── 3. Create + finalise the Stripe invoice (adapter is idempotent per billing run). ──
  try {
    const customer = repos.customers.get(org, decision.customerId);
    if (!customer) throw Object.assign(new Error("customer missing"), { code: "CUSTOMER_MISSING" });
    let stripeCustomerId = customer.stripeCustomerId;
    if (!stripeCustomerId) {
      ({ stripeCustomerId } = await rt.stripe.ensureCustomer({
        organisationId: org,
        customerId: customer.id,
        displayName: customer.displayName,
        email: customer.contactEmails[0] ?? null,
        existingStripeCustomerId: null,
      }));
      repos.customers.setStripeCustomerId(org, customer.id, stripeCustomerId);
    }
    const snapshot = await rt.stripe.createInvoice({
      organisationId: org,
      billingRunId: runId,
      billingKey: decision.billingKey,
      customerId: customer.id,
      stripeCustomerId,
      currency: rt.policy.currency,
      lines: decision.lines,
      daysUntilDue: rt.policy.invoiceDaysUntilDue,
      correlationId: run.correlationId,
    });
    if (snapshot.livemode !== false) throw Object.assign(new Error("live"), { code: "LIVE_MODE_REFUSED" });
    if (snapshot.totalMinor !== decision.calculation.totalMinor) {
      throw Object.assign(new Error("total mismatch"), { code: "STRIPE_TOTAL_MISMATCH" });
    }
    const lines: InvoiceLine[] = decision.lines.map((l, i) => ({
      ...l,
      stripeInvoiceItemId: decision!.lines.length === snapshot.lines.length ? (snapshot.lines[i]?.stripeInvoiceItemId ?? null) : null,
    }));
    const { invoice } = repos.transaction(() => {
      const res = repos.invoices.upsertFromSnapshot({ organisationId: org, customerId: customer.id, milestoneId: decision!.milestoneId, billingRunId: runId, billingKey: decision!.billingKey, lines, snapshot });
      repos.milestones.setState(org, decision!.milestoneId, "billed");
      run = repos.billingRuns.update(org, runId, { state: "invoiced", invoiceId: res.invoice.id, stripeInvoiceId: snapshot.stripeInvoiceId, lastError: null });
      audit({
        action: "stripe.invoice_finalised",
        decisionCode: "INVOICE_FINALISED",
        result: "ok",
        explanation: `Finalised Stripe test-mode invoice ${snapshot.stripeInvoiceNumber ?? snapshot.stripeInvoiceId} for ${decision!.calculation.totalMinor} GBP minor units, due in ${rt.policy.invoiceDaysUntilDue} days. No human approval step.`,
        customerId: customer.id,
        invoiceId: res.invoice.id,
        calculation: decision!.calculation,
        externalIds: { stripeInvoiceId: snapshot.stripeInvoiceId, stripeCustomerId },
      });
      return res;
    });
    void invoice;
    return run!;
  } catch (e) {
    const err = toSafeError(e, "STRIPE_INVOICE_FAILED");
    // Keep the billing key claimed (failed_retryable is part of the unique claim) so a retry reuses it.
    run = repos.billingRuns.update(org, runId, { state: "failed_retryable", lastError: err, attempts: (repos.billingRuns.get(org, runId)?.attempts ?? 0) + 1 });
    audit({ action: "stripe.invoice_failed", decisionCode: err.code, result: "error", explanation: `${err.message} (${err.code})` });
    return run;
  }
}
