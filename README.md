# AICTE — Approval & Compliance Command Centre

A working Next.js prototype of a workflow-driven approval platform: every application becomes a
**digital case file** that moves through an admin-configurable, version-controlled rule engine, with
every task assigned to a named human with a deadline — wrapped in a reminder → escalation system,
role-aware dashboards, exportable reports, and a tamper-evident audit trail.

> **Track → Route → Assign → Remind → Escalate → Verify → Record.**
> No application gets lost, no deadline is missed, no inspection is forgotten, and no expiring
> document goes unnoticed.

**And the one rule underneath all of it:** the system routes, reminds, tracks, escalates, extracts and
recommends — **it never approves, rejects or suspends on its own.** Every automated output is advisory
and every consequential act is a named human decision recorded in the audit trail.

---

## 1. Quick start

Requires **Node.js 18.18+** (built and tested on Node 20/22) and a **PostgreSQL** database. The
easiest option is a free [Neon](https://neon.tech) database: the same one works locally and on Vercel.
For a fully offline machine, run Postgres locally:
`docker run --name aicte-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16`.

```bash
git clone https://github.com/ViditSharma2005/AICTE_Approval_Tracking_System.git
cd AICTE_Approval_Tracking_System

cp .env.example .env   # then fill in DATABASE_URL, DATABASE_URL_UNPOOLED and SESSION_SECRET
npm run setup          # installs deps (generates the Prisma client), applies migrations, seeds
npm run dev            # http://localhost:3000
```

For local Docker Postgres, set both URLs to
`postgresql://postgres:postgres@localhost:5432/aicte?schema=public`.

Open **http://localhost:3000**, click any demo account, and press **Sign in** (the password
`demo123` is pre-filled).

`npm run setup` = `npm install` (its `postinstall` runs `prisma generate`) + `prisma migrate deploy` +
the seed. Note that **the seed wipes and re-creates all demo data**.

**No API keys are needed.** The AI features ship with deterministic offline engines and switch to a live
model automatically if you set one (see §3).

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm start` | Production build / production server |
| `npm run demo` | Dev server with **time compression on** (1 day = 10 s) — see §6 |
| `npm run setup` | Full one-shot install + migrations + seed |
| `npm run db:reset` | **Wipe and re-seed** the database (do this before a fresh demo) |
| `npm run db:seed` | Re-seed without wiping the schema |
| `npm run db:migrate` | `prisma migrate dev` — create a migration after editing `schema.prisma` |
| `npm run db:studio` | Prisma Studio — browse/edit the database in a browser |
| `npm test` | Unit tests for the workflow engine, rule validation and priority scoring |

### Demo accounts (password: `demo123`)

| Email | Role | What you see |
| --- | --- | --- |
| `college@stmarys.edu` | Institution | Own applications, deficiencies, undertakings, documents |
| `principal@wce.ac.in` | Institution | A second institution (Western College) |
| `scrutiny.west@aicte.gov.in` | Scrutiny officer | **Heavy workload** — the clearest bottleneck story |
| `scrutiny.north@aicte.gov.in` | Scrutiny officer | A normal scrutiny queue |
| `evc.west@aicte.gov.in` | EVC coordinator | Inspection queue, auto-allocation, scheduling, report filing |
| `committee@aicte.gov.in` | Committee member | Cases recommended to committee |
| `authority@aicte.gov.in` | Competent authority | Statutory decisions + **suspension recommendations** |
| `compliance.west@aicte.gov.in` | Compliance officer | Undertaking verification, expiry watch, date-conflict queue |
| `regional.west@aicte.gov.in` | Regional officer | Regional command view + escalation desk |
| `bureau@aicte.gov.in` | Bureau officer | National view, heat map, region comparison |
| `policy@aicte.gov.in` | Policy administrator | Rule engine (simulate → publish) |
| `admin@aicte.gov.in` | System administrator | Users (incl. workload caps), audit trail, chain verification |

The full list is also rendered on the login screen — click any account to load it.

---

### Vercel deployment

Vercel runs the app as serverless functions with **no persistent disk**, so SQLite cannot be used
there. The project uses PostgreSQL. Its build wiring:

- `postinstall: prisma generate`: Vercel caches `node_modules`, so without this the Prisma Client is
  stale or missing and the type-check fails (`Parameter 't' implicitly has an 'any' type` in
  `prisma/seed.ts`).
- `vercel-build: prisma generate && prisma migrate deploy && next build`: Vercel runs this instead
  of `build`, so every deployment applies pending migrations before building.

**Fresh deployment, step by step**

1. **Create the database.** Vercel → *Storage* → *Create Database* → **Neon** (free), and connect it to
   the project. This injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct)
   automatically. With your own Neon/Supabase database, add those two variables by hand.
2. **Import the repo.** Vercel → *Add New* → *Project* → pick this repo. Framework: **Next.js**. Leave
   the Build/Install/Output commands at their defaults (`vercel-build` is detected automatically) and
   the Root Directory at `./`.
3. **Environment variables** (Settings → Environment Variables, for Production *and* Preview):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | pooled Postgres URL (set by the Neon integration) |
   | `DATABASE_URL_UNPOOLED` | direct Postgres URL (set by the Neon integration) |
   | `SESSION_SECRET` | a long random string (`openssl rand -base64 32`) |
   | `DEMO_MODE` | `false` (or `true` for a time-compressed judging demo) |
   | `DEMO_DAY_MS` | `10000` |
   | `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | optional |

4. **Deploy.** The build creates all tables (`prisma migrate deploy`).
5. **Seed once, from your machine**, pointing at the same database:
   ```bash
   # .env contains the Neon DATABASE_URL / DATABASE_URL_UNPOOLED
   npm install
   npm run db:seed
   ```
   (The seed wipes data, so it is deliberately not part of the build.)
6. Open the `*.vercel.app` URL and sign in with any demo account (`demo123`).

After a schema change: `npm run db:migrate` locally (creates a migration), commit it, push, and Vercel
applies it on the next deployment.

## 2. What is actually built

### The workflow engine (not hard-coded stages)
`src/lib/workflow.ts` is pure, testable logic. Routes live in the database as **versioned rule
templates** (`RouteTemplate`). A route is an ordered list of stages with a per-stage SLA; the
administrator edits them in the UI at **Administration → Rule Engine (APH)**.

Four routes ship seeded:

| Route | Stages | Applies to |
| --- | --- | --- |
| New institution | Scrutiny 7d → EVC 21d → Committee 14d → Decision 10d | New institutions |
| Renewal | Scrutiny 7d → Decision 10d | Existing institutions |
| Extension / new course | Scrutiny 7d → EVC 21d → Decision 10d | Extension, new course |
| New institution **v2 (draft)** | Scrutiny 5d → EVC 14d → Committee 10d → Decision 7d | Ready to simulate & publish |

**Rule versioning.** When an application is submitted, the route *and* the SLAs are **snapshotted**
onto the application (`routeSnapshot`, `slaSnapshot`). Publishing a new APH version never re-routes an
in-flight case — "an application submitted in 2026 follows APH 2026.1". The case file shows the
snapshot it is bound to.

**Validation + dry-run simulation.** Before publishing, the engine refuses routes that (a) have no
DECISION stage, (b) repeat a stage, (c) miss an SLA, or (d) conflict with another *live* route over the
same application types. The admin sees a simulation: how many in-flight cases are affected, and
whether any would be stranded at a stage the new route removes.

### The deadline engine (Track → Remind → Escalate)
`src/lib/scheduler.ts`. There is **no background worker** — a single idempotent `runSchedulerTick()`
runs on every authenticated page render (throttled) and on demand via `POST /api/tick`, which the
"Live engine" pill in the header polls every 5 seconds. Zero infrastructure, always on.

| Watch | Reminders fire | Then escalates |
| --- | --- | --- |
| Application stage SLA | 2 days, 0 days before | L1 Regional Officer → L2 (3d late) Bureau → L3 (7d late) Bureau Head |
| EVC visit | on queue + SLA breach | Overdue flag + Regional Officer |
| Undertaking / deficiency | 7, 2, 0 days before | Overdue → Regional Officer; 5 days late → Bureau (L2) |
| Document validity | 90, 60, 30, 7, 0 days before | Expired → Compliance Officer |

Every reminder tier that has already fired is recorded, so nothing is ever notified twice. Each
undertaking reminder also carries a **72-hour magic link** (feature 6).

### Screens (all functional)

| Screen | Highlights |
| --- | --- |
| **Dashboard** | Ten role-specific dashboards from one scoped query — officer action centre (with a workload capacity bar), regional stage×ageing, national heat map, institution task list (with its own trust score), compliance posture, policy rule view |
| **Applications** | Filterable list (search, stage, status, type, region, past-SLA, mine), sorted by urgency; trust badge on every row |
| **Case file** | The star screen: route stepper, auto one-page case summary, tabs (Overview / EVC / Undertakings / Documents / Timeline & audit), and a right rail that renders **only** the actions valid for your role at this stage — plus the trust-score breakdown, AI document summaries and the letter drawer |
| **EVC** | Queue → **auto-allocate panel** (scored experts, coordinator confirms) → schedule → file inspection report (satisfactory / deficient) |
| **Undertakings** | Pre-approval deficiencies + post-approval conditions in one register, with reminders, proof uploads and officer verification |
| **Documents** | Expiry register, tiered alerts, renewal upload → compliance verification, entered-vs-OCR date comparison and conflict resolution |
| **Escalations** | Three-rung ladder, resolve with a recorded action note, plus **suspension recommendations** for the Competent Authority (Approve / Reject) |
| **Respond (public)** | `/respond/magic/[token]` — no-login, mobile-first compliance response page with clean expired / already-used states |
| **Reports** | Six consolidated reports (region pendency, stage ageing, institution compliance, overdue register, document register, escalation register) — each exportable to CSV, plus print-to-PDF |
| **Rule engine** | Versioned routes, validation, conflict detection, dry-run simulation, publish/archive |
| **Audit trail** | Append-only, hash-chained log with live chain verification |
| **Assistant** | Floating chat button on every page (bottom-right), context-aware and read-only |

---

## 3. The eight intelligence features

Every one of these was built to a single rule: **the system routes, reminds, tracks, escalates,
extracts and recommends — it never approves, rejects or suspends on its own.**

| # | Feature | Where to see it | Engine |
| --- | --- | --- | --- |
| 1 | **Compliance trust score** | Badge next to every institution name, everywhere (green ≥80 / amber 50–79 / red <50). Click it for the full event log. | `src/lib/trust.ts` — event-sourced. LoR −15, deficiency item −3 (capped at −12 per application), undertaking overdue −10, document expired −8, on-time compliance +2, appeal upheld +5, clamped 0–100. |
| 2 | **OCR date extraction + conflict detection** | Documents register: "Entered: X · OCR: Y (91%)" with an amber mismatch warning and officer confirmation. | `src/lib/ocr.ts` — Vercel AI SDK `generateObject` + zod when an API key is set, otherwise a deterministic offline reader with the same interface and the same 800 ms latency. |
| 3 | **AI document summaries** | Case file → right rail → "AI Document Summaries" (collapsed by default). | Reuses the feature-2 call; stored on `Document.aiSummary`; every panel carries an **AI-generated** badge. |
| 4 | **EVC auto-allocation** | `/evc` → "Auto-Allocate Panel" on any queued visit. | `src/lib/evc-matcher.ts` — haversine distance, +40 available, +30/20/10 for <100/300/500 km, −100 for same-state or declared conflict, +10 if under the monthly cap. Trust score <50 restricts the chair to professor level. The coordinator reviews, swaps and confirms — nothing is saved until they do. |
| 5 | **Officer workload cap** | Capacity bar "7/10 active cases" on officer dashboards; per-officer cap editor at **Administration → Users**. | `src/lib/assignment.ts` — new cases go to the lightest-loaded officer under their cap. When a region is full the case waits in the unassigned queue and the Regional Officer is told; assigning anyway requires a reason and writes `OVERRIDE_ASSIGNMENT`. |
| 6 | **Magic links** | Any reminder notification contains a 72-hour single-use link. | `src/lib/magic.ts` + public route `/respond/magic/[token]` (no login, mobile-first). Responses are audited as "Institution (magic link)". |
| 7 | **Context-aware assistant** | Floating button, bottom-right, on every page. | `src/app/api/chat/route.ts` — `streamText` with seven read-only tools that each re-check the caller's role and region. Answers only from tool results, ends with source links, and always appends "This is AI assistance; official interpretation rests with AICTE." No key? `src/lib/chat-fallback.ts` answers deterministically from the same tools. |
| 8 | **Auto-drafted letters + non-compliant flag** | Case file → Letters; `/escalations` → Suspension recommendations. | `src/lib/letters.ts` (Handlebars: deficiency notice, show cause, conditional approval) → review dialog → **Mark as Sent**. An undertaking more than 3 days overdue flags the institution `NON_COMPLIANT` (a visibility flag, not a penalty) and raises a **Suspension Recommendation** task. Only the Competent Authority's *Approve* sets `SUSPENDED`, and it records their name in the audit trail. |

### The trust score in detail (feature 1)

The score is **descriptive, never punitive**. `Institution.trustScore` is a cached derivation of the
`TrustScoreEvent` table — the event log is the source of truth, so the badge can always explain itself.
Events are written from the places they actually happen: a Letter of Rejection in `performTransition`,
each deficiency item created there, undertaking verification in `verifySubmission`, and the scheduler's
overdue and document-expiry ticks. The per-application cap on deficiency items stops one messy case from
sinking an institution on its own. Clicking the badge fetches `/api/trust` (role- and region-scoped) and
shows the contributions by event type plus the full history.

There is deliberately **no code path** from the score to a suspension, penalty or rejection. The one
place the score changes behaviour is feature 4: below 50, an EVC chair must be professor level — a
scrutiny decision, not a punishment.

### Real AI or no AI — both work

The project ships with **no API keys required**. Without them, the document reader and the assistant run
deterministic local engines with identical interfaces, so every screen and every workflow is fully
demoable offline. Set one key in `.env` (see `.env.example`) and the same code paths call a live model:

```bash
OPENAI_API_KEY="sk-..."            # or GOOGLE_GENERATIVE_AI_API_KEY="..."
OPENAI_MODEL="gpt-4o-mini"         # optional; defaults are in the code
```

If the provider errors, times out or is rate-limited, both features fall back to the offline engine and
log it — a missing key never breaks a workflow.

### Guardrails you can hold us to

- The trust score is descriptive. **No code path suspends, penalises or auto-rejects on it.**
- OCR/AI output is never written to a record as truth without a human confirming it — the date conflict
  stays flagged until an officer picks "Confirm entered date" or "Use OCR date instead".
- Letters are drafted, never sent automatically — **Mark as Sent** is the only dispatch path.
- Suspension has exactly one entry point: `decideSuspension()` in `src/lib/suspension.ts`, reachable only
  through the Competent Authority's Approve button, with a mandatory recorded reason.
- The assistant is read-only by construction: its tools take no write arguments, and each one re-resolves
  the caller with `getUser()` before touching the database.
- Every AI-generated thing on screen carries an **AI-generated** or **Advisory** badge.

---

## 4. Cross-cutting design decisions worth defending

- **Human-in-the-loop.** Supervisory roles (Regional/Bureau/Policy/System Admin) are deliberately
  **read-only** on statutory decisions — they act through escalation, never by overriding. Every
  decision records the officer's name in an append-only audit trail.
- **Deficiencies are tasks, not vibes.** A revert creates a tracked undertaking with its own deadline,
  reminders and escalation path. Replying auto-returns the case to re-scrutiny.
- **Explainable priority score.** Clicking any score shows its arithmetic (`+30 overdue, +20 EVC late…`).
- **Tamper-evident audit trail.** Each entry commits to the previous entry's hash; the audit page
  re-walks the whole chain on every load and reports INTACT / BROKEN.
- **Row-level scoping.** `scopeFor(user)` in `src/lib/rbac.ts` is applied to every query: institutions
  see only themselves, regional staff only their region, national roles everything. Enforced again on
  the case-file page itself, not just in the nav — and again inside every chatbot tool.
- **Works without JavaScript.** The critical forms are progressive-enhancement server actions, and the
  trust-badge breakdown, letter review and allocation dialog are all reachable without a framework
  runtime.

---

## 5. Project structure

```
aicte-portal/
├── prisma/
│   ├── schema.prisma        # data model (PostgreSQL)
│   ├── migrations/          # PostgreSQL migrations (single init baseline)
│   ├── seed.ts              # deterministic demo narrative, not random rows
├── src/
│   ├── app/
│   │   ├── login/           # sign-in + one-click demo accounts
│   │   ├── respond/magic/[token]/   # PUBLIC no-login response page (feature 6)
│   │   ├── (app)/           # everything behind auth (shared shell: gov strip + sidebar)
│   │   │   ├── dashboard/ applications/ evc/ undertakings/ documents/
│   │   │   ├── escalations/ reports/ notifications/
│   │   │   ├── admin/rules/ admin/users/ admin/audit/
│   │   │   └── institution/submit  institution/respond/[id]
│   │   └── api/
│   │       ├── tick/ reports/            # engine tick, CSV exports
│   │       ├── trust/                    # trust-score breakdown (scoped)
│   │       ├── evc/panel/ evc/confirm/   # allocation proposal + confirm
│   │       ├── letters/preview/ letters/send/
│   │       └── chat/                     # streaming, tool-calling assistant
│   ├── actions/             # server actions — every state change goes through here
│   ├── components/
│   │   ├── ui/ case/ charts/ forms/ dashboards/ app-shell/
│   │   ├── trust-badge.tsx  ai-badge.tsx  capacity-bar.tsx
│   │   ├── evc-allocate.tsx letter-dialog.tsx chat-widget.tsx
│   └── lib/
│       ├── workflow.ts      # routing engine + rule validation + publish simulation (pure)
│       ├── scheduler.ts     # reminders + escalation ladder (idempotent)
│       ├── priority.ts      # explainable priority score
│       ├── audit.ts         # hash-chained audit trail + verification
│       ├── session.ts       # JWT cookie auth
│       ├── rbac.ts          # roles, navigation, row-level scoping
│       ├── time.ts          # demo-aware time helpers
│       ├── queries.ts       # scoped reads + dashboard aggregations
│       ├── trust.ts         # (1) event-sourced trust score
│       ├── ocr.ts           # (2,3) document reader + summary codec
│       ├── documents.ts     # shared expiry/escalation + conflict helpers
│       ├── evc-matcher.ts   # (4) panel scoring and proposal
│       ├── assignment.ts    # (5) workload caps and queueing
│       ├── magic.ts         # (6) single-use, expiring links
│       ├── chat-tools.ts    # (7) read-only, role-scoped assistant tools
│       ├── chat-fallback.ts # (7) no-key deterministic answers
│       ├── letters.ts       # (8) Handlebars letter templates
│       └── suspension.ts    # (8) the only path to SUSPENDED
└── tests/workflow.test.ts   # 14 unit tests (npm test)
```

Stack: Next.js 15 (App Router) · TypeScript · Prisma · PostgreSQL · Tailwind CSS · lucide-react · jose ·
bcryptjs · Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/google`), `zod`, `handlebars`. Charts are
hand-rolled SVG/HTML — no chart library, so nothing to break mid-demo.

---

## 6. Data model (at a glance)

`Region` → `Institution` → `Application` (the case file) → `StageTransition` (full movement history)
· `EvcVisit` · `Undertaking` + `ComplianceSubmission` (deficiencies and post-approval conditions) ·
`Document` (expiry register) · `RouteTemplate` (versioned rules) · `Notification` · `Escalation` ·
`AuditLog` · `User` (11 roles).

Added for the eight features:

| Model | Feature | Purpose |
| --- | --- | --- |
| `TrustScoreEvent` | 1 | Append-only event log behind the score; `Institution.trustScore` is the cached sum |
| `Institution.latitude / longitude / status` | 1, 4, 8 | Geo for panel distance; `ACTIVE / NON_COMPLIANT / SUSPENDED` visibility flag |
| `Document.enteredDate / ocrExtractedDate / ocrConfidence / dateConflict / officerConfirmed / aiSummary` | 2, 3 | The extraction, the conflict and the human resolution |
| `Expert` (+ `User.expert`) | 4 | Empanelled pool: designation, state, city, coordinates, busy ranges, conflict states, monthly cap |
| `EvcVisit.experts / allocatedAt / allocatedBy` | 4 | The confirmed panel and who confirmed it |
| `User.maxActiveCases` | 5 | Per-officer workload cap (default 10) |
| `MagicLink` | 6 | Token, purpose, entity, expiry, used-at |
| `Letter` | 8 | Drafted/issued letters; `SENT` only after an officer marks it |
| `Task` | 8 | Recommendations requiring a human decision (suspension) |

The schema was originally written for SQLite and keeps its portability rules: no `enum` blocks
(enum-like columns are `String`, validated by `src/lib/constants.ts`) and no scalar lists (JSON is
stored in `String` columns via `src/lib/json.ts`). Text search uses `mode: "insensitive"` so search
stays case-insensitive on PostgreSQL.

---

## 7. Demo mode: time compression

Real-world timelines are impossible to show in a ten-minute demo. With `DEMO_MODE=true` one "day"
lasts `DEMO_DAY_MS` milliseconds, so a 7-day SLA expires in ~70 seconds and you can watch reminders
fire and escalations climb live.

```bash
npm run demo      # dev server with DEMO_MODE=true, DEMO_DAY_MS=10000
npm run db:reset  # re-seed so all deadlines are relative to the compressed clock
```

In demo mode the header shows a green **Live engine** pill (click to pause) and dashboards
auto-refresh. Set `DEMO_MODE=false` in `.env` for real 24-hour days — verified working in both modes.

`DEMO-GUIDE.md` has the 8-step stage walkthrough plus a 30-second demo script for each of the eight
intelligence features.

---

## 8. Database notes

The project runs on PostgreSQL (required for Vercel). Optionally, promote the enum-like `String`
columns into real `enum` blocks; the values in `src/lib/constants.ts` are already the exact names.
Run `npm run db:migrate` after any schema edit.

---

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Database empty / login fails with unknown user | `npm run db:seed` (or `npm run db:reset`) against the same `DATABASE_URL` |
| Vercel build: `Parameter 't' implicitly has an 'any' type` / `@prisma/client did not initialize yet` | Prisma Client not generated: make sure `postinstall: prisma generate` is in `package.json`, then redeploy *without* build cache |
| Vercel build: `Environment variable not found: DATABASE_URL_UNPOOLED` | Add both DB variables in Vercel (the Neon integration sets them) for Production **and** Preview |
| Vercel build: `P1001 Can't reach database server` | Wrong URL, or missing `?sslmode=require` |
| "P2022 / column does not exist" after pulling new code | `npx prisma migrate deploy` — the schema changed; never edit tables by hand |
| Cannot log in after `npm run build && npm start` on plain HTTP | Very unlikely — cookies are marked Secure only when the request arrives over HTTPS. Force it with `COOKIE_SECURE=true` (or `false`) behind an unusual proxy. |
| Assistant answers "I don't have that information" | Expected: either no AI key is set (deterministic mode) or no tool returned data. It never invents an answer. |
| Assistant is slow offline | By design — the offline engine streams in small chunks so the UI behaves identically to the streaming model. |
| OCR dates look invented | They are, deliberately: with no key the reader is a deterministic mock. It is labelled as such and always needs officer confirmation. |
| Port 3000 busy | `npx next dev -p 3001` |
| TypeScript/editor cannot find `@/…` | Restart the TS server; paths are mapped in `tsconfig.json` |
| Want a clean slate | `npm run db:reset` |

**Security note:** this is a prototype. `SESSION_SECRET` ships with a placeholder value in `.env` —
change it before any real deployment. Passwords are bcrypt-hashed, sessions are HTTP-only JWTs, and
file uploads are stored as references (filenames) rather than binaries.

---

## 10. Verification status

Checked before shipping:

- `npm run build` — clean compile, strict TypeScript, all routes
- `npx tsc --noEmit` — clean
- `npm test` — 14/14 unit tests (routing, rule validation, conflict detection, simulation, RBAC, priority)
- **147 authenticated page loads** across 12 roles × 12 screens (dashboard, applications, case files,
  EVC, undertakings, documents, escalations, reports, notifications, admin) — 0 failures
- Feature endpoints exercised end to end: trust breakdown, EVC panel proposal + confirm, letter
  preview ×3 + mark-as-sent, chat (role-scoped, keyed and keyless), magic-link response page
  (valid, used and invalid tokens)
- Suspension safety verified: Reject leaves the status untouched; Approve sets `SUSPENDED` and records
  the authority's name; replaying a decision is refused
- Audit hash chain verified intact across every entry
- Clean-extract test: unzip → `npm install` → `npm run setup` → `npm run build` → `next start`, then
  72 authenticated page loads — 0 failures
