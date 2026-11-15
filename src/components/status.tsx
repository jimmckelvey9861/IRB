import { Badge } from "./ui";

const LABELS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In review", tone: "warn" },
  awaiting_meeting: { label: "Awaiting board meeting", tone: "warn" },
  modifications_required: { label: "Changes required", tone: "bad" },
  approved: { label: "Approved", tone: "good" },
  disapproved: { label: "Disapproved", tone: "bad" },
  assigned: { label: "To do", tone: "warn" },
  completed: { label: "Done", tone: "good" },
  withdrawn_conflict: { label: "Withdrawn (conflict)", tone: "neutral" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = LABELS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
