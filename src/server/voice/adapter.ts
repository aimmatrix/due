import type { VoiceConfig } from "./config";
import { conversationVariables, validateContext } from "./format";
import type { CollectionCallContext, StartCallErrorCode, StartCallResult } from "./types";

export interface VoiceAdapterDeps {
  config: VoiceConfig;
  businessName?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export type StartCollectionCall = (ctx: CollectionCallContext) => Promise<StartCallResult>;

export function createElevenLabsVoiceAdapter(deps: VoiceAdapterDeps): { startCollectionCall: StartCollectionCall } {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const businessName = deps.businessName ?? "Due Demo Agency";

  async function startCollectionCall(ctx: CollectionCallContext): Promise<StartCallResult> {
    const result = (status: StartCallResult["status"], errorCode: StartCallErrorCode | null, ids?: { conversationId?: string | null; callSid?: string | null }): StartCallResult => ({
      status,
      actionId: ctx.actionId,
      conversationId: ids?.conversationId ?? null,
      callSid: ids?.callSid ?? null,
      at: now().toISOString(),
      errorCode,
    });

    if (validateContext(ctx)) return result("failed", "invalid_context");
    if (!deps.config.allowlist.includes(ctx.toNumber)) return result("failed", "destination_not_allowlisted");

    const body = {
      agent_id: deps.config.agentId,
      agent_phone_number_id: deps.config.agentPhoneNumberId,
      to_number: ctx.toNumber,
      conversation_initiation_client_data: {
        dynamic_variables: conversationVariables(ctx, businessName),
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.config.requestTimeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${deps.config.apiBaseUrl}/v1/convai/twilio/outbound-call`, {
        method: "POST",
        headers: { "xi-api-key": deps.config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // The provider may have dialled even though we never saw a response.
      // Reconcile before any further attempt; never redial from here.
      const aborted = (err as Error)?.name === "AbortError";
      return result("unknown", aborted ? "provider_timeout" : "network_error");
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) return result("failed", "misconfigured");
    if (res.status >= 500) return result("unknown", "provider_unavailable");

    let payload: { success?: boolean; conversation_id?: string | null; callSid?: string | null } = {};
    try {
      payload = await res.json();
    } catch {
      return result(res.ok ? "unknown" : "failed", res.ok ? "provider_unavailable" : "provider_rejected");
    }

    const ids = { conversationId: payload.conversation_id ?? null, callSid: payload.callSid ?? null };
    if (res.ok && payload.success) return result("accepted", null, ids);
    return result("failed", "provider_rejected", ids);
  }

  return { startCollectionCall };
}

export function createFakeVoiceAdapter(opts: { status?: StartCallResult["status"]; now?: () => Date } = {}): {
  startCollectionCall: StartCollectionCall;
  calls: CollectionCallContext[];
} {
  const calls: CollectionCallContext[] = [];
  const now = opts.now ?? (() => new Date());
  return {
    calls,
    async startCollectionCall(ctx) {
      calls.push(ctx);
      const status = opts.status ?? "accepted";
      return {
        status,
        actionId: ctx.actionId,
        conversationId: status === "accepted" ? `fake_conv_${ctx.actionId}` : null,
        callSid: status === "accepted" ? `fake_call_${ctx.actionId}` : null,
        at: now().toISOString(),
        errorCode: status === "accepted" ? null : status === "unknown" ? "provider_timeout" : "provider_rejected",
      };
    },
  };
}
