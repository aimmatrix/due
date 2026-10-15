# Teammate handoff — ElevenLabs collections calls

Owner: second team member  
Priority: P0, required for the demo  
Canonical specification: [PRD.md](PRD.md), especially FR-09 and lane B1  
Scope: build tasks and integration requirements; no agent prompts

## What you own

Build the ElevenLabs voice integration that calls an overdue customer after they fail to respond to a delivered reminder. Return the call outcome to Ammad's system so it can remember a promise, pause for a dispute or request review.

Ammad owns invoicing, Stripe, the database, the dashboard, scheduling, eligibility decisions and HTTP routes. You own ElevenLabs/Twilio setup, the outbound adapter, conversation configuration, signed callback verification and outcome normalisation. This isolates your work from the other sessions.

All demo calls go to a consenting, allowlisted teammate. Stripe test mode does not simulate telephone calls or cover their costs.

## File and branch boundaries

- Work in your own checkout/worktree and branch, suggested name `codex/voice`.
- Own `src/server/voice/**`, including colocated tests and `src/server/voice/README.md`.
- Import shared types from `src/contracts/**` after Ammad publishes the contract checkpoint.
- Do not edit shared types, dependencies/lockfile, database schema, API routes or dashboard files. Send required changes to Ammad's integration lane.
- Do not open your own database connection. Return typed results; Ammad persists them.
- Use a fake adapter for ordinary development. Arrange one controlled real-call test; do not run an independent background calling worker.

## Tasks

- [ ] **B1-01 — Set up ElevenLabs and outbound calls.** Configure an ElevenLabs agent and integrated Twilio phone number. Identify required configuration and implement `startCollectionCall`. Setup can begin immediately; implementation uses the A0-02 shared contracts. Done when one controlled call can be initiated and provider identifiers are returned without exposing secrets.
- [ ] **B1-02 — Configure the collections conversation.** Use the verified invoice context to identify the AI assistant, explain the outstanding amount and ask about payment. Capture a promised date, dispute, claimed payment or request for a person. Do not invent fees, accept a plan on the customer's behalf or collect card details. Offer instalments only when supplied as an enabled, approved option. Done when a teammate can complete a natural test conversation with the correct invoice facts.
- [ ] **B1-03 — Verify and normalise callbacks.** Implement `verifyAndNormaliseCallEvent` using the raw body and provider signature. Correlate the result to a known attempt, preserve source references and return a stable deduplication key. Give the implementation to Ammad for `POST /api/webhooks/elevenlabs`. Done when invalid signatures fail and duplicate results cannot be applied twice by the integration layer.
- [ ] **B1-04 — Handle failures and ambiguous outcomes.** Cover initiation failure, timeout with unknown result, no-answer, voicemail and incomplete conversations. Do not blindly redial or turn silence into agreement. Avoid invoice details in voicemail. Done when these states return explicit outcomes and a clear retry/review recommendation.
- [ ] **B1-05 — Integrate and prove the complete flow.** With Ammad, run delivered reminder → no response for the configured period → one call → outcome stored → future action updated. Also test payment or a reply arriving before dispatch. Done when the successful flow and cancellation cases work, and your module README records setup, configuration names, checks and limitations.

## What triggers a call

Ammad implements the eligibility decision. Your adapter executes only a reserved, freshly authorised action.

All conditions must hold:

1. Invoice is overdue and Stripe reports a positive remaining balance.
2. At least one reminder has confirmed successful delivery.
3. At least 24 hours have elapsed after that delivery in the explicitly labelled application clock.
4. No inbound customer reply arrived after that reminder. An email open is not a reply.
5. No active payment promise, open dispute or contact restriction blocks the call.
6. The destination matches the demo allowlist and the invoice has not used its one allowed voice attempt.

Recheck immediately before dispatch. A payment or any customer reply cancels the queued non-response call. A response that cannot be understood goes to review. Failed or unconfirmed reminder delivery does not start the non-response timer.

## Contract to agree at A0-02

`startCollectionCall(context)` receives:

| Field | Meaning |
| --- | --- |
| `actionId`, `correlationId` | Persisted reservation and trace identifiers |
| `organisationId`, `customerId`, `invoiceId` | Internal scope; never model-selected identifiers |
| `customerName`, `toNumber` | Verified contact and allowlisted E.164 number |
| `invoiceNumber`, `currency`, `amountRemainingMinor`, `dueAt` | Current financial facts from Stripe and canonical records |
| `policyVersion`, `checkedAt` | Version and time of the final eligibility check |
| `approvedPlanOptions` | Optional predefined offers; empty for the basic demo |

Return `accepted`, `failed` or `unknown` with the action ID, provider conversation ID/call SID when available, timestamp and a safe error code. `accepted` means provider initiation succeeded; it does not mean answered, agreed or paid. Persist action correlation in the provider request metadata/context supported by the chosen API.

`verifyAndNormaliseCallEvent(rawBody, headers)` returns a verified event with:

- Stable event/deduplication key, provider conversation ID and event time.
- Correlation to a known action; unknown IDs must not update an invoice.
- Outcome: `promise`, `dispute`, `claimed_payment`, `no_answer`, `failed` or `needs_review`.
- Transcript/source reference and concise summary.
- Promised date and quoted supporting evidence when unambiguous; otherwise review.
- Failure details when relevant, without secrets.

Ammad owns durable deduplication, correlation lookup, canonical updates and Cognee ingestion. An API transport timeout is an unknown result: reconcile it before considering another attempt. A claimed payment triggers a Stripe refresh; it does not mark the invoice paid.

## Configuration you supply

Document names and setup steps only; do not put secret values in the repository or handoff notes.

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_AGENT_ID`
- `ELEVENLABS_AGENT_PHONE_NUMBER_ID`
- `ELEVENLABS_WEBHOOK_SECRET`
- Demo allowlist requirements and desired callback URL supplied by Ammad.

Use ElevenLabs' native Twilio integration. Document any additional telephony account setup separately; avoid building a separate raw audio-streaming bridge for this demo.

## Handoff deliverables

- Module commit/PR containing only owned files.
- Typed adapter and callback-verification exports compatible with A0's contracts.
- Tests for the consequential outcomes and a record of one successful controlled call.
- Module README listing environment variable names, provider configuration, callback setup and limitations.
- Completed B1 task IDs and any dependency requests for Ammad.

Completion requires a real ElevenLabs call, not a mock transcript or a prerecorded success presented as live behaviour. A call can still end in no-answer; distinguish that honestly from a completed conversation.

## References

- [ElevenLabs outbound calls through Twilio](https://elevenlabs.io/docs/api-reference/integrations/twilio/outbound-call)
- [ElevenLabs post-call webhooks and signature verification](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks)
