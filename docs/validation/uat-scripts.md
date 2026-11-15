# User acceptance scripts (performance qualification)

Run each script on the hosted system using made-up data. For each step, record pass or fail, take a
screenshot where marked, and sign at the end. Any failure is logged, fixed through change control, and
the script is run again.

## UAT-1: Appoint the board

1. Administrator adds five members with different backgrounds (scientist, nonscientist, unaffiliated) and one alternate. Expected: the overview says the board cannot review research yet.
2. Official signs each appointment. Expected: overview shows "Yes" once the composition rules are met. Screenshot.
3. Each member records their human-subjects, orientation and system training. Expected: the training page shows all current.

## UAT-2: Expedited review on a phone

1. Investigator submits a minimal-risk study with a consent form missing one element. Expected: it cannot be sent until the gap is resolved.
2. Investigator resolves the gap and sends. Expected: an experienced reviewer is assigned within seconds and notified.
3. Reviewer, on a phone, declares no conflict, answers every criterion and signs. Expected: the investigator receives an approval letter at once with an expiry date no more than 12 months away. Screenshot.

## UAT-3: Full-board meeting

1. Investigator submits a greater-than-minimal-risk study; two reviewers complete their pre-reviews.
2. Chair schedules the meeting; members join by video, one by phone. Expected: quorum shows only once a majority including a nonscientist is present.
3. A member declares a conflict and steps out. Expected: quorum is rechecked.
4. Chair records findings and opens voting; members vote on phones; chair closes the vote. Expected: result and letter match the votes.
5. Chair adjourns and signs the minutes. Expected: minutes list attendance, votes for, against and abstaining, and controverted issues. Screenshot.

## UAT-4: Continuing review and lapse

1. Set a test study's approval to end in 30 days. Expected: the investigator is reminded.
2. Let a test study's approval end. Expected: the next day it is marked lapsed and the investigator and chair are told research must stop.
3. Investigator submits continuing review; reviewer approves. Expected: approval extends and the study is active again.

## UAT-5: Problem report

1. Investigator reports an unexpected serious event. Expected: chair is notified.
2. Chair determines it is an unanticipated problem and suspends approval, signing. Expected: study shows suspended; reports to FDA and the institution are drafted.
3. Official signs the reports. Screenshot.

## UAT-6: Public concern

1. Without signing in, submit a concern on `/concern` from a phone. Expected: a reference code is shown.
2. Chair answers it. Expected: entering the reference on `/concern` shows the answer.

## UAT-7: Policies and quality review

1. Official approves a policy. Expected: members are asked to read it; text can no longer be edited, only revised as a new version.
2. Chair opens the quality dashboard and signs the quarterly review. Screenshot.

## UAT-8: Security and records

1. Enter a wrong password five times. Expected: account locks and the audit trail records it.
2. Leave a session idle for 30 minutes. Expected: sign-in is required again.
3. Open the audit trail. Expected: every action above is listed with who, what and when, and integrity shows intact.

Executed by: ____________________  Date: __________

Reviewed by: ____________________  Date: __________
