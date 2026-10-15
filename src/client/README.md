# R2-4 live dashboard handoff

Implements A4-03 through A4-06. Production UI reads `/api/dashboard` and `/api/invoices/:id` only; synthetic contract fixtures are imported exclusively by tests. The removed `x-due-mock` header is no longer consulted.

## Behaviour

- Empty invoices link to `/forms/completion`. Recent runs display exact states, `lastError.code`, error messages and `decisionCode`; review and retryable failure states are visually distinct.
- Clock controls use GET/POST `/api/demo/clock`. The amber SIMULATED TIME label and the manually ticked Demo path appear when the read model reports simulated time. The checklist can also be opened explicitly in real time.
- Demo actions refetch the visible read model even on failure, since an action may have made partial progress. Invoice-detail controls also refetch the dashboard. Stripe refresh uses the returned `changed` flag. No dashboard control creates or approves an invoice.
- Visible pages refresh every 15 seconds and on focus so external call/payment webhooks appear without manual navigation. Fetches are aborted on navigation or replacement.
- Reminder delivery, eligibility checks and the response-window countdown use application time. Accepted dispatch with no outcome says “Call initiated, awaiting result”. Summary, promise date and transcript reference appear only when returned.
- Collection status, promises, disputes, unused memory and degraded/fake service details remain explicit. External Stripe links open in new tabs.

## Verification

- `npm run typecheck` passed; `npm test` passed (176 tests across the integrated workspace at verification time).
- Client regression tests cover missing scheduler HTML/JSON responses, clock reads/writes, invoice refresh, error references, empty-state form navigation, failure/review codes, simulated-only checklist, pending/recorded voice outcomes and application-clock countdown boundaries.
- Browser checked at 1280×720: an isolated empty SQLite database showed the completion link; submitting the real form returned `review_required` / `CUSTOMER_UNRESOLVED`, which appeared in recent runs. Clock advance/reset changed the header correctly. The scheduler's actual HTTP 404 displayed “not available yet”.
- Read-only inspection of the existing Stripe test invoice showed its £1,200 stored-price explanation, £0 outstanding balance, unused memory and `_blank` links. Its 390×844 mobile view had document width equal to viewport width (390px).
- The isolated verification used fake external adapters and a temporary database, without changing the existing server's clock or records. No real call, email or payment was initiated by this UI verification.

## Integration requests / remaining rehearsal gaps

1. Scheduler owner: provide `POST /api/demo/run-due-actions` using `RunDueActionsResponse`. It currently returns 404. The UI reports this honestly.
2. Scheduler/voice owners: rehearse delivered reminder → elapsed window → accepted call → webhook result → promise deferral against the live read models. Client rendering is regression-tested, but this provider sequence was not exercised here.
3. API owner: consider exposing whether demo controls are enabled in the read model. Currently disabled mode is discovered from the POST's `DEMO_MODE_DISABLED` response.
4. No contract extensions are required for the requested UI. Controls have no approval or invoice-creation route.
