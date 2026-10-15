/**
 * A2 Stripe lane. SIGNATURE LOCKED by src/contracts/modules.ts (StripeAdapter); body owned by A2.
 * `getStripeAdapter()` must return a fake when ADAPTER_STRIPE=fake and the real test-mode client otherwise.
 */
import { NotImplementedError, type StripeAdapter } from "@/contracts";

export function getStripeAdapter(): StripeAdapter {
  const notYet = (m: string) => () => {
    throw new NotImplementedError(`stripe.${m} (A2)`);
  };
  return {
    ensureCustomer: notYet("ensureCustomer"),
    createInvoice: notYet("createInvoice"),
    refreshInvoice: notYet("refreshInvoice"),
    verifyWebhook: notYet("verifyWebhook"),
  };
}
