/**
 * A3 memory lane (Cognee). SIGNATURE LOCKED by src/contracts/modules.ts (MemoryAdapter); body owned by A3.
 * Until implemented, memory is honestly reported as unavailable.
 */
import type { MemoryAdapter } from "@/contracts";

export function getMemoryAdapter(): MemoryAdapter {
  const unavailable = { code: "MEMORY_NOT_IMPLEMENTED", message: "Memory adapter not implemented yet", retryable: false };
  return {
    async rememberEvidence() {
      return { availability: "unavailable", receiptId: null, error: unavailable };
    },
    async recallContext() {
      return { availability: "unavailable", provider: "fallback_structured", facts: [], retrievalReceiptId: null, error: unavailable };
    },
  };
}
