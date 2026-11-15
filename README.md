# IRB

Software for running an independent Institutional Review Board (IRB) for FDA-regulated drug trials,
designed to pass AAHRPP accreditation with as little staff and paperwork as possible.

The software automates the logistics of an IRB (intake checks, routing, scheduling, minutes, letters,
reminders, reports and record keeping) and enforces the federal rules as it goes. Decisions stay with
qualified human members, as the regulations require.

- Plan and requirements map: [IRB software: requirements map and build plan](https://claude.ai/artifact/EuyWv1JJ5PPy3NUzCQyEqV)
- Rule-to-code traceability: [docs/requirements.md](docs/requirements.md)
- Hosting plan (AWS under a HIPAA business associate agreement): [docs/hosting.md](docs/hosting.md)
- Validation (21 CFR 11.10(a)): [docs/validation/plan.md](docs/validation/plan.md); `npm run validate` produces the OQ report

## Status

Stages 1 (core review loop) and 2 (meetings, oversight, pay) are built; stage 3 (accreditation and go-live) is in progress. Done so far:

- Tamper-evident audit trail: permanent, hash-chained entries the database refuses to change (21 CFR 11.10(e))
- Sign-in with password plus authenticator code, account lockout, idle and absolute session timeouts (21 CFR 11.300)
- Electronic signatures that re-check the password and are bound to the exact record signed (21 CFR 11.50, 11.70, 11.200)
- Board roster with alternates, and automatic composition checks against 21 CFR 56.107 and FDA's alternate-member guidance
- Member appointment by electronic signature of the organizational official (AAHRPP I.1.B)
- Study submission with an automatic consent form check against 21 CFR 50.25; incomplete forms cannot be sent
- Automatic review path (expedited or full board) and instant reviewer assignment by expertise and workload
- Conflict-of-interest declaration before a reviewer sees a study; conflicted reviewers are replaced at once
- Approval-criteria checklist (21 CFR 56.111) with no answers pre-filled, signed electronically
- Expedited decisions issue the investigator's letter immediately; full-board studies wait for the meeting (stage 2)
- Phone-friendly review screens
- Board meetings: automatic scheduling from member availability, live quorum meter, alternates, recusals, phone voting, minutes generated from the record and signed by the chair
- Yearly continuing review and amendments; reminders 60, 30, 14, 7 and 1 days before approval ends; studies marked lapsed the day after
- Problem reports: chair or member signs a determination; the system drafts the FDA and institutional reports for the organizational official to sign; suspension and termination
- In-app notices for new reviews, decisions, reminders and reports
- Policies and procedures: 15 starter SOPs, versioned, approved by the official's e-signature, frozen once approved, reviewed yearly, read-and-confirm by members
- Training records with 3-year renewal and reminders; untrained or expired members are not assigned reviews
- Public page (`/concern`) where participants can raise a complaint or question without signing in and check for the reply with a reference code
- Quality dashboard with targets and a signed quarterly review
- PDF copies of letters, minutes and FDA reports, with signature lines
- Email copies of every notice, sent by a background worker with retries (no participant information in emails)
- Study closure with a final report, starting the 3-year records retention date
- Validation package: plan, user acceptance scripts, and an automatically generated OQ report
- Member earnings: flat rate per completed review or meeting plus an on-call stipend, paid weekly, never tied to the decision

**Use made-up data only** until the system runs on a HIPAA-covered hosting account.

## Running locally

Requirements: Node.js 22 and PostgreSQL 16.

```bash
npm ci
cp .env.example .env.local       # adjust the database URLs
npm run db:migrate
npm run db:seed                  # made-up demo users and members
npm run dev
npm run daily                    # reminders and lapse check; in production the worker runs this
npm run worker                   # optional: sends queued emails (needs SMTP_URL) and runs the daily jobs
```

Demo accounts (all `@demo.test`, password printed by the seed script): `admin` adds members, `official`
appoints them, `investigator` submits studies, `dr.maya.patel` is the chair and an expedited reviewer. The first sign-in asks you to add the account to an
authenticator app.

## Checks

```bash
npm run typecheck
npm run lint
npm test          # set TEST_DATABASE_URL to also run the database tests (that database is wiped)
npm run build
```

Tests are tagged with the requirement they prove, for example `[REQ-56.107]`, so the test report
doubles as validation evidence (21 CFR 11.10(a)).

## Stack

TypeScript, Next.js, PostgreSQL (Drizzle ORM), installable web app for phones. Planned hosting: AWS
under a HIPAA business associate agreement.
