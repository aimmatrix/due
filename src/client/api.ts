import { isApiFailure, type ApiResponse, type DashboardData, type InvoiceDetailData, type DemoClockRequest, type AppTime, type RunDueActionsResponse, type RefreshInvoiceResponse } from '@/contracts';
export class ApiError extends Error {
  constructor(message: string, public code: string, public correlationId: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}
export interface ApiResult<T> {
  data: T;
  mock: boolean;
  correlationId: string;
}
export async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.body ? {
          'Content-Type': 'application/json'
        } : {}),
        ...init?.headers
      }
    });
  } catch {
    throw new ApiError('Could not reach Due. Check your connection and try again.', 'NETWORK_ERROR', 'unavailable', 0);
  }
  let envelope: ApiResponse<T>;
  try {
    envelope = await response.json();
  } catch {
    throw new ApiError(response.status === 404 ? 'This endpoint is not available yet. Backend integration is pending.' : 'The server returned an unreadable response.', 'INVALID_RESPONSE', response.headers.get('x-correlation-id') ?? 'unavailable', response.status);
  }
  if (!envelope || typeof envelope !== 'object' || typeof envelope.correlationId !== 'string') throw new ApiError('The server returned an invalid API envelope.', 'INVALID_RESPONSE', 'unavailable', response.status);
  if (isApiFailure(envelope)) throw new ApiError(envelope.error.message, envelope.error.code, envelope.correlationId, response.status);
  if (!response.ok || !('data' in envelope) || envelope.data == null) throw new ApiError('The request could not be completed.', 'REQUEST_FAILED', envelope.correlationId, response.status);
  return {
    data: envelope.data,
    mock: response.headers.get('x-due-mock') === 'true',
    correlationId: envelope.correlationId
  };
}
const post = <T,>(path: string, body?: unknown) => request<T>(path, {
  method: 'POST',
  ...(body === undefined ? {} : {
    body: JSON.stringify(body)
  })
});
export const api = {
  dashboard: (signal?: AbortSignal) => request<DashboardData>('/api/dashboard', {
    signal
  }),
  invoice: (id: string, signal?: AbortSignal) => request<InvoiceDetailData>(`/api/invoices/${encodeURIComponent(id)}`, {
    signal
  }),
  clock: (body: DemoClockRequest) => post<AppTime>('/api/demo/clock', body),
  runActions: () => post<RunDueActionsResponse>('/api/demo/run-due-actions'),
  refreshInvoice: (id: string) => post<RefreshInvoiceResponse>(`/api/invoices/${encodeURIComponent(id)}/refresh`)
};
