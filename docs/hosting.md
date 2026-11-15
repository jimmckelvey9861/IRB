# Hosting on AWS

This is the plan for running the IRB system with real study records. Until every step below is done
and the installation checklist in [validation/plan.md](validation/plan.md) is signed, use made-up data
only.

## Why AWS

AWS signs a HIPAA business associate agreement (BAA) online at no charge, and every service below is
on its list of HIPAA-eligible services. Check the current list on the AWS HIPAA page before you start,
because it changes. Equivalent setups work on Google Cloud or Azure.

## What you (Jim) need to do

1. Create an AWS account for the organization, owned by a company email address, with two-factor sign-in on the root user. Then lock the root user away.
2. In AWS Artifact, accept the **AWS Business Associate Addendum** for the account.
3. Decide the domain name (for example `irb.yourcro.com`).
4. Give the person deploying an IAM user or SSO login with administrator rights. Do not share the root login.

Those four steps need a person at the organization. Everything else can be done by whoever deploys.

## Architecture

| Piece | AWS service | Settings that matter |
| --- | --- | --- |
| Web app | ECS on Fargate, behind an Application Load Balancer | 2 tasks in 2 availability zones; image from this repo's `Dockerfile`; command `npm start` |
| Worker | ECS on Fargate | 1 task; command `npm run worker` (emails every 30 seconds, daily reminders) |
| Database | RDS for PostgreSQL 16 | Multi-AZ; encrypted with KMS; automated backups kept 35 days; deletion protection on; not publicly reachable |
| Email | SES (SMTP) | Verify the domain; request production access; put the SMTP credentials in `SMTP_URL` |
| HTTPS | ACM certificate on the load balancer; Route 53 for DNS | Redirect HTTP to HTTPS |
| Secrets | Secrets Manager | `DATABASE_URL`, `SMTP_URL`; injected into the tasks, never in the image |
| Logs and alarms | CloudWatch | Keep logs at least 6 years; alarm on task restarts, 5xx errors, and the worker's last daily run |
| Firewall | AWS WAF on the load balancer | Managed rule sets plus a rate limit on `/login` and `/concern` |
| Audit of AWS itself | CloudTrail | On for all regions, logs to an encrypted S3 bucket with object lock |

## Database roles

The audit trail is protected by database triggers. A database owner could remove a trigger, so the
application must not connect as the owner.

```sql
-- Run once as the RDS master user after the first migration.
CREATE ROLE irb_app LOGIN PASSWORD '<generated>';
GRANT USAGE ON SCHEMA public TO irb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO irb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO irb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO irb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO irb_app;
```

- The web app and worker use `irb_app`.
- Migrations (`npm run db:migrate`) run as a one-off ECS task using the owner role, as part of each release.

## Environment variables

| Name | Value |
| --- | --- |
| `DATABASE_URL` | `postgres://irb_app:...@<rds-endpoint>:5432/irb?sslmode=require` |
| `APP_URL` | `https://irb.yourcro.com` |
| `SMTP_URL` | SES SMTP URL with credentials |
| `MAIL_FROM` | `Your IRB <irb@yourcro.com>` |
| `IRB_NAME` | The IRB's registered name, as on its FDA registration |

## Releasing a change

1. Merge the pull request after CI passes; CI attaches the OQ report.
2. Build and push the image to ECR, tagged with the commit.
3. Run the migrate task, then update the web and worker services to the new image.
4. The official signs the release record (see the validation plan).

## Rough cost

For one small IRB: about $150 to $300 a month, mostly the Multi-AZ database and two web tasks. SES and
CloudWatch add a few dollars. Check the AWS pricing calculator for current prices.

## Before real data

- [ ] BAA accepted
- [ ] Installation checklist in the validation plan signed
- [ ] User acceptance scripts run and signed
- [ ] Demo accounts absent; real accounts created with two-factor sign-in
- [ ] Policies approved by the official
- [ ] 21 CFR 11.100(c) electronic-signature certification letter sent to FDA
- [ ] IRB registered with FDA/OHRP (21 CFR 56.106), with the registration renewed every 3 years
