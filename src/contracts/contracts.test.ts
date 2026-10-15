import { describe, expect, it } from "vitest";
import { FIXTURE_DASHBOARD, FIXTURE_INVOICE_DETAIL } from "./fixtures";
import { DEMO_POLICY, SEED_MILESTONES, billingKeyFor, formatMoney, sumMinor } from "./index";

describe("contract checkpoint", () => {
  it("bills the Acme migration at exactly 120000 GBP minor units", () => {
    const m = SEED_MILESTONES.find((x) => x.id === "ms_acme_migration");
    expect(m?.amountMinor).toBe(120000);
    expect(m?.currency).toBe("gbp");
    expect(formatMoney(120000)).toBe("£1,200.00");
  });

  it("keeps fixture totals internally consistent", () => {
    const inv = FIXTURE_INVOICE_DETAIL.invoice;
    expect(sumMinor(inv.lines.map((l) => l.amountMinor))).toBe(inv.totalMinor);
    expect(FIXTURE_INVOICE_DETAIL.calculation.totalMinor).toBe(inv.totalMinor);
    expect(FIXTURE_DASHBOARD.testMode).toBe(true);
  });

  it("rejects non-integer money", () => {
    expect(() => sumMinor([1.5])).toThrow();
  });

  it("produces deterministic billing keys and a versioned policy", () => {
    expect(billingKeyFor("org_demo", "cus_acme", "ms_acme_migration")).toBe("bill:org_demo:cus_acme:ms_acme_migration");
    expect(DEMO_POLICY.maxAutonomousInvoiceMinor).toBe(200000);
    expect(DEMO_POLICY.version).toMatch(/^demo-policy-/);
  });
});
