/**
 * POST /api/webhooks/stripe — raw-body, signature-verified Stripe events (A0-06).
 * Duplicate events are acknowledged without reprocessing; failures return 500 so Stripe retries.
 */
import { DEMO_ORGANISATION_ID, WebhookSignatureError } from "@/contracts";
import { fail, ok } from "@/server/http/respond";
import { toSafeError } from "@/server/orchestration/billing";
import { handleStripeEvent } from "@/server/orchestration/reconcile";
import { getRuntime } from "@/server/orchestration/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const rt = getRuntime();
  let event;
  try {
    event = rt.stripe.verifyWebhook(raw, req.headers.get("stripe-signature"));
  } catch (e) {
    if (e instanceof WebhookSignatureError) return fail({ code: e.code, message: "Invalid Stripe signature", retryable: false }, 400);
    const err = toSafeError(e, "STRIPE_WEBHOOK_UNAVAILABLE");
    return fail(err, 503);
  }
  try {
    const status = await handleStripeEvent(rt, DEMO_ORGANISATION_ID, event);
    return ok({ received: true, status, eventId: event.eventId });
  } catch (e) {
    return fail(toSafeError(e, "STRIPE_RECONCILE_FAILED"), 500);
  }
}
