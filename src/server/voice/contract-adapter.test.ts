import { describe, expect, it } from "vitest";
import { WebhookSignatureError, type CollectionCallContext } from "@/contracts";
import type { VoiceConfig } from "./config";
import { createContractVoiceAdapter, VoiceEventRejectedError } from "./contract-adapter";
import { signElevenLabsPayload } from "./webhook";

const NOW = new Date("2026-10-15T19:30:00Z");
const ts = Math.floor(NOW.getTime() / 1000);
const config: VoiceConfig = {
  apiKey: "xi_test", agentId: "agent_1", agentPhoneNumberId: "phnum_1", webhookSecret: "wsec_test",
  allowlist: ["+447700900123"], apiBaseUrl: "https://api.example.test", requestTimeoutMs: 50,
};

const ctx: CollectionCallContext = {
  actionId: "act_1", correlationId: "corr_1", organisationId: "org_demo", customerId: "cus_acme", invoiceId: "inv_1", customerName: "Acme Ltd",
  toNumber: "+447700900123", invoiceNumber: "DUE-0001", currency: "gbp", amountRemainingMinor: 120000, dueAt: "2026-10-29T18:43:00.000Z",
  policyVersion: "demo-1", checkedAt: NOW.toISOString(), approvedPlanOptions: [],
};

function fakeFetch(res: () => Response | Promise<Response>) {
  const calls: unknown[] = [];
  const impl = (async (...args: unknown[]) => { calls.push(args); return res(); }) as unknown as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const adapter = (f: typeof fetch, known: (a: string) => boolean = (a) => a === "act_1") =>
  createContractVoiceAdapter({ config, isKnownAction: known, fetch: f, now: () => NOW });

function payload(over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "post_call_transcription", event_timestamp: ts,
    data: {
      conversation_id: "conv_1", status: "done",
      transcript: [{ role: "agent", message: "Hello" }, { role: "user", message: "We'll pay it on the 24th of October, promise." }],
      metadata: { phone_call: { call_sid: "CA1" }, termination_reason: "end_call tool", ...meta },
      analysis: {
        transcript_summary: "Customer promised to pay on 24 October.",
        data_collection_results: { call_outcome: { value: "promise" }, promised_date: { value: "2026-10-24" }, customer_quote: { value: "We'll pay it on the 24th of October" } },
      },
      conversation_initiation_client_data: { dynamic_variables: { due_action_id: "act_1", due_correlation_id: "corr_1" } },
      ...over,
    },
  });
}
const signed = (body: string) => ({ "elevenlabs-signature": signElevenLabsPayload(body, config.webhookSecret, ts) });

describe("contract voice adapter — start", () => {
  it("maps an accepted call onto the locked contract result", async () => {
    const f = fakeFetch(() => json({ success: true, conversation_id: "conv_1", callSid: "CA1" }));
    expect(await adapter(f.impl).startCollectionCall(ctx)).toEqual({
      status: "accepted", actionId: "act_1", providerConversationId: "conv_1", callSid: "CA1", at: NOW.toISOString(), error: null,
    });
  });

  it("surfaces a provider rejection as a safe, non-retryable error", async () => {
    const r = await adapter(fakeFetch(() => json({ success: false }, 400)).impl).startCollectionCall(ctx);
    expect(r).toMatchObject({ status: "failed", error: { code: "PROVIDER_REJECTED", retryable: false } });
  });

  it("treats a 5xx as an unknown outcome that must be reconciled, not retried", async () => {
    const r = await adapter(fakeFetch(() => json({}, 503)).impl).startCollectionCall(ctx);
    expect(r).toMatchObject({ status: "unknown", error: { retryable: false } });
  });

  it("never dials without an invoice number or for a non-allowlisted number", async () => {
    const f = fakeFetch(() => json({ success: true }));
    expect((await adapter(f.impl).startCollectionCall({ ...ctx, invoiceNumber: null })).error?.code).toBe("INVALID_CONTEXT");
    expect((await adapter(f.impl).startCollectionCall({ ...ctx, toNumber: "+447700900999" })).error?.code).toBe("DESTINATION_NOT_ALLOWLISTED");
    expect(f.calls).toHaveLength(0);
  });
});

describe("contract voice adapter — callbacks", () => {
  const verify = (body: string, headers: Record<string, string>, known?: (a: string) => boolean) =>
    adapter(fakeFetch(() => json({})).impl, known).verifyAndNormaliseCallEvent(body, headers);

  it("returns a contract-shaped event with a stable dedupe key", async () => {
    const body = payload();
    const e = await verify(body, signed(body));
    expect(e).toMatchObject({
      dedupeKey: "elevenlabs:post_call_transcription:conv_1", providerConversationId: "conv_1", actionId: "act_1", outcome: "promise",
      promisedDate: "2026-10-24", supportingQuote: "We'll pay it on the 24th of October", transcriptRef: "elevenlabs:conv_1#1", failure: null,
    });
  });

  it("throws WebhookSignatureError for a missing, tampered or stale signature", async () => {
    const body = payload();
    await expect(verify(body, {})).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(verify(`${body} `, signed(body))).rejects.toBeInstanceOf(WebhookSignatureError);
    const stale = { "elevenlabs-signature": signElevenLabsPayload(body, config.webhookSecret, ts - 3600) };
    await expect(verify(body, stale)).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("rejects, as ignorable, callbacks for unknown actions and inbound calls", async () => {
    const body = payload();
    const unknown = await verify(body, signed(body), () => false).catch((e) => e);
    expect(unknown).toBeInstanceOf(VoiceEventRejectedError);
    expect(unknown).toMatchObject({ code: "unknown_action", ignorable: true });

    const inbound = payload({}, { phone_call: { call_sid: "CA9", direction: "inbound" } });
    expect(await verify(inbound, signed(inbound)).catch((e) => e)).toMatchObject({ code: "inbound_call", ignorable: true });
  });

  it("rejects, as not ignorable, a signed but malformed body", async () => {
    const body = "not json";
    expect(await verify(body, signed(body)).catch((e) => e)).toMatchObject({ code: "malformed_body", ignorable: false });
  });
});
