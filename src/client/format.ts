import { PRESENTATION_TIMEZONE, type CollectionStatus } from '@/contracts';
export const date = (value: string, time = false) => new Intl.DateTimeFormat('en-GB', {
  timeZone: PRESENTATION_TIMEZONE,
  day: 'numeric',
  month: 'short',
  ...(time ? {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23' as const
  } : {})
}).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
export const human = (value: string) => value.replaceAll('_', ' ').replaceAll('.', ' ');
export const collectionLabels: Record<CollectionStatus, string> = {
  not_due: 'Not due',
  overdue: 'Overdue',
  reminder_sent: 'Reminder sent',
  awaiting_response: 'Awaiting response',
  call_queued: 'Call queued',
  call_in_progress: 'Call in progress',
  promise_active: 'Promise to pay',
  paused_dispute: 'Dispute · paused',
  needs_review: 'Needs review',
  paid: 'Collected'
};

export function responseWindowLabel(closesAt: string, appNow: string, elapsedMs = 0) {
  const remaining = new Date(closesAt).getTime() - new Date(appNow).getTime() - elapsedMs;
  if (remaining <= 0) return 'Response window closed';
  const minutes = Math.ceil(remaining / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
}
