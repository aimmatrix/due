/**
 * Real reminder adapter using the Resend HTTP API (no SDK dependency) and its Svix-signed webhooks.
 * `accepted` means Resend took the message; only a verified `email.delivered` webhook makes it delivered.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError, type NotificationsAdapter, type ReminderDeliveryEvent, type SendReminderInput, type SendReminderResult } from "@/contracts";
import { reminderContent } from "./content";

export interface ResendConfig {
  apiKey: string;
  from: string;
  webhookSecret: string | null;
  allowlist: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

const TOLERANCE_SECONDS = 5 * 60;

export function verifySvixSignature(rawBody: string, headers: Record<string, string>, secret: string, now: Date): string {
  const h = (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? "";
  const id = h("svix-id");
  const ts = h("svix-timestamp");
  const sigs = h("svix-signature");
  if (!id || !ts || !sigs) throw new WebhookSignatureError("EMAIL_SIGNATURE_MISSING");
  const age = Math.abs(now.getTime() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) throw new WebhookSignatureError("EMAIL_SIGNATURE_STALE");
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  const ok = sigs.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new WebhookSignatureError("EMAIL_SIGNATURE_INVALID");
  return id;
}

export function createResendAdapter(cfg: ResendConfig): NotificationsAdapter {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const now = cfg.now ?? (() => new Date());
  const allow = new Set(cfg.allowlist.map((e) => e.toLowerCase()));

  return {
    async sendReminder(input: SendReminderInput): Promise<SendReminderResult> {
      const at = now().toISOString();
      if (!allow.has(input.to.toLowerCase())) {
        return { state: "failed", providerMessageId: null, at, error: { code: "RECIPIENT_NOT_ALLOWLISTED", message: "Destination is not a team-controlled demo address", retryable: false } };
      }
      const { subject, text, html } = reminderContent(input);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 10_000);
      try {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            authorization: `Bearer ${cfg.apiKey}`,
            "content-type": "application/json",
            // A repeated action ID returns the original send instead of emailing again.
            "idempotency-key": `reminder-${input.actionId}`,
          },
          body: JSON.stringify({ from: cfg.from, to: [input.to], subject, text, html, tags: [{ name: "action_id", value: input.actionId.replace(/[^a-zA-Z0-9_-]/g, "_") }] }),
        });
        if (res.ok) {
          const json = (await res.json()) as { id?: string };
          if (!json.id) return { state: "unknown", providerMessageId: null, at, error: { code: "EMAIL_NO_ID", message: "Provider accepted without a message ID", retryable: false } };
          return { state: "accepted", providerMessageId: json.id, at, error: null };
        }
        // 4xx (except 429) are definite rejections; 5xx/429 leave the outcome unknown.
        const definite = res.status >= 400 && res.status < 500 && res.status !== 429;
        return {
          state: definite ? "failed" : "unknown",
          providerMessageId: null,
          at,
          error: { code: definite ? "EMAIL_REJECTED" : "EMAIL_PROVIDER_UNAVAILABLE", message: `Email provider returned HTTP ${res.status}`, retryable: !definite },
        };
      } catch {
        // Timeout/network: the provider may or may not have sent it. Reconcile; never blindly resend.
        return { state: "unknown", providerMessageId: null, at, error: { code: "EMAIL_TIMEOUT", message: "Email provider did not respond", retryable: false } };
      } finally {
        clearTimeout(timer);
      }
    },

    verifyDeliveryEvent(rawBody: string, headers: Record<string, string>): ReminderDeliveryEvent | null {
      if (!cfg.webhookSecret) throw new WebhookSignatureError("EMAIL_WEBHOOK_NOT_CONFIGURED");
      const eventId = verifySvixSignature(rawBody, headers, cfg.webhookSecret, now());
      const body = JSON.parse(rawBody) as { type?: string; created_at?: string; data?: { email_id?: string } };
      const messageId = body.data?.email_id;
      if (!messageId) return null;
      const state = body.type === "email.delivered" ? "delivered" : body.type === "email.bounced" || body.type === "email.failed" ? "failed" : null;
      if (!state) return null; // opens/clicks/delays are not delivery outcomes (and an open is not a reply)
      return { providerEventId: eventId, providerMessageId: messageId, state, at: body.created_at ? new Date(body.created_at).toISOString() : now().toISOString() };
    },
  };
}
