/**
 * POST /api/webhooks/elevenlabs — signed post-call callbacks from ElevenLabs (A0-07 / B1-03).
 * Raw body goes to the voice adapter unchanged. Duplicates are acknowledged; events that cannot belong
 * to us (unknown action, inbound call, unsupported type) are acknowledged too, so the provider does not
 * keep retrying and disable the webhook. Failures return 500 so the provider retries.
 */
import { DEMO_ORGANISATION_ID, WebhookSignatureError } from "@/contracts";
import { env } from "@/server/config/env";
import { fail, ok } from "@/server/http/respond";
import { applyCallEvent } from "@/server/orchestration/calls";
import { getRuntime } from "@/server/orchestration/runtime";
import { toSafeError } from "@/server/orchestration/billing";
import { getVoiceAdapter, VoiceEventRejectedError } from "@/server/voice";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (env.adapterMode("voice") !== "real") {
    return fail({ code: "VOICE_NOT_CONFIGURED", message: "Voice callbacks are disabled (ADAPTER_VOICE is not real).", retryable: false }, 503);
  }
  const raw = await req.text();
  let event;
  try {
    event = await getVoiceAdapter().verifyAndNormaliseCallEvent(raw, Object.fromEntries(req.headers));
  } catch (e) {
    if (e instanceof WebhookSignatureError) return fail({ code: e.code, message: "Invalid voice callback signature", retryable: false }, 400);
    if (e instanceof VoiceEventRejectedError) {
      if (e.ignorable) return ok({ received: true, ignored: true, reason: e.code });
      return fail({ code: e.code.toUpperCase(), message: "Voice callback rejected", retryable: false }, 400);
    }
    return fail(toSafeError(e, "VOICE_WEBHOOK_UNAVAILABLE"), 503);
  }

  const rt = getRuntime();
  if (!rt.repos.webhooks.markProcessed("elevenlabs", event.dedupeKey)) {
    return ok({ received: true, duplicate: true, eventId: event.dedupeKey });
  }
  try {
    const result = await applyCallEvent(rt, DEMO_ORGANISATION_ID, event);
    return ok({ received: true, eventId: event.dedupeKey, status: result.status });
  } catch (e) {
    rt.repos.webhooks.unmark("elevenlabs", event.dedupeKey);
    return fail(toSafeError(e, "VOICE_EVENT_FAILED"), 500);
  }
}
