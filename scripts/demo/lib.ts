import { randomUUID } from 'node:crypto';
import type { ApiResponse, CompletionEventRequest, CompletionEventResponse, DashboardData, InvoiceDetailData, DemoClockRequest, DemoClockResponse, CustomerMessageRequest, CustomerMessageResponse, RunDueActionsResponse, SafeError } from '@/contracts';

export class Blocked extends Error {}
export function assert(condition: unknown, evidence: string): asserts condition {
  if (!condition) throw new Error(evidence);
  console.log(`  OK ${evidence}`);
}
export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Blocked(`NOT_CONFIGURED: ${name}`);
  return value;
}
export function baseUrl(): URL {
  const url = new URL(required('APP_BASE_URL'));
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, 'APP_BASE_URL is an HTTP origin without credentials');
  return new URL(url.origin);
}
export interface Reply<T> { status: number; body: ApiResponse<T> }
export async function request<T>(step: string, path: string, body?: unknown, bearer = false): Promise<Reply<T>> {
  console.log(`STEP ${step}`);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${required('INGEST_TOKEN')}`;
  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl()), { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: 'error' });
  } catch { throw new Blocked('HTTP_UNAVAILABLE: check APP_BASE_URL and the local server'); }
  if (response.headers.get('x-due-mock') === 'true') throw new Blocked('MOCK_READ_MODEL: x-due-mock=true');
  let payload: unknown;
  try { payload = await response.json(); } catch {
    if (response.status === 404) throw new Blocked(`ROUTE_NOT_READY: ${path} HTTP 404`);
    throw new Error(`HTTP ${response.status}: expected API JSON`);
  }
  const envelope = payload as ApiResponse<T>;
  assert(typeof envelope?.correlationId === 'string' && ('data' in envelope || 'error' in envelope), 'typed API envelope present');
  console.log(`  HTTP ${response.status} correlationId=${envelope.correlationId}${'error' in envelope ? ` code=${envelope.error.code}` : ' result=received'}`);
  return { status: response.status, body: envelope };
}
export function data<T>(reply: Reply<T>): T {
  if ('error' in reply.body) {
    if (reply.body.error.code === 'MODULE_NOT_READY') throw new Blocked('MODULE_NOT_READY');
    if (reply.status === 404 && reply.body.error.code !== 'INVOICE_NOT_FOUND') throw new Blocked('ROUTE_NOT_READY: HTTP 404');
    throw new Error(`HTTP ${reply.status}: ${reply.body.error.code}`);
  }
  assert(reply.status >= 200 && reply.status < 300, 'HTTP success');
  return reply.body.data;
}
export const submissionId = 'due-demo-acme-migration-v1';
export const completionText = 'The Acme website migration (M2-website-migration) is complete. DNS cut over and the client signed off on staging.';
export function completion(externalEventId = `form-${submissionId}`, text = completionText): CompletionEventRequest {
  return { externalEventId, sourceType: 'fixture_replay', sourceRef: `demo:${externalEventId}`, customerRef: 'acme', text };
}
export const uniqueId = (prefix: string) => `${prefix}-${randomUUID()}`;
export const postCompletion = (body: CompletionEventRequest) => request<CompletionEventResponse>('completion event (scripted fixture replay)', '/api/events/completion', body, true).then(data);
export const dashboard = () => request<DashboardData>('read canonical dashboard', '/api/dashboard').then(data);
export const detail = (id: string) => request<InvoiceDetailData>('read invoice evidence', `/api/invoices/${encodeURIComponent(id)}`).then(data);
export const clock = (body: DemoClockRequest) => request<DemoClockResponse>('set labelled application clock', '/api/demo/clock', body).then(data);
export const runDue = () => request<RunDueActionsResponse>('run scheduler through HTTP', '/api/demo/run-due-actions', {}).then(data);
export const message = (body: CustomerMessageRequest) => request<CustomerMessageResponse>('customer message', '/api/events/customer-message', body, true).then(data);
export async function checkRun(run: Pick<CompletionEventResponse, 'billingRunId' | 'billingRunState' | 'invoiceId'> & { lastError?: SafeError | null }) {
  const d = await dashboard();
  const saved = d.recentRuns.find(r => r.id === run.billingRunId);
  console.log(`  run=${run.billingRunId} state=${run.billingRunState} invoice=${run.invoiceId ?? 'none'} decision=${saved?.decisionCode ?? 'none'}`);
  if ((run.lastError ?? saved?.lastError)?.code === 'MODULE_NOT_READY') throw new Blocked('MODULE_NOT_READY');
  return d;
}
export async function ensureInvoice() {
  const run = await postCompletion(completion());
  const d = await checkRun(run);
  const invoice = d.invoices.find(i => i.customerId === 'cus_acme' && i.milestoneTitle === 'Website migration');
  if (!invoice) {
    if (run.billingRunState === 'review_required') throw new Blocked('BILLING_REVIEW_REQUIRED: no invoice; configure extraction or inspect review');
    throw new Error(`Expected Acme migration invoice, got ${run.billingRunState}`);
  }
  assert(invoice.totalMinor === 120000, 'Acme migration total = 120000 GBP minor units');
  return detail(invoice.id);
}
export async function scenario(name: string, action: () => Promise<void>) {
  try { await action(); console.log(`PASS ${name}`); }
  catch (e) {
    if (e instanceof Blocked) { console.log(`BLOCKED: ${e.message} [${name}]`); process.exitCode = 2; }
    else { console.log(`FAIL ${name}: ${e instanceof Error ? e.message : 'unexpected error'}`); process.exitCode = 1; }
  }
}
