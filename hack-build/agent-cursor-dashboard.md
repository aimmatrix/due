# Cursor — A4 dashboard and demo experience

**Product (one line):** Due is an AI accounts-receivable agent. A real "work completed" event automatically becomes a Stripe **test-mode** invoice at the stored contract price, every pound is explained, and collections adapt to promises, disputes and an ElevenLabs call. It is a Briefcase × Stripe hackathon demo and will be recorded as a video of two minutes or less tonight.

**Your mission:** build the single-page dashboard and the invoice detail view that judges watch in the video. It must make three things obvious:
- (a) the invoice was created automatically from a real event;
- (b) "Why £1,200?", traced to the contract, the evidence and the policy;
- (c) the collections timeline: the reminder was delivered, the labelled simulated wait passed, the call happened, and the promise deferred the next contact.

## Setup (do this first)

```bash
cd ~/Downloads/Briefcase
git worktree add ../due-dashboard -b codex/dashboard codex/foundation
cd ../due-dashboard
npm install
cp .env.example .env.local   # set PORT=3102, DATABASE_PATH=data/dashboard.db
npm run dev                   # http://localhost:3102
```

Open the `../due-dashboard` folder in Cursor, not the main `Briefcase` folder. Read `PRD.md` §2, §3, §8 ("UI API contract") and tasks A4-01…A4-06. Read `src/contracts/api.ts` and `src/contracts/fixtures/index.ts`.

## Files you OWN (create/edit only these)

- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- `src/app/invoices/**` (a new invoice detail page, e.g. `src/app/invoices/[id]/page.tsx`)
- `src/components/**`
- `src/client/**`: typed API client, hooks and UI tests (`*.test.ts`)
- `public/demo/**`

## NEVER touch

- `src/app/api/**` (route handlers belong to A0), `src/contracts/**`, `src/server/**`, `scripts/**`
- `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`. Do not install packages. Tailwind v4 is already set up through `@import "tailwindcss"` in `globals.css`. There is no component library; write small components yourself.

## Contracts you consume (already committed — do not change them)

- Envelope: `ApiResponse<T> = { data: T, correlationId } | { error: { code, message, retryable }, correlationId }`. Use `isApiFailure()`.
- `GET /api/dashboard` returns `DashboardData`: `testMode`, `appTime {now, simulated, offsetMs}`, `totals`, `invoices: InvoiceSummary[]`, `recentRuns`, `reviews`, `services: ServiceHealth[]` and `policy {version, rules}`.
- `GET /api/invoices/:id` returns `InvoiceDetailData`: `invoice` (+ `lines`), `customer`, `milestone`, `calculation`, `evidence[]`, `policy`, `promises`, `disputes`, `actions: CollectionActionView[]`, `voiceAttempts: VoiceAttemptView[]`, `callEligibility {eligible, decisionCode, reason, windowClosesAt, checks[]}`, `memory {provider, availability, facts}`, `timeline: AuditEntry[]` and `appTime`.
- Demo controls, which you call; A0 implements them: `POST /api/demo/clock` with body `DemoClockRequest` (`{advanceHours}` | `{setTo}` | `{reset:true}`) returns `AppTime`. `POST /api/demo/run-due-actions` returns `RunDueActionsResponse`. `POST /api/invoices/:id/refresh` returns `RefreshInvoiceResponse`. Until A0 ships them they return 404. Show that honestly as a disabled state or error toast; do not fake success.
- Money is integer minor units; display it with `formatMoney()` from `@/contracts`. Timestamps are UTC; display them in `Europe/London`.

## Build against fallbacks

- **Today, the live routes already serve the frozen fixtures:** `GET /api/dashboard` and `GET /api/invoices/inv_fixture_acme`. They carry the response header `x-due-mock: true`.
- Read that header in your API client. When it is true, show a visible **"MOCK DATA"** banner. When A0 wires real data the header disappears, and your UI should need zero changes. That is A4-03.
- For component work and tests you may also import `FIXTURE_DASHBOARD` / `FIXTURE_INVOICE_DETAIL` from `@/contracts/fixtures` directly.

## What to build (PRD A4-01…A4-05)

1. **Header:** a prominent **STRIPE TEST MODE** badge; an application clock that shows **"SIMULATED TIME"** in amber when `appTime.simulated` is true, so it cannot be confused with Stripe timestamps; and the policy version.
2. **Summary cards:** invoiced, collected, outstanding, overdue and open reviews.
3. **Invoice list:**
   - Columns: customer, milestone, Stripe number, total and remaining amounts, due date, Stripe status, and collection status.
   - Show collection status as a separate badge from Stripe status. Never merge them.
   - Show the next action, link to Stripe (`stripeDashboardUrl`) and the hosted invoice URL, and add a "Refresh from Stripe" button.
4. **Recent billing runs:** source type, source ref, state and decision code. Label `fixture_replay` as a fixture. **Reviews panel:** reason and decision code. **Service health:** cognee `unavailable` must read as "fallback in use", not as an error the demo hides.
5. **Invoice detail page** (`/invoices/[id]`):
   - **"Why this amount?"** panel: calculation lines → `priceSource.label` → evidence text with the quote highlighted → policy version.
   - Evidence panel with the source type and ref.
   - Policy rules table.
   - Promises and disputes, with quotes and statuses.
   - Collection actions: reminder #n with delivery state; a call shows dispatch state and outcome separately. **`accepted` dispatch must read as "call initiated", never "answered"**, and `outcome: null` reads as "awaiting result".
   - Call-eligibility checklist (`checks[]`, pass/fail) with `windowClosesAt`.
   - Memory panel that says honestly whether facts came from Cognee or the structured fallback.
   - Audit timeline, oldest to newest, with a "simulated" tag when `simulatedTime` is true.
6. **Demo controls (A4-04):** "Advance clock +24h", "Reset clock" and "Run due actions", plus a result panel. These controls must never create or approve invoices; there is no "create invoice" button anywhere.
7. Loading, empty and error states (with `correlationId`) for every fetch. The layout must be readable at 1280×720 recording size, and the critical story should fit on one screen plus the detail page.

## Definition of Done

- `npm run typecheck` passes in your worktree, and `npm test` passes if you add `src/client/*.test.ts`, e.g. a test that the client parses the envelope and the mock header.
- With `npm run dev`, `/` renders the fixture dashboard with the MOCK DATA banner, TEST MODE badge and simulated-time indicator. `/invoices/inv_fixture_acme` shows "Why £1,200?" traced to "Acme SOW 2026-07 §4.2", the delivered reminder, the call with outcome `promise` dated 2026-11-07, and the deferred reminder #2.
- Demo-control buttons call the real endpoints and degrade honestly while those endpoints return 404.
- Commit only owned files on `codex/dashboard`. Finish with a short handoff: completed task IDs, files changed, how you verified, and known gaps or contract-change requests.

## If you need a change to a locked/shared file

STOP and ask Ammad. Examples are a missing field in `InvoiceDetailData`, a new route, or a dependency. Do not edit `src/contracts/**`, `src/app/api/**`, `package.json` or another lane's files.
