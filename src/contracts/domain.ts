/**
 * Canonical domain records (PRD §7 "Minimum records"). FROZEN at the A0-02 contract checkpoint.
 * Stripe is authoritative for invoice/payment state; these records mirror it after a fresh retrieve.
 * Billing workflow state, Stripe invoice status and collection state are deliberately separate fields.
 */
import type {
  AuditEntryId,
  BillingRunId,
  CollectionActionId,
  ContractId,
  CorrelationId,
  CustomerId,
  DisputeId,
  EvidenceId,
  EvidenceSourceType,
  InvoiceId,
  IsoUtc,
  LondonDate,
  MilestoneId,
  OrganisationId,
  PromiseId,
  ReviewItemId,
  SafeError,
  SourceRef,
  VoiceAttemptId,
} from "./common";
import type { Currency, MinorUnits } from "./money";

export interface Customer {
  id: CustomerId;
  organisationId: OrganisationId;
  displayName: string;
  /** Names/aliases/email domains that identify this customer in incoming evidence. Used by deterministic matching. */
  matchKeys: string[];
  /** Null until A2 maps the customer into Stripe test mode. */
  stripeCustomerId: string | null;
  /** Team-controlled email destinations only. */
  contactEmails: string[];
  /** E.164 numbers on the demo allowlist only. */
  allowedPhoneNumbers: string[];
}

export interface Contract {
  id: ContractId;
  organisationId: OrganisationId;
  customerId: CustomerId;
  reference: string;
  title: string;
  sourceRef: SourceRef;
}

export type MilestoneState = "pending" | "completed" | "billed";

export interface Milestone {
  id: MilestoneId;
  organisationId: OrganisationId;
  customerId: CustomerId;
  contractId: ContractId;
  /** Short reference that evidence may mention, e.g. "M2-website-migration". */
  reference: string;
  title: string;
  description: string;
  /** Authoritative agreed price. The ONLY amount that may be billed. */
  amountMinor: MinorUnits;
  currency: Currency;
  sourceRef: SourceRef;
  state: MilestoneState;
}

export interface Evidence {
  id: EvidenceId;
  organisationId: OrganisationId;
  /** Provider/event ID used for idempotent ingestion. Unique per organisation + source type. */
  externalEventId: string;
  sourceType: EvidenceSourceType;
  /** e.g. email Message-ID, form submission URL, transcript ID. */
  sourceRef: string;
  /** Raw customer reference as received (unresolved). */
  customerRef: string;
  /** Resolved customer, or null if unresolved/ambiguous. */
  customerId: CustomerId | null;
  receivedAt: IsoUtc;
  /** Original text, persisted before processing. Treated as DATA, never instructions. */
  text: string;
  /** Optional invoice this evidence relates to (customer messages, call outcomes). */
  invoiceId: InvoiceId | null;
}

export type BillingRunState =
  | "received"
  | "evaluating"
  | "review_required"
  | "ignored"
  | "creating_invoice"
  | "invoiced"
  | "failed_retryable"
  | "failed";

export interface BillingRun {
  id: BillingRunId;
  organisationId: OrganisationId;
  correlationId: CorrelationId;
  /** Set once a customer + milestone is resolved. Unique across runs that reached creating_invoice. */
  billingKey: string | null;
  evidenceIds: EvidenceId[];
  policyVersion: string;
  state: BillingRunState;
  decisionCode: string | null;
  customerId: CustomerId | null;
  milestoneId: MilestoneId | null;
  invoiceId: InvoiceId | null;
  stripeInvoiceId: string | null;
  attempts: number;
  lastError: SafeError | null;
  createdAt: IsoUtc;
  updatedAt: IsoUtc;
}

/** Mirrors Stripe's invoice status values. */
export type StripeInvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitAmountMinor: MinorUnits;
  amountMinor: MinorUnits;
  milestoneId: MilestoneId;
  /** Where the price came from (contract/milestone). */
  priceSource: SourceRef;
  /** Evidence proving the work was completed. */
  evidenceIds: EvidenceId[];
  stripeInvoiceItemId: string | null;
}

export interface Invoice {
  id: InvoiceId;
  organisationId: OrganisationId;
  customerId: CustomerId;
  milestoneId: MilestoneId;
  billingRunId: BillingRunId;
  stripeInvoiceId: string;
  stripeInvoiceNumber: string | null;
  currency: Currency;
  /** Original invoice total. */
  totalMinor: MinorUnits;
  amountPaidMinor: MinorUnits;
  /** Stripe's amount_remaining after the latest fresh retrieve. */
  amountRemainingMinor: MinorUnits;
  stripeStatus: StripeInvoiceStatus;
  dueAt: IsoUtc;
  hostedInvoiceUrl: string | null;
  lines: InvoiceLine[];
  lastRefreshedAt: IsoUtc;
  createdAt: IsoUtc;
}

export type PromiseStatus = "active" | "superseded" | "fulfilled" | "broken";

export interface PaymentPromise {
  id: PromiseId;
  organisationId: OrganisationId;
  invoiceId: InvoiceId;
  customerId: CustomerId;
  promisedDate: LondonDate;
  evidenceId: EvidenceId;
  /** Exact supporting quote from the source. */
  quote: string;
  status: PromiseStatus;
  supersededById: PromiseId | null;
  createdAt: IsoUtc;
}

export type DisputeStatus = "open" | "resolved";

export interface Dispute {
  id: DisputeId;
  organisationId: OrganisationId;
  invoiceId: InvoiceId;
  customerId: CustomerId;
  evidenceId: EvidenceId;
  summary: string;
  quote: string;
  status: DisputeStatus;
  createdAt: IsoUtc;
}

export type CollectionActionKind = "reminder_email" | "voice_call" | "plan_offer";

export type CollectionActionState =
  | "queued"
  | "reserved"
  | "sent"
  | "cancelled"
  | "failed"
  /** External outcome unknown (e.g. provider timeout). Reconcile before any further attempt. */
  | "unknown";

/** Delivery confirmation for reminders. Only `delivered` starts the voice non-response timer. */
export type DeliveryState = "not_applicable" | "pending" | "delivered" | "failed" | "unknown";

export interface CollectionAction {
  id: CollectionActionId;
  organisationId: OrganisationId;
  invoiceId: InvoiceId;
  customerId: CustomerId;
  correlationId: CorrelationId;
  kind: CollectionActionKind;
  /** 1-based sequence per kind per invoice (reminder #1, #2...). */
  sequence: number;
  /** Application-clock time at which this action becomes executable. */
  dueAt: IsoUtc;
  state: CollectionActionState;
  decisionCode: string;
  reason: string;
  evidenceIds: EvidenceId[];
  /** Provider message ID / conversation ID once sent. */
  externalReceiptId: string | null;
  deliveryState: DeliveryState;
  deliveredAt: IsoUtc | null;
  cancelledReason: string | null;
  lastError: SafeError | null;
  createdAt: IsoUtc;
  updatedAt: IsoUtc;
}

export type CallOutcome = "promise" | "dispute" | "claimed_payment" | "no_answer" | "failed" | "needs_review";

export type VoiceDispatchState = "reserved" | "accepted" | "failed" | "unknown";

export interface VoiceAttempt {
  id: VoiceAttemptId;
  organisationId: OrganisationId;
  actionId: CollectionActionId;
  invoiceId: InvoiceId;
  customerId: CustomerId;
  providerConversationId: string | null;
  callSid: string | null;
  dispatchState: VoiceDispatchState;
  outcome: CallOutcome | null;
  transcriptRef: string | null;
  summary: string | null;
  promisedDate: LondonDate | null;
  initiatedAt: IsoUtc | null;
  completedAt: IsoUtc | null;
}

export type ReviewKind =
  | "billing"
  | "customer_message"
  | "call_outcome"
  | "reconciliation"
  | "provider_error";

export interface ReviewItem {
  id: ReviewItemId;
  organisationId: OrganisationId;
  kind: ReviewKind;
  status: "open" | "resolved";
  decisionCode: string;
  reason: string;
  customerId: CustomerId | null;
  invoiceId: InvoiceId | null;
  billingRunId: BillingRunId | null;
  evidenceIds: EvidenceId[];
  createdAt: IsoUtc;
}

/** Exact, code-validated calculation recorded with billing decisions. */
export interface Calculation {
  lines: Array<{
    description: string;
    quantity: number;
    unitAmountMinor: MinorUnits;
    amountMinor: MinorUnits;
    priceSource: SourceRef;
  }>;
  subtotalMinor: MinorUnits;
  taxMinor: MinorUnits;
  totalMinor: MinorUnits;
  currency: Currency;
  /** e.g. the demo tax assumption note. */
  notes: string[];
}

export type AuditResult = "ok" | "blocked" | "deferred" | "paused" | "cancelled" | "review" | "error";

export interface AuditEntry {
  id: AuditEntryId;
  organisationId: OrganisationId;
  correlationId: CorrelationId;
  /** Dotted action name, e.g. "evidence.received", "billing.evaluated", "stripe.invoice_finalised", "collections.reminder_sent". */
  action: string;
  decisionCode: string;
  result: AuditResult;
  customerId: CustomerId | null;
  invoiceId: InvoiceId | null;
  evidenceIds: EvidenceId[];
  policyVersion: string;
  calculation: Calculation | null;
  /** Concise explanation of recorded facts (not hidden model reasoning). */
  explanation: string;
  /** Resulting external IDs, e.g. { stripeInvoiceId: "in_..." }. */
  externalIds: Record<string, string>;
  /** Real wall-clock time the entry was written. */
  occurredAt: IsoUtc;
  /** Application-clock time the decision was made at. */
  appTime: IsoUtc;
  /** True when appTime came from the simulated demo clock. */
  simulatedTime: boolean;
}
