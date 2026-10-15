/**
 * B1 voice lane (teammate, ElevenLabs). SIGNATURE LOCKED by src/contracts/modules.ts (VoiceAdapter).
 * `getVoiceAdapter()` is the A0 integration entry point; the rest is the teammate's module surface.
 * ADAPTER_VOICE=real dials through ElevenLabs; anything else uses the labelled fake, which never dials.
 */
import { DEMO_ORGANISATION_ID, type VoiceAdapter } from "@/contracts";
import { env } from "@/server/config/env";
import { getRepositories } from "@/server/db";
import { createFakeVoiceAdapter } from "./adapter";
import { readVoiceConfig } from "./config";
import { createContractVoiceAdapter, VoiceEventRejectedError } from "./contract-adapter";

export { createElevenLabsVoiceAdapter, createFakeVoiceAdapter } from "./adapter";
export type { StartCollectionCall, VoiceAdapterDeps } from "./adapter";
export { readVoiceConfig, VoiceConfigError } from "./config";
export type { VoiceConfig } from "./config";
export { verifyAndNormaliseCallEvent, signElevenLabsPayload } from "./webhook";
export type { VerifyDeps } from "./webhook";
export { createContractVoiceAdapter, VoiceEventRejectedError } from "./contract-adapter";
export type { ContractVoiceDeps } from "./contract-adapter";
export * from "./types";

const globalForVoice = globalThis as unknown as { __dueVoice?: VoiceAdapter };

/** A known action is one whose voice attempt was persisted before dialling (and, once known, matches the conversation). */
function isKnownAction(actionId: string, conversationId: string): boolean {
  const attempt = getRepositories().voice.getByAction(DEMO_ORGANISATION_ID, actionId);
  return !!attempt && (!attempt.providerConversationId || attempt.providerConversationId === conversationId);
}

export function getVoiceAdapter(): VoiceAdapter {
  if (globalForVoice.__dueVoice) return globalForVoice.__dueVoice;
  if (env.adapterMode("voice") === "real") {
    // DEMO_PHONE_ALLOWLIST is the shared name used by the scheduler; VOICE_DEMO_ALLOWLIST is the module's own.
    const config = readVoiceConfig({
      ...process.env,
      VOICE_DEMO_ALLOWLIST: process.env.VOICE_DEMO_ALLOWLIST || process.env.DEMO_PHONE_ALLOWLIST,
    });
    globalForVoice.__dueVoice = createContractVoiceAdapter({ config, isKnownAction });
  } else {
    const fake = createFakeVoiceAdapter();
    globalForVoice.__dueVoice = {
      async startCollectionCall(ctx) {
        const r = await fake.startCollectionCall({ ...ctx, invoiceNumber: ctx.invoiceNumber ?? "" });
        return {
          status: r.status,
          actionId: r.actionId,
          providerConversationId: r.conversationId,
          callSid: r.callSid,
          at: r.at,
          error: r.errorCode ? { code: r.errorCode.toUpperCase(), message: "Fake voice adapter; nothing was dialled.", retryable: false } : null,
        };
      },
      async verifyAndNormaliseCallEvent() {
        // No signing secret exists in fake mode, so no callback can be authentic.
        throw new VoiceEventRejectedError("unsupported_event", false);
      },
    };
  }
  return globalForVoice.__dueVoice;
}
