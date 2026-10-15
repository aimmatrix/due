/**
 * UI ⇄ API contract (PRD §8 "UI API contract"). FROZEN at the A0-02 contract checkpoint.
 * Routes live in src/app/api/** (A0). The dashboard (A4) consumes these shapes only.
 */
import type { AppTime, CorrelationId, IsoUtc, SafeError } from "./common";
import type {
  AuditEntry,
  BillingRunState,
  CallOutcome,
  Calculation,
  CollectionActionKind,
  CollectionActionState,
  DeliveryState,
  Dispute,
  Evidence,
  InvoiceLine,
  PaymentPromise,
  ReviewItem,
  StripeInvoiceStatus,
  VoiceDispatchState,
} from "./domain";
import type { Currency, MinorUnits } from "./money";
import type { DemoPolicy } from "./policy";

// ── Envelope ──
export interface ApiSuccess<T> {
  data: T;
  correlationId: CorrelationId;
}
export interface ApiFailure {
  error: SafeError;
  correlationId: CorrelationId;
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function isApiFailure<T>(r: ApiResponse<T>): r is ApiFailure {
  return (r as ApiFailure).error !== undefined;
}

// ── Shared view pieces ──
export type ServiceName = "stripe" | "llm" | "cognee" | "email" | "elevenlabs" | "database";

export interface ServiceHealth {
  service: ServiceName;
  state: "ok" | "degraded" | "unavailable" | "not_configured";
  detail: string;
  checkedAt: IsoUtc;
}

/** Collection status derived for display; separate from Stripe status and billing-run state. */
export type CollectionStatus =
  | "not_due"
  | "overdue"
  | "reminder_sent"
  | "awaiting_response"
  | "call_queued"
  | "call_in_progress"
  | "promise_active"
  | "paused_dispute"
  | "needs_review"
  | "paid";

export interface InvoiceSummary {
  id: string;
  customerId: string;
  customerName: string;
  milestoneTitle: string;
  stripeInvoiceId: string;
  stripeInvoiceNumber: string | null;
  stripeStatus: StripeInvoiceStatus;
  /** Link to the Stripe test-mode dashboard object. */
  stripeDashboardUrl: string;
  hostedInvoiceUrl: string | null;
  currency: Currency;
  totalMinor: MinorUnits;
  amountPaidMinor: MinorUnits;
  amountRemainingMinor: MinorUnits;
  dueAt: IsoUtc;
  collectionStatus: CollectionStatus;
  /** Next scheduled action, if any. */
  nextAction: { kind: CollectionActionKind; dueAt: IsoUtc; state: CollectionActionState } | null;
  createdAt: IsoUtc;
  lastRefreshedAt: IsoUtc;
}

export interface BillingRunSummary {
  id: string;
  state: BillingRunState;
  decisionCode: string | null;
  sourceType: Evidence["sourceType"];
  sourceRef: string;
  customerName: string | null;
  receivedAt: IsoUtc;
  invoiceId: string | null;
  lastError: SafeError | null;
}

// ── GET /api/dashboard ──
export interface DashboardData {
  /** Always true in this build. The UI shows a prominent TEST MODE badge. */
  testMode: true;
  appTime: AppTime;
  totals: {
    currency: Currency;
    invoicedMinor: MinorUnits;
    collectedMinor: MinorUnits;
    outstandingMinor: MinorUnits;
    overdueMinor: MinorUnits;
    invoiceCount: number;
    openReviewCount: number;
  };
  invoices: InvoiceSummary[];
  recentRuns: BillingRunSummary[];
  reviews: ReviewItem[];
  services: ServiceHealth[];
  policy: Pick<DemoPolicy, "version" | "rules">;
}

// ── GET /api/invoices/:id ──
export interface VoiceAttemptView {
  id: string;
  actionId: string;
  dispatchState: VoiceDispatchState;
  /** null until the post-call webhook arrives. `accepted` dispatch is NOT an answered call. */
  outcome: CallOutcome | null;
  summary: string | null;
  promisedDate: string | null;
  transcriptRef: string | null;
  providerConversationId: string | null;
  initiatedAt: IsoUtc | null;
  completedAt: IsoUtc | null;
}

export interface CollectionActionView {
  id: string;
  kind: CollectionActionKind;
  sequence: number;
  state: CollectionActionState;
  deliveryState: DeliveryState;
  dueAt: IsoUtc;
  deliveredAt: IsoUtc | null;
  decisionCode: string;
  reason: string;
  cancelledReason: string | null;
  externalReceiptId: string | null;
}

export interface CallEligibilityView {
  eligible: boolean;
  decisionCode: string;
  reason: string;
  /** Application time at which the no-response window closes, if a reminder was delivered. */
  windowClosesAt: IsoUtc | null;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
}

export interface InvoiceDetailData {
  invoice: InvoiceSummary & { lines: InvoiceLine[] };
  customer: { id: string; displayName: string };
  milestone: { id: string; reference: string; title: string; amountMinor: MinorUnits; sourceLabel: string };
  /** "Why £1,200?" */
  calculation: Calculation;
  evidence: Evidence[];
  policy: Pick<DemoPolicy, "version" | "rules">;
  promises: PaymentPromise[];
  disputes: Dispute[];
  actions: CollectionActionView[];
  voiceAttempts: VoiceAttemptView[];
  callEligibility: CallEligibilityView;
  memory: {
    provider: "cognee" | "fallback_structured" | "not_used";
    availability: "available" | "unavailable" | "degraded" | "not_used";
    facts: Array<{ statement: string; sourceLabels: string[] }>;
  };
  /** Ordered oldest → newest. */
  timeline: AuditEntry[];
  appTime: AppTime;
}

// ── POST bodies ──

/** POST /api/events/completion — authenticated with `Authorization: Bearer $INGEST_TOKEN`. No price fields accepted. */
export interface CompletionEventRequest {
  externalEventId: string;
  sourceType: "email" | "completion_form" | "fixture_replay";
  sourceRef: string;
  customerRef: string;
  text: string;
  /** Defaults to server receive time when omitted. */
  receivedAt?: IsoUtc;
}

export interface CompletionEventResponse {
  evidenceId: string;
  billingRunId: string;
  status: "accepted" | "duplicate";
  billingRunState: BillingRunState;
  invoiceId: string | null;
}

/** POST /api/events/customer-message — authenticated like completion events. */
export interface CustomerMessageRequest {
  externalEventId: string;
  sourceType: "email" | "customer_message";
  sourceRef: string;
  customerRef: string;
  invoiceId: string;
  text: string;
  receivedAt?: IsoUtc;
}

export interface CustomerMessageResponse {
  evidenceId: string;
  status: "accepted" | "duplicate";
  classification: "promise" | "dispute" | "claimed_payment" | "needs_review" | "other";
  cancelledActionIds: string[];
}

/** POST /api/demo/clock — demo mode only. Either set an absolute time or advance by hours; `reset` returns to real time. */
export type DemoClockRequest = { setTo: IsoUtc } | { advanceHours: number } | { reset: true };
export type DemoClockResponse = AppTime;

/** POST /api/demo/run-due-actions — demo mode only. Runs the same worker logic deterministically. */
export interface RunDueActionsResponse {
  appTime: AppTime;
  evaluatedInvoices: number;
  results: Array<{
    invoiceId: string;
    decisionCode: string;
    action: "none" | "defer" | "pause" | "remind" | "offer_plan" | "call";
    executed: boolean;
    actionId: string | null;
    detail: string;
  }>;
}

/** POST /api/invoices/:id/refresh */
export interface RefreshInvoiceResponse {
  invoice: InvoiceSummary;
  changed: boolean;
}
