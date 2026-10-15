'use client';

import { useState } from 'react';
import { api, ApiError, type ApiResult } from '@/client/api';
import { date, human } from '@/client/format';
import { Badge, ErrorNotice } from './ui';
import type { AppTime, RunDueActionsResponse } from '@/contracts';
export function DemoControls({
  onChange
}: {
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ApiResult<AppTime | RunDueActionsResponse> | null>(null);
  async function run(label: string, action: () => Promise<ApiResult<AppTime | RunDueActionsResponse>>) {
    setBusy(label);
    setError(null);
    setResult(null);
    try {
      const response = await action();
      setResult(response);
      await onChange();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError('Could not run this demo action.', 'ACTION_FAILED', 'unavailable', 0));
    } finally {
      setBusy(null);
    }
  }
  return <section className="demo-controls" aria-label="Demo controls">
    <div className="demo-controls-row">
      <div>
        <span className="eyebrow">DEMO CONTROLS</span>
        <p>Move application time. Watch decisions adapt.</p>
      </div>
      <div className="button-group">
        <button className="button" disabled={!!busy} onClick={() => run('advance', () => api.clock({
          advanceHours: 24
        }))}>{busy === 'advance' ? 'Advancing…' : 'Advance clock +24h'}</button>
        <button className="button subtle" disabled={!!busy} onClick={() => run('reset', () => api.clock({
          reset: true
        }))}>{busy === 'reset' ? 'Resetting…' : 'Reset clock'}</button>
        <button className="button primary" disabled={!!busy} onClick={() => run('worker', api.runActions)}>
          {busy === 'worker' ? 'Running…' : 'Run due actions'}
          <span>→</span>
        </button>
      </div>
    </div>
    <p className="control-note">Simulates the application clock only. Stripe timestamps stay unchanged.</p>
    <div aria-live="polite">
      {error && <ErrorNotice error={error} />}
      {result && <div className="action-result">
        <Badge tone={result.mock ? 'amber' : 'green'}>{result.mock ? 'MOCK RESULT' : 'API RESULT'}</Badge>
        {'results' in result.data ? <>
          <p>{result.data.evaluatedInvoices} invoices evaluated · {date(result.data.appTime.now, true)}</p>
          {result.data.results.length ? result.data.results.map((item, index) => <p key={`${item.invoiceId}-${index}`}><strong>{human(item.action)} · {item.executed ? 'executed' : 'not executed'}</strong> — {item.detail}<code>{item.decisionCode}</code></p>) : <p>No actions were due.</p>}
        </> : <p>{result.data.simulated ? 'Simulated application time' : 'Application time reset'}: {date(result.data.now, true)}</p>}
        <small>Reference: {result.correlationId}</small>
      </div>}
    </div>
  </section>;
}
