# Due — hack-build plan

**Demo goal:** a real completion email/form event automatically creates and finalises a Stripe **test-mode** invoice at the stored milestone price. A test payment then reconciles the balance. Collections defer on a promise, pause on a dispute, and escalate to one ElevenLabs call after no response.

**Contract checkpoint:** the spine commit on `codex/foundation` (A0-01 + A0-02). All lanes branch from it.

## Who does what

| Session | Lanes / PRD tasks | Branch / worktree | Prompt |
|---|---|---|---|
| **Claude, this desktop session (integration)** | A0-01…A0-09 (foundation, DB, routes, orchestration, scheduler, integration, submission) and **A3** (collections, memory, notifications) | `codex/foundation` in `~/Downloads/Briefcase` | — |
| **Claude, terminal session** | **A1 billing agent + A2 Stripe adapter** (the invoicing critical path) | `codex/billing-stripe` in `~/Downloads/due-billing-stripe` | [agent-claude-billing-stripe.md](agent-claude-billing-stripe.md) |
| **Cursor** | **A4 dashboard and demo UX** | `codex/dashboard` in `~/Downloads/due-dashboard` | [agent-cursor-dashboard.md](agent-cursor-dashboard.md) |
| **Teammate** | **B1 ElevenLabs calling** | `codex/voice` (their own checkout) | [../TEAMMATE_TASKS.md](../TEAMMATE_TASKS.md) |

## File ownership matrix

| Stream | Owns (create/edit) | Never touches |
|---|---|---|
| A0 integration (this session) | `package.json`, lockfile, root config (`tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `postcss.config.mjs`, `.env.example`, `.gitignore`), `src/contracts/**`, `src/server/config/**`, `src/server/llm/**`, `src/server/http/**`, `src/server/db/**`, `src/server/jobs/**`, `src/server/orchestration/**`, `src/app/api/**`, `src/app/forms/**` (service-completion form = real event source), `scripts/**`, root docs, `hack-build/**` | lane-owned bodies below (except integration merges) |
| A3 collections (this session, later) | `src/server/collections/**`, `src/server/memory/**`, `src/server/notifications/**` | everything else |
| A1+A2 (terminal Claude) | `src/server/billing/**`, `src/server/stripe/**` | everything else |
| A4 (Cursor) | `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/invoices/**` (new pages), `src/components/**`, `src/client/**`, `public/demo/**` | `src/app/api/**`, `src/contracts/**`, `src/server/**`, `package.json`, lockfile |
| B1 (teammate) | `src/server/voice/**` | everything else |

## Locked spine: contract vs file

- **Locked files, edited by no stream:** `src/contracts/**` (types, policy, seed, fixtures), `package.json` plus lockfile, and root config. A lane that needs a change **stops and asks Ammad**.
- **Locked signature, body owned by the lane:** `src/server/billing/index.ts` (`evaluateBilling`), `src/server/stripe/index.ts` (`getStripeAdapter()`), `src/server/collections/index.ts`, `src/server/memory/index.ts`, `src/server/notifications/index.ts` and `src/server/voice/index.ts`. They ship as `NotImplementedError` stubs. The lane replaces the body, keeps the exported name and type, and may add private files beside it. **Commits like these are expected; they are not spine edits.**
- **Shared adapters A0 owns:** `src/server/llm` (`getLlm()`, `createFakeLlm()`), `src/server/config/env.ts` (`env.*`, Stripe live-key guard) and `src/server/http/respond.ts`.

## Data flow (pinned so no one edits another lane "to make it work")

```
POST /api/events/completion (A0) → persist Evidence → orchestration (A0)
   → evaluateBilling(ctx, {llm}) (A1) → BillingDecision
   → stripe.ensureCustomer + stripe.createInvoice (A2) → StripeInvoiceSnapshot → persist Invoice + Audit (A0)
POST /api/webhooks/stripe (A0) → stripe.verifyWebhook (A2) → stripe.refreshInvoice (A2) → persist (A0)
worker / POST /api/demo/run-due-actions (A0) → decideFollowUp (A3) → notifications / voice adapters → persist (A0)
Dashboard (A4) → fetch GET /api/dashboard, GET /api/invoices/:id → typed by src/contracts/api.ts
```

These routes serve the frozen fixtures today, marked with the `x-due-mock: true` header: `GET /api/dashboard`, `GET /api/invoices/inv_fixture_acme` and `GET /api/health`. The route shapes are final, and A0 swaps in real read models at A0-06.

## Build order

1. Spine (A0-01 + A0-02). Done on `codex/foundation` and needs Ammad's commit.
2. Start in parallel from the spine commit: terminal Claude (A1+A2), Cursor (A4) and the teammate (B1).
3. This session continues: A0-03 DB/repositories, then A0-04 seed + authenticated input routes + real event source, then A3-02/03/04.
4. Integrate one lane at a time: A1+A2, then A0-05 billing orchestrator and A0-06 Stripe webhooks/read models. Next comes A4-03 (real API), then A3 with A0-07, then B1-05.
5. A0-08 acceptance, then A0-09 video and submission. Keep 30 minutes for this.

## A3 → A0-07 integration rules (from the collections lane)

- `decideFollowUp` is pure and uses the **application clock** for every timestamp. When A0 records a provider time (`deliveredAt`, inbound `receivedAt`), it must add the simulated-clock offset first. Otherwise a reply arriving after the clock was advanced looks older than the reminder.
- At dispatch, re-run `decideFollowUp` and leave the action being dispatched out of `actions`. A reserved action blocks the decision; a queued one does not.
- Persist `promiseStatusUpdates()` before deciding. Use `callEligibility()` for the dashboard's `callEligibility` view.
- Email: `ADAPTER_EMAIL=real` uses Resend, sending only to `DEMO_EMAIL_ALLOWLIST` with `Idempotency-Key = reminder-<actionId>`. `accepted` does not mean delivered; only a verified `email.delivered` webhook does. That webhook route is A0's to build: `POST /api/webhooks/email` → `verifyDeliveryEvent` → `actions.markDelivery`. The fake adapter's IDs start with `fake_msg_`.

## Per-worktree runtime isolation

Each worktree has its own `.env.local` with a unique `PORT` and `DATABASE_PATH`. Only the integration checkout sets any `ADAPTER_*=real` that sends email or places calls. Lanes run `npm install` in their own worktree and never change dependencies.

| Worktree | PORT | DATABASE_PATH |
|---|---|---|
| Briefcase (integration) | 3000 | data/due.db |
| due-billing-stripe | 3101 | data/billing.db |
| due-dashboard | 3102 | data/dashboard.db |
| teammate voice | 3103 | data/voice.db |

## Integration checklist

- [ ] Every lane merged one at a time; `npm run typecheck && npm test` green after each.
- [ ] No lane edited a locked file: `git diff --stat <spine-sha>..<lane-branch> -- src/contracts package.json package-lock.json` is empty.
- [ ] Full demo path end-to-end against Stripe test mode: real event → invoice → test payment → zero balance → collections stop.
- [ ] Replay the event and confirm no duplicate invoice. Confirm the dispute pause, the promise deferral and that a reply or payment cancels a queued call.
- [ ] One real ElevenLabs call to an allowlisted teammate, with its outcome reconciled.
- [ ] Public repo scan: no secrets, no real customer data.
