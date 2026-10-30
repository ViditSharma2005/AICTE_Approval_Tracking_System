# Demo-day guide

**Opening line:** *"An approval process doesn't fail because people are lazy. It fails because
nothing is tracking the case. We turned every application into a case file with a route, an owner and
a deadline — and then we never let a deadline pass quietly."*

**Closing line:** *"No application gets lost, no deadline is missed, no inspection is forgotten, and
no expiring document goes unnoticed."*

Before you start: `npm run db:reset`, then either `npm run dev` (real timings) or `npm run demo`
(time compressed — recommended on stage).

---

## The 8-step walkthrough (~9 minutes)

| # | Do this | What it proves |
| --- | --- | --- |
| 1 | **Institution** (`college@stmarys.edu`) → Submit application. Note the route card showing which rules apply. Open the new case file. | Auto-routing. The route and SLAs are **snapshotted** at submission. |
| 2 | **Scrutiny officer** → open the case → **Raise deficiency**. Try submitting with an empty reason: it is refused. Add a reason and submit. | Deficiencies need a recorded reason; they become a **task with a deadline**, not a vague "revert". |
| 3 | **Institution** → Undertakings → **Respond** → attach proof. Watch the case file jump back to **Re-scrutiny** automatically. | The reply re-enters the workflow with no manual chasing. |
| 4 | **Scrutiny officer** → **Complete stage & forward**. The stage SLA resets, the next role is notified, and the stepper advances. | Auto-movement with a fresh clock per stage. |
| 5 | **EVC coordinator** → EVC → **Auto-Allocate Panel** → show the three scored experts and the reason chips ("860km away", "No conflict", "1 visit this month"), swap one from the dropdown, **Confirm panel** → then schedule and **file the inspection report**. | Inspections are scheduled, evidenced and SLA-bound. The engine proposes, the coordinator disposes. |
| 6 | **Competent authority** → **Conditionally approve**, adding two undertakings. | Post-approval compliance is created *by the decision itself*. |
| 7 | **Compliance officer** → Undertakings → verify the institution's submission. Then **Documents** → show a document at 12 days, then one already **Expired** with its escalation. | The system keeps working long after the approval letter. |
| 8 | **Bureau officer** → Dashboard: heat map, region comparison, escalations. Then **Policy admin** → Rule Engine → open the draft v2 → show the **dry-run simulation** → **Publish** → open an old case file and show its route snapshot unchanged. | Command visibility + rules that change without rewriting code or punishing in-flight cases. |

**Then, the eight intelligence features (5 minutes):**

| # | 30-second demo |
| --- | --- |
| 1 | Click any **trust-score badge** next to an institution name → full event log ("LoR −15", "Deficiency item −3"…). Point out: *"This number never suspends anybody — look, there is no such code path."* |
| 2 | **Compliance officer** → Documents → the lease deed shows **"Entered … &#124; OCR …"** with an amber mismatch → **Confirm entered date** or **Use OCR date instead**. |
| 3 | On a case file, open **AI Document Summaries** in the right rail — every panel carries an *AI-generated* badge. |
| 4 | **EVC** → Auto-Allocate Panel (above). |
| 5 | **Scrutiny officer** → dashboard → capacity bar **"7/10 active cases"**. **Admin** → Users → change an officer's cap inline. |
| 6 | Open any reminder notification: it contains a **72-hour magic link**. Open it in a private window — no login, one card, one task. |
| 7 | Click the floating **assistant** (bottom-right) → ask *"What's in my queue?"* or *"Explain the deficiency"*. It answers only from live data and ends with *"official interpretation rests with AICTE."* |
| 8 | Case file → **Letters** → draft a show-cause notice → **Mark as Sent**. Then **Competent authority** → Escalations → **Suspension recommendation** → Approve. Say: *"The institution is now SUSPENDED, and that only happened because a named human clicked Approve."* |

**Finish on:** `admin@aicte.gov.in` → **Audit Trail** → the green *"Chain verified"* banner. Every
action in the demo is attributed to a named human and cannot be edited away.

---

## Live-fire moments (use demo mode)

- The green **Live engine** pill in the header ticks every 5 s. Watch an SLA countdown cross zero and
  an escalation appear on the Regional Officer's dashboard *while you are talking*.
- Escalation ladder: point out `L1 → Regional Officer`, `L2 → Bureau`, `L3 → Bureau Head`. It climbs
  on its own; nobody has to notice.
- Priority score: click any score to show the arithmetic. *"A judge should never have to trust a
  number they can't interrogate."*

---

## Questions to expect, and the answer

**"What if an admin publishes a broken route?"**
Open Rule Engine → new version → uncheck DECISION → the validation panel turns red and **Publish is
refused by the server**, not just hidden in the UI. Routes must include SCRUTINY, must end in DECISION,
must not repeat a stage, and must not conflict with another live route over the same application type.

**"Two rules conflict — what happens?"**
The simulation flags it before publishing and names the conflicting route. Nothing publishes until one
is archived.

**"Does a rule change move existing applications?"**
No — open any case filed under v1 after publishing v2. `routeSnapshot` and `slaSnapshot` are frozen at
submission. New applicants follow the new rules; in-flight cases keep the ones they were judged against.

**"Can the system reject or approve an application by itself?"**
No. Every terminal action is gated on the logged-in role owning the current stage; supervisory roles
are read-only on decisions by design and act through escalation instead.

**"Why is this not just a CRUD app?"**
Because the moving parts are the *deadlines*: 90/60/30/7/0-day document alerts, 7/2/0-day undertaking
reminders, a three-rung escalation ladder, automatic re-scrutiny on reply, and automatic EVC queueing.

**"Where's the AI?"**
Eight places, all advisory: the trust score (explainable, event-sourced), OCR date extraction with
conflict detection, AI document summaries, EVC panel allocation, magic links, the context-aware
assistant, auto-drafted letters, and the non-compliance recommendation. Every one of them has a human
in the loop, and every output on screen carries an *AI-generated* / *Advisory* label.

**"Can the AI suspend an institution?"**
No — and this is the most important answer in the demo. An undertaking more than 3 days overdue flags
the institution **NON_COMPLIANT**, which is only a visibility flag. It then raises a *Suspension
Recommendation* task. The Competent Authority must Approve or Reject with a recorded reason, and only
Approve sets **SUSPENDED** — with their name in the audit trail. One entry point, one human, one
recorded decision.

**"Does it need API keys?"**
No. With no keys set, the document reader and the assistant run deterministic local engines with the
same interfaces, so every screen works offline. Add `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`
and the same code paths call a real model — the guardrails do not change.

---

## If something goes wrong on stage

| Problem | Recovery |
| --- | --- |
| Need a clean dataset mid-demo | `npm run db:reset` (takes ~2 s) |
| Ran out of fresh cases to move | Use any seeded case at Scrutiny; there are 32 |
| Demo mode feels too fast/slow | `DEMO_DAY_MS` in `.env` (default 10 000 ms = 10 s per day) |
| Want real timings | `npm run dev` (DEMO_MODE is off by default) |
