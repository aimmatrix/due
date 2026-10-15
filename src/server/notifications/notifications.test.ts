import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebhookSignatureError, type SendReminderInput } from "@/contracts";
import { createFakeNotifications, createResendAdapter, reminderContent } from "./index";

const NOW = new Date("2026-10-30T09:00:00.000Z");
const SECRET = `whsec_${Buffer.from("test-signing-secret").toString("base64")}`;

const reminder: SendReminderInput = {
  actionId: "act_1", organisationId: "org_demo", invoiceId: "inv_1", to: "team@example.test", customerName: "Acme Ltd",
  invoiceNumber: "DUE-0001", amountRemainingMinor: 120000, currency: "gbp", dueAt: "2026-10-29T18:43:00.000Z",
  hostedInvoiceUrl: "https://invoice.stripe.com/i/test",
};

function sign(body: string, id = "msg_evt_1", ts = Math.floor(NOW.getTime() / 1000)) {
  const sig = createHmac("sha256", Buffer.from("test-signing-secret")).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
}

function fakeFetch(response: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const adapter = (fetchImpl: typeof fetch) =>
  createResendAdapter({ apiKey: "re_test", from: "Due <ar@example.test>", webhookSecret: SECRET, allowlist: ["team@example.test"], fetchImpl, now: () => NOW, timeoutMs: 50 });

describe("reminder content", () => {
  it("states verified facts only and identifies the AI sender", () => {
    const c = reminderContent(reminder);
    expect(c.subject).toContain("£1,200.00");
    expect(c.text).toContain("29 October 2026");
    expect(c.text).toContain("AI accounts assistant");
    expect(c.text).not.toMatch(/interest|late fee|penalt/i);
  });
});

describe("Resend adapter", () => {
  it("sends with the action ID as idempotency key and reports accepted (not delivered)", async () => {
    const f = fakeFetch(() => Response.json({ id: "re_msg_1" }));
    const r = await adapter(f.impl).sendReminder(reminder);
    expect(r).toMatchObject({ state: "accepted", providerMessageId: "re_msg_1", error: null });
    const headers = f.calls[0]!.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("reminder-act_1");
    expect(JSON.parse(f.calls[0]!.init.body as string).to).toEqual(["team@example.test"]);
  });

  it("refuses destinations outside the team allowlist without calling the provider", async () => {
    const f = fakeFetch(() => Response.json({ id: "x" }));
    const r = await adapter(f.impl).sendReminder({ ...reminder, to: "someone@else.example" });
    expect(r.state).toBe("failed");
    expect(r.error?.code).toBe("RECIPIENT_NOT_ALLOWLISTED");
    expect(f.calls).toHaveLength(0);
  });

  it("distinguishes definite rejection from unknown outcomes", async () => {
    expect((await adapter(fakeFetch(() => new Response("bad", { status: 422 })).impl).sendReminder(reminder)).state).toBe("failed");
    expect((await adapter(fakeFetch(() => new Response("down", { status: 503 })).impl).sendReminder(reminder)).state).toBe("unknown");
    const hang = fakeFetch(() => new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("abort")), 100)));
    expect((await adapter(hang.impl).sendReminder(reminder)).state).toBe("unknown");
  });

  it("verifies signed delivery webhooks and maps only delivery outcomes", () => {
    const a = adapter(fakeFetch(() => Response.json({})).impl);
    const delivered = JSON.stringify({ type: "email.delivered", created_at: "2026-10-30T09:00:04.000Z", data: { email_id: "re_msg_1" } });
    expect(a.verifyDeliveryEvent(delivered, sign(delivered))).toEqual({ providerEventId: "msg_evt_1", providerMessageId: "re_msg_1", state: "delivered", at: "2026-10-30T09:00:04.000Z" });
    const bounced = JSON.stringify({ type: "email.bounced", data: { email_id: "re_msg_1" } });
    expect(a.verifyDeliveryEvent(bounced, sign(bounced))?.state).toBe("failed");
    const opened = JSON.stringify({ type: "email.opened", data: { email_id: "re_msg_1" } });
    expect(a.verifyDeliveryEvent(opened, sign(opened))).toBeNull(); // an open is not a reply or a delivery
  });

  it("rejects tampered, missing or stale signatures", () => {
    const a = adapter(fakeFetch(() => Response.json({})).impl);
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "re_msg_1" } });
    expect(() => a.verifyDeliveryEvent(body.replace("re_msg_1", "re_msg_2"), sign(body))).toThrow(WebhookSignatureError);
    expect(() => a.verifyDeliveryEvent(body, {})).toThrow(WebhookSignatureError);
    expect(() => a.verifyDeliveryEvent(body, sign(body, "msg_evt_1", Math.floor(NOW.getTime() / 1000) - 3600))).toThrow(WebhookSignatureError);
  });
});

describe("fake adapter", () => {
  it("labels simulated delivery and never resends a repeated action ID", async () => {
    const fake = createFakeNotifications(["team@example.test"], () => NOW);
    const a = await fake.sendReminder(reminder);
    const b = await fake.sendReminder(reminder);
    expect(a.providerMessageId).toBe("fake_msg_act_1");
    expect(b).toBe(a);
    expect(fake.sent.size).toBe(1);
    expect((await fake.sendReminder({ ...reminder, actionId: "act_2", to: "x@y.example" })).state).toBe("failed");
  });
});
