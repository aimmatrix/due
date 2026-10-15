/**
 * A1 billing lane. SIGNATURE LOCKED by src/contracts/modules.ts (EvaluateBilling); body owned by A1.
 */
import { NotImplementedError, type EvaluateBilling } from "@/contracts";

export const evaluateBilling: EvaluateBilling = async () => {
  throw new NotImplementedError("billing.evaluateBilling (A1)");
};
