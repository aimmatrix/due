// One controlled, manually triggered call to an allowlisted teammate (B1-01).
// Uses the real adapter; prints the initiation receipt. Never loops or redials.
//
//   npx tsx --env-file=.env.local src/server/voice/scripts/controlled-call.ts +447...
import { randomUUID } from "node:crypto";
import { createElevenLabsVoiceAdapter } from "../adapter";
import { readVoiceConfig } from "../config";

async function main() {
  const config = readVoiceConfig();
  const toNumber = process.argv[2] ?? config.allowlist[0] ?? "";
  const actionId = `manual_${randomUUID()}`;
  const { startCollectionCall } = createElevenLabsVoiceAdapter({ config });
  const receipt = await startCollectionCall({
    actionId,
    correlationId: `corr_${randomUUID()}`,
    organisationId: "org_demo",
    customerId: "cus_demo_acme",
    invoiceId: "inv_demo_acme_001",
    customerName: "Acme Ltd",
    toNumber,
    invoiceNumber: "DEMO-0001",
    currency: "GBP",
    amountRemainingMinor: 120000,
    dueAt: "2026-10-01T00:00:00Z",
    policyVersion: "demo-1",
    checkedAt: new Date().toISOString(),
    approvedPlanOptions: [],
  });
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
