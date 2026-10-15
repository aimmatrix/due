# Due

An AI accounts-receivable agent for service businesses, planned for the Briefcase × Stripe hackathon on 15 October 2026.

Due turns evidence of completed work into Stripe test-mode invoices, explains each charge, and follows up using customer promises and disputes. Customers who do not respond to a delivered reminder become eligible for an ElevenLabs call under explicit policy checks.

## Project status

Foundation and shared contract checkpoint (A0-01, A0-02) are in place. Lane modules ship as typed stubs; see [hack-build/PLAN.md](hack-build/PLAN.md) for ownership and build order.

## Commands

```bash
npm install
cp .env.example .env.local   # Stripe TEST keys only; live keys are refused
npm run dev                  # http://localhost:3000
npm run check:env            # which configuration names are set (never values)
npm run typecheck
npm test
```

`GET /api/health` reports configuration state. `GET /api/dashboard` and `GET /api/invoices/inv_fixture_acme` serve frozen mock fixtures (header `x-due-mock: true`) until the read models are wired.

## Build documents

- [Product requirements and full task breakdown](PRD.md)
- [Teammate handoff: ElevenLabs calling](TEAMMATE_TASKS.md)

## Ownership

- Ammad and separate AI sessions: foundation, billing, Stripe, memory, collections decisions, dashboard and integration.
- Second team member: ElevenLabs outbound calls, conversation configuration and call-result handling.

The PRD defines exclusive file ownership, shared interfaces, task dependencies and separate worktrees to avoid editing conflicts. Complete foundation tasks A0-01 and A0-02 before parallel implementation.

## Demo boundaries

Use synthetic customer data, Stripe test mode and allowlisted, consenting demo call recipients. Never commit API keys or real customer information. Telephone calls are real provider operations even when invoice payments use Stripe test mode.

## Event

[Briefcase × Stripe hackathon](https://hackathons.briefcase.so/stripe-october-2026/)
