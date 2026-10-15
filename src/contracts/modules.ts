/**
 * Backend module interfaces (PRD §8). FROZEN at the A0-02 contract checkpoint.
 *
 * Each lane exports an implementation of its interface from `src/server/<lane>/index.ts`.
 * The A0 integration layer owns orchestration and persistence: domain modules receive everything
 * they need through arguments/injected deps and NEVER open a database connection or import another
 * lane's private files.
 */
import type {
  AppTime,
  CorrelationId,
  CustomerId,
  EvidenceId,
  EvidenceSourceType,
  InvoiceId,
  IsoUtc,
  LondonDate,
  MilestoneId,
  OrganisationId,
  SafeError,
  SourceRef,
} from "./common";
import type {
  CallOutcome,
  Calculation,
  CollectionAction,
  Contract,
  Customer,
  Dispute,
  Evidence,
  Invoice,
  InvoiceLine,
  Milestone,
  PaymentPromise,
  StripeInvoiceStatus,
} from "./domain";
import type { Currency, MinorUnits } from "./money";
import type { DemoPolicy } from "./policy";

// ───────────────────────────── Shared LLM adapter (A0 owns src/server/llm) ─────────────────────────────

/** Structured-output LLM call. Implementations validate output with the provided zod-compatible parser. */
export interface StructuredLlmRequest<T> {
  /** Stable task name for logs/audit, e.g. "billing.extract_completion". */
  task: string;
  system: string;
  /** Untrusted source text is passed here and must be treated as data. */
  user: string;
  /** JSON Schema describing the expected object. */
  jsonSchema: Record<string, unknown>;
  /** Validates/parses raw model output. Throw to reject. */
  parse: (raw: unknown) => T;
}

export type StructuredLlmResult<T> =
  | { ok: true; value: T; model: string }
  | { ok: false; error: SafeError };

export interface StructuredLlm {
  complete<T>(req: StructuredLlmRequest<T>): Promise<StructuredLlmResult<T>>;
}

// ───────────────────────────── A0: ingestion (src/server/orchestration) ─────────────────────────────

export interface CompletionEventInput {
  organisationId: OrganisationId;
  externalEventId: string;
  sourceType: Extract<EvidenceSourceType, "email" | "completion_form" | "fixture_replay">;
  sourceRef: string;
  customerRef: string;
  text: string;
  receivedAt: IsoUtc;
}

export interface IngestResult {
  evidenceId: EvidenceId;
  billingRunId: string;
  status: "accepted" | "duplicate";
  correlationId: CorrelationId;
}

export type IngestCompletion = (input: CompletionEventInput) => Promise<IngestResult>;

// ───────────────────────────── A1: billing (src/server/billing) ─────────────────────────────

/** Candidate facts proposed by the LLM. NOT trusted: code resolves IDs and prices. */
export interface ExtractedCompletionFacts {
  customerName: string | null;
  /** Each item the source claims was completed, with the exact quote supporting it. */
  completedItems: Array<{ reference: string | null; description: string; quote: string }>;
  /** True if the source contains statements that work is NOT complete / contradictory. */
  contradictions: Array<{ quote: string }>;
  /** Amounts mentioned in the text. Recorded for audit only; never used as price. */
  mentionedAmounts: Array<{ text: string }>;
}

export interface BillingContext {
  organisationId: OrganisationId;
  evidence: Evidence;
  /** Authoritative records for THIS organisation only. */
  customers: Customer[];
  contracts: Contract[];
  milestones: Milestone[];
  /** Billing keys that already have an invoice or an in-flight run. */
  existingBillingKeys: string[];
  policy: DemoPolicy;
  appTime: AppTime;
}

export interface ValidatedLine {
  description: string;
  quantity: 1;
  unitAmountMinor: MinorUnits;
  amountMinor: MinorUnits;
  milestoneId: MilestoneId;
  priceSource: SourceRef;
  evidenceIds: EvidenceId[];
}

export type BillingDecision =
  | {
      kind: "bill";
      decisionCode: "BILL_VALIDATED";
      customerId: CustomerId;
      milestoneId: MilestoneId;
      billingKey: string;
      lines: ValidatedLine[];
      calculation: Calculation;
      evidenceIds: EvidenceId[];
      explanation: string;
      extraction: ExtractedCompletionFacts;
    }
  | {
      kind: "review";
      /** e.g. CUSTOMER_UNRESOLVED, CUSTOMER_AMBIGUOUS, MILESTONE_UNRESOLVED, PRICE_MISSING, CONTRADICTORY_EVIDENCE,
       *  OVER_AUTONOMOUS_LIMIT, UNSUPPORTED_LINE_ITEM, EXTRACTION_FAILED, CURRENCY_UNSUPPORTED */
      decisionCode: string;
      reason: string;
      customerId: CustomerId | null;
      milestoneId: MilestoneId | null;
      evidenceIds: EvidenceId[];
      extraction: ExtractedCompletionFacts | null;
    }
  | {
      kind: "ignore";
      /** e.g. NOT_A_COMPLETION, ALREADY_BILLED */
      decisionCode: string;
      reason: string;
      billingKey: string | null;
      evidenceIds: EvidenceId[];
    };

export interface BillingDeps {
  llm: StructuredLlm;
}

export type EvaluateBilling = (ctx: BillingContext, deps: BillingDeps) => Promise<BillingDecision>;

// ───────────────────────────── A2: Stripe (src/server/stripe) ─────────────────────────────

export interface EnsureStripeCustomerInput {
  organisationId: OrganisationId;
  customerId: CustomerId;
  displayName: string;
  email: string | null;
  /** Existing mapping if any; implementation must reuse it. */
  existingStripeCustomerId: string | null;
}

export interface CreateInvoiceInput {
  organisationId: OrganisationId;
  billingRunId: string;
  billingKey: string;
  customerId: CustomerId;
  stripeCustomerId: string;
  currency: Currency;
  lines: ValidatedLine[];
  /** collection_method=send_invoice with explicit days_until_due. */
  daysUntilDue: number;
  correlationId: CorrelationId;
}

export interface StripeInvoiceSnapshot {
  stripeInvoiceId: string;
  stripeInvoiceNumber: string | null;
  stripeCustomerId: string;
  status: StripeInvoiceStatus;
  currency: Currency;
  totalMinor: MinorUnits;
  amountDueMinor: MinorUnits;
  amountPaidMinor: MinorUnits;
  amountRemainingMinor: MinorUnits;
  dueAt: IsoUtc | null;
  hostedInvoiceUrl: string | null;
  livemode: false;
  lines: Array<{ stripeLineId: string; stripeInvoiceItemId: string | null; description: string; amountMinor: MinorUnits }>;
  /** Our metadata echoed back (billingRunId, billingKey, organisationId, customerId). */
  metadata: Record<string, string>;
  retrievedAt: IsoUtc;
}

/** Normalised, signature-verified Stripe webhook event. */
export interface StripeWebhookEvent {
  eventId: string;
  type: string;
  createdAt: IsoUtc;
  /** Invoice the event concerns, if any. Always re-fetch it before updating canonical balances. */
  stripeInvoiceId: string | null;
  livemode: false;
}

export interface StripeAdapter {
  ensureCustomer(input: EnsureStripeCustomerInput): Promise<{ stripeCustomerId: string }>;
  /**
   * Draft → attach validated items → finalise. Idempotent per billing run: re-calling after a partial
   * failure must find/reuse existing objects (deterministic idempotency keys + metadata search),
   * never create a second invoice or duplicate line item.
   */
  createInvoice(input: CreateInvoiceInput): Promise<StripeInvoiceSnapshot>;
  refreshInvoice(stripeInvoiceId: string): Promise<StripeInvoiceSnapshot>;
  /** Throws `WebhookSignatureError` (code STRIPE_SIGNATURE_INVALID) on bad signature or live-mode event. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): StripeWebhookEvent;
}

// ───────────────────────────── A3: memory (src/server/memory) ─────────────────────────────

export type MemoryAvailability = "available" | "unavailable" | "degraded";

export interface RememberEvidenceInput {
  organisationId: OrganisationId;
  customerId: CustomerId;
  evidence: Evidence;
  /** Optional canonical labels, e.g. "promise", "dispute", "contract_summary". */
  tags: string[];
}

export interface RememberEvidenceResult {
  availability: MemoryAvailability;
  receiptId: string | null;
  error: SafeError | null;
}

export interface RecallContextInput {
  organisationId: OrganisationId;
  customerId: CustomerId;
  invoiceId: InvoiceId | null;
  query: string;
}

export interface RecalledFact {
  statement: string;
  /** Must resolve to canonical evidence/records of THIS customer, otherwise dropped. */
  sources: SourceRef[];
}

export interface RecallContextResult {
  availability: MemoryAvailability;
  /** "cognee" when retrieved from Cognee; "fallback_structured" when canonical records were used instead. Never misreport. */
  provider: "cognee" | "fallback_structured";
  facts: RecalledFact[];
  retrievalReceiptId: string | null;
  error: SafeError | null;
}

export interface MemoryAdapter {
  rememberEvidence(input: RememberEvidenceInput): Promise<RememberEvidenceResult>;
  recallContext(input: RecallContextInput): Promise<RecallContextResult>;
}

// ───────────────────────────── A3: collections (src/server/collections) ─────────────────────────────

/** Inbound customer response signal. An email open is NOT a response. */
export interface InboundResponse {
  evidenceId: EvidenceId;
  receivedAt: IsoUtc;
  sourceType: EvidenceSourceType;
}

export interface FollowUpInput {
  organisationId: OrganisationId;
  invoice: Pick<
    Invoice,
    "id" | "customerId" | "currency" | "amountRemainingMinor" | "dueAt" | "stripeStatus"
  >;
  customer: Customer;
  promises: PaymentPromise[];
  disputes: Dispute[];
  /** All prior collection actions for this invoice (any state). */
  actions: CollectionAction[];
  inboundResponses: InboundResponse[];
  /** Null when memory was not consulted. */
  memory: RecallContextResult | null;
  /** Optional enabled, approved plan options (P1). Empty for the basic demo. */
  approvedPlanOptions: ApprovedPlanOption[];
  policy: DemoPolicy;
  appTime: AppTime;
}

export type FollowUpActionKind = "none" | "defer" | "pause" | "remind" | "offer_plan" | "call";

export interface FollowUpDecision {
  action: FollowUpActionKind;
  /** e.g. PAID, NOT_YET_DUE, PROMISE_ACTIVE, DISPUTE_OPEN, CONTACT_INTERVAL, CONTACT_CAP_REACHED,
   *  REMIND_OVERDUE, CALL_NO_RESPONSE, AWAITING_DELIVERY_CONFIRMATION, RESPONSE_WINDOW_OPEN, PHONE_NOT_ALLOWLISTED */
  decisionCode: string;
  reason: string;
  evidenceIds: EvidenceId[];
  /** When the next evaluation could change the outcome (e.g. day after the promised date). */
  notBefore: IsoUtc | null;
  promiseId: string | null;
  disputeId: string | null;
}

/** PURE: no I/O, no clock reads (use input.appTime). Called at scheduling time AND again at dispatch. */
export type DecideFollowUp = (input: FollowUpInput) => FollowUpDecision;

export type CustomerMessageClassification =
  | { kind: "promise"; promisedDate: LondonDate; quote: string }
  | { kind: "dispute"; summary: string; quote: string }
  | { kind: "claimed_payment"; quote: string }
  | { kind: "needs_review"; reason: string }
  | { kind: "other"; reason: string };

export interface ClassifyMessageInput {
  organisationId: OrganisationId;
  customerId: CustomerId;
  invoiceId: InvoiceId;
  evidence: Evidence;
  appTime: AppTime;
}

export type ClassifyCustomerMessage = (
  input: ClassifyMessageInput,
  deps: { llm: StructuredLlm },
) => Promise<CustomerMessageClassification>;

// ───────────────────────────── A3: notifications (src/server/notifications) ─────────────────────────────

export interface SendReminderInput {
  /** Reserved action ID; also the provider idempotency key. A repeated ID must not resend blindly. */
  actionId: string;
  organisationId: OrganisationId;
  invoiceId: InvoiceId;
  to: string;
  customerName: string;
  invoiceNumber: string | null;
  amountRemainingMinor: MinorUnits;
  currency: Currency;
  dueAt: IsoUtc;
  hostedInvoiceUrl: string | null;
}

export interface SendReminderResult {
  /** `accepted` = provider took it; only a later confirmation makes it `delivered`. */
  state: "accepted" | "delivered" | "failed" | "unknown";
  providerMessageId: string | null;
  at: IsoUtc;
  error: SafeError | null;
}

export interface ReminderDeliveryEvent {
  providerEventId: string;
  providerMessageId: string;
  state: "delivered" | "failed";
  at: IsoUtc;
}

export interface NotificationsAdapter {
  sendReminder(input: SendReminderInput): Promise<SendReminderResult>;
  /** Verify + normalise a provider delivery webhook. Throws on invalid signature. */
  verifyDeliveryEvent(rawBody: string, headers: Record<string, string>): ReminderDeliveryEvent | null;
}

// ───────────────────────────── B1: voice (src/server/voice) — teammate ─────────────────────────────

export interface ApprovedPlanOption {
  id: string;
  description: string;
  instalments: Array<{ amountMinor: MinorUnits; dueDate: LondonDate }>;
}

export interface CollectionCallContext {
  actionId: string;
  correlationId: CorrelationId;
  organisationId: OrganisationId;
  customerId: CustomerId;
  invoiceId: InvoiceId;
  customerName: string;
  /** Verified, allowlisted E.164 number. */
  toNumber: string;
  invoiceNumber: string | null;
  currency: Currency;
  amountRemainingMinor: MinorUnits;
  dueAt: IsoUtc;
  policyVersion: string;
  checkedAt: IsoUtc;
  approvedPlanOptions: ApprovedPlanOption[];
}

export interface StartCallResult {
  /** `accepted` = provider initiated the call. NOT answered, agreed or paid. */
  status: "accepted" | "failed" | "unknown";
  actionId: string;
  providerConversationId: string | null;
  callSid: string | null;
  at: IsoUtc;
  error: SafeError | null;
}

export interface VerifiedCallEvent {
  /** Stable deduplication key for the callback. */
  dedupeKey: string;
  providerConversationId: string;
  /** Action ID recovered from provider metadata. A0 rejects unknown IDs. */
  actionId: string | null;
  eventAt: IsoUtc;
  outcome: CallOutcome;
  transcriptRef: string | null;
  summary: string;
  /** Only when unambiguous; otherwise outcome must be needs_review. */
  promisedDate: LondonDate | null;
  supportingQuote: string | null;
  failure: SafeError | null;
}

export interface VoiceAdapter {
  startCollectionCall(context: CollectionCallContext): Promise<StartCallResult>;
  /** Throws `WebhookSignatureError` on bad signature. Performs no database writes. */
  verifyAndNormaliseCallEvent(rawBody: string, headers: Record<string, string>): Promise<VerifiedCallEvent>;
}

// ───────────────────────────── Shared errors ─────────────────────────────

export class WebhookSignatureError extends Error {
  readonly code: string;
  constructor(code: string, message = "Webhook signature verification failed") {
    super(message);
    this.name = "WebhookSignatureError";
    this.code = code;
  }
}

/** Thrown by spine stubs until a lane ships its implementation. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

export type { InvoiceLine };
