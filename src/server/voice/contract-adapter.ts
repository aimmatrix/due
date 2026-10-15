/**
 * A0 integration bridge: presents the teammate's ElevenLabs adapter (B1) through the locked
 * `VoiceAdapter` contract in src/contracts/modules.ts. Pure translation; no I/O of its own.
 */
import {
  WebhookSignatureError,
  type CollectionCallContext as ContractCallContext,
  type SafeError,
  type StartCallResult as ContractStartCallResult,
  type VerifiedCallEvent as ContractCallEvent,
  type VoiceAdapter,
} from "@/contracts";
import { createElevenLabsVoiceAdapter } from "./adapter";
import type { VoiceConfig } from "./config";
import { verifyAndNormaliseCallEvent } from "./webhook";
import type { StartCallErrorCode, VerifyErrorCode } from "./types";

/** The callback was authentic enough to parse but must not change any invoice. */
export class VoiceEventRejectedError extends Error {
  /** `ignorable` events (unsupported types, inbound calls) are acknowledged so the provider stops retrying. */
  constructor(
    readonly code: VerifyErrorCode,
    readonly ignorable: boolean,
  ) {
    super(`Voice callback rejected: ${code}`);
    this.name = "VoiceEventRejectedError";
  }
}

const SIGNATURE_ERRORS: ReadonlySet<VerifyErrorCode> = new Set(["missing_signature", "malformed_signature", "stale_signature", "invalid_signature"]);
const IGNORABLE_ERRORS: ReadonlySet<VerifyErrorCode> = new Set(["unsupported_event", "inbound_call", "missing_correlation", "unknown_action"]);

const START_ERRORS: Record<StartCallErrorCode, { message: string; retryable: boolean }> = {
  invalid_context: { message: "Call context failed validation; nothing was dialled.", retryable: false },
  destination_not_allowlisted: { message: "Destination is not on the voice demo allowlist; nothing was dialled.", retryable: false },
  provider_rejected: { message: "The voice provider rejected the call request.", retryable: false },
  provider_unavailable: { message: "The voice provider was unavailable; the outcome is unknown.", retryable: false },
  provider_timeout: { message: "The voice provider did not answer in time; the outcome is unknown.", retryable: false },
  network_error: { message: "The voice provider could not be reached; the outcome is unknown.", retryable: false },
  misconfigured: { message: "Voice provider credentials were refused.", retryable: false },
};

export interface ContractVoiceDeps {
  config: VoiceConfig;
  /** Looks up a persisted voice attempt so callbacks for unknown actions are rejected. */
  isKnownAction: (actionId: string, conversationId: string) => boolean | Promise<boolean>;
  businessName?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export function createContractVoiceAdapter(deps: ContractVoiceDeps): VoiceAdapter {
  const eleven = createElevenLabsVoiceAdapter({ config: deps.config, businessName: deps.businessName, fetch: deps.fetch, now: deps.now });
  return {
    async startCollectionCall(ctx: ContractCallContext): Promise<ContractStartCallResult> {
      // An invoice without a Stripe number cannot be spoken about accurately: refuse before dialling.
      const r = await eleven.startCollectionCall({ ...ctx, invoiceNumber: ctx.invoiceNumber ?? "" });
      const error: SafeError | null = r.errorCode ? { code: r.errorCode.toUpperCase(), ...START_ERRORS[r.errorCode] } : null;
      return { status: r.status, actionId: r.actionId, providerConversationId: r.conversationId, callSid: r.callSid, at: r.at, error };
    },

    async verifyAndNormaliseCallEvent(rawBody, headers): Promise<ContractCallEvent> {
      const result = await verifyAndNormaliseCallEvent(rawBody, headers, {
        webhookSecret: deps.config.webhookSecret,
        isKnownAction: deps.isKnownAction,
        now: deps.now,
      });
      if (!result.ok) {
        if (SIGNATURE_ERRORS.has(result.errorCode)) throw new WebhookSignatureError(result.errorCode.toUpperCase());
        throw new VoiceEventRejectedError(result.errorCode, IGNORABLE_ERRORS.has(result.errorCode));
      }
      const e = result.event;
      const turn = e.transcriptRef.turnIndex;
      return {
        dedupeKey: e.dedupKey,
        providerConversationId: e.conversationId,
        actionId: e.actionId,
        eventAt: e.eventAt,
        outcome: e.outcome,
        transcriptRef: `elevenlabs:${e.conversationId}${turn === null ? "" : `#${turn}`}`,
        summary: e.reviewReason ? `${e.summary} (${e.reviewReason})` : e.summary,
        promisedDate: e.promisedDate,
        supportingQuote: e.evidenceQuote,
        failure: e.failure ? { code: e.failure.code.toUpperCase(), message: e.failure.detail, retryable: false } : null,
      };
    },
  };
}
