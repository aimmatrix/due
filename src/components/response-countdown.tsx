'use client';

import { useEffect, useState } from 'react';
import type { AppTime } from '@/contracts';
import { responseWindowLabel } from '@/client/format';

export function ResponseCountdown({ closesAt, appTime }: { closesAt: string; appTime: AppTime }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(performance.now() - started), 1000);
    return () => window.clearInterval(timer);
  }, [appTime.now]);
  return <p className="response-countdown">{responseWindowLabel(closesAt, appTime.now, elapsed)} · application clock</p>;
}
