import { z } from "zod";
import { verifySvixSignature } from "@/server/notifications/resend";

const metadata = z.object({
  email_id: z.string().min(1).max(200),
  from: z.string().max(1000),
  to: z.array(z.string().max(1000)).max(100),
  subject: z.string().max(4000),
  message_id: z.string().min(1).max(1000),
});
const content = z.object({
  id: z.string(),
  message_id: z.string().min(1).max(1000),
  text: z.string().nullable().optional(),
  html: z.string().nullable().optional(),
});

export function verifyReceivedEvent(raw: string, headers: Headers, secret: string, now: Date) {
  // Use real wall time, never the simulated collections clock, for replay protection.
  return verifySvixSignature(raw, Object.fromEntries(headers.entries()), secret, now);
}

export function receivedEvent(raw: string) {
  const event = z.object({ type: z.string() }).passthrough().parse(JSON.parse(raw));
  if (event.type !== "email.received") return null;
  return z.object({ type: z.literal("email.received"), created_at: z.iso.datetime({ offset: true }), data: metadata }).parse(event);
}

export async function fetchReceivedEmail(emailId: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("INBOUND_CONTENT_UNAVAILABLE");
  const email = content.parse(await response.json());
  if (email.id !== emailId) throw new Error("INBOUND_CONTENT_MISMATCH");
  return email;
}
