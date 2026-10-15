/**
 * GET /api/invoices/:id — A0. Serves the frozen MOCK fixture (header x-due-mock: true) until A0-06.
 */
import { FIXTURE_INVOICE_DETAIL } from "@/contracts/fixtures";
import { fail, ok } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (id !== FIXTURE_INVOICE_DETAIL.invoice.id) {
    return fail({ code: "INVOICE_NOT_FOUND", message: "Invoice not found", retryable: false }, 404);
  }
  return ok(FIXTURE_INVOICE_DETAIL, undefined, { headers: { "x-due-mock": "true" } });
}
