/**
 * Ordered SQL migrations (A0-03). Append only: never edit an applied migration.
 * Money columns are INTEGER minor units; timestamps are ISO-8601 UTC TEXT; arrays/objects are JSON TEXT.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  match_keys TEXT NOT NULL DEFAULT '[]',
  stripe_customer_id TEXT,
  contact_emails TEXT NOT NULL DEFAULT '[]',
  allowed_phone_numbers TEXT NOT NULL DEFAULT '[]',
  UNIQUE (organisation_id, stripe_customer_id)
);

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  reference TEXT NOT NULL,
  title TEXT NOT NULL,
  source_ref TEXT NOT NULL
);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  reference TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (currency = 'gbp'),
  source_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','completed','billed')),
  UNIQUE (organisation_id, customer_id, reference)
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  invoice_id TEXT,
  received_at TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organisation_id, source_type, external_event_id)
);

CREATE TABLE billing_runs (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  billing_key TEXT,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  primary_evidence_id TEXT NOT NULL REFERENCES evidence(id),
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('received','evaluating','review_required','ignored','creating_invoice','invoiced','failed_retryable','failed')),
  decision_code TEXT,
  customer_id TEXT,
  milestone_id TEXT,
  invoice_id TEXT,
  stripe_invoice_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organisation_id, primary_evidence_id)
);
-- At most one run may own a billing key once it proceeds to invoicing.
CREATE UNIQUE INDEX billing_runs_claimed_key
  ON billing_runs (organisation_id, billing_key)
  WHERE billing_key IS NOT NULL AND state IN ('creating_invoice','invoiced','failed_retryable');

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  milestone_id TEXT NOT NULL REFERENCES milestones(id),
  billing_run_id TEXT NOT NULL REFERENCES billing_runs(id),
  billing_key TEXT NOT NULL,
  stripe_invoice_id TEXT NOT NULL,
  stripe_invoice_number TEXT,
  currency TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  amount_paid_minor INTEGER NOT NULL CHECK (amount_paid_minor >= 0),
  amount_remaining_minor INTEGER NOT NULL CHECK (amount_remaining_minor >= 0),
  stripe_status TEXT NOT NULL CHECK (stripe_status IN ('draft','open','paid','uncollectible','void')),
  due_at TEXT NOT NULL,
  hosted_invoice_url TEXT,
  lines TEXT NOT NULL DEFAULT '[]',
  last_refreshed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (stripe_invoice_id),
  UNIQUE (organisation_id, billing_key)
);

CREATE TABLE payment_promises (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  customer_id TEXT NOT NULL,
  promised_date TEXT NOT NULL,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  quote TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','superseded','fulfilled','broken')),
  superseded_by_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (organisation_id, evidence_id, invoice_id)
);

CREATE TABLE disputes (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  customer_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  summary TEXT NOT NULL,
  quote TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL,
  UNIQUE (organisation_id, evidence_id, invoice_id)
);

CREATE TABLE collection_actions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  customer_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reminder_email','voice_call','plan_offer')),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  due_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','reserved','sent','cancelled','failed','unknown')),
  decision_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  external_receipt_id TEXT,
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('not_applicable','pending','delivered','failed','unknown')),
  delivered_at TEXT,
  cancelled_reason TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (invoice_id, kind, sequence)
);
CREATE INDEX collection_actions_due ON collection_actions (state, due_at);
CREATE UNIQUE INDEX collection_actions_receipt ON collection_actions (kind, external_receipt_id) WHERE external_receipt_id IS NOT NULL;

CREATE TABLE voice_attempts (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  action_id TEXT NOT NULL UNIQUE REFERENCES collection_actions(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  customer_id TEXT NOT NULL,
  provider_conversation_id TEXT UNIQUE,
  call_sid TEXT,
  dispatch_state TEXT NOT NULL CHECK (dispatch_state IN ('reserved','accepted','failed','unknown')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('promise','dispute','claimed_payment','no_answer','failed','needs_review')),
  transcript_ref TEXT,
  summary TEXT,
  promised_date TEXT,
  initiated_at TEXT,
  completed_at TEXT
);

CREATE TABLE review_items (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','resolved')),
  decision_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  customer_id TEXT,
  invoice_id TEXT,
  billing_run_id TEXT,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  action TEXT NOT NULL,
  decision_code TEXT NOT NULL,
  result TEXT NOT NULL,
  customer_id TEXT,
  invoice_id TEXT,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  policy_version TEXT NOT NULL,
  calculation TEXT,
  explanation TEXT NOT NULL,
  external_ids TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  app_time TEXT NOT NULL,
  simulated_time INTEGER NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX audit_by_invoice ON audit_entries (organisation_id, invoice_id, seq);
CREATE INDEX audit_by_correlation ON audit_entries (correlation_id, seq);

-- Provider webhook/callback deduplication (stripe, elevenlabs, email).
CREATE TABLE processed_webhooks (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);

-- Key/value runtime settings (demo clock offset).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  {
    id: 2,
    name: "billing_run_decision",
    // Persist the validated billing decision so a crashed run resumes Stripe creation
    // without re-asking the LLM (which could answer differently).
    sql: `ALTER TABLE billing_runs ADD COLUMN decision TEXT;`,
  },
  {
    id: 3,
    name: "evidence_app_time",
    // Application-clock time at which the system recorded the evidence. Collections decisions compare
    // replies with reminder delivery on the app clock, so a reply after the demo clock moved counts.
    sql: `ALTER TABLE evidence ADD COLUMN received_app_at TEXT;`,
  },
];
