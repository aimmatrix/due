# Real inbound email (R2-3)

Provider: **Resend**, matching the existing outbound adapter and its Svix verifier.
No SDK or new dependency is required. Signature verification uses the existing
`verifySvixSignature` implementation over the unmodified request body, with a
five-minute tolerance against wall time (never the simulated collections clock).

## Provider setup

1. In Resend → Emails → Receiving, get the account's `<id>.resend.app` receiving
   domain. Use `complete@<id>.resend.app` for completions and
   `replies@<id>.resend.app` for replies. Alternatively enable receiving on a
   dedicated verified subdomain and publish the MX record shown by Resend.
2. Run this branch on port 3107 with its own database (`DATABASE_PATH=data/inbound.db`,
   `DEMO_MODE=true`) and seed the synthetic demo data. Expose that server through
   a public HTTPS tunnel.
3. In Resend → Webhooks, add
   `https://<tunnel-host>/api/webhooks/inbound-email`, enable **email.received**,
   and copy its signing secret into `INBOUND_EMAIL_WEBHOOK_SECRET`.
   Do not use the outbound delivery endpoint's secret unless it is actually the
   same webhook endpoint.
4. Set the configuration below, then restart the server. The API key needs access
   to retrieve received emails; an outbound sending-only key is insufficient.
5. For real Stripe invoices set `ADAPTER_STRIPE=real` and the existing test-mode
   Stripe configuration. Billing extraction also requires the billing lane and
   its existing LLM configuration. `DEMO_MODE=true` alone does not select real
   adapters; this route uses the existing runtime unchanged.

New environment names for the owner of `.env.example` to add:

```dotenv
INBOUND_EMAIL_PROVIDER=resend
INBOUND_EMAIL_WEBHOOK_SECRET=whsec_<inbound-endpoint-signing-secret>
INBOUND_COMPLETIONS_ADDRESS=complete@<id>.resend.app
INBOUND_ALLOWED_SENDERS=teammate@example.com,another-teammate@example.com
```

Existing required environment name: `RESEND_API_KEY`. Inbound configuration is
read in `config.ts`; shared environment configuration is unchanged. Empty or
invalid configuration returns 503, including with fake outbound email enabled.
Use only exact team-controlled synthetic addresses in the sender list (no
wildcards). This is a controlled demo sender gate, not a general customer email
authentication system.

## Routing and responses

The webhook verifies the raw body before parsing or accessing the API. The
`email.received` payload supplies metadata, including `email_id` and `message_id`.
The body is fetched using `GET /emails/receiving/{email_id}` with an eight-second
network timeout; webhook-supplied text is never substituted for the API response.
Unknown senders return 200 without fetching or writing evidence. Logs contain
fixed reason codes only. Recipients must belong to the configured inbound domain.

Completion email example:

- To: the exact `INBOUND_COMPLETIONS_ADDRESS`
- Subject: `Acme Ltd work complete`
- Body: `Acme Ltd M2-website-migration is complete.`

The unique customer name, match key or internal ID in the subject/body supplies a
customer reference. Missing or ambiguous customers receive an unresolved reference
for the billing validator to review. Email amounts remain untrusted text; stored
contract prices and the existing billing validator govern invoicing.

Customer reply example:

- To: `replies@<id>.resend.app`
- Subject: `Re: Invoice DUE-0001`
- Body: `We will pay on November 7.`

Alternatively send to `complete+DUE-0001@<id>.resend.app`. The token must exactly
match one persisted Stripe invoice number for the demo organisation. Multiple
or unknown tokens are acknowledged with an explicit ignored reason; no invoice
is guessed. Tokens take precedence even at the completion address. If the stored
customer has contact emails, the allowed sender must also match one of them.
The existing customer-message orchestrator records evidence/classification and
cancels queued calls. An accepted reply never directly marks an invoice paid.
The outbound adapter is unchanged: set the recipient/subject when composing a
manual demo reply; automatic Reply-To configuration is outside this lane.

Text is capped at 20,000 characters after removing quoted `>` lines, `On … wrote:`
history, original-message separators and common HTML quotes. HTML-only mail is
converted to text, never rendered, with script/style content removed. Attachments
are not fetched. Source text is passed only as evidence data to existing modules.

Successful work returns 200 with `{ data: { route, status, billingRunId?, evidenceId? } }`.
Bad signatures return 400. Invalid signed payloads return 400. Processing/API
failures return 503 and unmark the webhook so Resend can retry. Webhook event IDs
are claimed using `repos.webhooks.markProcessed("inbound_email", svixId)`; stored
Message-ID evidence also deduplicates alternate event IDs for the same message.
The claim is an in-progress claim as well as a completed marker; recovery after a
process crash between claim and completion needs an operator to unmark the event
before replay (the shared repository has no expiring lease).

Processing is awaited inline to keep database and billing work alive through the
response. Existing billing failures may return `billingRunState=failed_retryable`;
the existing worker must resume those runs. Deploy with sufficient request duration
for billing/LLM work. This lane does not add an unawaited background task or queue.

## Verification and handoff

Run `npm run typecheck && npm test`. The signed fixtures exercise completion →
persisted evidence → billing → fake Stripe test-mode invoice at the stored price;
webhook and Message-ID dedupe; unknown senders; replies and queued-call cancellation
for promise/dispute/review; unknown/ambiguous invoice rejection; signature failures;
retry after body-fetch failure; text stripping and length caps. A published Svix
signature test vector independently checks compatibility with the fixture signer.
All database tests use isolated, seeded in-memory SQLite databases.

**Live verification:** documentation was checked on 15 October 2026. No account
receiving domain, public tunnel, live inbound email or real Stripe invoice was
verified in this lane. Account availability and API key permissions remain to be
checked by the team. A signed fixture is not evidence of real email delivery.

For the optional live test send the completion example from an allowed teammate,
then inspect the stored Message-ID, billing run and Stripe test invoice. Reply with
its actual persisted invoice number and confirm a queued call becomes cancelled.
Record the actual outcome, including any retry/review state, before claiming live
end-to-end success.

Documentation checked:

- [Receiving setup](https://resend.com/docs/dashboard/receiving/introduction)
- [Receiving webhook payload and body retrieval](https://resend.com/docs/dashboard/receiving/create-receiving-webhook)
- [Retrieve received email API](https://resend.com/docs/api-reference/emails/retrieve-received-email)
- [Resend signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Svix manual verification and test vector](https://docs.svix.com/receiving/verifying-payloads/how-manual)
