import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_DASHBOARD, FIXTURE_INVOICE_DETAIL } from '@/contracts/fixtures';
import { useResource } from './use-resource';
import { Dashboard } from '@/components/dashboard';
import { InvoiceDetail } from '@/components/invoice-detail';

vi.mock('./use-resource', () => ({ useResource: vi.fn() }));
afterEach(() => vi.clearAllMocks());
function resource(data: unknown) {
  vi.mocked(useResource).mockReturnValue({ result: { data, correlationId: 'corr_view_test' }, loading: false, error: null, reload: vi.fn() });
}

describe('live dashboard presentation', () => {
  it('links the empty database to the completion form and retains real failure and review codes', () => {
    resource({ ...FIXTURE_DASHBOARD, invoices: [], recentRuns: [
      { ...FIXTURE_DASHBOARD.recentRuns[0], id: 'failure', state: 'failed_retryable', decisionCode: null, invoiceId: null, lastError: { code: 'MODULE_NOT_READY', message: 'Billing unavailable', retryable: true } },
      { ...FIXTURE_DASHBOARD.recentRuns[0], id: 'review', state: 'review_required', decisionCode: 'CUSTOMER_UNRESOLVED', invoiceId: null, lastError: null },
    ] });
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).toContain('No invoices yet:');
    expect(html).toContain('href="/forms/completion"');
    for (const text of ['failed_retryable', 'MODULE_NOT_READY', 'review_required', 'CUSTOMER_UNRESOLVED']) expect(html).toContain(text);
  });
  it('shows the demo path automatically only while simulated time is active', () => {
    resource({ ...FIXTURE_DASHBOARD, appTime: { ...FIXTURE_DASHBOARD.appTime, simulated: false } });
    expect(renderToStaticMarkup(createElement(Dashboard))).not.toContain('id="demo-path"');
    resource(FIXTURE_DASHBOARD);
    const html = renderToStaticMarkup(createElement(Dashboard));
    expect(html).toContain('id="demo-path"');
    expect(html).toContain('SIMULATED TIME');
  });
  it('keeps accepted dispatch distinct from the call outcome and shows the response countdown', () => {
    const data = structuredClone(FIXTURE_INVOICE_DETAIL);
    data.voiceAttempts[0] = { ...data.voiceAttempts[0]!, dispatchState: 'accepted', outcome: null, summary: null, promisedDate: null, transcriptRef: null };
    data.memory.provider = 'not_used';
    data.callEligibility.windowClosesAt = '2026-11-01T10:00:00.000Z';
    resource(data);
    const html = renderToStaticMarkup(createElement(InvoiceDetail, { id: data.invoice.id }));
    expect(html).toContain('Call initiated, awaiting result');
    expect(html).toContain('Memory not used for this decision');
    expect(html).toContain('24h 0m remaining');
    expect(html).toContain('Delivery:');
  });
  it('shows a recorded call result with its summary, payment date and transcript reference', () => {
    resource(FIXTURE_INVOICE_DETAIL);
    const html = renderToStaticMarkup(createElement(InvoiceDetail, { id: FIXTURE_INVOICE_DETAIL.invoice.id }));
    const attempt = FIXTURE_INVOICE_DETAIL.voiceAttempts[0]!;
    expect(html).toContain(attempt.summary!);
    expect(html).toContain('Promised payment:');
    expect(html).toContain(attempt.transcriptRef!);
  });
});
