/**
 * A3-03 — the pure collections decision function. No I/O and no clock reads: everything comes from
 * the input, and the same function runs at scheduling time AND again immediately before dispatch.
 *
 * TIME CONVENTION: every timestamp in FollowUpInput (invoice.dueAt, action.dueAt/deliveredAt,
 * inboundResponses[].receivedAt, appTime.now) must be on the APPLICATION clock. The integration layer
 * converts provider/real timestamps by adding the simulated-clock offset when it records them.
 *
 * At dispatch time the caller omits the action being dispatched from `actions`; a queued action does not
 * block a decision (uniqueness on invoice/kind/sequence prevents duplicates), a reserved one does.
 *
 * Precedence: paid → not finalised → not yet due → dispute → in-flight/unknown action →
 * active promise → response after reminder → voice escalation window → contact interval → reminder cap.
 */
import type {
  CallEligibilityView,
  CollectionAction,
  DecideFollowUp,
  FollowUpDecision,
  FollowUpInput,
  PaymentPromise,
  PromiseStatus,
} from "@/contracts";
import { formatMoney } from "@/contracts";
import { addDays, addHours, londonDate, startOfLondonDay } from "./time";

/** After this many promises on one invoice, a new promise no longer defers contact. */
export const MAX_PROMISES_HONOURED = 2;

const decision = (d: Partial<FollowUpDecision> & Pick<FollowUpDecision, "action" | "decisionCode" | "reason">): FollowUpDecision => ({
  evidenceIds: [],
  notBefore: null,
  promiseId: null,
  disputeId: null,
  ...d,
});

const isContact = (a: CollectionAction) => a.kind !== "plan_offer" && ["sent", "unknown", "reserved"].includes(a.state);
const contactTime = (a: CollectionAction) => a.deliveredAt ?? a.dueAt;
const max = (xs: string[]) => xs.reduce<string | null>((m, x) => (m === null || x > m ? x : m), null);

/** The latest active promise whose date has not passed (London calendar). */
export function currentPromise(promises: PaymentPromise[], appNow: string): PaymentPromise | null {
  const today = londonDate(appNow);
  const active = promises.filter((p) => p.status === "active" && p.promisedDate >= today);
  return active.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/**
 * Lifecycle reconciliation (pure): which promise statuses should change now. A promise is fulfilled
 * when Stripe shows the invoice paid, and broken once its date has passed with a balance remaining.
 * The integration layer persists the returned changes.
 */
export function promiseStatusUpdates(
  promises: PaymentPromise[],
  invoice: FollowUpInput["invoice"],
  appNow: string,
): Array<{ promiseId: string; status: PromiseStatus }> {
  const today = londonDate(appNow);
  const paid = invoice.stripeStatus === "paid" || invoice.amountRemainingMinor === 0;
  return promises
    .filter((p) => p.status === "active")
    .flatMap((p): Array<{ promiseId: string; status: PromiseStatus }> =>
      paid ? [{ promiseId: p.id, status: "fulfilled" as const }] : p.promisedDate < today ? [{ promiseId: p.id, status: "broken" as const }] : [],
    );
}

interface VoiceFacts {
  lastDeliveredReminder: CollectionAction | null;
  windowClosesAt: string | null;
  responseAfterReminder: FollowUpInput["inboundResponses"][number] | null;
  voiceAttemptsUsed: number;
  phoneAllowlisted: boolean;
}

function voiceFacts(input: FollowUpInput): VoiceFacts {
  const delivered = input.actions
    .filter((a) => a.kind === "reminder_email" && a.deliveryState === "delivered" && a.deliveredAt)
    .sort((a, b) => b.deliveredAt!.localeCompare(a.deliveredAt!));
  const last = delivered[0] ?? null;
  const response = last ? (input.inboundResponses.find((r) => r.receivedAt > last.deliveredAt!) ?? null) : null;
  return {
    lastDeliveredReminder: last,
    windowClosesAt: last ? addHours(last.deliveredAt!, input.policy.voiceEscalationAfterHours) : null,
    responseAfterReminder: response,
    voiceAttemptsUsed: input.actions.filter((a) => a.kind === "voice_call" && a.state !== "cancelled" && a.state !== "queued").length,
    phoneAllowlisted: input.customer.allowedPhoneNumbers.length > 0,
  };
}

export const decideFollowUp: DecideFollowUp = (input) => {
  const { invoice, policy, appTime } = input;
  const now = appTime.now;
  const balance = formatMoney(invoice.amountRemainingMinor, invoice.currency);

  // 1. Payment state (Stripe-authoritative snapshot).
  if (invoice.stripeStatus === "void" || invoice.stripeStatus === "uncollectible") {
    return decision({ action: "none", decisionCode: "INVOICE_CLOSED", reason: `Invoice is ${invoice.stripeStatus}; no collections.` });
  }
  if (invoice.stripeStatus === "paid" || invoice.amountRemainingMinor <= 0) {
    return decision({ action: "none", decisionCode: "PAID", reason: "Invoice is fully paid; collections stopped." });
  }
  if (invoice.stripeStatus === "draft") {
    return decision({ action: "none", decisionCode: "NOT_FINALISED", reason: "Invoice is not finalised yet." });
  }
  if (now < invoice.dueAt) {
    return decision({ action: "none", decisionCode: "NOT_YET_DUE", reason: "Invoice is not overdue yet.", notBefore: invoice.dueAt });
  }

  // 2. Open dispute pauses everything.
  const dispute = input.disputes.find((d) => d.status === "open");
  if (dispute) {
    return decision({ action: "pause", decisionCode: "DISPUTE_OPEN", reason: `Dispute open: ${dispute.summary}`, evidenceIds: [dispute.evidenceId], disputeId: dispute.id });
  }

  // 3. Never act while an action is in flight or its outcome is unknown (no blind retries).
  const unknown = input.actions.find((a) => a.state === "unknown");
  if (unknown) {
    return decision({ action: "none", decisionCode: "RECONCILE_UNKNOWN", reason: `Outcome of ${unknown.kind} #${unknown.sequence} is unknown; reconcile before any further contact.` });
  }
  // Another worker holds a reservation. (At dispatch, omit the action being dispatched from input.actions.)
  const inFlight = input.actions.find((a) => a.state === "reserved");
  if (inFlight) {
    return decision({ action: "none", decisionCode: "ACTION_IN_FLIGHT", reason: `${inFlight.kind} #${inFlight.sequence} is being dispatched.` });
  }

  // 4. A valid, current promise defers contact until the day after the promised date.
  const promise = currentPromise(input.promises, now);
  // Bounded: once more than MAX_PROMISES_HONOURED promises exist, new ones no longer defer contact.
  if (promise && input.promises.length <= MAX_PROMISES_HONOURED) {
    return decision({
      action: "defer",
      decisionCode: "PROMISE_ACTIVE",
      reason: `Customer promised to pay on ${promise.promisedDate} ("${promise.quote}"); next contact deferred.`,
      evidenceIds: [promise.evidenceId],
      promiseId: promise.id,
      notBefore: startOfLondonDay(addDays(promise.promisedDate, 1)),
    });
  }

  const contacts = input.actions.filter(isContact);
  const lastContactAt = max(contacts.map(contactTime));
  const remindersUsed = input.actions.filter((a) => a.kind === "reminder_email" && isContact(a)).length;
  const v = voiceFacts(input);

  // 5. A response after the last delivered reminder ends this escalation; it is classified elsewhere.
  if (v.responseAfterReminder) {
    return decision({
      action: "none",
      decisionCode: "RESPONSE_RECEIVED",
      reason: "Customer responded after the reminder; awaiting classification or review instead of escalating.",
      evidenceIds: [v.responseAfterReminder.evidenceId],
    });
  }

  // 6. Voice escalation after confirmed delivery + elapsed window + no response.
  const pendingDelivery = input.actions.find((a) => a.kind === "reminder_email" && a.state === "sent" && (a.deliveryState === "pending" || a.deliveryState === "unknown"));
  if (v.lastDeliveredReminder && v.voiceAttemptsUsed < policy.maxVoiceAttemptsPerInvoice) {
    if (now < v.windowClosesAt!) {
      return decision({
        action: "none",
        decisionCode: "RESPONSE_WINDOW_OPEN",
        reason: `Reminder delivered; waiting ${policy.voiceEscalationAfterHours}h for a response before calling.`,
        notBefore: v.windowClosesAt,
      });
    }
    if (v.phoneAllowlisted) {
      return decision({
        action: "call",
        decisionCode: "CALL_NO_RESPONSE",
        reason: `No response ${policy.voiceEscalationAfterHours}h after reminder #${v.lastDeliveredReminder.sequence} was delivered; ${balance} outstanding.`,
        evidenceIds: v.lastDeliveredReminder.evidenceIds,
      });
    }
    // No allowlisted number: fall through to email follow-up.
  } else if (pendingDelivery && !v.lastDeliveredReminder) {
    return decision({
      action: "none",
      decisionCode: "AWAITING_DELIVERY_CONFIRMATION",
      reason: `Reminder #${pendingDelivery.sequence} has no delivery confirmation yet; the response window has not started.`,
    });
  }

  // 7. Contact interval.
  if (lastContactAt) {
    const nextAllowed = addHours(lastContactAt, policy.minHoursBetweenContacts);
    if (now < nextAllowed) {
      return decision({ action: "none", decisionCode: "CONTACT_INTERVAL", reason: `Last contact was under ${policy.minHoursBetweenContacts}h ago.`, notBefore: nextAllowed });
    }
  }

  // 8. Reminder, within the cap.
  if (remindersUsed >= policy.maxReminderEmailsPerInvoice) {
    return decision({ action: "none", decisionCode: "CONTACT_CAP_REACHED", reason: `All ${policy.maxReminderEmailsPerInvoice} reminders and permitted calls are used; review manually.` });
  }
  return decision({
    action: "remind",
    decisionCode: "REMIND_OVERDUE",
    reason: `Invoice overdue with ${balance} remaining and no promise, dispute or recent contact.`,
  });
};

/** Dashboard checklist (A4-05) explaining whether a call is allowed right now. */
export function callEligibility(input: FollowUpInput): CallEligibilityView {
  const d = decideFollowUp(input);
  const v = voiceFacts(input);
  const now = input.appTime.now;
  const overdue = input.invoice.amountRemainingMinor > 0 && now >= input.invoice.dueAt && input.invoice.stripeStatus === "open";
  const promise = currentPromise(input.promises, now);
  const dispute = input.disputes.find((x) => x.status === "open");
  const checks: CallEligibilityView["checks"] = [
    { label: "Overdue with positive balance", passed: overdue, detail: `${formatMoney(input.invoice.amountRemainingMinor, input.invoice.currency)} remaining` },
    { label: "Reminder delivery confirmed", passed: !!v.lastDeliveredReminder, detail: v.lastDeliveredReminder ? `Reminder #${v.lastDeliveredReminder.sequence} delivered` : "No confirmed delivery" },
    { label: `${input.policy.voiceEscalationAfterHours}h response window elapsed`, passed: !!v.windowClosesAt && now >= v.windowClosesAt, detail: v.windowClosesAt ? `Closes ${v.windowClosesAt}` : "Not started" },
    { label: "No inbound response since reminder", passed: !v.responseAfterReminder, detail: v.responseAfterReminder ? "Customer responded" : "None received" },
    { label: "No active promise or dispute", passed: !promise && !dispute, detail: dispute ? "Dispute open" : promise ? `Promise to pay ${promise.promisedDate}` : "None" },
    { label: "Voice attempts remaining", passed: v.voiceAttemptsUsed < input.policy.maxVoiceAttemptsPerInvoice, detail: `${v.voiceAttemptsUsed} of ${input.policy.maxVoiceAttemptsPerInvoice} used` },
    { label: "Destination on demo allowlist", passed: v.phoneAllowlisted, detail: v.phoneAllowlisted ? "Allowlisted number" : "No allowlisted number" },
  ];
  return { eligible: d.action === "call", decisionCode: d.decisionCode, reason: d.reason, windowClosesAt: v.windowClosesAt, checks };
}
