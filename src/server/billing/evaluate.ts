/**
 * A1-02/03 — deterministic billing decision. Code resolves the customer and milestone from
 * authoritative records, prices from the stored milestone only, and enforces policy. Model output
 * can propose facts but can never authorise a charge or change an amount.
 */
import {
  billingKeyFor,
  formatMoney,
  sumMinor,
  type BillingDecision,
  type Calculation,
  type Customer,
  type EvaluateBilling,
  type ExtractedCompletionFacts,
  type Milestone,
  type ValidatedLine,
} from "@/contracts";
import { extractCompletionFacts, type ExtractionSource } from "./extract";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const containsWord = (hay: string, needle: string) =>
  new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(hay);

function matchCustomers(customers: Customer[], ref: string): Customer[] {
  const r = norm(ref);
  if (!r) return [];
  return customers.filter((c) => c.id === ref || norm(c.displayName) === r || c.matchKeys.some((k) => containsWord(r, norm(k))));
}

function sourceLabel(s: ExtractionSource): string {
  return s.kind === "llm" ? `facts extracted by ${s.model}` : "facts extracted by the rule-based fallback (no LLM configured)";
}

export const evaluateBilling: EvaluateBilling = async (ctx, deps) => {
  const { evidence, policy, organisationId: org } = ctx;
  const evidenceIds = [evidence.id];
  const customers = ctx.customers.filter((c) => c.organisationId === org);
  const review = (decisionCode: string, reason: string, extra: { customerId?: string | null; milestoneId?: string | null; extraction?: ExtractedCompletionFacts | null } = {}): BillingDecision => ({
    kind: "review",
    decisionCode,
    reason,
    customerId: extra.customerId ?? null,
    milestoneId: extra.milestoneId ?? null,
    evidenceIds,
    extraction: extra.extraction ?? null,
  });

  if (evidence.organisationId !== org) return review("ORGANISATION_MISMATCH", "Evidence belongs to another organisation.");

  // 1. Customer: the event's own reference is primary; the extracted name must not contradict it.
  const byRef = matchCustomers(customers, evidence.customerRef);
  if (byRef.length > 1) return review("CUSTOMER_AMBIGUOUS", `"${evidence.customerRef}" matches ${byRef.length} customers.`);

  const extraction = await extractCompletionFacts(
    { text: evidence.text, customerRef: evidence.customerRef, milestones: ctx.milestones.filter((m) => m.organisationId === org && (byRef.length === 0 || m.customerId === byRef[0]!.id)) },
    deps.llm,
  );
  if (!extraction.ok) return review(extraction.code, extraction.reason, { customerId: byRef[0]?.id ?? null });
  const facts = extraction.facts;

  let customer = byRef[0];
  if (facts.customerName) {
    const byName = matchCustomers(customers, facts.customerName);
    if (customer && byName.length > 0 && !byName.some((c) => c.id === customer!.id)) {
      return review("CUSTOMER_CONFLICT", `Event reference "${evidence.customerRef}" and message text "${facts.customerName}" name different customers.`, { extraction: facts });
    }
    if (!customer) {
      if (byName.length > 1) return review("CUSTOMER_AMBIGUOUS", `"${facts.customerName}" matches ${byName.length} customers.`, { extraction: facts });
      customer = byName[0];
    }
  }
  if (!customer) return review("CUSTOMER_UNRESOLVED", `No known customer matches "${evidence.customerRef}".`, { extraction: facts });

  // 2. Evidence quality: every claimed completion must be quoted verbatim; contradictions block billing.
  const text = norm(evidence.text);
  const unsupported = facts.completedItems.find((i) => !i.quote.trim() || !text.includes(norm(i.quote)));
  if (unsupported) return review("UNSUPPORTED_EVIDENCE", "A claimed completion is not supported by a verbatim quote from the source.", { customerId: customer.id, extraction: facts });
  if (facts.contradictions.length > 0) {
    return review("CONTRADICTORY_EVIDENCE", `Source contains contradictory statements, e.g. "${facts.contradictions[0]!.quote}".`, { customerId: customer.id, extraction: facts });
  }
  if (facts.completedItems.length === 0) {
    return { kind: "ignore", decisionCode: "NOT_A_COMPLETION", reason: "The message does not report completed work.", billingKey: null, evidenceIds };
  }

  // 3. Milestone: resolve only within this customer's milestones, by exact reference, then unique title.
  const own = ctx.milestones.filter((m) => m.organisationId === org && m.customerId === customer!.id);
  const resolved = new Map<string, Milestone>();
  for (const item of facts.completedItems) {
    let m = item.reference ? own.find((x) => norm(x.reference) === norm(item.reference!)) : undefined;
    if (!m && item.reference && ctx.milestones.some((x) => norm(x.reference) === norm(item.reference!) && x.customerId !== customer!.id)) {
      return review("MILESTONE_CUSTOMER_MISMATCH", `Milestone ${item.reference} belongs to a different customer.`, { customerId: customer.id, extraction: facts });
    }
    // Title matching only when no reference was given: an unknown explicit reference is never "corrected".
    if (!m && !item.reference) {
      const byTitle = own.filter((x) => norm(item.description).includes(norm(x.title)) || norm(item.quote).includes(norm(x.title)));
      if (byTitle.length === 1) m = byTitle[0];
    }
    if (!m) return review("MILESTONE_UNRESOLVED", `Completed work "${item.description}" does not match exactly one agreed milestone.`, { customerId: customer.id, extraction: facts });
    resolved.set(m.id, m);
  }
  if (resolved.size !== 1) {
    return review("UNSUPPORTED_LINE_ITEM", "The event reports several milestones; the demo bills one milestone per event.", { customerId: customer.id, extraction: facts });
  }
  const milestone = [...resolved.values()][0]!;

  // 4. Duplicate protection.
  const billingKey = billingKeyFor(org, customer.id, milestone.id);
  if (milestone.state === "billed" || ctx.existingBillingKeys.includes(billingKey)) {
    return { kind: "ignore", decisionCode: "ALREADY_BILLED", reason: `${milestone.reference} has already been billed.`, billingKey, evidenceIds };
  }

  // 5. Price authority + policy.
  if (milestone.currency !== policy.currency) return review("CURRENCY_UNSUPPORTED", `Milestone currency ${milestone.currency} is not ${policy.currency}.`, { customerId: customer.id, milestoneId: milestone.id, extraction: facts });
  if (!Number.isSafeInteger(milestone.amountMinor) || milestone.amountMinor <= 0) {
    return review("PRICE_MISSING", `No valid agreed price is stored for ${milestone.reference}.`, { customerId: customer.id, milestoneId: milestone.id, extraction: facts });
  }
  const line: ValidatedLine = {
    description: `${milestone.title} (${milestone.reference})`,
    quantity: 1,
    unitAmountMinor: milestone.amountMinor,
    amountMinor: milestone.amountMinor,
    milestoneId: milestone.id,
    priceSource: milestone.sourceRef,
    evidenceIds,
  };
  const subtotal = sumMinor([line.amountMinor]);
  const calculation: Calculation = {
    lines: [{ description: line.description, quantity: 1, unitAmountMinor: line.unitAmountMinor, amountMinor: line.amountMinor, priceSource: line.priceSource }],
    subtotalMinor: subtotal,
    taxMinor: 0,
    totalMinor: subtotal,
    currency: policy.currency,
    notes: [policy.tax.note],
  };
  if (calculation.totalMinor > policy.maxAutonomousInvoiceMinor) {
    return review(
      "OVER_AUTONOMOUS_LIMIT",
      `${milestone.title} is ${formatMoney(calculation.totalMinor)}, above the ${formatMoney(policy.maxAutonomousInvoiceMinor)} autonomous invoice limit.`,
      { customerId: customer.id, milestoneId: milestone.id, extraction: facts },
    );
  }

  const ignoredAmounts = facts.mentionedAmounts.length ? ` Amounts in the message (${facts.mentionedAmounts.map((a) => a.text).join(", ")}) were ignored; the stored price applies.` : "";
  return {
    kind: "bill",
    decisionCode: "BILL_VALIDATED",
    customerId: customer.id,
    milestoneId: milestone.id,
    billingKey,
    lines: [line],
    calculation,
    evidenceIds,
    explanation:
      `Matched ${customer.displayName} milestone ${milestone.reference} (${milestone.sourceRef.label ?? milestone.reference}) at the stored price ${formatMoney(calculation.totalMinor)}. ` +
      `Completion evidence: "${facts.completedItems[0]!.quote}" (${sourceLabel(extraction.source)}).${ignoredAmounts}`,
    extraction: facts,
  };
};
