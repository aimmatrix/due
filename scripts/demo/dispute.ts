import { assert, clock, detail, ensureInvoice, message, scenario, uniqueId } from './lib';
void scenario('dispute', async () => {
  const initial = await ensureInvoice();
  assert(initial.invoice.amountRemainingMinor > 0, 'unpaid invoice required');
  let changedClock = false;
  try {
    if (Date.parse(initial.invoice.dueAt) >= Date.parse(initial.appTime.now)) {
      changedClock = true;
      await clock({ setTo: new Date(Date.parse(initial.invoice.dueAt) + 3600000).toISOString() });
    }
    const result = await message({ externalEventId: uniqueId('dispute'), sourceType: 'customer_message', sourceRef: 'demo:delivery-dispute', customerRef: 'acme', invoiceId: initial.invoice.id, text: 'We dispute delivery of the website migration. The agreed migration was not delivered. Please stop collections while this is investigated.' });
    const after = await detail(initial.invoice.id);
    const status = after.invoice.collectionStatus;
    assert(status === 'paused_dispute' || status === 'needs_review', `collection status=${status}; classification=${result.classification}`);
    assert(after.evidence.some(e => e.id === result.evidenceId), 'customer message source persisted');
    assert(status !== 'paused_dispute' || after.disputes.some(d => d.evidenceId === result.evidenceId), 'paused dispute links to the new source');
    if (status === 'needs_review') console.log('  Review fallback observed; automatic dispute classification is unverified.');
  } finally {
    if (changedClock) {
      const reset = await clock({ reset: true });
      assert(!reset.simulated && reset.offsetMs === 0, 'application clock restored after dispute check');
    }
  }
});
