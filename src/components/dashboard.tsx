'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/client/api';
import { useResource } from '@/client/use-resource';
import { collectionLabels, date, human } from '@/client/format';
import { formatMoney, type DashboardData } from '@/contracts';
import { Shell } from './shell';
import { Badge, Empty, ErrorNotice, Loading, Panel } from './ui';
import { DemoControls } from './demo-controls';
import { RefreshInvoice } from './refresh-invoice';
const loadDashboard = (signal: AbortSignal) => api.dashboard(signal);
export function Dashboard() {
  const {
    result,
    error,
    loading,
    reload
  } = useResource<DashboardData>(loadDashboard);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const data = result?.data;
  const invoices = data?.invoices.filter(invoice => (filter === 'all' || (filter === 'outstanding' ? invoice.amountRemainingMinor > 0 : invoice.stripeStatus === 'paid')) && `${invoice.customerName} ${invoice.milestoneTitle} ${invoice.stripeInvoiceNumber ?? ''}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <Shell appTime={data?.appTime} policy={data?.policy.version}>
    <div className="page-heading">
      <div>
        <p className="eyebrow">YOUR RECEIVABLES, IN MOTION</p>
        <h1>Good work. Paid for.</h1>
        <p>A clear view of what’s earned, what’s collected, and what happens next.</p>
      </div>
      <button className="button" disabled={loading} onClick={reload}>↻ {loading ? 'Syncing…' : 'Sync overview'}</button>
    </div>
    {error && <ErrorNotice error={error} retry={reload} />}
    {loading && !data && <Loading />}
    {data && <>
      <DemoControls appTime={data.appTime} onChange={reload} />
      <section className="metrics" aria-label="Receivables summary">{[{
          label: 'Total invoiced',
          value: formatMoney(data.totals.invoicedMinor, data.totals.currency),
          note: `${data.totals.invoiceCount} invoices`,
          style: ''
        }, {
          label: 'Collected',
          value: formatMoney(data.totals.collectedMinor, data.totals.currency),
          note: 'Reconciled with Stripe',
          style: 'collected'
        }, {
          label: 'Outstanding',
          value: formatMoney(data.totals.outstandingMinor, data.totals.currency),
          note: 'Still to collect',
          style: ''
        }, {
          label: 'Overdue',
          value: formatMoney(data.totals.overdueMinor, data.totals.currency),
          note: 'Past the due date',
          style: ''
        }, {
          label: 'Needs review',
          value: String(data.totals.openReviewCount).padStart(2, '0'),
          note: 'Human judgement needed',
          style: ''
        }].map(metric => <article key={metric.label} className={`metric ${metric.style}`}>
          <p>{metric.label}</p>
          <strong>{metric.value}</strong>
          <small>{metric.note}</small>
        </article>)}</section>
      <div className="dashboard-grid">
        <div className="main-column">
          <Panel id="invoices" title="Invoices" aside={<Badge>{data.invoices.length} total</Badge>}>
            <div className="table-toolbar">
              <div className="segmented" role="group" aria-label="Invoice filter">{['all', 'outstanding', 'paid'].map(value => <button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'All invoices' : human(value)}</button>)}</div>
              <label className="search">
                <span className="sr-only">Search invoices</span>
                <span aria-hidden="true">⌕</span>
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search invoices…" />
              </label>
            </div>
            <div className="table-scroll"><table className="invoice-table">
                <thead><tr>
                    <th>Customer / milestone</th>
                    <th>Amount / remaining</th>
                    <th>Due / Stripe status</th>
                    <th>Collection status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr></thead>
                <tbody>{invoices.map(invoice => <tr key={invoice.id}>
                    <td><Link className="customer-link" href={`/invoices/${encodeURIComponent(invoice.id)}`}>
                        <span className="customer-avatar">{invoice.customerName.slice(0, 1)}</span>
                        <span>
                          <strong>{invoice.customerName}</strong>
                          <small>{invoice.milestoneTitle}</small>
                          <span className="invoice-number">{invoice.stripeInvoiceNumber ?? invoice.stripeInvoiceId}</span>
                        </span>
                      </Link></td>
                    <td>
                      <strong className="money">{formatMoney(invoice.totalMinor, invoice.currency)}</strong>
                      <small>{formatMoney(invoice.amountRemainingMinor, invoice.currency)} remaining</small>
                    </td>
                    <td>
                      <span>{date(invoice.dueAt)}</span>
                      <small><Badge tone={invoice.stripeStatus === 'paid' ? 'green' : 'neutral'}>{human(invoice.stripeStatus)}</Badge></small>
                    </td>
                    <td>
                      <Badge tone={invoice.collectionStatus === 'paid' ? 'green' : invoice.collectionStatus === 'paused_dispute' || invoice.collectionStatus === 'needs_review' ? 'amber' : 'neutral'}>{collectionLabels[invoice.collectionStatus]}</Badge>
                      <small>{invoice.nextAction ? `${human(invoice.nextAction.kind)} · ${date(invoice.nextAction.dueAt)} · ${human(invoice.nextAction.state)}` : 'No follow-up scheduled'}</small>
                    </td>
                    <td><Link className="arrow-link" aria-label={`View ${invoice.customerName} ${invoice.milestoneTitle}`} href={`/invoices/${encodeURIComponent(invoice.id)}`}>↗</Link></td>
                  </tr>)}</tbody>
              </table></div>
            {!invoices.length && <Empty>{data.invoices.length ? 'No invoices match your search or filter.' : <>No invoices yet: <Link className="text-link" href="/forms/completion">report completed work</Link>.</>}</Empty>}
            <details className="invoice-tools">
              <summary>Stripe links & reconciliation <span>↗</span></summary>
              {invoices.map(invoice => <div className="invoice-tool-row" key={invoice.id}>
                <span>{invoice.stripeInvoiceNumber ?? invoice.customerName}</span>
                <a href={invoice.stripeDashboardUrl} target="_blank" rel="noreferrer">Stripe ↗</a>
                {invoice.hostedInvoiceUrl && <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">Hosted invoice ↗</a>}
                <RefreshInvoice id={invoice.id} onChange={reload} />
              </div>)}
            </details>
          </Panel>
          <Panel id="activity" title="From completion to invoice" eyebrow="RECENT AGENT ACTIVITY" aside={<span className="quiet">{data.recentRuns.length} runs</span>}><div className="run-list">
              {data.recentRuns.map(run => <article className="run-row" key={run.id}>
                <span className={`run-icon ${run.state === 'invoiced' ? 'success' : ''}`}>{run.state === 'invoiced' ? '✓' : '◈'}</span>
                <div>
                  <strong>{run.customerName ?? 'Unresolved customer'}</strong>
                  <p>
                    {run.sourceType === 'fixture_replay' ? <Badge tone="amber">FIXTURE REPLAY</Badge> : human(run.sourceType)}
                    <span className="muted">→</span>
                    <Badge tone={run.state === 'failed_retryable' ? 'red' : run.state === 'review_required' ? 'amber' : 'neutral'}>{run.state}</Badge>
                  </p>
                  <small className="source-ref">{run.sourceRef}</small>
                  {run.lastError && <p className="text-red"><code>{run.lastError.code}</code> · {run.lastError.message}</p>}
                </div>
                <div className="run-end">
                  <time>{date(run.receivedAt, true)}</time>
                  <code>{run.decisionCode ?? 'PENDING'}</code>
                  {run.invoiceId && <Link href={`/invoices/${encodeURIComponent(run.invoiceId)}`}>View invoice ↗</Link>}
                </div>
              </article>)}
              {!data.recentRuns.length && <Empty>Incoming completion events and billing decisions will appear here.</Empty>}
            </div></Panel>
        </div>
        <aside className="right-column">
          <Panel id="reviews" title="A human touch" eyebrow="NEEDS REVIEW" aside={<Badge tone="amber">{data.totals.openReviewCount}</Badge>}>
            {data.reviews.filter(review => review.status === 'open').map(review => <article className="review-item" key={review.id}>
              <div className="review-item-heading">
                <span className="review-symbol">◈</span>
                <strong>{data.recentRuns.find(run => run.id === review.billingRunId)?.customerName ?? 'Review required'}</strong>
              </div>
              <p>{review.reason}</p>
              <code>{review.decisionCode}</code>
              <small>{human(review.kind)} · {date(review.createdAt, true)}</small>
              {review.invoiceId && <Link className="text-link" href={`/invoices/${encodeURIComponent(review.invoiceId)}`}>Inspect invoice →</Link>}
            </article>)}
            {!data.reviews.some(review => review.status === 'open') && <Empty>No open reviews. Exceptions will appear here.</Empty>}
            <div className="panel-footnote">Policy exceptions wait for your judgement.</div>
          </Panel>
          <Panel id="services" title="Connected services" aside={<span className="status-dot" />}>
            <div className="service-list">{data.services.map(service => <div className="service-row" key={service.service} title={`${service.detail} · checked ${date(service.checkedAt, true)}`}>
                <span>
                  <span className={`service-dot ${service.state === 'ok' ? 'ok' : 'warning'}`} />
                  {service.service === 'llm' ? 'Language model' : service.service === 'elevenlabs' ? 'ElevenLabs' : service.service === 'cognee' ? 'Cognee memory' : human(service.service)}
                </span>
                <small>{human(service.state)} · {service.detail}</small>
              </div>)}</div>
            {!data.services.length && <Empty>No service status reported.</Empty>}
          </Panel>
          <div className="policy-note">
            <span>◇</span>
            <div>
              <strong>Built around your rules.</strong>
              <p>Every charge and follow-up carries its evidence and policy version.</p>
              <details>
                <summary>View policy</summary>
                <dl>{data.policy.rules.map(rule => <div key={rule.rule}>
                    <dt>{rule.rule}</dt>
                    <dd>{rule.value}</dd>
                  </div>)}</dl>
              </details>
            </div>
          </div>
        </aside>
      </div>
    </>}
  </Shell>;
}
