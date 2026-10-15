'use client';

import { useState } from 'react';
import { api, ApiError } from '@/client/api';
import { ErrorNotice } from './ui';
export function RefreshInvoice({
  id,
  onChange
}: {
  id: string;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState('');
  async function refresh() {
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      const response = await api.refreshInvoice(id);
      setMessage(response.data.changed ? 'Invoice updated.' : 'Balance is up to date.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError('Refresh failed.', 'REFRESH_FAILED', 'unavailable', 0));
    } finally {
      try {
        await onChange();
      } catch {
        setError(new ApiError('Could not reload the latest view. Sync again to check the result.', 'RELOAD_FAILED', 'unavailable', 0));
      }
      setBusy(false);
    }
  }
  return <div className="refresh-control">
    <button className="button small" disabled={busy} onClick={refresh}>{busy ? 'Refreshing…' : '↻ Refresh from Stripe'}</button>
    <div aria-live="polite">
      {error && <ErrorNotice error={error} />}
      {message && <small>{message}</small>}
    </div>
  </div>;
}
