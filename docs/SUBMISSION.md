# Due — submission draft

Status: **draft; integration evidence required before submission.** See DEMO-RUNBOOK.md and its validation log. The requested checkpoint cannot yet demonstrate a real invoice or scheduler. Do not turn proposed features into verified claims.

| Field | Draft |
| --- | --- |
| Project name | Due |
| Team name | [TEAM NAME] |
| Description (1–2 sentences) | Due is an accounts-receivable agent that turns completion evidence into explained invoices and adapts follow-ups to customer context. This build targets Stripe test-mode billing, with promises and disputes constraining collections; see the recorded demonstration for verified behavior. |
| Track | Agents that collect |
| Member 1 name / email | [NAME] / [EMAIL] |
| Member 2 name / email | [NAME] / [EMAIL] |
| Additional members, if applicable | [NAMES AND EMAILS; OMIT IF UNUSED] |
| Public GitHub repository | [PUBLIC REPO URL] |
| Public video (≤2:00) | [PUBLIC VIDEO URL] |
| Recording revision | [COMMIT SHA] |
| Stripe features actually verified | None verified in this tooling lane. Replace with only the rows proven below before submitting. |
| Cognee checkbox | **Leave unchecked** until genuine ingestion/retrieval and its effect on a decision are demonstrated. |

## Evidence to complete before making feature claims

| Candidate feature | Required proof | Current evidence |
| --- | --- | --- |
| Stripe test customer and invoice creation/finalisation | Actual test dashboard object ID and automatic completion run/correlation ID | [UNVERIFIED] |
| Hosted invoice payment | Matching hosted test payment and Stripe status | [UNVERIFIED] |
| Signed webhook reconciliation | Verified webhook event, local zero balance, cancelled pending actions | [UNVERIFIED] |
| Manual refresh recovery | Actual refresh response and matching Stripe snapshot | [UNVERIFIED] |
| Collections/voice | Delivered reminder, 24h simulated window, actual allowlisted call, signed source-linked outcome | [UNVERIFIED] |
| Cognee side quest | Provider is Cognee, customer-scoped retrieval sources, and decision changed by retrieved context | [UNVERIFIED — unchecked] |

Do not list partial payments, instalments, production collections, invoice-email delivery or Cognee based solely on contracts, fake adapters, UI placeholders or intended design. Keep all contact details out of the public repo; fill actual names/emails into the submission form privately. Public links can be added here after verification.

The PRD records a submission deadline before 21:00 Europe/London on 15 October 2026. Ammad owns submission; a teammate should check repository and video access while logged out and confirm the organiser's current form and deadline. This draft does not submit or publish anything.
