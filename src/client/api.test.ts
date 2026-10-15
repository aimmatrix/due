import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, request } from './api';
import { FIXTURE_DASHBOARD } from '@/contracts/fixtures';
afterEach(() => vi.unstubAllGlobals());
const mockFetch = (body: unknown, init?: ResponseInit) => vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(body, init)));
describe('dashboard API boundary', () => {
  it('keeps the mock marker separate from data and preserves the reference', async () => {
    mockFetch({
      data: FIXTURE_DASHBOARD,
      correlationId: 'corr_test'
    }, {
      headers: {
        'x-due-mock': 'true'
      }
    });
    const result = await api.dashboard();
    expect(result.mock).toBe(true);
    expect(result.data.totals.outstandingMinor).toBe(120000);
    expect(result.correlationId).toBe('corr_test');
  });
  it('removes the mock state automatically when real read models are connected', async () => {
    mockFetch({
      data: FIXTURE_DASHBOARD,
      correlationId: 'corr_live'
    });
    expect((await api.dashboard()).mock).toBe(false);
  });
  it('preserves a safe API error and correlation ID', async () => {
    mockFetch({
      error: {
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
        retryable: false
      },
      correlationId: 'corr_missing'
    }, {
      status: 404
    });
    await expect(api.invoice('missing')).rejects.toMatchObject({
      code: 'INVOICE_NOT_FOUND',
      correlationId: 'corr_missing',
      status: 404
    });
  });
  it('shows a pending integration error for an HTML 404 without fabricating success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Not found</html>', {
      status: 404
    })));
    await expect(api.clock({
      advanceHours: 24
    })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 404,
      message: expect.stringContaining('integration is pending')
    });
  });
  it('rejects malformed successful responses', async () => {
    mockFetch({
      invoices: []
    });
    await expect(api.dashboard()).rejects.toBeInstanceOf(ApiError);
  });
  it('rejects null data without rendering a successful view', async () => {
    mockFetch({
      data: null,
      correlationId: 'corr_null'
    });
    await expect(api.dashboard()).rejects.toMatchObject({
      code: 'REQUEST_FAILED'
    });
  });
  it('submits typed clock requests and escapes invoice IDs', async () => {
    mockFetch({
      data: {
        now: '2026-10-31T10:00:00.000Z',
        simulated: true,
        offsetMs: 86400000
      },
      correlationId: 'corr_clock'
    });
    await api.clock({
      advanceHours: 24
    });
    expect(fetch).toHaveBeenCalledWith('/api/demo/clock', expect.objectContaining({
      method: 'POST',
      body: '{"advanceHours":24}',
      headers: {
        'Content-Type': 'application/json'
      },
      cache: 'no-store'
    }));
    await api.invoice('id/with spaces');
    expect(fetch).toHaveBeenLastCalledWith('/api/invoices/id%2Fwith%20spaces', expect.any(Object));
  });
  it('turns network failures into a safe error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(request('/api/dashboard')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      correlationId: 'unavailable'
    });
  });
});
