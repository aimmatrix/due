export interface VoiceConfig {
  apiKey: string;
  agentId: string;
  agentPhoneNumberId: string;
  webhookSecret: string;
  allowlist: string[];
  apiBaseUrl: string;
  requestTimeoutMs: number;
}

const REQUIRED = [
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_AGENT_ID",
  "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
  "ELEVENLABS_WEBHOOK_SECRET",
  "VOICE_DEMO_ALLOWLIST",
] as const;

export class VoiceConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing voice configuration: ${missing.join(", ")}`);
  }
}

export function readVoiceConfig(env: Record<string, string | undefined> = process.env): VoiceConfig {
  const missing = REQUIRED.filter((k) => !env[k]?.trim());
  if (missing.length) throw new VoiceConfigError(missing);
  return {
    apiKey: env.ELEVENLABS_API_KEY!.trim(),
    agentId: env.ELEVENLABS_AGENT_ID!.trim(),
    agentPhoneNumberId: env.ELEVENLABS_AGENT_PHONE_NUMBER_ID!.trim(),
    webhookSecret: env.ELEVENLABS_WEBHOOK_SECRET!.trim(),
    allowlist: env.VOICE_DEMO_ALLOWLIST!.split(",").map((n) => n.trim()).filter(Boolean),
    apiBaseUrl: env.ELEVENLABS_API_BASE_URL?.trim() || "https://api.elevenlabs.io",
    requestTimeoutMs: Number(env.ELEVENLABS_REQUEST_TIMEOUT_MS) || 15000,
  };
}
