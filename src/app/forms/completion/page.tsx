// Service-completion form (A0-04 real event source). A0-owned; separate from the operator dashboard.
// It reports finished work only: there is no price field and no "create invoice" control.
import type { Metadata } from "next";
import { CompletionForm } from "./completion-form";

export const metadata: Metadata = { title: "Report completed work — Due" };

export default function CompletionFormPage() {
  return (
    <main className="mx-auto max-w-xl p-6 font-sans">
      <h1 className="text-2xl font-semibold">Report completed work</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Tell us which customer work is finished. Billing uses the agreed contract price, so there is no amount to enter.
      </p>
      <CompletionForm />
    </main>
  );
}
