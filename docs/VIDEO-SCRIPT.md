# Due — two-minute video script

Recording gate: complete the runbook pre-flight with real Stripe test objects, delivered reminder evidence and one actual teammate call. If integration is blocked, show that state and remove unsupported narration. Target 1:58 to leave export margin; maximum public video length is 2:00. Follow PRD §14 in this order.

| Time | On screen | Narration |
| --- | --- | --- |
| 0:00–0:15 | Service-completion form; enter synthetic Acme migration evidence and click Report completion. Keep the access code hidden. Show source and correlation ID. | “Service businesses finish work, then spend time turning evidence into invoices and chasing payment. Here, reporting Acme's completed migration starts Due automatically.” |
| 0:15–0:45 | Due invoice detail, then Open in Stripe. Show actual test-mode invoice ID, finalised state, hosted payment link and £1,200. Return to Due. | “Due checks the customer, contract and billing policy, then creates and finalises this Stripe test invoice. Nobody raised or approved the bill manually.” |
| 0:45–0:55 | Why £1,200?, contract §4.2, completion source and policy version. | “Every pound comes from the agreed milestone. This line points to the contract, the completion evidence and the policy that permitted it.” |
| 0:55–1:25 | Label SIMULATED APPLICATION TIME. Show overdue clock, successfully delivered reminder and recorded delivery timestamp. Then +24h, eligibility checks and real ElevenLabs teammate call, with AI identification audible. | “We advance Due's application clock, not Stripe's. After confirmed reminder delivery and twenty-four hours without a reply, Due rechecks payment and customer context before one permitted AI call.” |
| 1:25–1:40 | Signed call-result event, source-linked promise and deferred next action. Optional genuine Cognee retrieval panel only if verified. | “The call produces a recorded promise to pay. That promise defers further contact and keeps its source attached.” Optional, only if true: “Cognee retrieves this context before the decision.” |
| 1:40–1:50 | Hosted Stripe test payment, return to Due, verified reconciliation and zero remaining balance. | “A Stripe test payment reconciles the balance and cancels pending collections.” If manual refresh was needed: “We refresh from Stripe to recover a delayed webhook.” |
| 1:50–1:58 | Overview paid state, audit trail and source links. | “Due turns completed work into explained invoices, follows up within policy, and remembers when to stop.” |

Overlay during every time jump: **“Simulated Due application time; Stripe time unchanged.”** Overlay edits: **“Waiting time edited out; events shown in original order.”** Remove waiting transparently, preserving causal order; do not splice a promise or payment from a different invoice into this sequence. Show test mode throughout. Hide credentials, account emails and real phone numbers in browser chrome, terminal output and call views.

If the call cannot be verified, say “Voice integration is not verified in this build” and show the blocker; do not use the successful-call narration. If a message becomes review, say “This reply needs review”; do not call it a recognised promise. Structured fallback is not a Cognee integration. The video script is a proposed shot list, not a record of completed acceptance checks.

Before upload: check audio, readable evidence, duration, a publicly accessible URL and the same repo revision used for the recording. Put the final URLs and verified feature claims in SUBMISSION.md.
