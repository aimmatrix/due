/**
 * Synthetic seed data (no real customers). FROZEN at the A0-02 contract checkpoint.
 * Lanes may import these in tests and fixtures. A0's seed script writes them to the database.
 */
import { DEMO_ORGANISATION_ID } from "./common";
import type { Contract, Customer, Milestone } from "./domain";

export const SEED_CUSTOMERS: Customer[] = [
  {
    id: "cus_acme",
    organisationId: DEMO_ORGANISATION_ID,
    displayName: "Acme Ltd",
    matchKeys: ["acme", "acme ltd", "acme.example"],
    stripeCustomerId: null,
    contactEmails: [],
    allowedPhoneNumbers: [],
  },
  {
    id: "cus_globex",
    organisationId: DEMO_ORGANISATION_ID,
    displayName: "Globex Partners",
    matchKeys: ["globex", "globex partners", "globex.example"],
    stripeCustomerId: null,
    contactEmails: [],
    allowedPhoneNumbers: [],
  },
];

export const SEED_CONTRACTS: Contract[] = [
  {
    id: "ctr_acme_web",
    organisationId: DEMO_ORGANISATION_ID,
    customerId: "cus_acme",
    reference: "ACME-SOW-2026-07",
    title: "Acme website migration statement of work",
    sourceRef: { kind: "contract", id: "ctr_acme_web", label: "Acme SOW 2026-07 §4 Milestones" },
  },
  {
    id: "ctr_globex_brand",
    organisationId: DEMO_ORGANISATION_ID,
    customerId: "cus_globex",
    reference: "GLX-SOW-2026-09",
    title: "Globex brand refresh statement of work",
    sourceRef: { kind: "contract", id: "ctr_globex_brand", label: "Globex SOW 2026-09 §3" },
  },
];

export const SEED_MILESTONES: Milestone[] = [
  {
    id: "ms_acme_migration",
    organisationId: DEMO_ORGANISATION_ID,
    customerId: "cus_acme",
    contractId: "ctr_acme_web",
    reference: "M2-website-migration",
    title: "Website migration",
    description: "Migrate the Acme marketing site to the new platform and cut over DNS.",
    amountMinor: 120000,
    currency: "gbp",
    sourceRef: { kind: "milestone", id: "ms_acme_migration", label: "Acme SOW 2026-07 §4.2 — £1,200" },
    state: "pending",
  },
  {
    id: "ms_acme_seo",
    organisationId: DEMO_ORGANISATION_ID,
    customerId: "cus_acme",
    contractId: "ctr_acme_web",
    reference: "M3-seo-audit",
    title: "SEO audit",
    description: "Post-migration SEO audit and redirect report.",
    amountMinor: 45000,
    currency: "gbp",
    sourceRef: { kind: "milestone", id: "ms_acme_seo", label: "Acme SOW 2026-07 §4.3 — £450" },
    state: "pending",
  },
  {
    id: "ms_globex_brand",
    organisationId: DEMO_ORGANISATION_ID,
    customerId: "cus_globex",
    contractId: "ctr_globex_brand",
    reference: "B1-brand-guidelines",
    title: "Brand guidelines",
    description: "Deliver the brand guidelines PDF and asset pack.",
    amountMinor: 250000,
    currency: "gbp",
    sourceRef: { kind: "milestone", id: "ms_globex_brand", label: "Globex SOW 2026-09 §3.1 — £2,500 (over autonomous limit)" },
    state: "pending",
  },
];

/** Canonical demo completion text for the happy path. */
export const DEMO_COMPLETION_TEXT =
  "Hi team — confirming the Acme website migration (M2-website-migration) is complete. DNS cut over at 14:10 and the client signed off on the staging review. Thanks, Priya";
