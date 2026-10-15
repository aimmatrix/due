/**
 * MOCK API fixtures for UI development (A4) and contract tests. FROZEN at the A0-02 checkpoint.
 * Everything here is synthetic and must be visibly marked as mock data when rendered.
 * IDs that look like Stripe IDs are fake.
 */
import type { DashboardData, InvoiceDetailData, InvoiceSummary } from "../api";
import { DEMO_ORGANISATION_ID } from "../common";
import type { AuditEntry, Evidence } from "../domain";
import { DEMO_POLICY } from "../policy";
import { DEMO_COMPLETION_TEXT } from "../seed";

const policyView = { version: DEMO_POLICY.version, rules: DEMO_POLICY.rules };

const appTime = { now: "2026-10-31T10:00:00.000Z", simulated: true, offsetMs: 1_350_000_000 };

export const FIXTURE_EVIDENCE: Evidence[] = [
  {
    id: "ev_fixture_completion",
    organisationId: DEMO_ORGANISATION_ID,
    externalEventId: "fixture-email-001",
    sourceType: "email",
    sourceRef: "<CAF-fixture-001@mail.example>",
    customerRef: "Acme Ltd",
    customerId: "cus_acme",
    receivedAt: "2026-10-15T18:42:00.000Z",
    text: DEMO_COMPLETION_TEXT,
    invoiceId: null,
  },
  {
    id: "ev_fixture_call",
    organisationId: DEMO_ORGANISATION_ID,
    externalEventId: "conv_fixture_001",
    sourceType: "call_outcome",
    sourceRef: "elevenlabs:conv_fixture_001",
    customerRef: "Acme Ltd",
    customerId: "cus_acme",
    receivedAt: "2026-10-31T09:58:00.000Z",
    text: "Customer: We'll pay it on the 7th of November, the PO has just been approved.",
    invoiceId: "inv_fixture_acme",
  },
];

const acmeSummary: InvoiceSummary = {
  id: "inv_fixture_acme",
  customerId: "cus_acme",
  customerName: "Acme Ltd",
  milestoneTitle: "Website migration",
  stripeInvoiceId: "in_FIXTURE000000000000001",
  stripeInvoiceNumber: "DUE-0001",
  stripeStatus: "open",
  stripeDashboardUrl: "https://dashboard.stripe.com/test/invoices/in_FIXTURE000000000000001",
  hostedInvoiceUrl: "https://invoice.stripe.com/i/fixture",
  currency: "gbp",
  totalMinor: 120000,
  amountPaidMinor: 0,
  amountRemainingMinor: 120000,
  dueAt: "2026-10-29T18:43:00.000Z",
  collectionStatus: "promise_active",
  nextAction: { kind: "reminder_email", dueAt: "2026-11-08T09:00:00.000Z", state: "queued" },
  createdAt: "2026-10-15T18:43:05.000Z",
  lastRefreshedAt: "2026-10-31T10:00:00.000Z",
};

const paidSummary: InvoiceSummary = {
  ...acmeSummary,
  id: "inv_fixture_acme_seo",
  milestoneTitle: "SEO audit",
  stripeInvoiceId: "in_FIXTURE000000000000002",
  stripeInvoiceNumber: "DUE-0002",
  stripeStatus: "paid",
  stripeDashboardUrl: "https://dashboard.stripe.com/test/invoices/in_FIXTURE000000000000002",
  totalMinor: 45000,
  amountPaidMinor: 45000,
  amountRemainingMinor: 0,
  collectionStatus: "paid",
  nextAction: null,
};

const audit = (partial: Partial<AuditEntry> & Pick<AuditEntry, "id" | "action" | "decisionCode" | "result" | "explanation" | "occurredAt">): AuditEntry => ({
  organisationId: DEMO_ORGANISATION_ID,
  correlationId: "corr_fixture_001",
  customerId: "cus_acme",
  invoiceId: "inv_fixture_acme",
  evidenceIds: [],
  policyVersion: DEMO_POLICY.version,
  calculation: null,
  externalIds: {},
  appTime: partial.occurredAt,
  simulatedTime: false,
  ...partial,
});

const calculation = {
  lines: [
    {
      description: "Website migration (M2-website-migration)",
      quantity: 1,
      unitAmountMinor: 120000,
      amountMinor: 120000,
      priceSource: { kind: "milestone", id: "ms_acme_migration", label: "Acme SOW 2026-07 §4.2 — £1,200" },
    },
  ],
  subtotalMinor: 120000,
  taxMinor: 0,
  totalMinor: 120000,
  currency: "gbp" as const,
  notes: [DEMO_POLICY.tax.note],
};

export const FIXTURE_DASHBOARD: DashboardData = {
  testMode: true,
  appTime,
  totals: {
    currency: "gbp",
    invoicedMinor: 165000,
    collectedMinor: 45000,
    outstandingMinor: 120000,
    overdueMinor: 120000,
    invoiceCount: 2,
    openReviewCount: 1,
  },
  invoices: [acmeSummary, paidSummary],
  recentRuns: [
    {
      id: "run_fixture_001",
      state: "invoiced",
      decisionCode: "BILL_VALIDATED",
      sourceType: "email",
      sourceRef: "<CAF-fixture-001@mail.example>",
      customerName: "Acme Ltd",
      receivedAt: "2026-10-15T18:42:00.000Z",
      invoiceId: "inv_fixture_acme",
      lastError: null,
    },
    {
      id: "run_fixture_002",
      state: "review_required",
      decisionCode: "OVER_AUTONOMOUS_LIMIT",
      sourceType: "completion_form",
      sourceRef: "form:submission-0007",
      customerName: "Globex Partners",
      receivedAt: "2026-10-15T18:50:00.000Z",
      invoiceId: null,
      lastError: null,
    },
  ],
  reviews: [
    {
      id: "rev_fixture_001",
      organisationId: DEMO_ORGANISATION_ID,
      kind: "billing",
      status: "open",
      decisionCode: "OVER_AUTONOMOUS_LIMIT",
      reason: "Brand guidelines milestone is £2,500, above the £2,000 autonomous invoice limit.",
      customerId: "cus_globex",
      invoiceId: null,
      billingRunId: "run_fixture_002",
      evidenceIds: [],
      createdAt: "2026-10-15T18:50:01.000Z",
    },
  ],
  services: [
    { service: "stripe", state: "ok", detail: "Test mode key", checkedAt: appTime.now },
    { service: "llm", state: "ok", detail: "Structured extraction available", checkedAt: appTime.now },
    { service: "cognee", state: "unavailable", detail: "Using structured-record fallback", checkedAt: appTime.now },
    { service: "email", state: "ok", detail: "Team-controlled destination", checkedAt: appTime.now },
    { service: "elevenlabs", state: "ok", detail: "Allowlisted demo number", checkedAt: appTime.now },
    { service: "database", state: "ok", detail: "SQLite", checkedAt: appTime.now },
  ],
  policy: policyView,
};

export const FIXTURE_INVOICE_DETAIL: InvoiceDetailData = {
  invoice: {
    ...acmeSummary,
    lines: [
      {
        description: "Website migration (M2-website-migration)",
        quantity: 1,
        unitAmountMinor: 120000,
        amountMinor: 120000,
        milestoneId: "ms_acme_migration",
        priceSource: { kind: "milestone", id: "ms_acme_migration", label: "Acme SOW 2026-07 §4.2 — £1,200" },
        evidenceIds: ["ev_fixture_completion"],
        stripeInvoiceItemId: "ii_FIXTURE0001",
      },
    ],
  },
  customer: { id: "cus_acme", displayName: "Acme Ltd" },
  milestone: {
    id: "ms_acme_migration",
    reference: "M2-website-migration",
    title: "Website migration",
    amountMinor: 120000,
    sourceLabel: "Acme SOW 2026-07 §4.2 — £1,200",
  },
  calculation,
  evidence: FIXTURE_EVIDENCE,
  policy: policyView,
  promises: [
    {
      id: "prm_fixture_001",
      organisationId: DEMO_ORGANISATION_ID,
      invoiceId: "inv_fixture_acme",
      customerId: "cus_acme",
      promisedDate: "2026-11-07",
      evidenceId: "ev_fixture_call",
      quote: "We'll pay it on the 7th of November",
      status: "active",
      supersededById: null,
      createdAt: "2026-10-31T09:58:30.000Z",
    },
  ],
  disputes: [],
  actions: [
    {
      id: "act_fixture_rem1",
      kind: "reminder_email",
      sequence: 1,
      state: "sent",
      deliveryState: "delivered",
      dueAt: "2026-10-30T09:00:00.000Z",
      deliveredAt: "2026-10-30T09:00:04.000Z",
      decisionCode: "REMIND_OVERDUE",
      reason: "Invoice overdue with £1,200.00 remaining and no blockers.",
      cancelledReason: null,
      externalReceiptId: "msg_fixture_001",
    },
    {
      id: "act_fixture_call1",
      kind: "voice_call",
      sequence: 1,
      state: "sent",
      deliveryState: "not_applicable",
      dueAt: "2026-10-31T09:00:04.000Z",
      deliveredAt: null,
      decisionCode: "CALL_NO_RESPONSE",
      reason: "No response 24h after delivered reminder #1.",
      cancelledReason: null,
      externalReceiptId: "conv_fixture_001",
    },
    {
      id: "act_fixture_rem2",
      kind: "reminder_email",
      sequence: 2,
      state: "queued",
      deliveryState: "pending",
      dueAt: "2026-11-08T09:00:00.000Z",
      deliveredAt: null,
      decisionCode: "PROMISE_ACTIVE",
      reason: "Deferred until after the promised date 2026-11-07.",
      cancelledReason: null,
      externalReceiptId: null,
    },
  ],
  voiceAttempts: [
    {
      id: "va_fixture_001",
      actionId: "act_fixture_call1",
      dispatchState: "accepted",
      outcome: "promise",
      summary: "Customer confirmed receipt and promised payment on 7 November once the PO is approved.",
      promisedDate: "2026-11-07",
      transcriptRef: "elevenlabs:conv_fixture_001",
      providerConversationId: "conv_fixture_001",
      initiatedAt: "2026-10-31T09:55:00.000Z",
      completedAt: "2026-10-31T09:58:00.000Z",
    },
  ],
  callEligibility: {
    eligible: false,
    decisionCode: "PROMISE_ACTIVE",
    reason: "Active promise to pay on 2026-11-07.",
    windowClosesAt: "2026-10-31T09:00:04.000Z",
    checks: [
      { label: "Overdue with positive balance", passed: true, detail: "£1,200.00 remaining" },
      { label: "Reminder delivery confirmed", passed: true, detail: "Reminder #1 delivered 30 Oct 09:00" },
      { label: "24h response window elapsed", passed: true, detail: "Closed 31 Oct 09:00 (simulated time)" },
      { label: "No inbound response since reminder", passed: true, detail: "None received" },
      { label: "No active promise or dispute", passed: false, detail: "Promise to pay 7 Nov" },
      { label: "Voice attempts remaining", passed: false, detail: "1 of 1 used" },
    ],
  },
  memory: {
    provider: "fallback_structured",
    availability: "unavailable",
    facts: [{ statement: "Promised payment on 2026-11-07 during call", sourceLabels: ["Call conv_fixture_001"] }],
  },
  timeline: [
    audit({ id: "aud_1", action: "evidence.received", decisionCode: "EVIDENCE_PERSISTED", result: "ok", explanation: "Completion email received from Acme Ltd.", occurredAt: "2026-10-15T18:42:00.000Z", evidenceIds: ["ev_fixture_completion"], invoiceId: null }),
    audit({ id: "aud_2", action: "billing.evaluated", decisionCode: "BILL_VALIDATED", result: "ok", explanation: "Matched Acme Ltd milestone M2-website-migration at the stored price £1,200.00.", occurredAt: "2026-10-15T18:42:03.000Z", evidenceIds: ["ev_fixture_completion"], calculation, invoiceId: null }),
    audit({ id: "aud_3", action: "stripe.invoice_finalised", decisionCode: "INVOICE_FINALISED", result: "ok", explanation: "Finalised Stripe test-mode invoice DUE-0001, due in 14 days.", occurredAt: "2026-10-15T18:43:05.000Z", externalIds: { stripeInvoiceId: "in_FIXTURE000000000000001" } }),
    audit({ id: "aud_4", action: "collections.reminder_sent", decisionCode: "REMIND_OVERDUE", result: "ok", explanation: "Reminder #1 delivered to the team-controlled inbox.", occurredAt: "2026-10-15T19:10:00.000Z", appTime: "2026-10-30T09:00:04.000Z", simulatedTime: true }),
    audit({ id: "aud_5", action: "voice.call_started", decisionCode: "CALL_NO_RESPONSE", result: "ok", explanation: "No response 24h after delivered reminder; one call initiated (accepted by provider, not yet answered).", occurredAt: "2026-10-15T19:20:00.000Z", appTime: "2026-10-31T09:55:00.000Z", simulatedTime: true, externalIds: { conversationId: "conv_fixture_001" } }),
    audit({ id: "aud_6", action: "voice.outcome_recorded", decisionCode: "PROMISE_RECORDED", result: "deferred", explanation: "Customer promised payment on 2026-11-07; next reminder deferred to 8 Nov.", occurredAt: "2026-10-15T19:23:00.000Z", appTime: "2026-10-31T09:58:30.000Z", simulatedTime: true, evidenceIds: ["ev_fixture_call"] }),
  ],
  appTime,
};
