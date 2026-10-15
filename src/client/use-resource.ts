'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type ApiResult } from './api';
export function useResource<T>(load: (signal: AbortSignal) => Promise<ApiResult<T>>) {
  const [result, setResult] = useState<ApiResult<T> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError(null);
    try {
      const value = await load(current.signal);
      if (!current.signal.aborted) setResult(value);
    } catch (cause) {
      if (!current.signal.aborted) setError(cause instanceof ApiError ? cause : new ApiError('Could not load this view.', 'LOAD_FAILED', 'unavailable', 0));
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      controller.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [reload]);
  return {
    result,
    error,
    loading,
    reload
  };
}
