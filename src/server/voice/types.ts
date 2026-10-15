// Mirrors the B1 contract in TEAMMATE_TASKS.md. Replace with imports from
// src/contracts/** once the A0-02 checkpoint is published.

export interface ApprovedPlanOption {
  id: string;
  description: string;
}

export interface CollectionCallContext {
  actionId: string;
  correlationId: string;
  organisationId: string;
  customerId: string;
  invoiceId: string;
  customerName: string;
  toNumber: string;
  invoiceNumber: string;
  currency: string;
  amountRemainingMinor: number;
  dueAt: string;
  policyVersion: string;
  checkedAt: string;
  approvedPlanOptions: ApprovedPlanOption[];
}

export type StartCallStatus = "accepted" | "failed" | "unknown";

export type StartCallErrorCode =
  | "invalid_context"
  | "destination_not_allowlisted"
  | "provider_rejected"
  | "provider_unavailable"
  | "provider_timeout"
  | "network_error"
  | "misconfigured";

export interface StartCallResult {
  status: StartCallStatus;
  actionId: string;
  conversationId: string | null;
  callSid: string | null;
  at: string;
  errorCode: StartCallErrorCode | null;
}

export type CallOutcome =
  | "promise"
  | "dispute"
  | "claimed_payment"
  | "no_answer"
  | "failed"
  | "needs_review";

export type CallRecommendation =
  | "none"
  | "defer_until_promise"
  | "pause_for_dispute"
  | "refresh_stripe"
  | "review"
  | "no_retry";

export interface TranscriptReference {
  provider: "elevenlabs";
  conversationId: string;
  turnIndex: number | null;
}

export interface VerifiedCallEvent {
  dedupKey: string;
  provider: "elevenlabs";
  eventType: "post_call_transcription" | "call_initiation_failure";
  conversationId: string;
  callSid: string | null;
  eventAt: string;
  actionId: string;
  correlationId: string | null;
  outcome: CallOutcome;
  recommendation: CallRecommendation;
  summary: string;
  promisedDate: string | null;
  evidenceQuote: string | null;
  transcriptRef: TranscriptReference;
  reviewReason: string | null;
  failure: { code: string; detail: string } | null;
}

export type VerifyErrorCode =
  | "missing_signature"
  | "malformed_signature"
  | "stale_signature"
  | "invalid_signature"
  | "malformed_body"
  | "unsupported_event"
  | "inbound_call"
  | "missing_correlation"
  | "unknown_action";

export type VerifyResult =
  | { ok: true; event: VerifiedCallEvent }
  | { ok: false; errorCode: VerifyErrorCode };
