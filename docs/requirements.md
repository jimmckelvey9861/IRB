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
| REQ-AAHRPP-II.1.B | Members trained before reviewing | `src/domain/roster.ts` (warning) | `src/domain/roster.test.ts` | Partial: routing block comes with routing |
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
| REQ-56.108(c) | Greater-than-minimal-risk research goes to a convened full board | `src/domain/review.ts` `proposePath`; submission waits as "awaiting meeting" | `src/lib/submissions.integration.test.ts` | Partial: meetings are stage 2 |
| REQ-56.115(b) | Records kept at least 3 years after study completion | Audit and signature tables cannot be deleted | integration test | Partial: per-study retention clock comes with studies |

Not yet built: convened meetings, quorum and voting, minutes (stage 2); file uploads for protocols and consent forms; email and phone notifications; PDF letters.
