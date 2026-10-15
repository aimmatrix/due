import { ConfigError, env } from "@/server/config/env";

export interface InboundConfig {
  provider: "resend";
  webhookSecret: string;
  apiKey: string;
  completionsAddress: string;
  allowedSenders: string[];
}

export function mailbox(value: string): string | null {
  const candidate = (value.match(/^[^<>]*<([^<>]+)>$/)?.[1] ?? value).trim().toLowerCase();
  return /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(candidate) ? candidate : null;
}

export function inboundConfig(): InboundConfig {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new ConfigError(name, `Missing ${name}`);
    return value;
  };
  if (required("INBOUND_EMAIL_PROVIDER") !== "resend") throw new ConfigError("INBOUND_EMAIL_PROVIDER", "Only Resend is supported");
  const webhookSecret = required("INBOUND_EMAIL_WEBHOOK_SECRET");
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(webhookSecret)) throw new ConfigError("INBOUND_EMAIL_WEBHOOK_SECRET", "Expected a Svix signing secret");
  const completionsAddress = mailbox(required("INBOUND_COMPLETIONS_ADDRESS"));
  if (!completionsAddress) throw new ConfigError("INBOUND_COMPLETIONS_ADDRESS", "Expected an email address");
  const allowedSenders = required("INBOUND_ALLOWED_SENDERS").split(",").map((v) => mailbox(v));
  if (allowedSenders.some((v) => !v)) throw new ConfigError("INBOUND_ALLOWED_SENDERS", "Expected comma-separated email addresses");
  const apiKey = env.resendApiKey();
  if (!apiKey) throw new ConfigError("RESEND_API_KEY", "Required to retrieve received email bodies");
  return { provider: "resend", webhookSecret, apiKey, completionsAddress, allowedSenders: allowedSenders as string[] };
}
