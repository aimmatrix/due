"use client";

import { useMemo, useState } from "react";

type Result =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; status: string; state: string; decisionCode: string | null; error: string | null; correlationId: string }
  | { kind: "error"; message: string; correlationId?: string };

const STATE_TEXT: Record<string, string> = {
  invoiced: "Received. An invoice was created automatically.",
  review_required: "Received. It needs a human review before any invoice.",
  ignored: "Received. No new invoice: this work is already billed or not billable.",
  failed_retryable: "Received and saved. Billing hit a temporary problem and will retry.",
  received: "Received. Processing has started.",
  evaluating: "Received. Processing has started.",
  creating_invoice: "Received. The invoice is being created.",
};

export function CompletionForm() {
  const submissionId = useMemo(() => crypto.randomUUID(), []);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setResult({ kind: "sending" });
    try {
      const res = await fetch("/api/forms/completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId,
          accessCode: fd.get("accessCode"),
          reporterName: fd.get("reporterName"),
          customer: fd.get("customer"),
          milestoneReference: fd.get("milestoneReference"),
          notes: fd.get("notes"),
        }),
      });
      const json = await res.json();
      if (json.error) setResult({ kind: "error", message: json.error.message, correlationId: json.correlationId });
      else
        setResult({
          kind: "done",
          status: json.data.status,
          state: json.data.billingRunState,
          decisionCode: json.data.decisionCode,
          error: json.data.lastError?.code ?? null,
          correlationId: json.correlationId,
        });
    } catch {
      setResult({ kind: "error", message: "Could not reach the server. Your report was not sent." });
    }
  }

  const input = "mt-1 w-full rounded border border-neutral-300 px-3 py-2";
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm font-medium">
        Your name
        <input name="reporterName" required maxLength={100} className={input} />
      </label>
      <label className="block text-sm font-medium">
        Customer
        <input name="customer" required maxLength={200} placeholder="e.g. Acme Ltd" className={input} />
      </label>
      <label className="block text-sm font-medium">
        Milestone reference <span className="font-normal text-neutral-500">(optional)</span>
        <input name="milestoneReference" maxLength={100} placeholder="e.g. M2-website-migration" className={input} />
      </label>
      <label className="block text-sm font-medium">
        What was completed?
        <textarea name="notes" required maxLength={5000} rows={4} className={input} />
      </label>
      <label className="block text-sm font-medium">
        Access code
        <input name="accessCode" type="password" required autoComplete="off" className={input} />
      </label>
      <button
        type="submit"
        disabled={result.kind === "sending"}
        className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {result.kind === "sending" ? "Sending…" : "Report completion"}
      </button>
      {result.kind === "done" && (
        <div role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p className="font-medium">{result.status === "duplicate" ? "Already received — this is the original result." : (STATE_TEXT[result.state] ?? `Received (${result.state}).`)}</p>
          <p className="mt-1 text-neutral-600">
            State: {result.state}
            {result.decisionCode ? ` · ${result.decisionCode}` : ""}
            {result.error ? ` · ${result.error}` : ""} · ref {result.correlationId}
          </p>
        </div>
      )}
      {result.kind === "error" && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          {result.message}
          {result.correlationId ? ` (ref ${result.correlationId})` : ""}
        </p>
      )}
    </form>
  );
}
