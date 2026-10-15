import type { ReactNode } from 'react';
import type { ApiError } from '@/client/api';
export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Panel({
  title,
  eyebrow,
  aside,
  children,
  id,
  className = ''
}: {
  title: string;
  eyebrow?: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return <section id={id} className={`panel ${className}`}>
    <div className="panel-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {aside}
    </div>
    {children}
  </section>;
}
export function Empty({
  children
}: {
  children: ReactNode;
}) {
  return <div className="empty">{children}</div>;
}
export function ErrorNotice({
  error,
  retry
}: {
  error: ApiError;
  retry?: () => void;
}) {
  return <div className="error-notice" role="alert">
    <strong>{error.message}</strong>
    <span>{error.code} · Reference: {error.correlationId}</span>
    {retry && <button className="button small" onClick={retry}>Try again ↻</button>}
  </div>;
}
export function Loading() {
  return <div className="loading" role="status" aria-label="Loading account data">
    <div className="skeleton skeleton-title" />
    <div className="skeleton skeleton-metrics" />
    <div className="skeleton skeleton-table" />
    <span className="sr-only">Loading account data…</span>
  </div>;
}
