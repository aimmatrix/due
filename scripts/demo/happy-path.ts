import type { CompletionEventResponse, SafeError } from '@/contracts';
import { assert, Blocked, checkRun, completionText, data, detail, request, required, scenario, submissionId } from './lib';

// The frozen contracts do not yet export the form DTO; keep the route-only fields local.
type FormResult = Omit<CompletionEventResponse, 'evidenceId'> & { lastError: SafeError | null };
void scenario('happy-path', async () => {
  const run = data(await request<FormResult>('submit actual completion-form HTTP endpoint', '/api/forms/completion', {
    submissionId, accessCode: required('FORM_ACCESS_CODE'), reporterName: 'Demo operator',
    customer: 'acme', milestoneReference: 'M2-website-migration', notes: completionText,
  }));
  await checkRun(run);
  assert(run.billingRunState === 'invoiced' && !!run.invoiceId, 'form automatically reached invoiced with an invoice ID');
  const invoice = (await detail(run.invoiceId)).invoice;
  assert(invoice.totalMinor === 120000 && invoice.currency === 'gbp', 'stored contract total is GBP 120000');
  assert(invoice.stripeStatus === 'open' || invoice.stripeStatus === 'paid', 'invoice is finalised');
  assert(invoice.stripeInvoiceId.startsWith('in_') && !invoice.stripeInvoiceId.includes('fake'), 'Stripe invoice ID has a plausible external shape');
  console.log(`  stripeInvoiceId=${invoice.stripeInvoiceId}\n  dashboard=${invoice.stripeDashboardUrl}`);
  if (process.env.ADAPTER_STRIPE !== 'real') throw new Blocked('REAL_STRIPE_UNVERIFIED: set ADAPTER_STRIPE=real on both server and client; inspect the actual test invoice');
  console.log('  Evidence: HTTP run + persisted snapshot; verify object in Stripe before making an external integration claim.');
});
