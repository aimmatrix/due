/**
 * Repository interfaces + SQLite implementation (A0-03). A0-owned.
 * Domain lanes never import this; orchestration loads records here and passes them as arguments.
 * Every query is scoped by organisationId to prevent context mixing.
 */
import { randomUUID } from "node:crypto";
import type {
  AuditEntry,
  BillingRun,
  BillingRunState,
  CollectionAction,
  CollectionActionState,
  Contract,
  Customer,
  Dispute,
  DisputeStatus,
  Evidence,
  Invoice,
  Milestone,
  MilestoneState,
  OrganisationId,
  PaymentPromise,
  PromiseStatus,
  InboundResponse,
  ReviewItem,
  SafeError,
  StripeInvoiceSnapshot,
  VoiceAttempt,
} from "@/contracts";
import type { Db } from "./connection";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const nowIso = () => new Date().toISOString();
const j = (v: unknown) => JSON.stringify(v);
const pj = <T>(v: unknown, fallback: T): T => (typeof v === "string" ? (JSON.parse(v) as T) : fallback);

type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const n = (v: unknown) => v as number;

// ───────────────────────────── Row mappers ─────────────────────────────

const toCustomer = (r: Row): Customer => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  displayName: s(r.display_name),
  matchKeys: pj(r.match_keys, []),
  stripeCustomerId: sn(r.stripe_customer_id),
  contactEmails: pj(r.contact_emails, []),
  allowedPhoneNumbers: pj(r.allowed_phone_numbers, []),
});

const toContract = (r: Row): Contract => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  customerId: s(r.customer_id),
  reference: s(r.reference),
  title: s(r.title),
  sourceRef: pj(r.source_ref, { kind: "contract", id: s(r.id) }),
});

const toMilestone = (r: Row): Milestone => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  customerId: s(r.customer_id),
  contractId: s(r.contract_id),
  reference: s(r.reference),
  title: s(r.title),
  description: s(r.description),
  amountMinor: n(r.amount_minor),
  currency: "gbp",
  sourceRef: pj(r.source_ref, { kind: "milestone", id: s(r.id) }),
  state: s(r.state) as MilestoneState,
});

const toEvidence = (r: Row): Evidence => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  externalEventId: s(r.external_event_id),
  sourceType: s(r.source_type) as Evidence["sourceType"],
  sourceRef: s(r.source_ref),
  customerRef: s(r.customer_ref),
  customerId: sn(r.customer_id),
  receivedAt: s(r.received_at),
  text: s(r.text),
  invoiceId: sn(r.invoice_id),
});

const toRun = (r: Row): BillingRun => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  correlationId: s(r.correlation_id),
  billingKey: sn(r.billing_key),
  evidenceIds: pj(r.evidence_ids, []),
  policyVersion: s(r.policy_version),
  state: s(r.state) as BillingRunState,
  decisionCode: sn(r.decision_code),
  customerId: sn(r.customer_id),
  milestoneId: sn(r.milestone_id),
  invoiceId: sn(r.invoice_id),
  stripeInvoiceId: sn(r.stripe_invoice_id),
  attempts: n(r.attempts),
  lastError: pj<SafeError | null>(r.last_error, null),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const toInvoice = (r: Row): Invoice => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  customerId: s(r.customer_id),
  milestoneId: s(r.milestone_id),
  billingRunId: s(r.billing_run_id),
  stripeInvoiceId: s(r.stripe_invoice_id),
  stripeInvoiceNumber: sn(r.stripe_invoice_number),
  currency: "gbp",
  totalMinor: n(r.total_minor),
  amountPaidMinor: n(r.amount_paid_minor),
  amountRemainingMinor: n(r.amount_remaining_minor),
  stripeStatus: s(r.stripe_status) as Invoice["stripeStatus"],
  dueAt: s(r.due_at),
  hostedInvoiceUrl: sn(r.hosted_invoice_url),
  lines: pj(r.lines, []),
  lastRefreshedAt: s(r.last_refreshed_at),
  createdAt: s(r.created_at),
});

const toPromise = (r: Row): PaymentPromise => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  invoiceId: s(r.invoice_id),
  customerId: s(r.customer_id),
  promisedDate: s(r.promised_date),
  evidenceId: s(r.evidence_id),
  quote: s(r.quote),
  status: s(r.status) as PromiseStatus,
  supersededById: sn(r.superseded_by_id),
  createdAt: s(r.created_at),
});

const toDispute = (r: Row): Dispute => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  invoiceId: s(r.invoice_id),
  customerId: s(r.customer_id),
  evidenceId: s(r.evidence_id),
  summary: s(r.summary),
  quote: s(r.quote),
  status: s(r.status) as DisputeStatus,
  createdAt: s(r.created_at),
});

const toAction = (r: Row): CollectionAction => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  invoiceId: s(r.invoice_id),
  customerId: s(r.customer_id),
  correlationId: s(r.correlation_id),
  kind: s(r.kind) as CollectionAction["kind"],
  sequence: n(r.sequence),
  dueAt: s(r.due_at),
  state: s(r.state) as CollectionActionState,
  decisionCode: s(r.decision_code),
  reason: s(r.reason),
  evidenceIds: pj(r.evidence_ids, []),
  externalReceiptId: sn(r.external_receipt_id),
  deliveryState: s(r.delivery_state) as CollectionAction["deliveryState"],
  deliveredAt: sn(r.delivered_at),
  cancelledReason: sn(r.cancelled_reason),
  lastError: pj<SafeError | null>(r.last_error, null),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const toVoice = (r: Row): VoiceAttempt => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  actionId: s(r.action_id),
  invoiceId: s(r.invoice_id),
  customerId: s(r.customer_id),
  providerConversationId: sn(r.provider_conversation_id),
  callSid: sn(r.call_sid),
  dispatchState: s(r.dispatch_state) as VoiceAttempt["dispatchState"],
  outcome: sn(r.outcome) as VoiceAttempt["outcome"],
  transcriptRef: sn(r.transcript_ref),
  summary: sn(r.summary),
  promisedDate: sn(r.promised_date),
  initiatedAt: sn(r.initiated_at),
  completedAt: sn(r.completed_at),
});

const toReview = (r: Row): ReviewItem => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  kind: s(r.kind) as ReviewItem["kind"],
  status: s(r.status) as ReviewItem["status"],
  decisionCode: s(r.decision_code),
  reason: s(r.reason),
  customerId: sn(r.customer_id),
  invoiceId: sn(r.invoice_id),
  billingRunId: sn(r.billing_run_id),
  evidenceIds: pj(r.evidence_ids, []),
  createdAt: s(r.created_at),
});

const toAudit = (r: Row): AuditEntry => ({
  id: s(r.id),
  organisationId: s(r.organisation_id),
  correlationId: s(r.correlation_id),
  action: s(r.action),
  decisionCode: s(r.decision_code),
  result: s(r.result) as AuditEntry["result"],
  customerId: sn(r.customer_id),
  invoiceId: sn(r.invoice_id),
  evidenceIds: pj(r.evidence_ids, []),
  policyVersion: s(r.policy_version),
  calculation: pj(r.calculation, null),
  explanation: s(r.explanation),
  externalIds: pj(r.external_ids, {}),
  occurredAt: s(r.occurred_at),
  appTime: s(r.app_time),
  simulatedTime: n(r.simulated_time) === 1,
});

// ───────────────────────────── Interfaces ─────────────────────────────

type Org = OrganisationId;

export interface InsertEvidence extends Omit<Evidence, "id"> {
  /** Application-clock time of recording (defaults to receivedAt). */
  receivedAppAt?: string;
}

export type ClaimResult = { ok: true } | { ok: false; existingRunId: string | null };

/** Paid state must never regress; a stale snapshot cannot overwrite a newer terminal state. */
export interface UpsertInvoiceInput {
  organisationId: Org;
  customerId: string;
  milestoneId: string;
  billingRunId: string;
  billingKey: string;
  lines: Invoice["lines"];
  snapshot: StripeInvoiceSnapshot;
}

export type NewCollectionAction = Omit<CollectionAction, "id" | "createdAt" | "updatedAt"> & { id?: string };

export interface Repositories {
  db: Db;
  transaction<T>(fn: () => T): T;

  customers: {
    list(org: Org): Customer[];
    get(org: Org, id: string): Customer | null;
    setStripeCustomerId(org: Org, id: string, stripeCustomerId: string): void;
  };
  contracts: { list(org: Org): Contract[] };
  milestones: {
    list(org: Org): Milestone[];
    get(org: Org, id: string): Milestone | null;
    setState(org: Org, id: string, state: MilestoneState): void;
  };
  evidence: {
    /** Idempotent on (organisation, sourceType, externalEventId). */
    insertOrGet(input: InsertEvidence): { evidence: Evidence; created: boolean };
    get(org: Org, id: string): Evidence | null;
    listByIds(org: Org, ids: string[]): Evidence[];
    /** Inbound customer responses (customer_message/email/call_outcome) for an invoice received after `afterIso`. */
    listInboundForInvoice(org: Org, invoiceId: string, afterIso?: string): Evidence[];
    /** Inbound responses for collections decisions, timestamped on the APPLICATION clock. */
    listInboundResponses(org: Org, invoiceId: string): InboundResponse[];
  };
  billingRuns: {
    /** Idempotent on primary evidence: re-delivery returns the original run. */
    createOrGet(input: { organisationId: Org; correlationId: string; primaryEvidenceId: string; policyVersion: string }): { run: BillingRun; created: boolean };
    get(org: Org, id: string): BillingRun | null;
    update(org: Org, id: string, patch: Partial<Omit<BillingRun, "id" | "organisationId" | "createdAt">>): BillingRun;
    /**
     * Atomically move a run to creating_invoice and claim its billing key. Fails if another run
     * already owns the key (duplicate milestone) — the caller must not call Stripe in that case.
     */
    claimBillingKey(org: Org, id: string, patch: { billingKey: string; customerId: string; milestoneId: string; decisionCode: string }): ClaimResult;
    findByBillingKey(org: Org, billingKey: string): BillingRun | null;
    listRecent(org: Org, limit: number): BillingRun[];
    listRetryable(org: Org): BillingRun[];
    /** Validated decision stored with the run (DB-only column) for crash-safe resume. */
    saveDecision(org: Org, id: string, decision: unknown): void;
    getDecision<T>(org: Org, id: string): T | null;
  };
  invoices: {
    upsertFromSnapshot(input: UpsertInvoiceInput): { invoice: Invoice; changed: boolean };
    /** Apply a fresh snapshot to an existing invoice (refresh/webhook). Never regresses paid → unpaid. */
    applySnapshot(org: Org, snapshot: StripeInvoiceSnapshot): { invoice: Invoice; changed: boolean } | null;
    get(org: Org, id: string): Invoice | null;
    getByStripeId(org: Org, stripeInvoiceId: string): Invoice | null;
    getByBillingKey(org: Org, billingKey: string): Invoice | null;
    list(org: Org): Invoice[];
  };
  promises: {
    /** Inserts a new active promise and supersedes previous active promises on the invoice. */
    record(input: Omit<PaymentPromise, "id" | "status" | "supersededById" | "createdAt">): PaymentPromise;
    listByInvoice(org: Org, invoiceId: string): PaymentPromise[];
    setStatus(org: Org, id: string, status: PromiseStatus): void;
  };
  disputes: {
    record(input: Omit<Dispute, "id" | "status" | "createdAt">): Dispute;
    listByInvoice(org: Org, invoiceId: string): Dispute[];
    resolve(org: Org, id: string): void;
  };
  actions: {
    /** Unique on (invoice, kind, sequence): returns the existing action instead of a duplicate. */
    insertOrGet(input: NewCollectionAction): { action: CollectionAction; created: boolean };
    get(org: Org, id: string): CollectionAction | null;
    listByInvoice(org: Org, invoiceId: string): CollectionAction[];
    listDue(org: Org, appNowIso: string): CollectionAction[];
    /** Compare-and-set state transition. Returns null if the action was not in one of `from`. */
    transition(
      org: Org,
      id: string,
      from: CollectionActionState[],
      to: CollectionActionState,
      patch?: Partial<Pick<CollectionAction, "externalReceiptId" | "deliveryState" | "deliveredAt" | "cancelledReason" | "lastError" | "reason" | "decisionCode">>,
    ): CollectionAction | null;
    /** Cancel every queued (not yet reserved) action for an invoice. Returns cancelled IDs. */
    cancelQueued(org: Org, invoiceId: string, reason: string, kinds?: CollectionAction["kind"][]): string[];
    findByReceipt(org: Org, kind: CollectionAction["kind"], externalReceiptId: string): CollectionAction | null;
    markDelivery(org: Org, id: string, state: "delivered" | "failed", at: string): CollectionAction | null;
  };
  voice: {
    insert(input: Omit<VoiceAttempt, "id">): VoiceAttempt;
    getByAction(org: Org, actionId: string): VoiceAttempt | null;
    getByConversation(org: Org, providerConversationId: string): VoiceAttempt | null;
    listByInvoice(org: Org, invoiceId: string): VoiceAttempt[];
    update(org: Org, id: string, patch: Partial<Omit<VoiceAttempt, "id" | "organisationId" | "actionId">>): VoiceAttempt;
  };
  reviews: {
    open(input: Omit<ReviewItem, "id" | "status" | "createdAt">): ReviewItem;
    listOpen(org: Org): ReviewItem[];
    resolve(org: Org, id: string): void;
  };
  audit: {
    append(entry: Omit<AuditEntry, "id" | "occurredAt"> & { occurredAt?: string }): AuditEntry;
    listByInvoice(org: Org, invoiceId: string): AuditEntry[];
    listByCorrelation(correlationId: string): AuditEntry[];
  };
  webhooks: {
    /** True the first time (provider, eventId) is seen; false for duplicates. */
    markProcessed(provider: string, eventId: string): boolean;
    /** Undo a mark when processing failed so the provider retry is not swallowed. */
    unmark(provider: string, eventId: string): void;
  };
  settings: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
}

// ───────────────────────────── SQLite implementation ─────────────────────────────

const PAID_LIKE = new Set(["paid", "void", "uncollectible"]);

export function createRepositories(db: Db): Repositories {
  const one = (sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as Row | undefined;
  const all = (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as Row[];
  const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params);

  const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/.test(e.message);

  const repos: Repositories = {
    db,
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),

    customers: {
      list: (org) => all("SELECT * FROM customers WHERE organisation_id = ? ORDER BY id", org).map(toCustomer),
      get: (org, id) => {
        const r = one("SELECT * FROM customers WHERE organisation_id = ? AND id = ?", org, id);
        return r ? toCustomer(r) : null;
      },
      setStripeCustomerId: (org, id, stripeCustomerId) => {
        run("UPDATE customers SET stripe_customer_id = ? WHERE organisation_id = ? AND id = ?", stripeCustomerId, org, id);
      },
    },

    contracts: {
      list: (org) => all("SELECT * FROM contracts WHERE organisation_id = ? ORDER BY id", org).map(toContract),
    },

    milestones: {
      list: (org) => all("SELECT * FROM milestones WHERE organisation_id = ? ORDER BY id", org).map(toMilestone),
      get: (org, id) => {
        const r = one("SELECT * FROM milestones WHERE organisation_id = ? AND id = ?", org, id);
        return r ? toMilestone(r) : null;
      },
      setState: (org, id, state) => {
        run("UPDATE milestones SET state = ? WHERE organisation_id = ? AND id = ?", state, org, id);
      },
    },

    evidence: {
      insertOrGet: (input) => {
        const id = newId("ev");
        const res = run(
          `INSERT INTO evidence (id, organisation_id, external_event_id, source_type, source_ref, customer_ref, customer_id, invoice_id, received_at, text, created_at, received_app_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (organisation_id, source_type, external_event_id) DO NOTHING`,
          id, input.organisationId, input.externalEventId, input.sourceType, input.sourceRef, input.customerRef,
          input.customerId, input.invoiceId, input.receivedAt, input.text, nowIso(), input.receivedAppAt ?? input.receivedAt,
        );
        const r = one(
          "SELECT * FROM evidence WHERE organisation_id = ? AND source_type = ? AND external_event_id = ?",
          input.organisationId, input.sourceType, input.externalEventId,
        )!;
        return { evidence: toEvidence(r), created: res.changes === 1 };
      },
      get: (org, id) => {
        const r = one("SELECT * FROM evidence WHERE organisation_id = ? AND id = ?", org, id);
        return r ? toEvidence(r) : null;
      },
      listByIds: (org, ids) => {
        if (ids.length === 0) return [];
        const marks = ids.map(() => "?").join(",");
        return all(`SELECT * FROM evidence WHERE organisation_id = ? AND id IN (${marks}) ORDER BY received_at`, org, ...ids).map(toEvidence);
      },
      listInboundForInvoice: (org, invoiceId, afterIso) =>
        all(
          `SELECT * FROM evidence WHERE organisation_id = ? AND invoice_id = ?
             AND source_type IN ('customer_message','email','call_outcome')
             AND (? IS NULL OR received_at > ?) ORDER BY received_at`,
          org, invoiceId, afterIso ?? null, afterIso ?? null,
        ).map(toEvidence),
      listInboundResponses: (org, invoiceId) =>
        all(
          `SELECT id, source_type, COALESCE(received_app_at, received_at) AS at FROM evidence
           WHERE organisation_id = ? AND invoice_id = ? AND source_type IN ('customer_message','email','call_outcome') ORDER BY at`,
          org, invoiceId,
        ).map((r) => ({ evidenceId: s(r.id), receivedAt: s(r.at), sourceType: s(r.source_type) as InboundResponse["sourceType"] })),
    },

    billingRuns: {
      createOrGet: (input) => {
        const t = nowIso();
        const res = run(
          `INSERT INTO billing_runs (id, organisation_id, correlation_id, evidence_ids, primary_evidence_id, policy_version, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?)
           ON CONFLICT (organisation_id, primary_evidence_id) DO NOTHING`,
          newId("run"), input.organisationId, input.correlationId, j([input.primaryEvidenceId]), input.primaryEvidenceId,
          input.policyVersion, t, t,
        );
        const r = one("SELECT * FROM billing_runs WHERE organisation_id = ? AND primary_evidence_id = ?", input.organisationId, input.primaryEvidenceId)!;
        return { run: toRun(r), created: res.changes === 1 };
      },
      get: (org, id) => {
        const r = one("SELECT * FROM billing_runs WHERE organisation_id = ? AND id = ?", org, id);
        return r ? toRun(r) : null;
      },
      update: (org, id, patch) => {
        const cols: Record<string, unknown> = {
          correlation_id: patch.correlationId,
          billing_key: patch.billingKey,
          evidence_ids: patch.evidenceIds && j(patch.evidenceIds),
          policy_version: patch.policyVersion,
          state: patch.state,
          decision_code: patch.decisionCode,
          customer_id: patch.customerId,
          milestone_id: patch.milestoneId,
          invoice_id: patch.invoiceId,
          stripe_invoice_id: patch.stripeInvoiceId,
          attempts: patch.attempts,
          last_error: patch.lastError === undefined ? undefined : patch.lastError === null ? null : j(patch.lastError),
        };
        const sets: string[] = [];
        const vals: unknown[] = [];
        for (const [k, v] of Object.entries(cols)) {
          if (v === undefined) continue;
          sets.push(`${k} = ?`);
          vals.push(v);
        }
        sets.push("updated_at = ?");
        vals.push(nowIso());
        run(`UPDATE billing_runs SET ${sets.join(", ")} WHERE organisation_id = ? AND id = ?`, ...vals, org, id);
        return repos.billingRuns.get(org, id)!;
      },
      claimBillingKey: (org, id, patch) => {
        try {
          const res = run(
            `UPDATE billing_runs SET billing_key = ?, customer_id = ?, milestone_id = ?, decision_code = ?, state = 'creating_invoice', updated_at = ?
             WHERE organisation_id = ? AND id = ? AND state IN ('received','evaluating','failed_retryable')`,
            patch.billingKey, patch.customerId, patch.milestoneId, patch.decisionCode, nowIso(), org, id,
          );
          if (res.changes === 1) return { ok: true };
          const self = repos.billingRuns.get(org, id);
          if (self?.billingKey === patch.billingKey && self.state === "creating_invoice") return { ok: true };
          return { ok: false, existingRunId: repos.billingRuns.findByBillingKey(org, patch.billingKey)?.id ?? null };
        } catch (e) {
          if (!isUnique(e)) throw e;
          return { ok: false, existingRunId: repos.billingRuns.findByBillingKey(org, patch.billingKey)?.id ?? null };
        }
      },
      findByBillingKey: (org, billingKey) => {
        const r = one(
          `SELECT * FROM billing_runs WHERE organisation_id = ? AND billing_key = ?
           ORDER BY CASE state WHEN 'invoiced' THEN 0 WHEN 'creating_invoice' THEN 1 WHEN 'failed_retryable' THEN 2 ELSE 3 END, created_at LIMIT 1`,
          org, billingKey,
        );
        return r ? toRun(r) : null;
      },
      listRecent: (org, limit) => all("SELECT * FROM billing_runs WHERE organisation_id = ? ORDER BY created_at DESC LIMIT ?", org, limit).map(toRun),
      listRetryable: (org) =>
        all("SELECT * FROM billing_runs WHERE organisation_id = ? AND state IN ('received','evaluating','creating_invoice','failed_retryable') ORDER BY created_at", org).map(toRun),
      saveDecision: (org, id, decision) => {
        run("UPDATE billing_runs SET decision = ?, updated_at = ? WHERE organisation_id = ? AND id = ?", j(decision), nowIso(), org, id);
      },
      getDecision: <T>(org: Org, id: string): T | null => {
        const r = one("SELECT decision FROM billing_runs WHERE organisation_id = ? AND id = ?", org, id);
        return r ? pj<T | null>(r.decision, null) : null;
      },
    },

    invoices: {
      upsertFromSnapshot: (input) => {
        const existing = repos.invoices.getByStripeId(input.organisationId, input.snapshot.stripeInvoiceId);
        if (existing) return repos.invoices.applySnapshot(input.organisationId, input.snapshot)!;
        const sn = input.snapshot;
        const t = nowIso();
        const id = newId("inv");
        try {
          run(
            `INSERT INTO invoices (id, organisation_id, customer_id, milestone_id, billing_run_id, billing_key, stripe_invoice_id, stripe_invoice_number,
               currency, total_minor, amount_paid_minor, amount_remaining_minor, stripe_status, due_at, hosted_invoice_url, lines, last_refreshed_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id, input.organisationId, input.customerId, input.milestoneId, input.billingRunId, input.billingKey, sn.stripeInvoiceId,
            sn.stripeInvoiceNumber, sn.currency, sn.totalMinor, sn.amountPaidMinor, sn.amountRemainingMinor, sn.status,
            sn.dueAt ?? t, sn.hostedInvoiceUrl, j(input.lines), sn.retrievedAt, t,
          );
        } catch (e) {
          if (!isUnique(e)) throw e;
          const dup = repos.invoices.getByBillingKey(input.organisationId, input.billingKey);
          if (dup && dup.stripeInvoiceId !== sn.stripeInvoiceId) {
            throw new Error(`Billing key ${input.billingKey} already has invoice ${dup.id}; refusing second Stripe invoice`);
          }
          return { invoice: dup!, changed: false };
        }
        return { invoice: repos.invoices.get(input.organisationId, id)!, changed: true };
      },
      applySnapshot: (org, sn) => {
        const cur = repos.invoices.getByStripeId(org, sn.stripeInvoiceId);
        if (!cur) return null;
        // Never regress a terminal state (paid/void/uncollectible) back to open/draft from a stale event.
        if (PAID_LIKE.has(cur.stripeStatus) && !PAID_LIKE.has(sn.status)) {
          return { invoice: cur, changed: false };
        }
        // Never let a stale snapshot increase the remaining balance of a paid-in-part invoice.
        if (cur.stripeStatus === sn.status && sn.amountPaidMinor < cur.amountPaidMinor) {
          return { invoice: cur, changed: false };
        }
        const changed =
          cur.stripeStatus !== sn.status ||
          cur.amountPaidMinor !== sn.amountPaidMinor ||
          cur.amountRemainingMinor !== sn.amountRemainingMinor ||
          cur.stripeInvoiceNumber !== sn.stripeInvoiceNumber ||
          cur.hostedInvoiceUrl !== sn.hostedInvoiceUrl;
        run(
          `UPDATE invoices SET stripe_status = ?, amount_paid_minor = ?, amount_remaining_minor = ?, total_minor = ?,
             stripe_invoice_number = ?, hosted_invoice_url = ?, due_at = COALESCE(?, due_at), last_refreshed_at = ?
           WHERE organisation_id = ? AND id = ?`,
          sn.status, sn.amountPaidMinor, sn.amountRemainingMinor, sn.totalMinor, sn.stripeInvoiceNumber, sn.hostedInvoiceUrl,
          sn.dueAt, sn.retrievedAt, org, cur.id,
        );
        return { invoice: repos.invoices.get(org, cur.id)!, changed };
      },
      get: (org, id) => {
        const r = one("SELECT * FROM invoices WHERE organisation_id = ? AND id = ?", org, id);
        return r ? toInvoice(r) : null;
      },
      getByStripeId: (org, stripeInvoiceId) => {
        const r = one("SELECT * FROM invoices WHERE organisation_id = ? AND stripe_invoice_id = ?", org, stripeInvoiceId);
        return r ? toInvoice(r) : null;
      },
      getByBillingKey: (org, billingKey) => {
        const r = one("SELECT * FROM invoices WHERE organisation_id = ? AND billing_key = ?", org, billingKey);
        return r ? toInvoice(r) : null;
      },
      list: (org) => all("SELECT * FROM invoices WHERE organisation_id = ? ORDER BY created_at DESC", org).map(toInvoice),
    },

    promises: {
      record: (input) =>
        repos.transaction(() => {
          const existing = one(
            "SELECT * FROM payment_promises WHERE organisation_id = ? AND evidence_id = ? AND invoice_id = ?",
            input.organisationId, input.evidenceId, input.invoiceId,
          );
          if (existing) return toPromise(existing);
          const id = newId("prm");
          run(
            "UPDATE payment_promises SET status = 'superseded', superseded_by_id = ? WHERE organisation_id = ? AND invoice_id = ? AND status = 'active'",
            id, input.organisationId, input.invoiceId,
          );
          run(
            `INSERT INTO payment_promises (id, organisation_id, invoice_id, customer_id, promised_date, evidence_id, quote, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
            id, input.organisationId, input.invoiceId, input.customerId, input.promisedDate, input.evidenceId, input.quote, nowIso(),
          );
          return toPromise(one("SELECT * FROM payment_promises WHERE id = ?", id)!);
        }),
      listByInvoice: (org, invoiceId) =>
        all("SELECT * FROM payment_promises WHERE organisation_id = ? AND invoice_id = ? ORDER BY created_at", org, invoiceId).map(toPromise),
      setStatus: (org, id, status) => {
        run("UPDATE payment_promises SET status = ? WHERE organisation_id = ? AND id = ?", status, org, id);
      },
    },

    disputes: {
      record: (input) => {
        const id = newId("dsp");
        run(
          `INSERT INTO disputes (id, organisation_id, invoice_id, customer_id, evidence_id, summary, quote, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
           ON CONFLICT (organisation_id, evidence_id, invoice_id) DO NOTHING`,
          id, input.organisationId, input.invoiceId, input.customerId, input.evidenceId, input.summary, input.quote, nowIso(),
        );
        return toDispute(
          one("SELECT * FROM disputes WHERE organisation_id = ? AND evidence_id = ? AND invoice_id = ?", input.organisationId, input.evidenceId, input.invoiceId)!,
        );
      },
      listByInvoice: (org, invoiceId) =>
        all("SELECT * FROM disputes WHERE organisation_id = ? AND invoice_id = ? ORDER BY created_at", org, invoiceId).map(toDispute),
      resolve: (org, id) => {
        run("UPDATE disputes SET status = 'resolved' WHERE organisation_id = ? AND id = ?", org, id);
      },
    },

    actions: {
      insertOrGet: (input) => {
        const id = input.id ?? newId("act");
        const t = nowIso();
        const res = run(
          `INSERT INTO collection_actions (id, organisation_id, invoice_id, customer_id, correlation_id, kind, sequence, due_at, state,
             decision_code, reason, evidence_ids, external_receipt_id, delivery_state, delivered_at, cancelled_reason, last_error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (invoice_id, kind, sequence) DO NOTHING`,
          id, input.organisationId, input.invoiceId, input.customerId, input.correlationId, input.kind, input.sequence, input.dueAt,
          input.state, input.decisionCode, input.reason, j(input.evidenceIds), input.externalReceiptId, input.deliveryState,
          input.deliveredAt, input.cancelledReason, input.lastError ? j(input.lastError) : null, t, t,
        );
        const r = one("SELECT * FROM collection_actions WHERE invoice_id = ? AND kind = ? AND sequence = ?", input.invoiceId, input.kind, input.sequence)!;
        return { action: toAction(r), created: res.changes === 1 };
      },
      get: (org, id) => {
        const r = one("SELECT * FROM collection_actions WHERE organisation_id = ? AND id = ?", org, id);
        return r ? toAction(r) : null;
      },
      listByInvoice: (org, invoiceId) =>
        all("SELECT * FROM collection_actions WHERE organisation_id = ? AND invoice_id = ? ORDER BY created_at, sequence", org, invoiceId).map(toAction),
      listDue: (org, appNowIso) =>
        all("SELECT * FROM collection_actions WHERE organisation_id = ? AND state = 'queued' AND due_at <= ? ORDER BY due_at", org, appNowIso).map(toAction),
      transition: (org, id, from, to, patch = {}) => {
        const marks = from.map(() => "?").join(",");
        const sets = ["state = ?", "updated_at = ?"];
        const vals: unknown[] = [to, nowIso()];
        const cols: Record<string, unknown> = {
          external_receipt_id: patch.externalReceiptId,
          delivery_state: patch.deliveryState,
          delivered_at: patch.deliveredAt,
          cancelled_reason: patch.cancelledReason,
          last_error: patch.lastError === undefined ? undefined : patch.lastError === null ? null : j(patch.lastError),
          reason: patch.reason,
          decision_code: patch.decisionCode,
        };
        for (const [k, v] of Object.entries(cols)) {
          if (v === undefined) continue;
          sets.push(`${k} = ?`);
          vals.push(v);
        }
        const res = run(
          `UPDATE collection_actions SET ${sets.join(", ")} WHERE organisation_id = ? AND id = ? AND state IN (${marks})`,
          ...vals, org, id, ...from,
        );
        return res.changes === 1 ? repos.actions.get(org, id) : null;
      },
      cancelQueued: (org, invoiceId, reason, kinds) => {
        const rows = all(
          "SELECT id, kind FROM collection_actions WHERE organisation_id = ? AND invoice_id = ? AND state = 'queued'",
          org, invoiceId,
        ).filter((r) => !kinds || kinds.includes(s(r.kind) as CollectionAction["kind"]));
        const cancelled: string[] = [];
        for (const r of rows) {
          if (repos.actions.transition(org, s(r.id), ["queued"], "cancelled", { cancelledReason: reason })) cancelled.push(s(r.id));
        }
        return cancelled;
      },
      findByReceipt: (org, kind, externalReceiptId) => {
        const r = one("SELECT * FROM collection_actions WHERE organisation_id = ? AND kind = ? AND external_receipt_id = ?", org, kind, externalReceiptId);
        return r ? toAction(r) : null;
      },
      markDelivery: (org, id, state, at) => {
        // Delivery can only be confirmed once and never flips delivered → failed.
        const res = run(
          `UPDATE collection_actions SET delivery_state = ?, delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END, updated_at = ?
           WHERE organisation_id = ? AND id = ? AND delivery_state IN ('pending','unknown')`,
          state, state, at, nowIso(), org, id,
        );
        return res.changes === 1 ? repos.actions.get(org, id) : null;
      },
    },

    voice: {
      insert: (input) => {
        const id = newId("va");
        run(
          `INSERT INTO voice_attempts (id, organisation_id, action_id, invoice_id, customer_id, provider_conversation_id, call_sid, dispatch_state,
             outcome, transcript_ref, summary, promised_date, initiated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, input.organisationId, input.actionId, input.invoiceId, input.customerId, input.providerConversationId, input.callSid,
          input.dispatchState, input.outcome, input.transcriptRef, input.summary, input.promisedDate, input.initiatedAt, input.completedAt,
        );
        return toVoice(one("SELECT * FROM voice_attempts WHERE id = ?", id)!);
      },
      getByAction: (org, actionId) => {
        const r = one("SELECT * FROM voice_attempts WHERE organisation_id = ? AND action_id = ?", org, actionId);
        return r ? toVoice(r) : null;
      },
      getByConversation: (org, conv) => {
        const r = one("SELECT * FROM voice_attempts WHERE organisation_id = ? AND provider_conversation_id = ?", org, conv);
        return r ? toVoice(r) : null;
      },
      listByInvoice: (org, invoiceId) =>
        all("SELECT * FROM voice_attempts WHERE organisation_id = ? AND invoice_id = ? ORDER BY initiated_at", org, invoiceId).map(toVoice),
      update: (org, id, patch) => {
        const cols: Record<string, unknown> = {
          invoice_id: patch.invoiceId,
          customer_id: patch.customerId,
          provider_conversation_id: patch.providerConversationId,
          call_sid: patch.callSid,
          dispatch_state: patch.dispatchState,
          outcome: patch.outcome,
          transcript_ref: patch.transcriptRef,
          summary: patch.summary,
          promised_date: patch.promisedDate,
          initiated_at: patch.initiatedAt,
          completed_at: patch.completedAt,
        };
        const sets: string[] = [];
        const vals: unknown[] = [];
        for (const [k, v] of Object.entries(cols)) {
          if (v === undefined) continue;
          sets.push(`${k} = ?`);
          vals.push(v);
        }
        if (sets.length) run(`UPDATE voice_attempts SET ${sets.join(", ")} WHERE organisation_id = ? AND id = ?`, ...vals, org, id);
        return toVoice(one("SELECT * FROM voice_attempts WHERE organisation_id = ? AND id = ?", org, id)!);
      },
    },

    reviews: {
      open: (input) => {
        const id = newId("rev");
        run(
          `INSERT INTO review_items (id, organisation_id, kind, status, decision_code, reason, customer_id, invoice_id, billing_run_id, evidence_ids, created_at)
           VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
          id, input.organisationId, input.kind, input.decisionCode, input.reason, input.customerId, input.invoiceId, input.billingRunId,
          j(input.evidenceIds), nowIso(),
        );
        return toReview(one("SELECT * FROM review_items WHERE id = ?", id)!);
      },
      listOpen: (org) => all("SELECT * FROM review_items WHERE organisation_id = ? AND status = 'open' ORDER BY created_at DESC", org).map(toReview),
      resolve: (org, id) => {
        run("UPDATE review_items SET status = 'resolved' WHERE organisation_id = ? AND id = ?", org, id);
      },
    },

    audit: {
      append: (entry) => {
        const id = newId("aud");
        const seq = n((one("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM audit_entries") as Row).next);
        run(
          `INSERT INTO audit_entries (id, organisation_id, correlation_id, action, decision_code, result, customer_id, invoice_id, evidence_ids,
             policy_version, calculation, explanation, external_ids, occurred_at, app_time, simulated_time, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, entry.organisationId, entry.correlationId, entry.action, entry.decisionCode, entry.result, entry.customerId, entry.invoiceId,
          j(entry.evidenceIds), entry.policyVersion, entry.calculation ? j(entry.calculation) : null, entry.explanation, j(entry.externalIds),
          entry.occurredAt ?? nowIso(), entry.appTime, entry.simulatedTime ? 1 : 0, seq,
        );
        return toAudit(one("SELECT * FROM audit_entries WHERE id = ?", id)!);
      },
      listByInvoice: (org, invoiceId) =>
        all("SELECT * FROM audit_entries WHERE organisation_id = ? AND invoice_id = ? ORDER BY seq", org, invoiceId).map(toAudit),
      listByCorrelation: (correlationId) => all("SELECT * FROM audit_entries WHERE correlation_id = ? ORDER BY seq", correlationId).map(toAudit),
    },

    webhooks: {
      markProcessed: (provider, eventId) =>
        run("INSERT INTO processed_webhooks (provider, event_id, received_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", provider, eventId, nowIso()).changes === 1,
      unmark: (provider, eventId) => {
        run("DELETE FROM processed_webhooks WHERE provider = ? AND event_id = ?", provider, eventId);
      },
    },

    settings: {
      get: (key) => {
        const r = one("SELECT value FROM app_settings WHERE key = ?", key);
        return r ? s(r.value) : null;
      },
      set: (key, value) => {
        run("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
      },
    },
  };
  return repos;
}
