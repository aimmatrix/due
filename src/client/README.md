# A4 dashboard handoff

Implemented A4-01 through A4-05 against the frozen API. The UI fetches the actual endpoints; it never substitutes local fixtures. A4-06 technical checks are complete; live end-to-end rehearsal awaits backend integration.

## Preview

Branch: `codex/dashboard`, based on spine `517ccf7`.
Worktree: `/Users/ammad/Downloads/due-dashboard`.
Run `PORT=3102 npm run dev`, then open http://localhost:3102.

## Demo sequence (under two minutes)

1. Overview: point to **MOCK DATA** while fixtures are being served. Identify total, collected and outstanding amounts; Stripe status and collection status are distinct.
2. Open Acme's Website migration. Explain £1,200 from the stored contract clause, the highlighted completion evidence, tax assumption and policy version.
3. Scroll to Collection journey: reminder #1 delivered → call initiated → separately recorded promise outcome → reminder #2 deferred until 8 November.
4. Point to the 7 November promise and call eligibility checks. The active promise blocks another call. Structured fallback is identified honestly when Cognee is unavailable.
5. Show the audit trail, including simulated application timestamps and the original recorded timestamps in Decision provenance.
6. Once the backend is wired, use Advance clock +24h / Run due actions, then refresh from Stripe after a test payment. The UI reloads its read model after each successful mutation. It never creates or approves invoices.

## Verification

- `npm run typecheck`: passes.
- `npm test`: 15 tests, including 8 API-client tests. Covers mock-marker removal, API error correlation, HTML 404 handling, malformed envelopes, network failures, clock request serialization and escaped invoice IDs.
- Browser checked at 1280×720 and 390×844: invoice filters, empty search results, fixture amounts, invoice navigation, highlighted evidence, dispatch versus outcome, simulated clock and unavailable-control error handling. Mobile detail has no page-level horizontal overflow.
- Production build: both `npm run build` (Turbopack) and `npm run build -- --webpack` passed. Initial sandbox permission/cache errors cleared after a clean build in the final worktree location.

## Backend integration gaps for A0

- `POST /api/demo/clock`, `POST /api/demo/run-due-actions`, and `POST /api/invoices/:id/refresh` are absent at the spine checkpoint. Buttons call the contracts and show readable errors; there is no fabricated success.
- The dashboard fixture includes `inv_fixture_acme_seo`, but its detail API only accepts `inv_fixture_acme`. Opening SEO audit therefore shows the API's `INVOICE_NOT_FOUND` error and correlation ID. A0 should supply a detail read model for every listed invoice.
- Remove `x-due-mock: true` only when read models are backed by actual records. The UI then removes its mock banner automatically.
- Real input → Stripe invoice → payment → zero balance and real telephony remain backend/integration acceptance work. This lane does not claim external operations were exercised.
- No changes to contracts, API routes, server modules, manifests or lockfiles are needed.
