/**
 * Training requirements and status. Pure functions; no database access.
 *
 * Sources: AAHRPP Standards I-1 (education of the HRPP's people), II-1 (members know their duties),
 * III-1 (researchers know their obligations); 21 CFR 11.10(i) (people who use the electronic records
 * system are trained to do so); ICH E6 (GCP).
 */

export type TrainingRole = "administrator" | "official" | "chair" | "member" | "investigator";

export interface Course {
  id: string;
  label: string;
  requiredFor: TrainingRole[];
  /** Months the completion stays valid; null means once is enough. */
  validMonths: number | null;
}

export const COURSES: Course[] = [
  {
    id: "human-subjects",
    label: "Human subjects protection (for example CITI Biomedical)",
    requiredFor: ["chair", "member", "official", "investigator"],
    validMonths: 36,
  },
  { id: "gcp", label: "Good Clinical Practice (ICH E6)", requiredFor: ["investigator"], validMonths: 36 },
  { id: "irb-orientation", label: "Orientation to this IRB's policies and procedures", requiredFor: ["chair", "member"], validMonths: null },
  {
    id: "system",
    label: "Using this system: electronic records and signatures (21 CFR 11.10(i))",
    requiredFor: ["administrator", "official", "chair", "member", "investigator"],
    validMonths: null,
  },
];

/** Human-subjects training stays valid this long; reviewers with older training are not assigned work. */
export const HUMAN_SUBJECTS_VALID_MONTHS = 36;

export const TRAINING_REMINDER_DAYS = [60, 30, 7] as const;

export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function expiryFor(courseId: string, completedOn: string): string | null {
  const c = COURSES.find((x) => x.id === courseId);
  return c?.validMonths ? addMonthsIso(completedOn, c.validMonths) : null;
}

/** True when a human-subjects completion date is recent enough to review research. */
export function humanSubjectsCurrent(completedOn: string | null | undefined, today: string): boolean {
  return !!completedOn && addMonthsIso(completedOn, HUMAN_SUBJECTS_VALID_MONTHS) > today;
}

export interface TrainingRecordLike {
  course: string;
  completedOn: string;
  expiresOn: string | null;
}

export type CourseStatus =
  | { course: Course; state: "missing" }
  | { course: Course; state: "current"; completedOn: string; expiresOn: string | null; daysLeft: number | null }
  | { course: Course; state: "expired"; completedOn: string; expiresOn: string };

function days(fromIso: string, toIso: string) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** The status of every course a person's roles require, using their latest completion of each. */
export function trainingStatus(roles: TrainingRole[], records: TrainingRecordLike[], today: string): CourseStatus[] {
  return COURSES.filter((c) => c.requiredFor.some((r) => roles.includes(r))).map((course) => {
    const latest = records
      .filter((r) => r.course === course.id)
      .sort((a, b) => b.completedOn.localeCompare(a.completedOn))[0];
    if (!latest) return { course, state: "missing" as const };
    if (latest.expiresOn && latest.expiresOn <= today) {
      return { course, state: "expired" as const, completedOn: latest.completedOn, expiresOn: latest.expiresOn };
    }
    return {
      course,
      state: "current" as const,
      completedOn: latest.completedOn,
      expiresOn: latest.expiresOn,
      daysLeft: latest.expiresOn ? days(today, latest.expiresOn) : null,
    };
  });
}
