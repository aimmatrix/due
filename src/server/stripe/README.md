# Stripe adapter

`getStripeAdapter()` selects the real Stripe SDK adapter when `ADAPTER_STRIPE=real`, otherwise a process-local fake. Only test keys and non-live objects/events are accepted.

Real invoices use send-invoice collection, explicit payment terms, card payments, no automatic tax or default tax rates, and no automatic sending/collection. Items are explicitly attached to the invoice. A customer/invoice metadata scan plus hashed deterministic idempotency keys recover partial failures beyond the API idempotency retention window. A line fingerprint refuses a changed amount/description under an existing billing key. The adapter re-fetches invoices and paginates their lines; it owns no database writes.

Both adapters verify raw webhook bodies with Stripe's signature verifier. Invalid/missing signatures and live events throw `WebhookSignatureError`. The fake has no hosted payment URL and exposes `payInvoice` for isolated tests.

## Verified in BriefhACK sandbox, 15 October 2026

- Adapter + canonical reconciliation: `in_1UQuHD37kZ3RpSrqw6ObmubB`, paid £1,200; payment event `evt_1UQuHJ37kZ3RpSrqnp0vzJiU`, duplicate ignored, queued reminder cancelled. This smoke test uses an isolated database and explicit extraction test double.
- Full HTTP form → billing → Stripe → forwarded signed webhook → dashboard: `in_1UQuIi37kZ3RpSrqHoS3xSPe`, local invoice `inv_2a14813037f9429fb7fa`, paid £1,200 and £0 remaining. Form replay created no duplicate. Billing uses its labelled rule-based fallback.
- Decline then success fixture: `in_1UQu9a37kZ3RpSrqbSt0Iyij`, £450. A declined test card preserved the balance; test Visa then settled it.
- Untouched presentation fixture: `in_1UQu9Y37kZ3RpSrqg5OHEf5t`, £1,200 open.

Run the documented scripts from the repository root with `.env.local` loaded. See `hack-build/STRIPE-DEMO-SETUP.md` for local listener and server instructions. Secrets and generated reports remain ignored.
