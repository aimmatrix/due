/** POST /api/invoices/:id/refresh — manual recovery path: reconcile current Stripe state (A0-06). */
import { DEMO_ORGANISATION_ID, type RefreshInvoiceResponse } from "@/contracts";
import { fail, ok } from "@/server/http/respond";
import { toSafeError } from "@/server/orchestration/billing";
import { invoiceSummary } from "@/server/orchestration/read-models";
import { reconcileStripeInvoice } from "@/server/orchestration/reconcile";
import { getRuntime } from "@/server/orchestration/runtime";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rt = getRuntime();
  const inv = rt.repos.invoices.get(DEMO_ORGANISATION_ID, id);
  if (!inv) return fail({ code: "INVOICE_NOT_FOUND", message: "Invoice not found", retryable: false }, 404);
  try {
    const res = await reconcileStripeInvoice(rt, DEMO_ORGANISATION_ID, inv.stripeInvoiceId, { kind: "manual_refresh" });
    const fresh = res.invoice ?? inv;
    const data: RefreshInvoiceResponse = { invoice: invoiceSummary(rt.repos, fresh, rt.appTime()), changed: res.changed };
    return ok(data);
  } catch (e) {
    return fail(toSafeError(e, "STRIPE_REFRESH_FAILED"), 502);
  }
}
