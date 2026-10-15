/**
 * A3-02 — classify an inbound customer message into promise / dispute / claimed payment / review.
 * The LLM proposes; code validates. A promise needs an explicit, resolvable date and a verbatim quote,
 * otherwise it is sent to review. Message text is data, never instructions.
 */
import { z } from "zod";
import type { ClassifyCustomerMessage, CustomerMessageClassification } from "@/contracts";
import { daysBetween, isValidLondonDate, londonDate } from "./time";

/** Promises further out than this are not accepted automatically (no indefinite deferral). */
export const MAX_PROMISE_DAYS_AHEAD = 45;

const llmOutput = z.object({
  kind: z.enum(["promise", "dispute", "claimed_payment", "unclear", "other"]),
  promisedDate: z.string().nullable(),
  quote: z.string(),
  summary: z.string(),
});
type LlmOutput = z.infer<typeof llmOutput>;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "promisedDate", "quote", "summary"],
  properties: {
    kind: {
      type: "string",
      enum: ["promise", "dispute", "claimed_payment", "unclear", "other"],
      description:
        "promise = commits to pay on a specific date; dispute = disagrees with the invoice or says work/delivery is wrong; " +
        "claimed_payment = says they already paid; unclear = mentions payment but no specific date or is ambiguous; other = unrelated.",
    },
    promisedDate: {
      type: ["string", "null"],
      description: "For promise only: the specific date as YYYY-MM-DD, resolved against today's date. null if no specific date.",
    },
    quote: { type: "string", description: "The exact sentence from the message supporting the classification, copied verbatim." },
    summary: { type: "string", description: "One short neutral sentence describing the message." },
  },
} as const;

const SYSTEM = [
  "You classify a customer's reply about an unpaid invoice for an accounts-receivable system.",
  "Only report what the customer actually wrote. Do not infer agreement from politeness.",
  "A promise requires a specific calendar date (e.g. 'Friday 7 November', 'on the 14th', 'tomorrow'). 'Soon', 'next week sometime' or 'when we can' is unclear.",
  "Never invent dates, amounts or payment plans.",
].join(" ");

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Pure validation of model output against the source text and application time. */
export function validateClassification(raw: LlmOutput, text: string, todayLondon: string): CustomerMessageClassification {
  const quote = raw.quote.trim();
  if (raw.kind === "other") return { kind: "other", reason: raw.summary || "Message is not about payment." };
  if (!quote || !squash(text).includes(squash(quote))) {
    return { kind: "needs_review", reason: "Supporting quote could not be found in the message." };
  }
  switch (raw.kind) {
    case "dispute":
      return { kind: "dispute", summary: raw.summary || "Customer disputes the invoice.", quote };
    case "claimed_payment":
      return { kind: "claimed_payment", quote };
    case "unclear":
      return { kind: "needs_review", reason: `Payment mentioned without a clear commitment: "${quote}"` };
    case "promise": {
      const d = raw.promisedDate;
      if (!d || !isValidLondonDate(d)) return { kind: "needs_review", reason: `Promise without a resolvable date: "${quote}"` };
      const ahead = daysBetween(todayLondon, d);
      if (ahead < 0) return { kind: "needs_review", reason: `Promised date ${d} is already in the past.` };
      if (ahead > MAX_PROMISE_DAYS_AHEAD) {
        return { kind: "needs_review", reason: `Promised date ${d} is more than ${MAX_PROMISE_DAYS_AHEAD} days away.` };
      }
      return { kind: "promise", promisedDate: d, quote };
    }
  }
}

export const classifyCustomerMessage: ClassifyCustomerMessage = async (input, deps) => {
  const today = londonDate(input.appTime.now);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" }).format(new Date(input.appTime.now));
  const res = await deps.llm.complete({
    task: "collections.classify_customer_message",
    system: SYSTEM,
    user: `Today is ${weekday} ${today} (Europe/London).\n\nCustomer message:\n"""\n${input.evidence.text}\n"""`,
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    parse: (v) => llmOutput.parse(v),
  });
  if (!res.ok) return { kind: "needs_review", reason: `Automatic classification unavailable (${res.error.code}).` };
  return validateClassification(res.value, input.evidence.text, today);
};
