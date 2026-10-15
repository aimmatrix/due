/**
 * Idempotent synthetic seed (A0-03/A0-04). Destinations come from the demo allowlists in env so
 * no real contact details are committed.
 */
import { SEED_CONTRACTS, SEED_CUSTOMERS, SEED_MILESTONES } from "@/contracts";
import type { Db } from "./connection";

export interface SeedOptions {
  /** Team-controlled reminder destination(s) for Acme. */
  emails?: string[];
  /** Consenting, allowlisted teammate number(s) in E.164 for Acme. */
  phones?: string[];
}

export function seedDemoData(db: Db, opts: SeedOptions = {}): { customers: number; contracts: number; milestones: number } {
  const tx = db.transaction(() => {
    const cust = db.prepare(
      `INSERT INTO customers (id, organisation_id, display_name, match_keys, stripe_customer_id, contact_emails, allowed_phone_numbers)
       VALUES (@id, @organisationId, @displayName, @matchKeys, NULL, @contactEmails, @allowedPhoneNumbers)
       ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, match_keys = excluded.match_keys,
         contact_emails = CASE WHEN @replaceEmails = 1 THEN excluded.contact_emails ELSE customers.contact_emails END,
         allowed_phone_numbers = CASE WHEN @replacePhones = 1 THEN excluded.allowed_phone_numbers ELSE customers.allowed_phone_numbers END`,
    );
    for (const c of SEED_CUSTOMERS) {
      const isAcme = c.id === "cus_acme";
      cust.run({
        id: c.id,
        organisationId: c.organisationId,
        displayName: c.displayName,
        matchKeys: JSON.stringify(c.matchKeys),
        contactEmails: JSON.stringify(isAcme ? (opts.emails ?? []) : []),
        allowedPhoneNumbers: JSON.stringify(isAcme ? (opts.phones ?? []) : []),
        // Re-seeding without destinations keeps the ones already configured.
        replaceEmails: isAcme && opts.emails?.length ? 1 : 0,
        replacePhones: isAcme && opts.phones?.length ? 1 : 0,
      });
    }
    const ctr = db.prepare(
      `INSERT INTO contracts (id, organisation_id, customer_id, reference, title, source_ref)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    );
    for (const c of SEED_CONTRACTS) ctr.run(c.id, c.organisationId, c.customerId, c.reference, c.title, JSON.stringify(c.sourceRef));
    const ms = db.prepare(
      `INSERT INTO milestones (id, organisation_id, customer_id, contract_id, reference, title, description, amount_minor, currency, source_ref, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    );
    for (const m of SEED_MILESTONES) {
      ms.run(m.id, m.organisationId, m.customerId, m.contractId, m.reference, m.title, m.description, m.amountMinor, m.currency, JSON.stringify(m.sourceRef), m.state);
    }
  });
  tx();
  return { customers: SEED_CUSTOMERS.length, contracts: SEED_CONTRACTS.length, milestones: SEED_MILESTONES.length };
}
