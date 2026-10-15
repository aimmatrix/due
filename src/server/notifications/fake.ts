/**
 * Fake reminder adapter for lane development and offline demos. Message IDs start with `fake_` so a
 * simulated delivery can never be mistaken for a real one in the dashboard or audit log.
 */
import type { NotificationsAdapter, SendReminderResult } from "@/contracts";

export function createFakeNotifications(allowlist: string[], now: () => Date = () => new Date()): NotificationsAdapter & { sent: Map<string, SendReminderResult> } {
  const allow = new Set(allowlist.map((e) => e.toLowerCase()));
  const sent = new Map<string, SendReminderResult>();
  return {
    sent,
    async sendReminder(input) {
      const prior = sent.get(input.actionId);
      if (prior) return prior;
      const at = now().toISOString();
      const result: SendReminderResult =
        allow.size > 0 && !allow.has(input.to.toLowerCase())
          ? { state: "failed", providerMessageId: null, at, error: { code: "RECIPIENT_NOT_ALLOWLISTED", message: "Destination is not a team-controlled demo address", retryable: false } }
          : { state: "delivered", providerMessageId: `fake_msg_${input.actionId}`, at, error: null };
      sent.set(input.actionId, result);
      return result;
    },
    verifyDeliveryEvent() {
      return null;
    },
  };
}
