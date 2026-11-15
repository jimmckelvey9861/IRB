# Validation plan

FDA requires that a computer system holding regulated electronic records is validated: shown, with
evidence, to do what it is meant to do accurately and reliably (21 CFR 11.10(a)). This plan explains
how that evidence is produced for every release. It follows the usual three steps.

| Step | Question it answers | How | Evidence |
| --- | --- | --- | --- |
| Installation qualification (IQ) | Is it installed correctly? | The checklist below, run once per environment and after infrastructure changes | Signed checklist |
| Operational qualification (OQ) | Does every function work as specified? | `npm run validate` runs every automated test against a real database and maps each result to the requirement it proves | `validation/oq-report.md`, kept with the release |
| Performance qualification (PQ) | Does it work for our people, in our process? | Staff run the scripts in [uat-scripts.md](uat-scripts.md) on the hosted system using made-up data | Signed scripts with screenshots |

## Requirements

The requirements are the rows of [docs/requirements.md](../requirements.md). Each row names the rule,
the code that enforces it and the tests that prove it. Every automated test carries the IDs of the
requirements it covers, for example `[REQ-56.108(c)]`. The OQ report fails if any requirement has
no passing test, if any test fails, or if the database tests were skipped.

## Change control

1. Every change is made on a branch and merged through a pull request; no one changes the running system directly.
2. Continuous integration runs type checks, lint, all tests, the build and the OQ report on each pull request. A failing check blocks the merge.
3. Before deployment the organizational official (or delegate) reads the OQ report, confirms that changed requirements have tests, and signs the release.
4. Changes that affect how people use the system get a PQ re-run of the affected scripts.
5. The release record keeps: the commit, the OQ report, any PQ scripts, and the signature.

## Installation qualification checklist

Run on each new environment (for example, production on AWS) and file the signed copy.

- [ ] The hosting account is covered by a signed HIPAA business associate agreement.
- [ ] The database is encrypted at rest, with automated backups and point-in-time recovery turned on.
- [ ] A backup restore has been tested into a separate environment.
- [ ] All traffic uses HTTPS; plain HTTP redirects.
- [ ] `npm run db:migrate` completed and the database schema version matches the release.
- [ ] Audit-trail protection works: an attempted `UPDATE audit_events ...` by the application's database user is refused.
- [ ] The overview page shows "Audit trail integrity: Intact".
- [ ] The daily job (`npm run daily`) is scheduled once a day and its last run succeeded.
- [ ] Server clocks use NTP (time stamps in the audit trail depend on it).
- [ ] Only named people have administrator access to the hosting account, each with two-factor sign-in.
- [ ] The application's environment variables hold no default or demo passwords, and no demo accounts exist.

Completed by: ____________________  Date: __________

## Electronic signature certification

Before anyone signs electronically, the organization sends FDA a one-time letter certifying that the
electronic signatures used in its system are the legally binding equivalent of handwritten signatures
(21 CFR 11.100(c)). Send it before the IRB's first electronically signed decision, to the FDA office named in 11.100(c); check FDA's Part 11 web page for the current address.
