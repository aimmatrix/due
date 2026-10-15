import type { CollectionCallContext } from "./types";

const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(n: string): boolean {
  return E164.test(n);
}

export function formatAmount(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

export function formatDueDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })
    .format(new Date(iso));
}

export function validateContext(ctx: CollectionCallContext): string | null {
  const required: (keyof CollectionCallContext)[] = [
    "actionId", "correlationId", "organisationId", "customerId", "invoiceId",
    "customerName", "toNumber", "invoiceNumber", "currency", "dueAt", "policyVersion", "checkedAt",
  ];
  for (const k of required) {
    if (typeof ctx[k] !== "string" || !(ctx[k] as string).trim()) return `missing ${k}`;
  }
  if (!Number.isInteger(ctx.amountRemainingMinor) || ctx.amountRemainingMinor <= 0) return "amount must be a positive integer";
  if (!isE164(ctx.toNumber)) return "toNumber must be E.164";
  if (Number.isNaN(Date.parse(ctx.dueAt)) || Number.isNaN(Date.parse(ctx.checkedAt))) return "invalid timestamp";
  if (!Array.isArray(ctx.approvedPlanOptions)) return "approvedPlanOptions must be an array";
  return null;
}

// Values exposed to the conversation. Internal IDs travel separately as
// correlation metadata and are never spoken.
export function conversationVariables(ctx: CollectionCallContext, businessName: string): Record<string, string> {
  return {
    business_name: businessName,
    customer_name: ctx.customerName,
    invoice_number: ctx.invoiceNumber,
    amount_due: formatAmount(ctx.amountRemainingMinor, ctx.currency),
    due_date: formatDueDate(ctx.dueAt),
    plan_options: ctx.approvedPlanOptions.length
      ? ctx.approvedPlanOptions.map((o) => o.description).join("; ")
      : "none",
    due_action_id: ctx.actionId,
    due_correlation_id: ctx.correlationId,
    due_policy_version: ctx.policyVersion,
  };
}
