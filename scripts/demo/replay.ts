import { assert, checkRun, completion, dashboard, ensureInvoice, postCompletion, scenario } from './lib';
void scenario('replay', async () => {
  const initial = await ensureInvoice();
  const first = await postCompletion(completion());
  await checkRun(first);
  assert(first.status === 'duplicate', 'same externalEventId returns duplicate');
  assert(first.invoiceId === initial.invoice.id, 'duplicate event returns original invoice');
  const alternate = await postCompletion(completion('due-demo-alternate-migration-v1'));
  await checkRun(alternate);
  const invoices = (await dashboard()).invoices.filter(i => i.customerId === 'cus_acme' && i.milestoneTitle === 'Website migration');
  assert(invoices.length === 1 && invoices[0]?.id === initial.invoice.id, 'exactly one canonical invoice for Acme migration after alternate event');
  assert(alternate.invoiceId === null || alternate.invoiceId === initial.invoice.id, 'alternate event did not return a different invoice');
  console.log(`  invoice=${initial.invoice.id} stripe=${initial.invoice.stripeInvoiceId}; local API invariant, external Stripe duplicate scan remains manual`);
});
