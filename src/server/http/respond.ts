/** API envelope helpers (A0). Success: { data, correlationId }. Error: { error, correlationId }. */
import { randomUUID } from "node:crypto";
import type { ApiFailure, ApiSuccess, SafeError } from "@/contracts";

export function newCorrelationId(): string {
  return `corr_${randomUUID()}`;
}

export function ok<T>(data: T, correlationId = newCorrelationId(), init?: ResponseInit): Response {
  const body: ApiSuccess<T> = { data, correlationId };
  return Response.json(body, init);
}

export function fail(error: SafeError, status: number, correlationId = newCorrelationId()): Response {
  const body: ApiFailure = { error, correlationId };
  return Response.json(body, { status });
}
