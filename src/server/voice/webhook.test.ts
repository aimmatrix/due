import assert from "node:assert/strict";
import { test } from "node:test";
import { signElevenLabsPayload, verifyAndNormaliseCallEvent, type VerifyDeps } from "./webhook";

const secret = "wsec_test";
const now = new Date("2026-10-15T19:30:00Z");
const ts = Math.floor(now.getTime() / 1000);
const deps: VerifyDeps = { webhookSecret: secret, isKnownAction: (a) => a === "act_1", now: () => now };

function payload(overrides: Record<string, any> = {}, type = "post_call_transcription") {
  return JSON.stringify({
    type,
    event_timestamp: ts,
    data: {
      conversation_id: "conv_1",
      status: "done",
      transcript: [
        { role: "agent", message: "Hello, this is an AI assistant." },
        { role: "user", message: "Yes, this is accounts." },
        { role: "user", message: "We'll pay it on the 24th of October, promise." },
      ],
      metadata: { phone_call: { call_sid: "CA1" }, termination_reason: "end_call tool" },
      analysis: {
        transcript_summary: "Customer promised to pay on 24 October.",
        data_collection_results: {
          call_outcome: { value: "promise" },
          promised_date: { value: "2026-10-24" },
          customer_quote: { value: "We'll pay it on the 24th of October" },
        },
      },
      conversation_initiation_client_data: { dynamic_variables: { due_action_id: "act_1", due_correlation_id: "corr_1" } },
      ...overrides,
    },
  });
}

const signed = (body: string, t = ts) => ({ "ElevenLabs-Signature": signElevenLabsPayload(body, secret, t) });

test("valid promise is verified, correlated and source-linked", async () => {
  const body = payload();
  const r = await verifyAndNormaliseCallEvent(body, signed(body), deps);
  assert.ok(r.ok);
  assert.equal(r.event.outcome, "promise");
  assert.equal(r.event.promisedDate, "2026-10-24");
  assert.equal(r.event.recommendation, "defer_until_promise");
  assert.equal(r.event.transcriptRef.turnIndex, 2);
  assert.equal(r.event.callSid, "CA1");
  assert.equal(r.event.correlationId, "corr_1");
  assert.equal(r.event.dedupKey, "elevenlabs:post_call_transcription:conv_1");
});

test("duplicate deliveries share one dedup key", async () => {
  const body = payload();
  const a = await verifyAndNormaliseCallEvent(body, signed(body), deps);
  const b = await verifyAndNormaliseCallEvent(body, signed(body, ts - 60), deps);
  assert.ok(a.ok && b.ok);
  assert.equal(a.event.dedupKey, b.event.dedupKey);
});

test("tampered body fails signature", async () => {
  const body = payload();
  const r = await verifyAndNormaliseCallEvent(body.replace("2026-10-24", "2027-10-24"), signed(body), deps);
  assert.deepEqual(r, { ok: false, errorCode: "invalid_signature" });
});

test("missing and stale signatures fail", async () => {
  const body = payload();
  assert.deepEqual(await verifyAndNormaliseCallEvent(body, {}, deps), { ok: false, errorCode: "missing_signature" });
  assert.deepEqual(await verifyAndNormaliseCallEvent(body, signed(body, ts - 3600), deps), { ok: false, errorCode: "stale_signature" });
});

test("unknown action cannot update anything", async () => {
  const body = payload({ conversation_initiation_client_data: { dynamic_variables: { due_action_id: "act_other" } } });
  assert.deepEqual(await verifyAndNormaliseCallEvent(body, signed(body), deps), { ok: false, errorCode: "unknown_action" });
});

test("promise without a valid date goes to review", async () => {
  const body = payload({
    analysis: { data_collection_results: { call_outcome: { value: "promise" }, promised_date: { value: "next week" }, customer_quote: { value: "next week" } } },
  });
  const r = await verifyAndNormaliseCallEvent(body, signed(body), deps);
  assert.ok(r.ok);
  assert.equal(r.event.outcome, "needs_review");
  assert.equal(r.event.promisedDate, null);
});

test("promise whose quote is not in the transcript goes to review", async () => {
  const body = payload({
    analysis: { data_collection_results: { call_outcome: { value: "promise" }, promised_date: { value: "2026-10-24" }, customer_quote: { value: "I will pay tomorrow" } } },
  });
  const r = await verifyAndNormaliseCallEvent(body, signed(body), deps);
  assert.ok(r.ok);
  assert.equal(r.event.outcome, "needs_review");
});

test("silence is no_answer, never agreement", async () => {
  const body = payload({ transcript: [{ role: "agent", message: "Hello?" }] });
  const r = await verifyAndNormaliseCallEvent(body, signed(body), deps);
  assert.ok(r.ok);
  assert.equal(r.event.outcome, "no_answer");
  assert.equal(r.event.recommendation, "no_retry");
});

test("voicemail is no_answer", async () => {
  const body = payload({ metadata: { termination_reason: "voicemail_detected" } });
  const r = await verifyAndNormaliseCallEvent(body, signed(body), deps);
  assert.ok(r.ok);
  assert.equal(r.event.outcome, "no_answer");
});

test("dispute pauses and claimed payment refreshes Stripe", async () => {
  for (const [value, outcome, rec] of [["dispute", "dispute", "pause_for_dispute"], ["claimed_payment", "claimed_payment", "refresh_stripe"]] as const) {
    const body = payload({ analysis: { data_collection_results: { call_outcome: { value } } } });
    const r = await verifyAndNormaliseCallEvent(body, signed(body), deps);
    assert.ok(r.ok);
    assert.equal(r.event.outcome, outcome);
    assert.equal(r.event.recommendation, rec);
  }
});

test("incomplete conversation goes to review", async () => {
  const body = payload({ status: "processing" });
  const r = await verifyAndNormaliseCallEvent(body, signed(body), deps);
  assert.ok(r.ok);
  assert.equal(r.event.outcome, "needs_review");
});

test("initiation failure is explicit", async () => {
  const body = JSON.stringify({
    type: "call_initiation_failure",
    event_timestamp: ts,
    data: { conversation_id: "conv_1", failure_reason: "no-answer", conversation_initiation_client_data: { dynamic_variables: { due_action_id: "act_1" } } },
  });
  const r = await verifyAndNormaliseCallEvent(body, signed(body), deps);
  assert.ok(r.ok);
  assert.equal(r.event.outcome, "no_answer");
  assert.equal(r.event.dedupKey, "elevenlabs:call_initiation_failure:conv_1");
});
