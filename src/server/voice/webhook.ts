import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CallOutcome,
  CallRecommendation,
  VerifiedCallEvent,
  VerifyErrorCode,
  VerifyResult,
} from "./types";

export interface VerifyDeps {
  webhookSecret: string;
  // Integration-layer lookup of a persisted voice attempt. Unknown actions are
  // rejected so they cannot update an invoice.
  isKnownAction: (actionId: string, conversationId: string) => boolean | Promise<boolean>;
  now?: () => Date;
  toleranceSeconds?: number;
}

type Headers = Record<string, string | string[] | undefined> | { get(name: string): string | null };

function header(headers: Headers, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  }
  const rec = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key ? rec[key] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function signElevenLabsPayload(rawBody: string, secret: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v0=${digest}`;
}

function verifySignature(rawBody: string, sigHeader: string | undefined, deps: VerifyDeps): VerifyErrorCode | null {
  if (!sigHeader) return "missing_signature";
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const v0 = parts.v0;
  if (!Number.isInteger(t) || !v0 || !/^[0-9a-f]+$/i.test(v0)) return "malformed_signature";
  const nowSec = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - t) > (deps.toleranceSeconds ?? 30 * 60)) return "stale_signature";
  const expected = createHmac("sha256", deps.webhookSecret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v0, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "invalid_signature";
  return null;
}

interface TranscriptTurn {
  role?: string;
  message?: string | null;
}

interface CollectedField {
  value?: unknown;
}

const VOICEMAIL_HINT = /voicemail|answering machine/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function quoteTurnIndex(transcript: TranscriptTurn[], quote: string): number | null {
  const q = normalise(quote);
  if (!q) return null;
  const i = transcript.findIndex((t) => t.role === "user" && normalise(t.message ?? "").includes(q));
  return i >= 0 ? i : null;
}

function isRealDate(d: string): boolean {
  if (!DATE.test(d)) return false;
  const parsed = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
}

export async function verifyAndNormaliseCallEvent(
  rawBody: string,
  headers: Headers,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const sigError = verifySignature(rawBody, header(headers, "elevenlabs-signature"), deps);
  if (sigError) return { ok: false, errorCode: sigError };

  let body: { type?: string; event_timestamp?: number; data?: Record<string, any> };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, errorCode: "malformed_body" };
  }
  const type = body.type;
  const data = body.data;
  if (!data || typeof data !== "object") return { ok: false, errorCode: "malformed_body" };
  if (type !== "post_call_transcription" && type !== "call_initiation_failure") {
    return { ok: false, errorCode: "unsupported_event" };
  }

  const conversationId = str(data.conversation_id);
  const vars = (data.conversation_initiation_client_data?.dynamic_variables ?? {}) as Record<string, unknown>;
  const actionId = str(vars.due_action_id);
  if (!conversationId || !actionId) return { ok: false, errorCode: "missing_correlation" };
  if (!(await deps.isKnownAction(actionId, conversationId))) return { ok: false, errorCode: "unknown_action" };

  const eventAt = new Date(((body.event_timestamp ?? 0) || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const metadata = (data.metadata ?? {}) as Record<string, any>;
  const callSid = str(metadata.phone_call?.call_sid) || null;
  const base = {
    dedupKey: `elevenlabs:${type}:${conversationId}`,
    provider: "elevenlabs" as const,
    eventType: type as VerifiedCallEvent["eventType"],
    conversationId,
    callSid,
    eventAt,
    actionId,
    correlationId: str(vars.due_correlation_id) || null,
    transcriptRef: { provider: "elevenlabs" as const, conversationId, turnIndex: null as number | null },
  };

  const build = (
    outcome: CallOutcome,
    recommendation: CallRecommendation,
    summary: string,
    extra: Partial<Pick<VerifiedCallEvent, "promisedDate" | "evidenceQuote" | "reviewReason" | "failure">> & { turnIndex?: number | null } = {},
  ): VerifyResult => ({
    ok: true,
    event: {
      ...base,
      transcriptRef: { ...base.transcriptRef, turnIndex: extra.turnIndex ?? null },
      outcome,
      recommendation,
      summary,
      promisedDate: extra.promisedDate ?? null,
      evidenceQuote: extra.evidenceQuote ?? null,
      reviewReason: extra.reviewReason ?? null,
      failure: extra.failure ?? null,
    },
  });

  if (type === "call_initiation_failure") {
    const reason = str(data.failure_reason) || "unknown";
    if (/no[-_ ]?answer|busy/i.test(reason)) {
      return build("no_answer", "no_retry", `Call not answered (${reason}).`, { failure: { code: reason, detail: "Call was not answered." } });
    }
    return build("failed", "review", `Call could not be initiated (${reason}).`, { failure: { code: reason, detail: "Provider reported an initiation failure." } });
  }

  const transcript = (Array.isArray(data.transcript) ? data.transcript : []) as TranscriptTurn[];
  const userTurns = transcript.filter((t) => t.role === "user" && str(t.message));
  const summary = str(data.analysis?.transcript_summary) || "No summary provided.";
  const termination = str(metadata.termination_reason);

  if (VOICEMAIL_HINT.test(termination) || (VOICEMAIL_HINT.test(summary) && userTurns.length === 0)) {
    return build("no_answer", "no_retry", "Reached voicemail; no invoice details were left.");
  }
  if (userTurns.length === 0) {
    return build("no_answer", "no_retry", "No customer speech was captured.");
  }
  if (str(data.status) && str(data.status) !== "done") {
    return build("needs_review", "review", summary, { reviewReason: `Conversation status ${str(data.status)}` });
  }

  const collected = (data.analysis?.data_collection_results ?? {}) as Record<string, CollectedField>;
  const rawOutcome = str(collected.call_outcome?.value).toLowerCase();
  const quote = str(collected.customer_quote?.value);
  const turnIndex = quoteTurnIndex(transcript, quote);
  const quoted = turnIndex !== null ? quote : null;

  switch (rawOutcome) {
    case "promise": {
      const date = str(collected.promised_date?.value);
      if (!isRealDate(date)) {
        return build("needs_review", "review", summary, { evidenceQuote: quoted, turnIndex, reviewReason: "Promise without a clear date" });
      }
      if (!quoted) {
        return build("needs_review", "review", summary, { promisedDate: date, reviewReason: "Promise quote not found in transcript" });
      }
      return build("promise", "defer_until_promise", summary, { promisedDate: date, evidenceQuote: quoted, turnIndex });
    }
    case "dispute":
      return build("dispute", "pause_for_dispute", summary, {
        evidenceQuote: quoted,
        turnIndex,
        reviewReason: str(collected.dispute_reason?.value) || null,
      });
    case "claimed_payment":
      return build("claimed_payment", "refresh_stripe", summary, { evidenceQuote: quoted, turnIndex });
    case "needs_person":
      return build("needs_review", "review", summary, { evidenceQuote: quoted, turnIndex, reviewReason: "Customer asked for a person" });
    default:
      return build("needs_review", "review", summary, {
        evidenceQuote: quoted,
        turnIndex,
        reviewReason: termination ? `Unclear outcome (${termination})` : "Unclear outcome",
      });
  }
}
