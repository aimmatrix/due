import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORGANISATION_ID as ORG, DEMO_POLICY, WebhookSignatureError, billingKeyFor,
  type AppTime, type EvaluateBilling, type StripeAdapter, type StripeInvoiceSnapshot,
  type SendReminderResult, type StartCallResult, type VoiceAdapter } from "@/contracts";
import { createRepositories, openDatabase, seedDemoData, type Repositories } from "@/server/db";
import { createFakeLlm, unavailableLlm } from "@/server/llm";
import { createFakeNotifications, createResendAdapter } from "@/server/notifications";
import { ingestCompletion, processBillingRun } from "@/server/orchestration/billing";
import { recordCustomerMessage } from "@/server/orchestration/messages";
import { getAppTime, setAppClock } from "./clock";
import { dispatchAction, runDueActions, type SchedulerRuntime } from "./scheduler";
import { emailDeliveryResponse, handleEmailDelivery } from "./email-delivery";

/** Fake Stripe whose "server" state can be paid/partially paid, with failures on demand. */
function fakeStripe() {
  const invoices = new Map<string, StripeInvoiceSnapshot>();
  const ctl = { refreshFails: false };
  const adapter: StripeAdapter = {
    async ensureCustomer(i) {
      return { stripeCustomerId: `cus_fake_${i.customerId}` };
    },
    async createInvoice(i) {
      const existing = [...invoices.values()].find((x) => x.metadata.billingRunId === i.billingRunId);
      if (existing) return existing;
      const total = i.lines.reduce((s, l) => s + l.amountMinor, 0);
      const inv: StripeInvoiceSnapshot = {
        stripeInvoiceId: `in_fake_${invoices.size + 1}`, stripeInvoiceNumber: `DUE-000${invoices.size + 1}`, stripeCustomerId: i.stripeCustomerId,
        status: "open", currency: "gbp", totalMinor: total, amountDueMinor: total, amountPaidMinor: 0, amountRemainingMinor: total,
        dueAt: "2026-10-29T18:42:00.000Z", hostedInvoiceUrl: "https://invoice.stripe.com/i/fake", livemode: false,
        lines: i.lines.map((l, n) => ({ stripeLineId: `il_${n}`, stripeInvoiceItemId: `ii_${n}`, description: l.description, amountMinor: l.amountMinor })),
        metadata: { billingRunId: i.billingRunId }, retrievedAt: "2026-10-15T18:43:00.000Z",
      };
      invoices.set(inv.stripeInvoiceId, inv);
      return inv;
    },
    async refreshInvoice(id) {
      if (ctl.refreshFails) throw Object.assign(new Error("down"), { code: "STRIPE_UNAVAILABLE" });
      const inv = invoices.get(id);
      if (!inv) throw new Error("no such invoice");
      return { ...inv, retrievedAt: new Date().toISOString() };
    },
    verifyWebhook(raw, sig) {
      if (sig !== "valid") throw new WebhookSignatureError("STRIPE_SIGNATURE_INVALID");
      return JSON.parse(raw);
    },
  };
  const pay = (id: string, amountMinor: number) => {
    const inv = invoices.get(id)!;
    const paid = inv.amountPaidMinor + amountMinor;
    invoices.set(id, { ...inv, amountPaidMinor: paid, amountRemainingMinor: inv.totalMinor - paid, status: paid >= inv.totalMinor ? "paid" : "open" });
  };
  return { adapter, invoices, ctl, pay };
}

const evaluate: EvaluateBilling = async (ctx) => {
  const ms = ctx.milestones.find((m) => m.id === "ms_acme_migration")!;
  const line = { description: ms.title, quantity: 1 as const, unitAmountMinor: ms.amountMinor, amountMinor: ms.amountMinor, milestoneId: ms.id, priceSource: ms.sourceRef, evidenceIds: [ctx.evidence.id] };
  return {
    kind: "bill", decisionCode: "BILL_VALIDATED", customerId: ms.customerId, milestoneId: ms.id, billingKey: billingKeyFor(ORG, ms.customerId, ms.id),
    lines: [line], calculation: { lines: [line], subtotalMinor: 120000, taxMinor: 0, totalMinor: 120000, currency: "gbp", notes: [DEMO_POLICY.tax.note] },
    evidenceIds: [ctx.evidence.id], explanation: "Matched Acme M2 at £1,200.00", extraction: { customerName: null, completedItems: [], contradictions: [], mentionedAmounts: [] },
  };
};

const REAL = new Date("2026-10-15T09:00:00.000Z");
let db: ReturnType<typeof openDatabase>;
let repos: Repositories;
let stripe: ReturnType<typeof fakeStripe>;
let rt: SchedulerRuntime;
let voice: VoiceAdapter;
let calls: ReturnType<typeof vi.fn<VoiceAdapter["startCollectionCall"]>>;
let invoiceId: string;
let fake: ReturnType<typeof createFakeNotifications>;
const actions = () => repos.actions.listByInvoice(ORG, invoiceId);
const advance = (hours = 25) => setAppClock(repos, { advanceHours: hours });
const app = () => getAppTime(repos);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(REAL);
  vi.stubEnv("DEMO_PHONE_ALLOWLIST", "+447700900000");
  db = openDatabase(":memory:");
  seedDemoData(db, { emails: ["team@example.test"], phones: ["+447700900000"] });
  repos = createRepositories(db);
  stripe = fakeStripe();
  fake = createFakeNotifications(["team@example.test"]);
  calls = vi.fn(async (ctx): Promise<StartCallResult> => ({ status: "accepted", actionId: ctx.actionId,
    providerConversationId: "conv_fake_1", callSid: "sid_fake_1", at: new Date().toISOString(), error: null }));
  voice = { startCollectionCall: calls, async verifyAndNormaliseCallEvent() { throw new Error("unused"); } };
  rt = { repos, stripe: stripe.adapter, policy: DEMO_POLICY, appTime: app, notifications: fake, voice };
  const billing = { ...rt, evaluateBilling: evaluate, llm: unavailableLlm };
  const ing = await ingestCompletion(billing, { organisationId: ORG, externalEventId: "sub-1", sourceType: "completion_form", sourceRef: "form:sub-1",
    customerRef: "Acme Ltd", text: "M2 done", receivedAt: REAL.toISOString() });
  invoiceId = (await processBillingRun(billing, ORG, ing.billingRunId)).invoiceId!;
  setAppClock(repos, { setTo: "2026-10-30T09:00:00.000Z" });
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function queue(kind: "reminder_email" | "voice_call" = "reminder_email") {
  const invoice = repos.invoices.get(ORG, invoiceId)!;
  return repos.actions.insertOrGet({ organisationId: ORG, invoiceId, customerId: invoice.customerId, correlationId: "c",
    kind, sequence: 1, dueAt: app().now, state: "queued", decisionCode: kind === "voice_call" ? "CALL_NO_RESPONSE" : "REMIND_OVERDUE",
    reason: "Overdue", evidenceIds: [], externalReceiptId: null, deliveryState: kind === "voice_call" ? "not_applicable" : "pending",
    deliveredAt: null, cancelledReason: null, lastError: null }).action;
}
function reminderOutcome(state: SendReminderResult["state"]) {
  const send = vi.fn(async (): Promise<SendReminderResult> => ({ state, providerMessageId: state === "failed" ? null : "msg_test", at: new Date().toISOString(), error: null }));
  rt.notifications = { sendReminder: send, verifyDeliveryEvent: () => null };
  return send;
}
async function reply() {
  return recordCustomerMessage({ repos, policy: DEMO_POLICY, appTime: app,
    classifyCustomerMessage: async () => ({ kind: "other", reason: "Finance checking" }), llm: createFakeLlm(() => ({})) }, {
    organisationId: ORG, externalEventId: "reply", sourceType: "email", sourceRef: "message:reply", customerRef: "Acme Ltd",
    invoiceId, text: "Finance checking", receivedAt: new Date().toISOString(),
  });
}

describe("scheduler", () => {
  it("sends and audits one overdue reminder; repeated and concurrent runs do not duplicate it", async () => {
    const responses = await Promise.all([runDueActions(rt, ORG), runDueActions(rt, ORG)]);
    await runDueActions(rt, ORG);
    expect(responses.flatMap((r) => r.results).filter((r) => r.executed)).toHaveLength(1);
    expect(fake.sent.size).toBe(1);
    expect(actions()).toHaveLength(1);
    expect(actions()[0]).toMatchObject({ state: "sent", deliveryState: "delivered", deliveredAt: app().now });
    expect(repos.audit.listByInvoice(ORG, invoiceId).filter((a) => a.action === "collections.reminder_sent")).toMatchObject([
      { decisionCode: "REMIND_OVERDUE", policyVersion: DEMO_POLICY.version, appTime: app().now, simulatedTime: true },
    ]);
  });
  it("cancels a reserved reminder when fresh Stripe state reveals payment", async () => {
    const a = queue();
    stripe.pay(repos.invoices.get(ORG, invoiceId)!.stripeInvoiceId, 120000);
    const res = await dispatchAction(rt, ORG, a);
    expect(res).toMatchObject({ executed: false, decisionCode: "PAID" });
    expect(actions()[0]).toMatchObject({ state: "cancelled", cancelledReason: "PAID" });
    expect(fake.sent.size).toBe(0);
  });
  it("delivered reminder starts the 24h application-clock window; only one call is initiated", async () => {
    await runDueActions(rt, ORG);
    advance(23);
    await runDueActions(rt, ORG);
    expect(calls).not.toHaveBeenCalled();
    advance(2);
    await runDueActions(rt, ORG);
    await runDueActions(rt, ORG);
    advance(100);
    await runDueActions(rt, ORG);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0]![0]).toMatchObject({ amountRemainingMinor: 120000, toNumber: "+447700900000", approvedPlanOptions: [], policyVersion: DEMO_POLICY.version });
    expect(repos.voice.listByInvoice(ORG, invoiceId)).toMatchObject([{ dispatchState: "accepted", initiatedAt: "2026-10-31T10:00:00.000Z" }]);
    expect(repos.audit.listByInvoice(ORG, invoiceId).find((a) => a.action === "voice.call_started")?.explanation).toBe("Collection call initiated by the provider.");
  });
  it("a reply recorded after the reminder suppresses escalation even though real time is older", async () => {
    await runDueActions(rt, ORG);
    advance(1);
    await reply();
    advance();
    const res = await runDueActions(rt, ORG);
    expect(res.results[0]?.decisionCode).toBe("RESPONSE_RECEIVED");
    expect(calls).not.toHaveBeenCalled();
  });
  it("rechecks a reply arriving during the fresh Stripe request and cancels the reserved call", async () => {
    await runDueActions(rt, ORG);
    advance();
    const call = queue("voice_call");
    const refresh = rt.stripe.refreshInvoice;
    rt.stripe.refreshInvoice = async (id) => { await reply(); return refresh(id); };
    expect(await dispatchAction(rt, ORG, call)).toMatchObject({ executed: false, decisionCode: "RESPONSE_RECEIVED" });
    expect(repos.actions.get(ORG, call.id)?.state).toBe("cancelled");
    expect(calls).not.toHaveBeenCalled();
  });
  it.each(["accepted", "failed"] as const)("%s email delivery does not start the call timer", async (state) => {
    reminderOutcome(state);
    await runDueActions(rt, ORG);
    advance(100);
    await runDueActions(rt, ORG);
    expect(calls).not.toHaveBeenCalled();
    expect(actions().some((a) => a.kind === "voice_call")).toBe(false);
    expect(actions().every((a) => a.deliveredAt === null)).toBe(true);
  });
  it("unknown reminder outcomes are never automatically retried", async () => {
    const send = reminderOutcome("unknown");
    await runDueActions(rt, ORG);
    advance(100);
    const res = await runDueActions(rt, ORG);
    expect(send).toHaveBeenCalledTimes(1);
    expect(res.results[0]?.decisionCode).toBe("RECONCILE_UNKNOWN");
    expect(actions()[0]?.state).toBe("unknown");
  });
  it.each(["unknown", "throw", "timeout", "failed"] as const)("%s call outcome consumes the attempt without redial", async (state) => {
    await runDueActions(rt, ORG);
    advance();
    calls.mockImplementation(async (ctx) => {
      if (state === "throw") throw new Error("provider payload must not leak");
      if (state === "timeout") return new Promise(() => {});
      return { status: state, actionId: ctx.actionId, providerConversationId: null, callSid: null, at: new Date().toISOString(), error: null };
    });
    const running = runDueActions(rt, ORG);
    if (state === "timeout") await vi.advanceTimersByTimeAsync(20_001);
    await running;
    advance(100);
    await runDueActions(rt, ORG);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(repos.voice.listByInvoice(ORG, invoiceId)[0]?.dispatchState).toBe(state === "failed" ? "failed" : "unknown");
    expect(actions().find((a) => a.kind === "voice_call")?.state).toBe(state === "failed" ? "failed" : "unknown");
  });
  it.each(["throw", "timeout"] as const)("%s reminder outcome becomes unknown and never retries", async (state) => {
    const send = vi.fn(async (): Promise<SendReminderResult> => {
      if (state === "throw") throw new Error("provider payload");
      return new Promise(() => {});
    });
    rt.notifications = { sendReminder: send, verifyDeliveryEvent: () => null };
    const running = runDueActions(rt, ORG);
    if (state === "timeout") await vi.advanceTimersByTimeAsync(20_001);
    await running;
    advance(100);
    await runDueActions(rt, ORG);
    expect(send).toHaveBeenCalledTimes(1);
    expect(actions()[0]?.state).toBe("unknown");
  });
  it.each(["promise", "dispute", "payment"] as const)("%s arriving during refresh cancels the reserved call", async (state) => {
    await runDueActions(rt, ORG);
    advance();
    const a = queue("voice_call");
    const refresh = rt.stripe.refreshInvoice;
    rt.stripe.refreshInvoice = async (id) => {
      if (state === "payment") stripe.pay(id, 120000);
      else {
        const ev = repos.evidence.insertOrGet({ organisationId: ORG, externalEventId: state, sourceType: "email", sourceRef: state, customerRef: "Acme Ltd", customerId: "cus_acme", invoiceId,
          receivedAt: REAL.toISOString(), receivedAppAt: app().now, text: state }).evidence;
        if (state === "promise") repos.promises.record({ organisationId: ORG, invoiceId, customerId: "cus_acme", promisedDate: "2026-11-10", evidenceId: ev.id, quote: "Pay later" });
        else repos.disputes.record({ organisationId: ORG, invoiceId, customerId: "cus_acme", evidenceId: ev.id, quote: "Disputed", summary: "Work disputed" });
      }
      return refresh(id);
    };
    expect(await dispatchAction(rt, ORG, a)).toMatchObject({ executed: false, decisionCode: state === "promise" ? "PROMISE_ACTIVE" : state === "dispute" ? "DISPUTE_OPEN" : "PAID" });
    expect(repos.actions.get(ORG, a.id)?.state).toBe("cancelled");
    expect(calls).not.toHaveBeenCalled();
  });
  it("voice not configured creates no action and consumes no attempt", async () => {
    await runDueActions(rt, ORG);
    advance();
    delete rt.voice;
    expect((await runDueActions(rt, ORG)).results[0]).toMatchObject({ decisionCode: "CALL_NOT_CONFIGURED", executed: false, actionId: null });
    expect(actions()).toHaveLength(1);
    expect(repos.voice.listByInvoice(ORG, invoiceId)).toHaveLength(0);
    rt.voice = voice;
    await runDueActions(rt, ORG);
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it("Stripe refresh failure requeues the same action; recovery dispatches it once", async () => {
    stripe.ctl.refreshFails = true;
    expect((await runDueActions(rt, ORG)).results[0]?.decisionCode).toBe("STRIPE_REFRESH_UNAVAILABLE");
    expect(actions()[0]).toMatchObject({ state: "queued", lastError: { code: "STRIPE_REFRESH_UNAVAILABLE" } });
    expect(fake.sent.size).toBe(0);
    stripe.ctl.refreshFails = false;
    await runDueActions(rt, ORG);
    expect(actions()).toHaveLength(1);
    expect(fake.sent.size).toBe(1);
  });
  it("refuses a phone outside the configured allowlist", async () => {
    await runDueActions(rt, ORG);
    advance();
    vi.stubEnv("DEMO_PHONE_ALLOWLIST", "+447700900099");
    expect((await runDueActions(rt, ORG)).results[0]?.decisionCode).toBe("PHONE_NOT_ALLOWLISTED");
    expect(calls).not.toHaveBeenCalled();
    expect(repos.voice.listByInvoice(ORG, invoiceId)).toHaveLength(0);
  });
  it("missing email cancels without sending", async () => {
    vi.spyOn(repos.customers, "get").mockImplementation(() => ({ id: "cus_acme", organisationId: ORG, displayName: "Acme", matchKeys: [], stripeCustomerId: null, contactEmails: [], allowedPhoneNumbers: [] }));
    expect((await runDueActions(rt, ORG)).results[0]?.decisionCode).toBe("NO_TEAM_CONTROLLED_EMAIL");
    expect(fake.sent.size).toBe(0);
    expect(actions()[0]?.state).toBe("cancelled");
  });
  it("persists broken promises before deciding and fulfills promises on paid invoices", async () => {
    const ev = repos.evidence.insertOrGet({ organisationId: ORG, externalEventId: "promise", sourceType: "email", sourceRef: "promise", customerRef: "Acme", customerId: "cus_acme", invoiceId,
      receivedAt: REAL.toISOString(), text: "Pay tomorrow" }).evidence;
    const p = repos.promises.record({ organisationId: ORG, customerId: "cus_acme", invoiceId, promisedDate: "2026-10-29", evidenceId: ev.id, quote: "Pay tomorrow" });
    await runDueActions(rt, ORG);
    expect(repos.promises.listByInvoice(ORG, invoiceId).find((x) => x.id === p.id)?.status).toBe("broken");
    const ev2 = repos.evidence.insertOrGet({ organisationId: ORG, externalEventId: "promise2", sourceType: "email", sourceRef: "promise2", customerRef: "Acme", customerId: "cus_acme", invoiceId, receivedAt: REAL.toISOString(), text: "Pay later" }).evidence;
    const p2 = repos.promises.record({ organisationId: ORG, customerId: "cus_acme", invoiceId, promisedDate: "2026-11-10", evidenceId: ev2.id, quote: "Pay later" });
    const id = repos.invoices.get(ORG, invoiceId)!.stripeInvoiceId;
    stripe.pay(id, 120000);
    repos.invoices.applySnapshot(ORG, await stripe.adapter.refreshInvoice(id));
    await runDueActions(rt, ORG);
    expect(repos.promises.listByInvoice(ORG, invoiceId).find((x) => x.id === p2.id)?.status).toBe("fulfilled");
  });
});

const SECRET = `whsec_${Buffer.from("test-signing-secret").toString("base64")}`;
function signed(body: string, id = "evt_delivery_1") {
  const ts = String(Math.floor(Date.now() / 1000));
  return { "svix-id": id, "svix-timestamp": ts,
    "svix-signature": `v1,${createHmac("sha256", Buffer.from("test-signing-secret")).update(`${id}.${ts}.${body}`).digest("base64")}` };
}
function deliveryAdapter() {
  return createResendAdapter({ apiKey: "re_test", from: "ar@example.test", webhookSecret: SECRET, allowlist: ["team@example.test"] });
}
const delivered = () => JSON.stringify({ type: "email.delivered", created_at: "2026-10-15T09:00:04.000Z", data: { email_id: "msg_test" } });

describe("email delivery webhook", () => {
  beforeEach(async () => { reminderOutcome("accepted"); await runDueActions(rt, ORG); rt.notifications = deliveryAdapter(); });
  it("verifies delivery once, converts to app time, deduplicates and never flips delivered to failed", async () => {
    const body = delivered();
    expect(handleEmailDelivery(rt, ORG, body, signed(body))).toBe("processed");
    expect(actions()[0]).toMatchObject({ deliveryState: "delivered", deliveredAt: "2026-10-30T09:00:04.000Z" });
    const count = repos.audit.listByInvoice(ORG, invoiceId).length;
    expect(handleEmailDelivery(rt, ORG, body, signed(body))).toBe("duplicate");
    expect(handleEmailDelivery(rt, ORG, body, signed(body, "evt_delivery_2"))).toBe("processed");
    const bounced = JSON.stringify({ type: "email.bounced", data: { email_id: "msg_test" } });
    handleEmailDelivery(rt, ORG, bounced, signed(bounced, "evt_bounce"));
    expect(actions()[0]?.deliveryState).toBe("delivered");
    expect(repos.audit.listByInvoice(ORG, invoiceId)).toHaveLength(count);
  });
  it("bad signatures return 400; opens and unknown receipts are ignored", async () => {
    const response = await emailDeliveryResponse(new Request("http://localhost/api/webhooks/email", { method: "POST", body: delivered() }), rt, ORG);
    expect(response.status).toBe(400);
    expect(actions()[0]?.deliveryState).toBe("pending");
    const opened = JSON.stringify({ type: "email.opened", data: { email_id: "msg_test" } });
    const ignored = await emailDeliveryResponse(new Request("http://localhost/api/webhooks/email", { method: "POST", body: opened, headers: signed(opened) }), rt, ORG);
    expect(ignored.status).toBe(200);
    expect((await ignored.json()).data.ignored).toBe(true);
    const unknown = delivered().replace("msg_test", "other_receipt");
    expect(handleEmailDelivery(rt, ORG, unknown, signed(unknown, "evt_unknown"))).toBe("ignored");
  });
  it("rolls back delivery and releases dedupe after processing fails, allowing a retry", () => {
    const body = delivered();
    const spy = vi.spyOn(repos.audit, "append").mockImplementationOnce(() => { throw new Error("db failure"); });
    expect(() => handleEmailDelivery(rt, ORG, body, signed(body))).toThrow();
    expect(actions()[0]?.deliveryState).toBe("pending");
    spy.mockRestore();
    expect(handleEmailDelivery(rt, ORG, body, signed(body))).toBe("processed");
    expect(actions()[0]?.deliveryState).toBe("delivered");
  });
});
