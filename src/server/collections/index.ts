/**
 * A3 collections lane. SIGNATURES LOCKED by src/contracts/modules.ts; bodies owned by A3.
 */
import { NotImplementedError, type ClassifyCustomerMessage, type DecideFollowUp } from "@/contracts";

export const decideFollowUp: DecideFollowUp = () => {
  throw new NotImplementedError("collections.decideFollowUp (A3)");
};

export const classifyCustomerMessage: ClassifyCustomerMessage = async () => {
  throw new NotImplementedError("collections.classifyCustomerMessage (A3)");
};
