/**
 * A1-01 — extract candidate completion facts from untrusted evidence text.
 * The LLM proposes facts; nothing here decides customers, milestones or prices (see evaluate.ts).
 * When no LLM is configured, a strict, clearly labelled rule-based extractor is used instead.
 */
import { z } from "zod";
import type { ExtractedCompletionFacts, Milestone, StructuredLlm } from "@/contracts";

export type ExtractionSource = { kind: "llm"; model: string } | { kind: "rules_fallback" };

export type ExtractionResult =
  | { ok: true; facts: ExtractedCompletionFacts; source: ExtractionSource }
  | { ok: false; code: string; reason: string };

const factsSchema = z.object({
  customerName: z.string().nullable(),
  completedItems: z.array(z.object({ reference: z.string().nullable(), description: z.string(), quote: z.string() })).max(10),
  contradictions: z.array(z.object({ quote: z.string() })).max(10),
  mentionedAmounts: z.array(z.object({ text: z.string() })).max(10),
});

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["customerName", "completedItems", "contradictions", "mentionedAmounts"],
  properties: {
    customerName: { type: ["string", "null"], description: "Customer the work was done for, as written. null if not stated." },
    completedItems: {
      type: "array",
      description: "Each piece of work the message states is COMPLETE. Exclude work described as pending, partial or planned.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reference", "description", "quote"],
        properties: {
          reference: { type: ["string", "null"], description: "Milestone/reference code exactly as written (e.g. M2-website-migration), or null." },
          description: { type: "string", description: "Short description of the completed work." },
          quote: { type: "string", description: "Exact sentence from the message stating it is complete, copied verbatim." },
        },
      },
    },
    contradictions: {
      type: "array",
      description: "Exact quotes saying the work is NOT complete, partially done, blocked, rejected or in dispute.",
      items: { type: "object", additionalProperties: false, required: ["quote"], properties: { quote: { type: "string" } } },
    },
    mentionedAmounts: {
      type: "array",
      description: "Any money amounts mentioned, verbatim. These are recorded for audit only.",
      items: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } },
    },
  },
} as const;

const SYSTEM = [
  "You extract facts from a message reporting completed client work, for an invoicing system.",
  "Report only what the message states. Do not decide prices or whether to bill.",
  "Copy quotes verbatim. If completion is uncertain or contradicted, record the contradiction.",
].join(" ");

// ── Rule-based fallback (no LLM configured) ──

const COMPLETION = /\b(complete|completed|done|finished|delivered|shipped|signed off|sign-off|live|launched)\b/i;
const NEGATION = /\b(not|isn't|isnt|hasn't|hasnt|haven't|wasn't|incomplete|partially|partial|pending|blocked|still|yet to|almost|nearly|dispute|rejected|failed)\b/i;
const AMOUNT = /£\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:gbp|pounds)\b/gi;

const sentences = (text: string) => text.split(/(?<=[.!?\n])\s+/).map((s) => s.trim()).filter(Boolean);

export function ruleBasedExtract(text: string, customerRef: string, milestones: Milestone[]): ExtractedCompletionFacts {
  const sents = sentences(text);
  const completedItems: ExtractedCompletionFacts["completedItems"] = [];
  for (const m of milestones) {
    const re = new RegExp(`\\b${m.reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    // Any sentence that names the reference AND says it is complete (labels like "Milestone: X." don't count).
    const s = sents.find((x) => re.test(x) && COMPLETION.test(x) && !NEGATION.test(x));
    if (s) completedItems.push({ reference: m.reference, description: m.title, quote: s });
  }
  return {
    customerName: customerRef || null,
    completedItems,
    contradictions: sents.filter((s) => NEGATION.test(s)).map((quote) => ({ quote })),
    mentionedAmounts: (text.match(AMOUNT) ?? []).map((t) => ({ text: t })),
  };
}

export async function extractCompletionFacts(
  input: { text: string; customerRef: string; milestones: Milestone[] },
  llm: StructuredLlm,
): Promise<ExtractionResult> {
  const res = await llm.complete({
    task: "billing.extract_completion",
    system: SYSTEM,
    user: `Customer reference supplied with the event: ${JSON.stringify(input.customerRef)}\n\nMessage:\n"""\n${input.text}\n"""`,
    jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>,
    parse: (v) => factsSchema.parse(v),
  });
  if (res.ok) return { ok: true, facts: res.value, source: { kind: "llm", model: res.model } };
  if (res.error.code === "LLM_UNAVAILABLE") {
    return { ok: true, facts: ruleBasedExtract(input.text, input.customerRef, input.milestones), source: { kind: "rules_fallback" } };
  }
  return { ok: false, code: "EXTRACTION_FAILED", reason: `Fact extraction failed (${res.error.code}); a person must review this evidence.` };
}
