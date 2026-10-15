'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, type ApiResult } from '@/client/api';
import { date, human } from '@/client/format';
import { Badge, ErrorNotice } from './ui';
import type { AppTime, RunDueActionsResponse } from '@/contracts';
export function DemoControls({
  onChange,
  appTime
}: {
  onChange: () => Promise<void>;
  appTime: AppTime;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ApiResult<AppTime | RunDueActionsResponse> | null>(null);
  const [showPath, setShowPath] = useState(false);
  const [clock, setClock] = useState<AppTime | null>(null);
  const [clockError, setClockError] = useState<ApiError | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.currentClock(controller.signal).then(response => {
      if (!controller.signal.aborted) { setClock(response.data); setClockError(null); }
    }).catch(cause => {
      if (!controller.signal.aborted) setClockError(cause instanceof ApiError ? cause : new ApiError('Could not read the clock.', 'CLOCK_FAILED', 'unavailable', 0));
    });
    return () => controller.abort();
  }, [appTime.now]);
  async function run(label: string, action: () => Promise<ApiResult<AppTime | RunDueActionsResponse>>) {
    setBusy(label);
    setError(null);
    setResult(null);
    try {
      const response = await action();
      setResult(response);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError('Could not run this demo action.', 'ACTION_FAILED', 'unavailable', 0));
    } finally {
      try { await onChange(); }
      catch { setError(new ApiError('Could not reload the latest view. Sync again to check the result.', 'RELOAD_FAILED', 'unavailable', 0)); }
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
    <div className="demo-path-heading">
      <button className="text-link" aria-expanded={showPath || appTime.simulated} aria-controls="demo-path" onClick={() => setShowPath(value => !value)} disabled={appTime.simulated}>{showPath || appTime.simulated ? 'Demo path visible' : 'Show demo path'}</button>
      {clock && <small>Clock: {date(clock.now, true)} London · {clock.simulated ? 'simulated' : 'real time'}</small>}
    </div>
    {(showPath || appTime.simulated) && <div id="demo-path" className="demo-path">
      <strong>Demo path</strong><span>Rehearsal checklist · tick manually as you present</span>
      <ol>{['Report completed work', 'Open the resulting invoice', 'Explain “Why £1,200?” from stored prices', 'Check reminder delivery', 'Advance simulated time +24h', 'Run due actions · check call result', 'Show promise deferring collections', 'Pay in Stripe test mode · refresh to £0'].map(step => <li key={step}><label><input type="checkbox" />{step}</label></li>)}</ol>
    </div>}
    <p className="control-note">Simulates the application clock only. Stripe timestamps stay unchanged.</p>
    <div aria-live="polite">
      {clockError && <ErrorNotice error={clockError} />}
      {error && <>{busy === null && error.status === 404 && <p className="text-red">This action is not available yet.</p>}<ErrorNotice error={error} /></>}
      {result && <div className="action-result">
        <Badge>API RESULT</Badge>
        {'results' in result.data ? <>
          <p>{result.data.evaluatedInvoices} invoices evaluated · {date(result.data.appTime.now, true)}</p>
          {result.data.results.length ? result.data.results.map((item, index) => <p key={`${item.invoiceId}-${index}`}><strong>{human(item.action)} · {item.executed ? 'executed' : 'not executed'}</strong> — {item.detail}<code>{item.decisionCode}</code></p>) : <p>No actions were due.</p>}
        </> : <p>{result.data.simulated ? 'Simulated application time' : 'Application time reset'}: {date(result.data.now, true)}</p>}
        <small>Reference: {result.correlationId}</small>
      </div>}
    </div>
  </section>;
}
