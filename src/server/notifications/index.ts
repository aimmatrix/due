/**
 * A3 notifications lane (reminder email). SIGNATURE LOCKED by src/contracts/modules.ts (NotificationsAdapter).
 * ADAPTER_EMAIL=real uses Resend; anything else uses the clearly labelled fake.
 */
import type { NotificationsAdapter } from "@/contracts";
import { ConfigError, env } from "@/server/config/env";
import { createFakeNotifications } from "./fake";
import { createResendAdapter } from "./resend";

export { reminderContent } from "./content";
export { createFakeNotifications } from "./fake";
export { createResendAdapter, verifySvixSignature } from "./resend";

const globalForEmail = globalThis as unknown as { __dueFakeEmail?: NotificationsAdapter };

export function getNotificationsAdapter(): NotificationsAdapter {
  if (env.adapterMode("email") === "real") {
    const apiKey = env.resendApiKey();
    const from = env.reminderFromEmail();
    if (!apiKey) throw new ConfigError("RESEND_API_KEY", "ADAPTER_EMAIL=real requires RESEND_API_KEY");
    if (!from) throw new ConfigError("REMINDER_FROM_EMAIL", "ADAPTER_EMAIL=real requires REMINDER_FROM_EMAIL");
    return createResendAdapter({ apiKey, from, webhookSecret: env.resendWebhookSecret(), allowlist: env.demoEmailAllowlist() });
  }
  globalForEmail.__dueFakeEmail ??= createFakeNotifications(env.demoEmailAllowlist());
  return globalForEmail.__dueFakeEmail;
}
