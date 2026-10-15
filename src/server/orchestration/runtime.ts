/** Production wiring of lane modules into the orchestrators (A0). Tests build their own runtimes. */
import { DEMO_POLICY } from "@/contracts";
import { evaluateBilling } from "@/server/billing";
import { classifyCustomerMessage } from "@/server/collections";
import { getRepositories } from "@/server/db";
import { getAppTime } from "@/server/jobs/clock";
import { getLlm } from "@/server/llm";
import { getStripeAdapter } from "@/server/stripe";
import type { BillingRuntime } from "./billing";
import type { MessageRuntime } from "./messages";

export function getRuntime(): BillingRuntime & MessageRuntime {
  const repos = getRepositories();
  return {
    repos,
    evaluateBilling,
    classifyCustomerMessage,
    stripe: getStripeAdapter(),
    llm: getLlm(),
    policy: DEMO_POLICY,
    appTime: () => getAppTime(repos),
  };
}
