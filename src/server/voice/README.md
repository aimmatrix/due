# Voice module (lane B1)

ElevenLabs Agents + native Twilio integration for the one permitted non-response collections call. This module initiates the call and turns the signed post-call webhook into a typed outcome. It does not persist anything, decide eligibility or open a database connection; A0 owns those.

## Handoff for Ammad (A0)

Branch `codex/voice`, files only under `src/server/voice/**`. No dependencies, shared types, routes or root files were changed.

**Blocker: a real outbound call needs a paid Twilio account.** ElevenLabs reaches Twilio, but the trial account rejects the call ("trial accounts have limited parameter access"). Upgrade the Twilio account, then rerun `scripts/controlled-call.ts` to complete B1-01 and B1-05. Until then, report the real ElevenLabs call as unmet, not simulated.

**Already live (identifiers, not secrets):**

- ElevenLabs agent "Due collections": `agent_9301m50ff7pxe36ss4jfsysd3ham`, configured from `agent-config.ts`
- Twilio number `+16413374120`, imported as `phnum_4301m50ezantfa4t58d8z38q91eq` and used by that agent for outbound calls only (no inbound agent assigned)
- Allowlisted demo destination: the teammate's verified mobile, held in `VOICE_DEMO_ALLOWLIST`

**Integration steps:**

1. Add the configuration names below to `.env.example`. Secret values are shared locally, never committed.
2. Call `createElevenLabsVoiceAdapter({ config: readVoiceConfig() }).startCollectionCall(context)` only for a reserved, freshly authorised action. Persist the returned `conversationId` and `callSid` with the voice attempt. `accepted` means initiation only; `unknown` must be reconciled, never redialled.
3. Implement `POST /api/webhooks/elevenlabs`. Pass the **raw body string** and headers unchanged to `verifyAndNormaliseCallEvent(rawBody, headers, { webhookSecret, isKnownAction })`. `isKnownAction(actionId, conversationId)` looks up the persisted voice attempt. Enforce uniqueness on `event.dedupKey`, then apply `event.outcome` and `event.recommendation` (see Outcome rules).
4. Once the route has a public URL: ElevenLabs → Settings → Webhooks → add a post-call webhook to it, enable HMAC and call-initiation-failure events, and set `ELEVENLABS_WEBHOOK_SECRET`.
5. Publish voice types in `src/contracts/**`. This module will swap `types.ts` for those imports; field names already match `TEAMMATE_TASKS.md`.
6. Run `npx tsx --test src/server/voice/*.test.ts`, or move the tests to the project test runner.

## Exports (`src/server/voice/index.ts`)

| Export | Purpose |
| --- | --- |
| `createElevenLabsVoiceAdapter({ config })` | Returns `startCollectionCall(context)` → `accepted` / `failed` / `unknown` with action ID, conversation ID, call SID, timestamp and safe error code |
| `createFakeVoiceAdapter()` | Same shape for ordinary development; records calls, never dials |
| `verifyAndNormaliseCallEvent(rawBody, headers, { webhookSecret, isKnownAction })` | Verifies `ElevenLabs-Signature`, correlates to a known action and returns a `VerifiedCallEvent` with dedup key, outcome, recommendation, promised date, quote and transcript reference |
| `readVoiceConfig(env)` | Reads configuration and throws `VoiceConfigError` listing missing names |

Types live in `types.ts` and mirror the contract in `TEAMMATE_TASKS.md`. Swap them for `src/contracts/**` imports once A0-02 is published.

## Configuration names

| Variable | Notes |
| --- | --- |
| `ELEVENLABS_API_KEY` | Server-side only |
| `ELEVENLABS_AGENT_ID` | Printed by `setup-agent.ts` |
| `ELEVENLABS_AGENT_PHONE_NUMBER_ID` | Twilio number imported into ElevenLabs (`phnum_…`) |
| `ELEVENLABS_WEBHOOK_SECRET` | HMAC secret from ElevenLabs post-call webhook settings |
| `VOICE_DEMO_ALLOWLIST` | Comma-separated E.164 numbers of consenting teammates; anything else is refused before dialling |
| `ELEVENLABS_REQUEST_TIMEOUT_MS` | Optional, default 15000 |

## Provider setup

1. Twilio: verify the teammate's number under Verified Caller IDs, buy one voice number, enable the destination country in Geo permissions.
2. ElevenLabs → Phone numbers → import the Twilio number (SID + auth token). Note the `phnum_…` ID.
3. `npx tsx --env-file=.env.local src/server/voice/scripts/setup-agent.ts` creates/updates the agent from `agent-config.ts` (prompt, first message, voicemail message, end-call and voicemail-detection tools, data-collection fields) and clears the number's inbound agent so the number is outbound-only.
4. ElevenLabs → Settings → Webhooks: add a post-call webhook pointing at A0's `POST /api/webhooks/elevenlabs`, enable HMAC, copy the secret into `ELEVENLABS_WEBHOOK_SECRET`. Enable "send call initiation failure" events.
5. One controlled call: `npx tsx --env-file=.env.local src/server/voice/scripts/controlled-call.ts +44…`.

## Conversation behaviour (B1-02)

- Identifies itself as an AI assistant and confirms it is speaking to accounts before revealing any invoice detail.
- States only the verified invoice number, amount and due date passed as dynamic variables.
- No fees, interest or discounts; never asks for card details; plan options offered only when `approvedPlanOptions` is non-empty, never accepted on the customer's behalf.
- Voicemail message contains no invoice or amount details.
- Extracts `call_outcome`, `promised_date`, `customer_quote`, `dispute_reason` via ElevenLabs data collection.

Correlation travels as dynamic variables `due_action_id`, `due_correlation_id`, `due_policy_version`; they are returned in the webhook under `conversation_initiation_client_data` and never spoken.

## Outcome rules (B1-03 / B1-04)

| Situation | Outcome | Recommendation |
| --- | --- | --- |
| Confirmed date (YYYY-MM-DD) and the quote appears in a customer turn | `promise` | `defer_until_promise` |
| Promise with vague date or unverifiable quote | `needs_review` | `review` |
| Dispute | `dispute` | `pause_for_dispute` |
| "I already paid" | `claimed_payment` | `refresh_stripe` (never marks paid) |
| Asked for a person / unclear | `needs_review` | `review` |
| No customer speech, voicemail, no-answer/busy | `no_answer` | `no_retry` |
| Conversation not `done` | `needs_review` | `review` |
| Initiation failure event | `failed` | `review` |

Adapter: invalid context or non-allowlisted number → `failed` without dialling; provider rejection or 4xx → `failed`; transport timeout, network error or 5xx → `unknown` (reconcile before any further attempt; the adapter never redials).

Webhook: missing, malformed, stale (>30 min) or invalid signatures are rejected; unknown or missing `due_action_id` is rejected; inbound-direction conversations are rejected. `dedupKey` is `elevenlabs:<event type>:<conversation id>`, stable across redeliveries; A0 enforces uniqueness.

## Tests

`npx tsx --test src/server/voice/*.test.ts` (20 tests: adapter states, signature checks, every outcome mapping). No dependency added; A0 may switch to the project test runner.

## Status

| Task | State |
| --- | --- |
| B1-01 | Agent and Twilio number configured; adapter implemented. Controlled outbound call reaches ElevenLabs but is rejected (see limitations) |
| B1-02 | Conversation configured and pushed to the agent |
| B1-03 | Implemented and tested; route wiring is A0 |
| B1-04 | Implemented and tested |
| B1-05 | Waiting on A0-07 and the limitation below |

## Limitations

- **Real outbound call is blocked by the Twilio trial account.** The controlled call on 15 Oct 2026 returned `failed / provider_rejected`; ElevenLabs reports "trial accounts have limited parameter access". Upgrading the Twilio account is required to complete B1-01/B1-05; this is reported as an unmet requirement, not simulated.
- **Outbound only.** Inbound calls are not supported: the setup script leaves no agent assigned to the number, and the webhook rejects any conversation whose `metadata.phone_call.direction` is `inbound` (`inbound_call`) as well as any without a known `due_action_id`. If the number was already assigned to the agent in the ElevenLabs dashboard, re-run `setup-agent.ts` or unassign it under Phone numbers.
- Voicemail detection relies on ElevenLabs' voicemail tool and termination reason; unrecognised voicemail with no customer speech still maps to `no_answer`.

## Requests for A0

- Add the variable names above to `.env.example`.
- Route `POST /api/webhooks/elevenlabs` must pass the raw body string and headers unchanged, and supply `isKnownAction(actionId, conversationId)` from persisted voice attempts.
- Store `conversationId`/`callSid` from the initiation receipt so webhook correlation can match on both.
- Publish `src/contracts/**` voice types; this module will switch its imports.
