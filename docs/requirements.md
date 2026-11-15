# Requirements traceability

Each row ties a regulatory requirement to the code that enforces it and the tests that prove it.
The full plain-language map, including later stages, is in the
[plan document](https://claude.ai/artifact/EuyWv1JJ5PPy3NUzCQyEqV).

Sources: [21 CFR 56](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-56),
[21 CFR 50](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-50),
[21 CFR 11](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11),
[FDA IRB FAQ (Feb 2025)](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/institutional-review-boards-frequently-asked-questions),
[AAHRPP standards](https://www.aahrpp.org/resources/for-accreditation/instruments/evaluation-instrument-for-accreditation/introduction/list-of-standards-and-elements).

| ID | Requirement | Enforced in | Tested in | Status |
| --- | --- | --- | --- | --- |
| REQ-56.107 | At least 5 members; scientist, nonscientist, unaffiliated; not one profession; gender diversity effort | `src/domain/roster.ts` `evaluateComposition` | `src/domain/roster.test.ts` | Done |
| REQ-FAQ15 | Alternates formally linked to the primaries they replace, with comparable qualifications | `src/domain/roster.ts` `checkAlternate` | `src/domain/roster.test.ts` | Done |
| REQ-AAHRPP-I.1.B | Members appointed by the organizational official | `src/lib/members.ts` `appointMember` | `src/lib/foundation.integration.test.ts` | Done |
| REQ-AAHRPP-II-1 | Members trained before reviewing; training renewed every 3 years; reminders before it expires | `src/domain/training.ts`; `selectReviewers` skips untrained or expired members; `src/lib/training.ts` | `src/domain/review.test.ts`, `src/lib/stage3.integration.test.ts` | Done |
| REQ-11.10(i) | People who use the system are trained to do so | `src/domain/training.ts` course "system" required for every role | `src/lib/stage3.integration.test.ts` | Done |
| REQ-AAHRPP-I-1 | Written policies and procedures, approved by the organization, kept current, communicated to members | `src/domain/policy-library.ts` (15 starter SOPs), `src/lib/policies.ts`; approved text frozen by trigger (`drizzle/0008_stage3.sql`) | `src/lib/stage3.integration.test.ts` | Done (starter texts need expert review before approval) |
| REQ-AAHRPP-I-4 | Participants and others can raise complaints, questions and concerns, and get answers | `src/app/concern` (public, no sign-in), `src/lib/complaints.ts` | `src/lib/stage3.integration.test.ts` | Done |
| REQ-AAHRPP-I-5 | Quality improvement: measures, periodic signed review, yearly policy review | `src/lib/quality.ts`, `src/app/quality`, `policyReviewSweep` | `src/lib/stage3.integration.test.ts` | Done |
| REQ-11.10(d),(g) | Access limited to authorized people; authority checks | `src/lib/auth/session.ts`, `src/lib/members.ts` `requireRole` | `src/lib/foundation.integration.test.ts` | Done |
| REQ-11.10(e) | Secure, time-stamped, permanent audit trail | `src/lib/audit.ts`, `drizzle/0001_audit_immutability.sql` | `src/lib/foundation.integration.test.ts` | Done |
| REQ-11.50 | Signature shows printed name, date/time, meaning | `src/lib/esign.ts` | `src/lib/foundation.integration.test.ts` | Done |
| REQ-11.70 | Signature bound to its record | `src/lib/esign.ts` `recordHash`, `verifySignature` | `src/lib/foundation.integration.test.ts` | Done |
| REQ-11.200 | Two distinct identification components | `src/lib/auth/service.ts`, `src/lib/auth/totp.ts`, `src/lib/esign.ts` | `src/lib/auth/auth-unit.test.ts`, integration test | Done |
| REQ-11.300 | Password controls, lockout and reporting of failed attempts | `src/lib/auth/password.ts`, `src/lib/auth/service.ts` | `src/lib/auth/auth-unit.test.ts`, integration test | Done |
| REQ-56.107(e) | Conflicted members excluded from review; declaration required before seeing the study | `src/lib/submissions.ts` `declareConflict`, `completeReview`; `src/domain/review.ts` `selectReviewers` | `src/domain/review.test.ts`, `src/lib/submissions.integration.test.ts` | Done |
| REQ-AAHRPP-II.1.E | Reviewers with matching expertise; consultant flagged when none | `src/domain/review.ts` `selectReviewers` | `src/domain/review.test.ts` | Done |
| REQ-50.25 | Consent form contains required elements | `src/domain/consent.ts`; intake blocks until each gap is resolved | `src/domain/review.test.ts`, `src/lib/submissions.integration.test.ts` | Done |
| REQ-56.110 | Expedited review only for eligible research, only by designated experienced reviewers, who may not disapprove | `src/domain/review.ts` `proposePath`, `validateDecision`; `setExperiencedReviewer` (chair only) | `src/domain/review.test.ts`, integration test | Done |
| REQ-56.111 | Every approval criterion answered; none unmet for approval | `src/domain/review.ts` `APPROVAL_CRITERIA`, `validateDecision` | `src/domain/review.test.ts` | Done |
| REQ-56.109(e),(f) | Written decision to investigator, reasons when changes required; approval at most 12 months | `src/lib/submissions.ts` `issueLetter`; letters table is permanent | `src/lib/submissions.integration.test.ts` | Done |
| REQ-56.108(c) | Greater-than-minimal-risk research goes to a convened full board; quorum is a majority of seats including a nonscientist; a motion needs a majority of those present | `src/domain/review.ts` `proposePath`; `src/domain/meeting.ts` `countSeats`, `tally`; `src/lib/meetings.ts` `closeVote` | `src/domain/meeting.test.ts`, `src/lib/meetings.integration.test.ts` | Done |
| REQ-FAQ14/15/28 | Remote members count only with the materials; alternates take only a listed primary's seat, of the same kind, never alongside that primary; quorum rechecked after each recusal; quorum counted against the seats, not the size of the member pool; optional house policy (every seat filled plus an unaffiliated member), changed only by the official's e-signature | `src/domain/meeting.ts` `countSeats`, `assignSeats`; `src/lib/meetings.ts` `joinMeeting`, `itemSeats`, `recuse`; `src/lib/settings.ts` | `src/domain/meeting.test.ts`, `src/lib/meetings.integration.test.ts` | Done |
| REQ-56.115(a)(2) | Minutes show attendance, actions, votes for/against/abstaining, basis for changes or disapproval, and controverted issues | `src/domain/minutes.ts` `generateMinutes`; chair signs them | `src/lib/meetings.integration.test.ts` | Done |
| REQ-FAQ8 | Member pay does not depend on the decision | `src/lib/pay.ts` `recordEarning` takes no decision | `src/lib/meetings.integration.test.ts` | Done |
| REQ-56.109(f) | Continuing review at least yearly; reminders before approval ends; research stops the day after it lapses; on-time renewal extends from the old expiry | `src/domain/oversight.ts` `approvalState`, `renewedExpiry`; `src/lib/oversight.ts` `runOversightSweep`, `createFollowOnSubmission`; `applyDecision` | `src/domain/oversight.test.ts`, `src/lib/oversight.integration.test.ts` | Done |
| REQ-56.108(a)(4) | Changes to approved research reviewed before they start; minor changes may be expedited; the approval period is unchanged | `src/lib/oversight.ts` `createFollowOnSubmission`; `src/domain/review.ts` `proposePath` | `src/lib/oversight.integration.test.ts` | Done |
| REQ-56.108(b) | Prompt reports of unanticipated problems, serious or continuing noncompliance, suspension or termination to the investigator, institution and FDA | `src/domain/oversight.ts` `requiredReports`; `src/lib/oversight.ts` `determineEvent` drafts them, `signRegulatoryReport` (official) | `src/domain/oversight.test.ts`, `src/lib/oversight.integration.test.ts` | Partial: sending by email comes in stage 3 |
| REQ-56.113 | Suspension or termination with reasons; only the chair (urgently) or the board | `src/domain/oversight.ts` `determinationProblems`; study status set to suspended or terminated | `src/domain/oversight.test.ts`, `src/lib/oversight.integration.test.ts` | Done |
| REQ-11.10(b) | Accurate and complete copies of records in human-readable form, with signature manifestations, for inspection | `src/lib/pdf.ts`; PDF routes for letters, minutes and regulatory reports | `src/lib/pdf.test.ts` | Done |
| REQ-56.115(b) | Records kept at least 3 years after study completion | `src/lib/oversight.ts` `closeStudy` sets the retention date; audit, signature, letter and training tables cannot be deleted | `src/lib/oversight.integration.test.ts`, `src/lib/foundation.integration.test.ts` | Done |

Not yet built (stage 3): policies and procedures, training records, complaints portal, QA dashboards, validation package, file uploads for protocols and consent forms, email and push notifications (in-app notices exist), PDF letters, hosting.
