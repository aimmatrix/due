/**
 * Request parsing for inbound event routes (A0-04). Bodies are validated strictly; any attempt to
 * supply a price/amount is rejected because the event reports work done, never what to charge.
 */
import { z } from "zod";

const PRICE_KEYS = /^(amount|amount_?minor|price|unit_?amount|total|subtotal|currency|line_?items|lines)$/i;

export function containsPriceField(body: unknown): boolean {
  return typeof body === "object" && body !== null && Object.keys(body).some((k) => PRICE_KEYS.test(k));
}

const isoUtc = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO-8601 timestamp");

export const completionEventSchema = z
  .object({
    externalEventId: z.string().trim().min(1).max(200),
    sourceType: z.enum(["email", "completion_form", "fixture_replay"]),
    sourceRef: z.string().trim().min(1).max(500),
    customerRef: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(20_000),
    receivedAt: isoUtc.optional(),
  })
  .strict();

export const customerMessageSchema = z
  .object({
    externalEventId: z.string().trim().min(1).max(200),
    sourceType: z.enum(["email", "customer_message"]),
    sourceRef: z.string().trim().min(1).max(500),
    customerRef: z.string().trim().min(1).max(200),
    invoiceId: z.string().trim().min(1).max(100),
    text: z.string().trim().min(1).max(20_000),
    receivedAt: isoUtc.optional(),
  })
  .strict();

export const demoClockSchema = z.union([
  z.object({ setTo: isoUtc }).strict(),
  z.object({ advanceHours: z.number().positive().max(1440) }).strict(),
  z.object({ reset: z.literal(true) }).strict(),
]);

export async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

export function toUtc(v: string | undefined): string {
  return v ? new Date(v).toISOString() : new Date().toISOString();
}
