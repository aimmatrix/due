/**
 * A3 collections lane. SIGNATURES LOCKED by src/contracts/modules.ts; bodies owned by A3.
 */
export { classifyCustomerMessage, validateClassification, MAX_PROMISE_DAYS_AHEAD } from "./classify";
export { decideFollowUp, callEligibility, currentPromise, promiseStatusUpdates, MAX_PROMISES_HONOURED } from "./decide";
