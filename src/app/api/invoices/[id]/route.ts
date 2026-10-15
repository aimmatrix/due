/** GET /api/invoices/:id — A0-06 real read model: invoice, evidence, calculation, policy and timeline. */
import { DEMO_ORGANISATION_ID } from "@/contracts";
import { getRepositories } from "@/server/db";
import { fail, ok } from "@/server/http/respond";
import { getAppTime } from "@/server/jobs/clock";
import { buildInvoiceDetail } from "@/server/orchestration/read-models";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const repos = getRepositories();
  const detail = buildInvoiceDetail(repos, DEMO_ORGANISATION_ID, id, getAppTime(repos));
  if (!detail) return fail({ code: "INVOICE_NOT_FOUND", message: "Invoice not found", retryable: false }, 404);
  return ok(detail);
}
