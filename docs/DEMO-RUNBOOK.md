# Due demo runbook

Use synthetic Acme data and Stripe **test mode**. This procedure is for one local instance. The API scenarios are scripted replays; the recorded real-world trigger must be a person submitting the completion form. Do not present blocked steps or fake adapters as external success.

## Clean checkout

Use Node 22 or newer, npm, and (for real invoice verification) a logged-in Stripe CLI. From the repository root:

```bash
npm install
cp .env.example .env.local
# Edit local configuration using the names below; never commit it.
npm run check:env
npm run db:seed
PORT=3108 npm run dev
```

The explicit `PORT=3108` prefix is necessary because npm expands the dev command before Next loads `.env.local`. For this lane use port 3108, `data/demo.db`, and a matching loopback `APP_BASE_URL`. Set `DEMO_MODE` to true. The server and all scripts must load the same `.env.local`; the scripts have no hard-coded base URL or credentials.

Configuration names (values belong only in `.env.local`):

- Required local runtime: `PORT`, `APP_BASE_URL`, `DATABASE_PATH`, `DEMO_MODE`, `INGEST_TOKEN`, `FORM_ACCESS_CODE`.
- Stripe: `ADAPTER_STRIPE`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Real verification needs the real adapter and test credentials. A configured key alone does not prove a working adapter.
- Extraction: `ADAPTER_LLM`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`. Missing extraction can produce review; do not call that an invoice success.
- Memory: `ADAPTER_MEMORY`, `COGNEE_API_URL`, `COGNEE_API_KEY`.
- Reminders: `ADAPTER_EMAIL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `REMINDER_FROM_EMAIL`, `DEMO_EMAIL_ALLOWLIST`.
- Voice: `ADAPTER_VOICE`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_AGENT_PHONE_NUMBER_ID`, `ELEVENLABS_WEBHOOK_SECRET`, `VOICE_DEMO_ALLOWLIST`, `DEMO_PHONE_ALLOWLIST`.

Keep all external email/voice adapters fake in lane checkouts. Real sends and calls belong to the integration checkout, with team-controlled recipients and a consenting allowlisted teammate. Stop the background worker while exercising scenarios so another process cannot contact a customer during the checks.

For the integration recording, run Stripe forwarding in another terminal:

```bash
stripe listen --forward-to http://localhost:3108/api/webhooks/stripe
```

Put the signing secret printed by the CLI into `STRIPE_WEBHOOK_SECRET` privately, then restart the server. Do not paste terminal secrets into recordings or commits. Verify a signed webhook actually updates the invoice; forwarding alone is not payment evidence.

## Pre-flight

- Confirm test-mode badge, matching URL/port/database, and no stale application-clock offset.
- Run `npx tsc --noEmit`. Inspect `/api/health`, `/api/dashboard` and the actual service states. Reject any `x-due-mock: true` response as rehearsal evidence.
- Run the scenarios below, recording correlation IDs and exit codes: 0 PASS, 1 FAIL, 2 BLOCKED. BLOCKED is not a pass.
- Ensure the real adapter exists before recording an invoice. Open the invoice in the actual Stripe test dashboard and confirm GBP 1,200, finalised state, hosted link and matching ID.
- Verify delivered reminder evidence and a successful signed voice outcome before using the complete two-minute script. A provider accepting a request is not delivery or an answered call.
- Run the public-repo scan after staging intended files. Resolve every finding, then inspect Git history and untracked additions separately. Check the repo and video links while logged out, and video duration ≤2:00.

## Scenario commands and isolation

Run from the repository root with the local server running:

```bash
npx tsx --env-file=.env.local scripts/demo/happy-path.ts
npx tsx --env-file=.env.local scripts/demo/replay.ts
npx tsx --env-file=.env.local scripts/demo/price-injection.ts
npx tsx --env-file=.env.local scripts/demo/dispute.ts
npx tsx --env-file=.env.local scripts/demo/promise-and-clock.ts
npx tsx scripts/demo/scan-public-repo.ts
```

Run happy-path then replay against the same fresh database. Replay sends the same event ID twice and an alternate event for the same milestone, and checks one canonical invoice. It does not enumerate remote Stripe objects; inspect those separately.

**Use a separate fresh local database for price-injection, dispute and promise-and-clock.** Reset between them, restart the server, then run the relevant command. Injection must reach billing before a migration invoice exists; otherwise deduplication would hide the price-safety behavior. Dispute and promise bootstrap an invoice through the event endpoint. They must not inherit a paid invoice, earlier dispute, or another scenario's promise. Dispute and promise checks first make the invoice overdue using the labelled application clock, so a not-yet-due invoice cannot hide the behavior being tested; they reset any clock they changed. The promise script then advances by 24h, calls the scheduler, checks no contact and actual promise deferral, and resets time in `finally` after any attempted clock mutation. It requires a working scheduler and classifier. A review fallback does not prove promise-aware deferral.

The happy-path script submits the real form HTTP endpoint, but is still a scripted test. Use the browser form for the live trigger during recording. A plausible invoice ID and API snapshot do not independently prove Stripe state.

## Exact recording click path (PRD §14)

| Time | Operator path and evidence |
| --- | --- |
| 0:00–0:15 | Open `/forms/completion`. Enter “Demo operator”, customer `acme`, milestone `M2-website-migration`, and “The Acme website migration is complete. DNS cut over and the client signed off on staging.” Enter the local access code off camera. Click **Report completion**. Show state and correlation ID. |
| 0:15–0:45 | Open `/`, find Acme's Website migration row, click the customer link or arrow to `/invoices/<id>`. Click **Open in Stripe ↗**. Show the actual test invoice, its ID, GBP 1,200 and finalised state; return to Due. There is no manual invoice-creation or approval click. |
| 0:45–0:55 | Show **Why £1,200?**, **The evidence**, **Rules in effect** and **Audit trail**. Connect the line to Acme SOW §4.2 and the incoming completion. |
| 0:55–1:25 | Using an integration-only HTTP control, advance the labelled application clock beyond the invoice's real due date, then POST `/api/demo/run-due-actions`. Show **Collection journey** with confirmed email delivery. Advance another 24 application hours, run actions again, and show **Call eligibility** and the real teammate call. Do not claim a call when any prerequisite is blocked. |
| 1:25–1:40 | After the signed call-result webhook, refresh the page. Show **Promises & disputes**, the source-linked outcome and the deferred action. Show **Customer memory** only as Cognee evidence if its actual provider/availability says so and retrieval changed the decision. |
| 1:40–1:50 | Click **Hosted invoice ↗**, pay using Stripe's test card below, return and wait for webhook reconciliation. If needed click **↻ Refresh from Stripe** and disclose that recovery. Show zero balance and cancelled pending contacts. |
| 1:50–2:00 | Return to the overview and show the paid invoice and audit result. Close on the product value. |

Clock/scheduler controls are HTTP operations, not assumed dashboard buttons. With the shell loading `.env.local`, run these from the repository root (the node runner avoids echoing tokens):

```bash
node --env-file=.env.local --import tsx --input-type=module -e 'import {clock} from "./scripts/demo/lib.ts"; await clock({advanceHours: 24})'
node --env-file=.env.local --import tsx --input-type=module -e 'import {runDue} from "./scripts/demo/lib.ts"; await runDue()'
```

For the first overdue step, derive the required hours from the displayed `dueAt` and current application time; one day may not make a newly issued invoice overdue. Reminder delivery must be confirmed before starting the 24h no-response interval. Any reply before dial cancels the queued call. Do not run the promise regression script to demonstrate a real voice call: that script deliberately tests suppression of contact.

Hosted test payment: use **4242 4242 4242 4242**, a future expiry, any three-digit CVC and synthetic billing details. Confirm that the page is a Stripe test payment page before entering the card. This card is not a real charge. Inspect Stripe and the canonical API after payment; never manually mark a local invoice paid.

## Recovery

- **Missed payment webhook:** on invoice detail click **↻ Refresh from Stripe**, or POST `/api/invoices/<id>/refresh`, then reload. Record correlation ID. If Stripe still shows unpaid, do not claim payment.
- **Clock:** reset with the command below. Confirm `simulated=false`, `offsetMs=0` on `/api/demo/clock`; a reset changes neither Stripe time nor already recorded action times.
- **Database:** stop `npm run dev`, the worker, and every SQLite connection cleanly. Run reset with `--yes` below, then restart. It refuses paths outside `./data/`, symlinks, hardlinks, SQLite sidecars and a reachable server. If a stopped process left sidecars, confirm every connection is closed, then run `npm run db:seed` once to let SQLite recover and close cleanly before retrying; never delete sidecars from an active database. It deletes only the configured DB and invokes `scripts/seed.ts`, the same canonical seed implementation as `npm run db:seed`. There is no seed HTTP endpoint. Resetting local state does not void or delete Stripe invoices; use a dedicated test account and inspect/reconcile existing remote billing keys before repeating real runs.

```bash
node --env-file=.env.local --import tsx --input-type=module -e 'import {clock} from "./scripts/demo/lib.ts"; await clock({reset:true})'
npx tsx --env-file=.env.local scripts/demo/reset-local.ts --yes
```

## Known limitations and honest claims

At the requested `5d8c4a0` checkpoint, billing and Stripe adapters are `MODULE_NOT_READY` stubs and `/api/demo/run-due-actions` is absent. The complete recording is gated on integration; do not submit this checkpoint as an end-to-end success. See the validation log for the actual run results.

The application clock is simulated and never changes Stripe timestamps. SQLite is a single-machine demo store. Review fallback is safe blocking behavior, not proof of LLM extraction or promise recognition. Memory fallback is canonical structured data, not Cognee retrieval. A real ElevenLabs/Twilio call requires funded/configured accounts, a suitable phone number, a reachable signed callback and a consenting teammate; a fake adapter or accepted initiation is not a completed call. Test invoice creation does not prove email receipt, delivery, payment reconciliation or call completion. Tax is a simple demo assumption; no production VAT claim. Instalments and partial payments must remain unclaimed until separately verified.

## Integration handoff (root files intentionally unchanged)

Proposed README change: link this runbook, the video script and submission draft; replace the stale blanket mock/foundation status only after each lane is integrated and verified. Explain PASS/FAIL/BLOCKED and the fresh-database requirement.

Proposed npm names (integration owner must add): `demo:happy`, `demo:replay`, `demo:price-injection`, `demo:dispute`, `demo:promise-clock`, `demo:reset`, and `check:public-repo`. Map them to the corresponding `tsx --env-file=.env.local scripts/demo/<file>.ts` commands above, except the scan needs no env file. Keep reset's `--yes` explicit at invocation.

## Validation log — 15 October 2026

Built on requested base `5d8c4a0`, branch `codex/demo-runbook`, isolated checkout `/private/tmp/due-demo`; `.env.local` used port 3108 and `data/demo.db`, with fake adapters and no real recipient configuration. Dependencies were installed from the npm cache and the SQLite native dependency rebuilt. Product code and root configuration were unchanged.

Final commands ran via `npx tsx --env-file=.env.local scripts/demo/<scenario>.ts` against `PORT=3108 npm run dev`. The five invoice scenarios shared a fresh seeded DB because all were blocked before invoice creation; integrated reruns must follow the isolation procedure above.

```text
BLOCKED: MODULE_NOT_READY [happy-path]         exit 2
BLOCKED: MODULE_NOT_READY [replay]             exit 2
OK amount field → HTTP 400 PRICE_NOT_ACCEPTED
BLOCKED: MODULE_NOT_READY [price-injection]    exit 2
BLOCKED: MODULE_NOT_READY [dispute]            exit 2
BLOCKED: MODULE_NOT_READY [promise-and-clock]  exit 2
BLOCKED: ROUTE_NOT_READY: /api/demo/run-due-actions HTTP 404
PASS clock-recovery (advance 24h, reset; simulated=false, offsetMs=0)
FAIL reset-local without --yes (expected refusal, exit 1)
FAIL reset-local with active SQLite sidecars (expected refusal, exit 1)
PASS reset-local --yes after server shutdown and clean SQLite close (exit 0)
PASS reset guards: outside path, traversal and symlink refused; sentinel preserved
PASS scanner negative fixture: 10 findings; values redacted; reserved contacts accepted
PASS npx tsc --noEmit
```

Correlation evidence: form completion `corr_a7e06288-c8ff-4c5d-88c1-14fa8778ecc7` → run `run_1b04a585d6c749c8853b`, `failed_retryable`, no invoice; event bootstrap `corr_1ee88099-47cc-4d6e-8fbd-b6e936d12e0c` → run `run_6890f597d2774586b8b6`; amount rejection `corr_ee03a4ca-155b-496b-99de-054d4c7a5e88`; injected text `corr_cc2932ec-3f6f-4597-8467-a5f306eb7840` → run `run_c98b72ddabfd4062a1b5`.

The base checkpoint scan passed with 87 tracked files and zero findings. After staging all 11 owned deliverables, the branch scan passed with 98 tracked files and zero findings; `git diff --cached --check` also passed. A separate scan of the integration checkout's current tracked working files reported one real finding: `src/server/voice/README.md:14`, a non-reserved phone number. Its value is intentionally omitted. That file is outside this lane's ownership; the integration owner must redact it and review history before publication. The scanner does not claim that the public repository is safe while that finding remains.

No real Stripe invoice, payment, reminder, voice call or Cognee retrieval was verified in this lane. Server stopped after verification. Root README changes and desired npm names are listed in the integration handoff above.
