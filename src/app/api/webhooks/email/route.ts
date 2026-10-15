import { DEMO_ORGANISATION_ID } from "@/contracts";
import { getRepositories } from "@/server/db";
import { fail } from "@/server/http/respond";
import { emailDeliveryResponse } from "@/server/jobs/email-delivery";
import { getNotificationsAdapter } from "@/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    return await emailDeliveryResponse(req, { repos: getRepositories(), notifications: getNotificationsAdapter() }, DEMO_ORGANISATION_ID);
  } catch {
    return fail({ code: "EMAIL_WEBHOOK_UNAVAILABLE", message: "Email webhook is unavailable.", retryable: true }, 503);
  }
}
