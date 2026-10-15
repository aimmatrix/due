/**
 * Shared primitives. FROZEN at the A0-02 contract checkpoint.
 * Only the A0 integration lane edits files under src/contracts/**.
 */

/** ISO-8601 UTC timestamp, e.g. "2026-10-15T18:30:00.000Z". All stored times are UTC. */
export type IsoUtc = string;

/** Calendar date "YYYY-MM-DD" interpreted in Europe/London (promised dates, due dates shown to humans). */
export type LondonDate = string;

export type OrganisationId = string;
export type CustomerId = string;
export type ContractId = string;
export type MilestoneId = string;
export type EvidenceId = string;
export type BillingRunId = string;
export type InvoiceId = string;
export type PromiseId = string;
export type DisputeId = string;
export type CollectionActionId = string;
export type VoiceAttemptId = string;
export type AuditEntryId = string;
export type ReviewItemId = string;
export type CorrelationId = string;

/** The single demo organisation. Still threaded through every query to prevent context mixing. */
export const DEMO_ORGANISATION_ID: OrganisationId = "org_demo";

/** Display/presentation timezone. Storage is always UTC. */
export const PRESENTATION_TIMEZONE = "Europe/London";

/**
 * Error safe to persist and show in the UI: no secrets, no raw provider payloads, no stack traces.
 * `code` is a stable SCREAMING_SNAKE identifier; `message` is a short human sentence.
 */
export interface SafeError {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Application clock reading. The demo can advance a *simulated* application clock to show overdue
 * follow-ups. This never changes Stripe's clock or Stripe timestamps; anything derived from it must
 * be labelled as simulated in the UI and audit log.
 */
export interface AppTime {
  /** Current application time (simulated when `simulated` is true). */
  now: IsoUtc;
  /** True when the demo clock has been moved away from real wall-clock time. */
  simulated: boolean;
  /** Milliseconds added to real time. 0 when not simulated. */
  offsetMs: number;
}

/** Source of a piece of evidence. `fixture_replay` must be labelled in the UI and never be the only real-trigger proof. */
export type EvidenceSourceType =
  | "email"
  | "completion_form"
  | "customer_message"
  | "call_outcome"
  | "fixture_replay";

/** A pointer back to the original source of a fact (email message ID, form submission ID, transcript ID, contract clause). */
export interface SourceRef {
  /** e.g. "evidence", "contract", "milestone", "transcript", "stripe_invoice". */
  kind: string;
  /** Internal or external identifier of the referenced object. */
  id: string;
  /** Optional exact quote supporting the fact. Data, never instructions. */
  quote?: string;
  /** Optional human label, e.g. "Acme MSA §3.2". */
  label?: string;
}
