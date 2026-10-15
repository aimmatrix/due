'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { api } from '@/client/api';
import { useResource } from '@/client/use-resource';
import { collectionLabels, date, human } from '@/client/format';
import { formatMoney, type InvoiceDetailData } from '@/contracts';
import { Shell } from './shell';
import { Badge, Empty, ErrorNotice, Loading, Panel } from './ui';
import { RefreshInvoice } from './refresh-invoice';
import { DemoControls } from './demo-controls';
function Highlight({
  text,
  quotes
}: {
  text: string;
  quotes: string[];
}) {
  const matches = quotes.filter(quote => quote && text.includes(quote)).sort((a, b) => b.length - a.length);
  const quote = matches[0];
  if (!quote) return <>{text}</>;
  const position = text.indexOf(quote);
  return <>
    {text.slice(0, position)}
    <mark>{quote}</mark>
    {text.slice(position + quote.length)}
  </>;
}
export function InvoiceDetail({
  id
}: {
  id: string;
}) {
  const load = useCallback((signal: AbortSignal) => api.invoice(id, signal), [id]);
  const {
    result,
    error,
    loading,
    reload
  } = useResource<InvoiceDetailData>(load);
  const data = result?.data;
  return <Shell active="invoices" appTime={data?.appTime} policy={data?.policy.version} mock={result?.mock}>
    <Link className="back-link" href="/">← Back to overview</Link>
    {error && <ErrorNotice error={error} retry={reload} />}
    {loading && !data && <Loading />}
    {data && <>
      <div className="page-heading detail-heading">
        <div>
          <p className="eyebrow">{data.invoice.stripeInvoiceNumber ?? data.invoice.stripeInvoiceId} · {data.customer.displayName}</p>
          <h1>{data.milestone.title}</h1>
          <div className="heading-badges">
            <Badge>Stripe · {human(data.invoice.stripeStatus)}</Badge>
            <Badge tone={data.invoice.collectionStatus === 'paid' ? 'green' : 'neutral'}>{collectionLabels[data.invoice.collectionStatus]}</Badge>
            <span className="quiet">Due {date(data.invoice.dueAt)}</span>
          </div>
        </div>
        <div className="detail-amount">
          <span>Outstanding balance</span>
          <strong>{formatMoney(data.invoice.amountRemainingMinor, data.invoice.currency)}</strong>
          <small>{formatMoney(data.invoice.amountPaidMinor, data.invoice.currency)} collected of {formatMoney(data.invoice.totalMinor, data.invoice.currency)}</small>
        </div>
      </div>
      <div className="detail-toolbar">
        <div className="button-group">
          <a className="button primary" href={data.invoice.stripeDashboardUrl} target="_blank" rel="noreferrer">Open in Stripe ↗</a>
          {data.invoice.hostedInvoiceUrl && <a className="button" href={data.invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">Hosted invoice ↗</a>}
        </div>
        <div className="reconciliation">
          <small>Stripe snapshot · {date(data.invoice.lastRefreshedAt, true)} London</small>
          <RefreshInvoice id={id} onChange={reload} />
        </div>
      </div>
      <div className="detail-grid">
        <div className="main-column">
          <Panel title={`Why ${formatMoney(data.calculation.totalMinor, data.calculation.currency)}?`} eyebrow="EVERY POUND, EXPLAINED" className="explanation-panel" aside={<Badge tone="green">Stored contract price</Badge>}>
            <div className="calculation">
              {data.calculation.lines.map((line, index) => <div className="calculation-line" key={`${line.description}-${index}`}>
                <div>
                  <strong>{line.description}</strong>
                  <small>{line.quantity} × {formatMoney(line.unitAmountMinor, data.calculation.currency)}</small>
                  <span className="price-source">↳ {line.priceSource.label ?? line.priceSource.id}</span>
                  {line.priceSource.quote && <blockquote>{line.priceSource.quote}</blockquote>}
                </div>
                <strong className="money">{formatMoney(line.amountMinor, data.calculation.currency)}</strong>
              </div>)}
              <div className="calculation-total">
                <span>Subtotal</span>
                <span>{formatMoney(data.calculation.subtotalMinor, data.calculation.currency)}</span>
              </div>
              <div className="calculation-total">
                <span>Tax</span>
                <span>{formatMoney(data.calculation.taxMinor, data.calculation.currency)}</span>
              </div>
              <div className="calculation-total grand-total">
                <strong>Invoice total</strong>
                <strong>{formatMoney(data.calculation.totalMinor, data.calculation.currency)}</strong>
              </div>
              {data.calculation.notes.map(note => <p className="calculation-note" key={note}>{note}</p>)}
            </div>
            <div className="explanation-chain">
              <span>Completion evidence</span>
              <b>→</b>
              <span>Agreed milestone</span>
              <b>→</b>
              <span>Stored price</span>
              <b>→</b>
              <span>Policy check</span>
            </div>
          </Panel>
          <Panel id="evidence" title="The evidence" eyebrow="SOURCE MATERIAL" aside={<span className="quiet">{data.evidence.length} records</span>}>
            {data.evidence.map(evidence => <article className="evidence-item" key={evidence.id}>
              <div className="evidence-heading">
                <Badge tone={evidence.sourceType === 'fixture_replay' ? 'amber' : 'neutral'}>{evidence.sourceType === 'fixture_replay' ? 'FIXTURE REPLAY' : human(evidence.sourceType)}</Badge>
                <time>{date(evidence.receivedAt, true)} London</time>
              </div>
              <blockquote><Highlight text={evidence.text} quotes={[...data.promises.filter(promise => promise.evidenceId === evidence.id).map(promise => promise.quote), ...data.disputes.filter(dispute => dispute.evidenceId === evidence.id).map(dispute => dispute.quote), ...data.invoice.lines.filter(line => line.evidenceIds.includes(evidence.id)).flatMap(line => [line.priceSource.quote ?? '', data.milestone.reference, data.milestone.title])]} /></blockquote>
              <code className="source-ref">{evidence.sourceRef}</code>
            </article>)}
            {!data.evidence.length && <Empty>No source evidence was returned for this invoice.</Empty>}
          </Panel>
          <Panel title="Collection journey" eyebrow="DECISIONS WITH CONTEXT">
            {data.actions.map(action => {
              const attempts = data.voiceAttempts.filter(attempt => attempt.actionId === action.id);
              return <article className="collection-item" key={action.id}>
                <div className="collection-item-top">
                  <span className="journey-icon">{action.kind === 'voice_call' ? '↗' : '✉'}</span>
                  <div>
                    <strong>{action.kind === 'reminder_email' ? `Reminder #${action.sequence}` : action.kind === 'voice_call' ? `Collection call #${action.sequence}` : 'Payment plan offer'}</strong>
                    <small>Scheduled {date(action.dueAt, true)} · application time</small>
                  </div>
                  <Badge tone={action.state === 'failed' ? 'red' : action.deliveryState === 'delivered' ? 'green' : 'neutral'}>{action.kind === 'voice_call' ? human(action.state) : action.state === 'sent' ? `Email ${human(action.deliveryState)}` : human(action.state)}</Badge>
                </div>
                <p>{action.reason}</p>
                {action.kind !== 'voice_call' && <small>Delivery: {human(action.deliveryState)}{action.deliveredAt ? ` · ${date(action.deliveredAt, true)}` : ''}</small>}
                {action.cancelledReason && <p>Cancelled: {action.cancelledReason}</p>}
                {action.kind === 'voice_call' && !attempts.length && <p className="quiet">No provider dispatch or outcome recorded.</p>}
                {attempts.map(attempt => <div className="voice-result" key={attempt.id}>
                  <div>
                    <span>Provider dispatch</span>
                    <Badge tone={attempt.dispatchState === 'failed' ? 'red' : 'neutral'}>{attempt.dispatchState === 'accepted' ? 'Call initiated' : human(attempt.dispatchState)}</Badge>
                  </div>
                  <div>
                    <span>Recorded outcome</span>
                    <Badge tone={attempt.outcome === 'promise' ? 'green' : 'neutral'}>{attempt.outcome ? human(attempt.outcome) : 'Awaiting result'}</Badge>
                  </div>
                  {attempt.summary && <p>{attempt.summary}</p>}
                  {attempt.promisedDate && <p>Promised payment: <strong>
                      {date(attempt.promisedDate)}
                      {attempt.promisedDate.slice(0, 4)}
                    </strong></p>}
                  {attempt.initiatedAt && <small>Initiated {date(attempt.initiatedAt, true)}</small>}
                  {attempt.completedAt && <small>Completed {date(attempt.completedAt, true)}</small>}
                  {attempt.transcriptRef && <code className="source-ref">Transcript: {attempt.transcriptRef}</code>}
                </div>)}
                <code>{action.decisionCode}</code>
              </article>;
            })}
            {!data.actions.length && <Empty>No collection actions scheduled.</Empty>}
          </Panel>
          <Panel title="Audit trail" eyebrow="OLDEST TO NEWEST">
            <ol className="timeline">{[...data.timeline].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map(entry => <li key={entry.id}>
                <div className="timeline-dot" />
                <div className="timeline-top">
                  <strong>{human(entry.action)}</strong>
                  {entry.simulatedTime && <Badge tone="amber">SIMULATED</Badge>}
                  <time>{date(entry.simulatedTime ? entry.appTime : entry.occurredAt, true)}</time>
                </div>
                <p>{entry.explanation}</p>
                <div className="timeline-meta">
                  <code>{entry.decisionCode}</code>
                  <span>{human(entry.result)}</span>
                </div>
                <details>
                  <summary>Decision provenance</summary>
                  <small>Policy {entry.policyVersion} · Reference {entry.correlationId}</small>
                  <small>Recorded {date(entry.occurredAt, true)} London</small>
                  <small>Evidence: {entry.evidenceIds.join(', ') || 'None recorded'}</small>
                  {Object.entries(entry.externalIds).map(([key, value]) => <code key={key}>{key}: {value}</code>)}
                </details>
              </li>)}</ol>
            {!data.timeline.length && <Empty>No audit entries yet.</Empty>}
          </Panel>
        </div>
        <aside className="right-column">
          <Panel title="Promises & disputes" eyebrow="CUSTOMER CONTEXT">
            {data.promises.map(promise => <article className="promise-item" key={promise.id}>
              <div>
                <Badge tone={promise.status === 'active' ? 'green' : 'neutral'}>{human(promise.status)} promise</Badge>
                <strong>
                  {date(promise.promisedDate)}
                  {promise.promisedDate.slice(0, 4)}
                </strong>
              </div>
              <blockquote>“{promise.quote}”</blockquote>
              <a href="#evidence" className="text-link">View source evidence ↗</a>
            </article>)}
            {data.disputes.map(dispute => <article className="review-item" key={dispute.id}>
              <Badge tone="amber">{human(dispute.status)} dispute</Badge>
              <p>{dispute.summary}</p>
              <blockquote>“{dispute.quote}”</blockquote>
              <a href="#evidence" className="text-link">View source evidence ↗</a>
            </article>)}
            {!data.promises.length && !data.disputes.length && <Empty>No promises or disputes recorded.</Empty>}
          </Panel>
          <Panel title="Call eligibility" aside={<Badge tone={data.callEligibility.eligible ? 'green' : 'amber'}>{data.callEligibility.eligible ? 'Eligible' : 'Blocked'}</Badge>}><div className="eligibility">
              <p>{data.callEligibility.reason}</p>
              {data.callEligibility.windowClosesAt && <div className="response-window">
                <span>Response window closes</span>
                <strong>{date(data.callEligibility.windowClosesAt, true)} London</strong>
                {data.appTime.simulated && <Badge tone="amber">SIMULATED TIME</Badge>}
              </div>}
              <ul className="checklist">{data.callEligibility.checks.map(check => <li key={check.label}>
                  <span className={check.passed ? 'check-pass' : 'check-fail'}>
                    {check.passed ? '✓' : '−'}
                    <span className="sr-only">{check.passed ? 'Passed' : 'Failed'}</span>
                  </span>
                  <div>
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </div>
                </li>)}</ul>
              <code>{data.callEligibility.decisionCode}</code>
            </div></Panel>
          <Panel title="Customer memory" aside={<Badge tone={data.memory.provider === 'cognee' && data.memory.availability === 'available' ? 'green' : 'amber'}>{data.memory.provider === 'fallback_structured' ? 'Fallback in use' : human(data.memory.availability)}</Badge>}><div className="memory-content">
              <p>{data.memory.provider === 'fallback_structured' ? 'Facts from structured records. Cognee memory is unavailable.' : data.memory.provider === 'cognee' ? `Retrieved from Cognee · ${human(data.memory.availability)}.` : 'Memory was not used for this decision.'}</p>
              {data.memory.facts.map((fact, index) => <div className="memory-fact" key={index}>
                <strong>{fact.statement}</strong>
                {fact.sourceLabels.map(label => <small key={label}>{label}</small>)}
              </div>)}
              {!data.memory.facts.length && <p className="quiet">No memory facts returned.</p>}
            </div></Panel>
          <Panel title="Rules in effect" eyebrow={data.policy.version}><dl className="policy-rules">{data.policy.rules.map(rule => <div key={rule.rule}>
                <dt>{rule.rule}</dt>
                <dd>{rule.value}</dd>
              </div>)}</dl></Panel>
        </aside>
      </div>
      <DemoControls onChange={reload} />
    </>}
  </Shell>;
}
