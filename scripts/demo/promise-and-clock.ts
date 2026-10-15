import { assert, Blocked, clock, detail, ensureInvoice, message, runDue, scenario, uniqueId } from './lib';
void scenario('promise-and-clock', async () => {
  let changedClock = false;
  try {
    let initial = await ensureInvoice();
    assert(initial.invoice.amountRemainingMinor > 0 && initial.disputes.every(d => d.status !== 'open'), 'unpaid invoice without dispute required; reset between scenarios');
    // Make the invoice overdue first so no-contact proves promise policy,
    // rather than merely the invoice not being due yet. No worker should run.
    if (Date.parse(initial.invoice.dueAt) >= Date.parse(initial.appTime.now)) {
      changedClock = true;
      await clock({ setTo: new Date(Date.parse(initial.invoice.dueAt) + 3600000).toISOString() });
      initial = await detail(initial.invoice.id);
    }
    const now = new Date(initial.appTime.now);
    const future = new Date(now.getTime() + 7 * 86400000);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(future);
    const reply = await message({ externalEventId: uniqueId('promise'), sourceType: 'customer_message', sourceRef: 'demo:payment-promise', customerRef: 'acme', invoiceId: initial.invoice.id, text: `We'll pay on ${date}. We promise to pay the full invoice balance on ${date}.` });
    const baseline = await detail(initial.invoice.id);
    const ids = new Set(baseline.actions.map(a => a.id));
    // Set the flag before the request: an ambiguous response may still have changed the clock.
    changedClock = true;
    await clock({ advanceHours: 24 });
    const scheduler = await runDue();
    const after = await detail(initial.invoice.id);
    assert(new Date(after.appTime.now).getTime() < future.getTime(), '24h advance remains before promised date seven days ahead');
    assert(!after.actions.some(a => (!ids.has(a.id) || baseline.actions.find(b => b.id === a.id)?.state !== a.state) && (['sent', 'reserved', 'unknown'].includes(a.state))), 'no new dispatched or reserved contact before promise');
    assert(after.voiceAttempts.length === baseline.voiceAttempts.length, 'no new voice attempt before promise');
    const result = scheduler.results.find(r => r.invoiceId === initial.invoice.id);
    assert(!!result && !result.executed && !['remind', 'call'].includes(result.action), 'scheduler evaluated invoice without contact');
    if (reply.classification !== 'promise') throw new Blocked(`PROMISE_CLASSIFIER_UNAVAILABLE: classification=${reply.classification}; no-contact checked, deferral unverified`);
    assert(after.promises.some(p => p.evidenceId === reply.evidenceId && p.promisedDate === date && p.status === 'active'), 'active promise with exact date and source');
    assert(after.invoice.collectionStatus === 'promise_active' && result.action === 'defer', 'promise caused scheduler deferral');
    console.log(`  promisedDate=${date} decision=${result.decisionCode}`);
  } finally {
    if (changedClock) {
      const reset = await clock({ reset: true });
      assert(!reset.simulated && reset.offsetMs === 0, 'application clock restored to real time');
    }
  }
});
