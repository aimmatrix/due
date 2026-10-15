import assert from "node:assert/strict";
import { test } from "node:test";
import { createElevenLabsVoiceAdapter } from "./adapter";
import type { VoiceConfig } from "./config";
import type { CollectionCallContext } from "./types";

const config: VoiceConfig = {
  apiKey: "xi_test",
  agentId: "agent_1",
  agentPhoneNumberId: "phnum_1",
  webhookSecret: "whsec",
  allowlist: ["+447700900123"],
  apiBaseUrl: "https://example.test",
  requestTimeoutMs: 50,
};

const ctx: CollectionCallContext = {
  actionId: "act_1",
  correlationId: "corr_1",
  organisationId: "org_1",
  customerId: "cus_1",
  invoiceId: "inv_1",
  customerName: "Acme Ltd",
  toNumber: "+447700900123",
  invoiceNumber: "INV-0001",
  currency: "GBP",
  amountRemainingMinor: 120000,
  dueAt: "2026-10-01T00:00:00Z",
  policyVersion: "demo-1",
  checkedAt: "2026-10-15T19:00:00Z",
  approvedPlanOptions: [],
};

const json = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test("accepted initiation returns provider IDs and sends correlation metadata", async () => {
  let sent: any;
  const fetchStub = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ success: true, conversation_id: "conv_1", callSid: "CA1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await createElevenLabsVoiceAdapter({ config, fetch: fetchStub }).startCollectionCall(ctx);
  assert.equal(r.status, "accepted");
  assert.equal(r.conversationId, "conv_1");
  assert.equal(r.callSid, "CA1");
  const vars = sent.conversation_initiation_client_data.dynamic_variables;
  assert.equal(vars.due_action_id, "act_1");
  assert.equal(vars.amount_due, "£1,200.00");
  assert.equal(vars.plan_options, "none");
  assert.ok(!JSON.stringify(r).includes("xi_test"));
});

test("non-allowlisted destination is never dialled", async () => {
  let called = false;
  const fetchStub = (async () => ((called = true), new Response("{}"))) as unknown as typeof fetch;
  const r = await createElevenLabsVoiceAdapter({ config, fetch: fetchStub }).startCollectionCall({ ...ctx, toNumber: "+447700900999" });
  assert.equal(r.status, "failed");
  assert.equal(r.errorCode, "destination_not_allowlisted");
  assert.equal(called, false);
});

test("invalid context fails before calling the provider", async () => {
  const r = await createElevenLabsVoiceAdapter({ config, fetch: json(200, {}) }).startCollectionCall({ ...ctx, amountRemainingMinor: 0 });
  assert.equal(r.errorCode, "invalid_context");
});

test("provider rejection is failed, not accepted", async () => {
  const r = await createElevenLabsVoiceAdapter({ config, fetch: json(200, { success: false, message: "trial" }) }).startCollectionCall(ctx);
  assert.equal(r.status, "failed");
  assert.equal(r.errorCode, "provider_rejected");
});

test("timeout is unknown so the caller reconciles instead of redialling", async () => {
  const hang = ((_u: string, init: RequestInit) =>
    new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
  const r = await createElevenLabsVoiceAdapter({ config, fetch: hang }).startCollectionCall(ctx);
  assert.equal(r.status, "unknown");
  assert.equal(r.errorCode, "provider_timeout");
});

test("provider 5xx is unknown", async () => {
  const r = await createElevenLabsVoiceAdapter({ config, fetch: json(502, {}) }).startCollectionCall(ctx);
  assert.equal(r.status, "unknown");
});
