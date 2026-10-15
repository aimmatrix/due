import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORGANISATION_ID } from "@/contracts";

const mocks = vi.hoisted(() => ({
  demoMode: vi.fn(), runtime: vi.fn(), billing: vi.fn(), collections: vi.fn(),
}));
vi.mock("@/server/config/env", () => ({ env: { demoMode: mocks.demoMode } }));
vi.mock("@/server/jobs/scheduler-runtime", () => ({ getSchedulerRuntime: mocks.runtime }));
vi.mock("@/server/orchestration/billing", () => ({ processBillingRun: mocks.billing }));
vi.mock("@/server/jobs/scheduler", () => ({ runDueActions: mocks.collections }));
import { POST } from "@/app/api/demo/run-due-actions/route";

beforeEach(() => vi.resetAllMocks());
describe("demo collections route", () => {
  it("returns 403 before constructing adapters when demo mode is disabled", async () => {
    mocks.demoMode.mockReturnValue(false);
    const res = await POST();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("DEMO_MODE_DISABLED");
    expect(mocks.runtime).not.toHaveBeenCalled();
  });
  it("recovers every retryable billing run before running collections and returns the envelope", async () => {
    const order: string[] = [];
    const rt = { repos: { billingRuns: { listRetryable: vi.fn(() => [{ id: "r1" }, { id: "r2" }]) } } };
    const data = { appTime: { now: "2026-10-30T09:00:00.000Z", simulated: true, offsetMs: 1 }, evaluatedInvoices: 0, results: [] };
    mocks.demoMode.mockReturnValue(true);
    mocks.runtime.mockReturnValue(rt);
    mocks.billing.mockImplementation(async (_rt, _org, id) => { order.push(id); });
    mocks.collections.mockImplementation(async () => { order.push("collections"); return data; });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data, correlationId: expect.any(String) });
    expect(order).toEqual(["r1", "r2", "collections"]);
    expect(mocks.collections).toHaveBeenCalledWith(rt, DEMO_ORGANISATION_ID);
  });
  it("returns a safe error without provider payloads when runtime construction fails", async () => {
    mocks.demoMode.mockReturnValue(true);
    mocks.runtime.mockImplementation(() => { throw new Error("sensitive-provider-payload"); });
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("sensitive-provider-payload");
  });
});
