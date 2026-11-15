/**
 * Starter written procedures (SOPs) for the IRB. AAHRPP expects written policies and procedures for
 * every part of the protection program, approved by the organization and followed in practice.
 *
 * These are plain-language starting drafts that describe what this software enforces. They load as
 * drafts; a qualified regulatory reviewer should check them before the organizational official
 * approves them. Each one cites the rules it implements.
 */

export interface StarterPolicy {
  code: string;
  title: string;
  sources: string;
  body: string;
}

const s = (lines: string[]) => lines.join("\n");

export const STARTER_POLICIES: StarterPolicy[] = [
  {
    code: "SOP-01",
    title: "Authority, independence and scope of the IRB",
    sources: "21 CFR 56.102, 56.103, 56.109(a); AAHRPP Standards I-1, II-1",
    body: s([
      "Purpose: to set out what the IRB may decide and how its independence is protected.",
      "",
      "1. The IRB reviews FDA-regulated clinical investigations of drugs and biologics that name it as the reviewing IRB. It may approve, require changes to, or disapprove research, and it may suspend or terminate approval.",
      "2. No one, including the organization's owners, officers or sponsors, may approve research the IRB has not approved, or overrule an IRB disapproval.",
      "3. Anyone who tries to influence an IRB decision improperly must be reported to the organizational official, who records the report and responds within 5 business days. Members may report directly and without retaliation.",
      "4. The organizational official is responsible for the program and appoints members, but has no vote and takes no part in review decisions.",
      "5. Member pay never depends on a decision (see SOP-14).",
    ]),
  },
  {
    code: "SOP-02",
    title: "Membership, appointment, alternates and training",
    sources: "21 CFR 56.107; FDA IRB FAQ 15, 16; 21 CFR 11.10(i); AAHRPP Standard II-1",
    body: s([
      "Purpose: to keep the board properly qualified and composed.",
      "",
      "1. The board has at least 5 voting members with varied backgrounds, including at least one scientist, one nonscientist and one member not otherwise affiliated with the organization. It may not consist entirely of one profession, and every reasonable effort is made to include both men and women.",
      "2. The administrator records each candidate's qualifications; the organizational official appoints members by electronic signature. Appointments are for a stated term.",
      "3. Alternates are appointed the same way and are linked to the primary members they may replace. An alternate has comparable qualifications and votes only when their primary is absent.",
      "4. Before reviewing, each member completes human-subjects protection training (renewed every 3 years), orientation to these procedures, and training on this system. The system does not assign reviews to members whose training is missing or expired.",
      "5. The system checks the composition rules continuously and warns the administrator and official when a rule is not met.",
    ]),
  },
  {
    code: "SOP-03",
    title: "Conflicts of interest",
    sources: "21 CFR 56.107(e); 21 CFR Part 54; AAHRPP Standards I-6, II-1",
    body: s([
      "Purpose: to keep personal interests out of IRB decisions.",
      "",
      "1. A member has a conflict when they, or their spouse or dependent children, have a financial interest in the sponsor or the product, are involved in the study, or have any other interest that could affect their judgment.",
      "2. Before seeing a study's materials, an assigned reviewer must declare whether they have a conflict. A reviewer who declares one is withdrawn at once and the system assigns another.",
      "3. At a meeting, a conflicted member steps out for that item, is not counted toward quorum for it, and does not vote, except to answer questions the board asks.",
      "4. Investigators disclose their financial interests in the submission; the IRB considers them when judging risks and the consent form.",
      "5. The organization's own financial interests in research it reviews are disclosed to the board and reviewed by the official.",
    ]),
  },
  {
    code: "SOP-04",
    title: "Submissions and choosing the review path",
    sources: "21 CFR 56.108(a), 56.110; 63 FR 60364; AAHRPP Standard II-2",
    body: s([
      "Purpose: to make sure every submission gets the right kind of review quickly.",
      "",
      "1. Investigators submit through the system. A submission that lacks a required consent element cannot be sent until the investigator shows where it is covered.",
      "2. The system proposes expedited review only when the research is no more than minimal risk and fits a published expedited category, or when an amendment is a minor change. Everything else goes to the convened board.",
      "3. The assigned reviewer confirms the path. If they disagree, they refer the submission to the full board.",
      "4. Reviewers are assigned automatically by expertise and workload. When no member has the needed expertise, the chair invites a non-voting consultant, who also declares conflicts.",
    ]),
  },
  {
    code: "SOP-05",
    title: "Expedited review",
    sources: "21 CFR 56.110; FDA IRB FAQ 20; AAHRPP Standard II-2",
    body: s([
      "Purpose: to set out who may do expedited review and what they may decide.",
      "",
      "1. Expedited review is done by the chair or by experienced members the chair designates in the system.",
      "2. The reviewer applies the same approval criteria as the board (SOP-07) and signs the review electronically.",
      "3. The reviewer may approve or require changes. They may not disapprove; research they would disapprove goes to the full board.",
      "4. All members are told of research approved by expedited review through the system.",
    ]),
  },
  {
    code: "SOP-06",
    title: "Convened meetings, quorum, voting and minutes",
    sources: "21 CFR 56.108(c), 56.115(a)(2); FDA IRB FAQ 14, 15, 28; AAHRPP Standards II-2, II-5",
    body: s([
      "Purpose: to make full-board decisions valid and well recorded.",
      "",
      "1. Meetings may be held by video or phone. Members attending remotely count only if they received the materials beforehand and can take part in the discussion. Votes by email do not count.",
      "2. Quorum is a majority of the voting seats and must include at least one nonscientist. The system rechecks quorum for every item, after every arrival, departure and recusal. Without quorum, no vote is taken.",
      "3. A motion passes with a majority of the members present, so an abstention counts the same as a vote against.",
      "4. The board makes and records each approval-criterion finding before voting.",
      "5. The system writes the minutes from the meeting record: attendance, actions, the vote count for, against and abstaining, the reasons for requiring changes or disapproving, and a summary of controverted issues and their resolution. The chair signs them electronically.",
    ]),
  },
  {
    code: "SOP-07",
    title: "Criteria for approval and informed consent",
    sources: "21 CFR 56.111, 50.20, 50.25, 50.27; AAHRPP Standard II-3",
    body: s([
      "Purpose: to make sure no research is approved unless every criterion is met.",
      "",
      "1. Reviewers record a finding for each criterion of 21 CFR 56.111: risks minimized; risks reasonable; equitable selection; consent sought and documented; data monitoring; privacy and confidentiality; safeguards for vulnerable subjects; and the rules for children.",
      "2. No answer is filled in for the reviewer. Approval is impossible while any criterion is unmet.",
      "3. The consent form must contain every element of 21 CFR 50.25(a) and the additional elements that apply. The system checks the text and the reviewer confirms it.",
      "4. Approval lasts at most 12 months.",
      "5. The investigator receives the decision in writing. When changes are required or research is disapproved, the letter states the reasons, and the investigator may respond in person or in writing.",
    ]),
  },
  {
    code: "SOP-08",
    title: "Children and other vulnerable participants",
    sources: "21 CFR 50 Subpart D, 56.111(b), 56.107(a); AAHRPP Standard II-4",
    body: s([
      "Purpose: to give extra protection to people who may be vulnerable to coercion or undue influence.",
      "",
      "1. Submissions state whether the research involves children or other vulnerable people, such as people with impaired decision-making capacity or people in a dependent relationship with the investigator.",
      "2. When children are involved, the board finds and records which Subpart D category applies (50.51, 50.52 or 50.53), and how parents' permission and children's assent will be obtained. Research under 50.54 needs FDA review.",
      "3. When the board regularly reviews research with a vulnerable group, it includes a member or consultant knowledgeable about that group.",
    ]),
  },
  {
    code: "SOP-09",
    title: "Continuing review, amendments and lapses",
    sources: "21 CFR 56.108(a)(3)-(4), 56.109(f), 56.110(b); FDA guidance on continuing review (2012); AAHRPP Standard II-2",
    body: s([
      "Purpose: to keep approved research under review for as long as it runs.",
      "",
      "1. The system reminds the investigator 60, 30, 14, 7 and 1 days before approval ends.",
      "2. The investigator submits a continuing review with a progress report: enrollment, withdrawals, problems and new information. Approval renewed on time runs from the old expiry date.",
      "3. If approval ends before renewal, the study is marked lapsed the next day. All research activity stops, including enrollment and procedures, unless the IRB finds that enrolled participants' safety requires them to continue.",
      "4. Changes to approved research may not start until the IRB approves them, except to remove an immediate hazard to participants, which must be reported promptly.",
    ]),
  },
  {
    code: "SOP-10",
    title: "Unanticipated problems, noncompliance, suspension and termination",
    sources: "21 CFR 56.108(b), 56.113, 312.66; AAHRPP Standards I-5, II-2",
    body: s([
      "Purpose: to act quickly on problems and report them to the right people.",
      "",
      "1. Investigators report unanticipated problems, serious adverse events they believe may meet that definition, deviations and possible noncompliance through the system. The chair is notified at once.",
      "2. The chair or a designated member decides, and signs, whether the event is an unanticipated problem involving risks to participants or others, whether there was serious or continuing noncompliance, and what action is needed.",
      "3. Only the chair (urgently, to protect participants) or the convened board may suspend or terminate approval. A chair's urgent action goes to the board at its next meeting.",
      "4. For each reportable finding, the system drafts a report to the investigator, the organizational official, FDA and the sponsor. The official signs it and it is sent promptly, normally within 30 days of the determination.",
    ]),
  },
  {
    code: "SOP-11",
    title: "Complaints, questions and concerns",
    sources: "AAHRPP Standards I-4, I-5",
    body: s([
      "Purpose: to give participants and others a way to be heard.",
      "",
      "1. Anyone may raise a complaint, question or concern through the public form or by the phone number in every consent form, without signing in and, if they wish, without giving their name.",
      "2. The system acknowledges each one at once and the chair or administrator responds within 5 business days.",
      "3. A complaint that suggests harm or noncompliance is handled under SOP-10.",
      "4. Complaints are reviewed in the quarterly quality review (SOP-13).",
    ]),
  },
  {
    code: "SOP-12",
    title: "Records, electronic signatures and retention",
    sources: "21 CFR 56.115, Part 11; AAHRPP Standard II-5",
    body: s([
      "Purpose: to keep complete, trustworthy records.",
      "",
      "1. All IRB records are kept in this system: submissions, reviews, minutes, letters, reports, membership, training and these procedures.",
      "2. Every change is written to a permanent, time-stamped audit trail that the database will not let anyone change or delete. The system checks the trail's integrity continuously.",
      "3. Electronic signatures need the signer's password at the moment of signing, show the signer's name, date, time and meaning, and are bound to the exact record signed. Each person certifies to FDA that their electronic signature is the legal equivalent of a handwritten one.",
      "4. Sign-in uses a password and an authenticator code. Accounts lock after 5 failed attempts.",
      "5. Records are kept for at least 3 years after the research ends, and longer if a sponsor agreement requires it.",
    ]),
  },
  {
    code: "SOP-13",
    title: "Quality improvement",
    sources: "AAHRPP Standard I-5",
    body: s([
      "Purpose: to measure how well the program works and improve it.",
      "",
      "1. The system tracks review turnaround, overdue reviews and reports, meeting quorum, training status, lapsed studies, complaints and audit-trail integrity on the quality dashboard.",
      "2. Each quarter the chair and official review the dashboard, record findings and actions, and sign the review.",
      "3. Every policy is reviewed at least once a year. The system reminds the official when a review is due.",
    ]),
  },
  {
    code: "SOP-14",
    title: "Member compensation",
    sources: "FDA IRB FAQ 8; AAHRPP Standard I-1",
    body: s([
      "Purpose: to pay members fairly without influencing decisions.",
      "",
      "1. Members earn a flat amount for each completed review and each meeting attended, plus an hourly stipend for time on call. The amount is the same whatever the decision.",
      "2. Rates are set by the administrator and recorded with their effective date. Earnings are paid weekly.",
      "3. No member is paid by a sponsor or investigator for reviewing their research.",
    ]),
  },
  {
    code: "SOP-15",
    title: "Investigator responsibilities",
    sources: "21 CFR 312.53, 312.60, 312.62, 312.66, 50.20; AAHRPP Standards III-1, III-2",
    body: s([
      "Purpose: to tell investigators what the IRB expects of them.",
      "",
      "1. Investigators complete human-subjects and Good Clinical Practice training before submitting, and renew it every 3 years.",
      "2. They obtain and document informed consent using the approved form, and start no research and make no change without IRB approval.",
      "3. They promptly report unanticipated problems, deviations and noncompliance, and submit continuing review on time.",
      "4. They keep research records as FDA and the sponsor require, and give the IRB access on request.",
    ]),
  },
];
