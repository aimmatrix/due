/**
 * Server configuration with readable errors and the Stripe test-mode guard (A0-01).
 * Owned by A0. Lanes import the getters; they never read process.env directly for these names.
 */

export class ConfigError extends Error {
  constructor(public readonly variable: string, message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function read(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function required(name: string, purpose: string): string {
  const v = read(name);
  if (!v) throw new ConfigError(name, `Missing ${name} (${purpose}). Copy .env.example to .env.local and set it.`);
  return v;
}

/** Refuses anything other than a Stripe TEST secret/restricted key. Live mode is never allowed. */
export function stripeSecretKey(): string {
  const key = required("STRIPE_SECRET_KEY", "Stripe test-mode secret key");
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new ConfigError("STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY must be a TEST-mode key (sk_test_… or rk_test_…). Live mode is refused.");
  }
  return key;
}

export const env = {
  stripeSecretKey,
  stripeWebhookSecret: () => required("STRIPE_WEBHOOK_SECRET", "Stripe webhook signing secret (whsec_…)"),
  anthropicApiKey: () => read("ANTHROPIC_API_KEY") ?? null,
  anthropicModel: () => read("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
  openAiApiKey: () => read("OPENAI_API_KEY") ?? null,
  openAiModel: () => read("OPENAI_MODEL") ?? "gpt-4.1-mini",
  ingestToken: () => required("INGEST_TOKEN", "bearer token for /api/events/*"),
  /** Shared access code typed into the service-completion form. */
  formAccessCode: () => required("FORM_ACCESS_CODE", "access code for the service-completion form"),
  databasePath: () => read("DATABASE_PATH") ?? "data/due.db",
  demoMode: () => read("DEMO_MODE") === "true",
  appBaseUrl: () => read("APP_BASE_URL") ?? "http://localhost:3000",
  cogneeApiUrl: () => read("COGNEE_API_URL") ?? null,
  cogneeApiKey: () => read("COGNEE_API_KEY") ?? null,
  resendApiKey: () => read("RESEND_API_KEY") ?? null,
  resendWebhookSecret: () => read("RESEND_WEBHOOK_SECRET") ?? null,
  reminderFromEmail: () => read("REMINDER_FROM_EMAIL") ?? null,
  /** Team-controlled reminder destination(s), comma separated. */
  demoEmailAllowlist: () => (read("DEMO_EMAIL_ALLOWLIST") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  /** Consenting teammate numbers in E.164, comma separated. */
  demoPhoneAllowlist: () => (read("DEMO_PHONE_ALLOWLIST") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  elevenLabsApiKey: () => read("ELEVENLABS_API_KEY") ?? null,
  elevenLabsAgentId: () => read("ELEVENLABS_AGENT_ID") ?? null,
  elevenLabsAgentPhoneNumberId: () => read("ELEVENLABS_AGENT_PHONE_NUMBER_ID") ?? null,
  elevenLabsWebhookSecret: () => read("ELEVENLABS_WEBHOOK_SECRET") ?? null,
  /** "fake" (default) or "real" for each external adapter. Lanes develop against fakes. */
  adapterMode: (name: "stripe" | "email" | "voice" | "memory" | "llm"): "fake" | "real" =>
    read(`ADAPTER_${name.toUpperCase()}`) === "real" ? "real" : "fake",
};

/** Startup report used by `npm run check:env` and the dashboard service-health panel. */
export function configReport(): Array<{ name: string; ok: boolean; detail: string }> {
  const checks: Array<[string, () => unknown]> = [
    ["STRIPE_SECRET_KEY", env.stripeSecretKey],
    ["STRIPE_WEBHOOK_SECRET", env.stripeWebhookSecret],
    ["INGEST_TOKEN", env.ingestToken],
    ["FORM_ACCESS_CODE", env.formAccessCode],
  ];
  const out = checks.map(([name, fn]) => {
    try {
      fn();
      return { name, ok: true, detail: "set" };
    } catch (e) {
      return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  });
  const optional: Array<[string, unknown]> = [
    ["ANTHROPIC_API_KEY", env.anthropicApiKey()],
    ["OPENAI_API_KEY", env.openAiApiKey()],
    ["COGNEE_API_KEY", env.cogneeApiKey()],
    ["RESEND_API_KEY", env.resendApiKey()],
    ["ELEVENLABS_API_KEY", env.elevenLabsApiKey()],
  ];
  for (const [name, v] of optional) out.push({ name, ok: true, detail: v ? "set" : "not set (fake adapter / fallback used)" });
  return out;
}
