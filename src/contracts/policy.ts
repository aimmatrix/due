/**
 * Written demo policy (PRD §6). Versioned configuration, displayed in the dashboard.
 * Enforcement lives in code: prompts and retrieved documents can never expand these permissions.
 * FROZEN at the A0-02 contract checkpoint. Changing a value requires a new `version`.
 */
import type { Currency, MinorUnits } from "./money";

export interface DemoPolicy {
  /** Recorded on every decision and audit entry. */
  version: string;
  environment: "stripe_test_mode_only";
  currency: Currency;
  /** Invoices above this total are never created autonomously; they go to review. */
  maxAutonomousInvoiceMinor: MinorUnits;
  /** Payment terms used for `send_invoice` invoices. */
  invoiceDaysUntilDue: number;
  /** Price authority: only the stored contract/milestone price may be billed. */
  priceAuthority: "stored_milestone_price";
  /** Demo tax assumption. NOT production VAT handling. */
  tax: { mode: "none_demo_assumption"; note: string };
  /** Minimum gap between any two collection contacts, in application-clock hours. */
  minHoursBetweenContacts: number;
  /** Hours after a CONFIRMED-delivered reminder with no inbound response before a call is eligible. */
  voiceEscalationAfterHours: number;
  maxReminderEmailsPerInvoice: number;
  maxVoiceAttemptsPerInvoice: number;
  instalments: { enabled: boolean; count: 2; interestFree: true; requiresCustomerAcceptance: true };
  interestAndLateFees: "disabled";
  /** Human-readable rules for the dashboard policy panel. */
  rules: ReadonlyArray<{ rule: string; value: string }>;
}

export const DEMO_POLICY: DemoPolicy = {
  version: "demo-policy-2026-10-15.1",
  environment: "stripe_test_mode_only",
  currency: "gbp",
  maxAutonomousInvoiceMinor: 200000,
  invoiceDaysUntilDue: 14,
  priceAuthority: "stored_milestone_price",
  tax: { mode: "none_demo_assumption", note: "Demo assumption: no tax applied. Not production VAT handling." },
  minHoursBetweenContacts: 24,
  voiceEscalationAfterHours: 24,
  maxReminderEmailsPerInvoice: 2,
  maxVoiceAttemptsPerInvoice: 1,
  instalments: { enabled: false, count: 2, interestFree: true, requiresCustomerAcceptance: true },
  interestAndLateFees: "disabled",
  rules: [
    { rule: "Environment", value: "Stripe test mode only" },
    { rule: "Currency", value: "GBP only" },
    { rule: "Maximum autonomous invoice", value: "£2,000" },
    { rule: "Price authority", value: "Stored contract/milestone price" },
    { rule: "Required evidence", value: "Known customer, agreed milestone, completion evidence" },
    { rule: "Duplicate prevention", value: "Unique organisation/customer/milestone billing key" },
    { rule: "Ambiguity or conflicting evidence", value: "Review required; do not bill" },
    { rule: "Open dispute", value: "Pause collections" },
    { rule: "Active payment promise", value: "Defer until the promised date has passed" },
    { rule: "Contact interval", value: "At least 24 hours between collection contacts (application time)" },
    {
      rule: "Voice escalation",
      value: "24 application-clock hours after confirmed reminder delivery, with no subsequent inbound response",
    },
    { rule: "Response before call", value: "Cancel queued call; classify response or open review" },
    { rule: "Demo contact cap", value: "At most two reminder emails and one voice attempt per invoice" },
    { rule: "Instalments", value: "Two payments, zero interest, customer acceptance required" },
    { rule: "Interest and late fees", value: "Disabled" },
    { rule: "External destinations", value: "Team-controlled email and explicitly allowlisted phone number" },
  ],
};

/** Deterministic billing key: one bill per organisation/customer/milestone. */
export function billingKeyFor(organisationId: string, customerId: string, milestoneId: string): string {
  return `bill:${organisationId}:${customerId}:${milestoneId}`;
}
