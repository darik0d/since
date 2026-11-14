export type Status = "watching" | "reported" | "confirmed" | "needs_review" | "ask_at_checkin" | "expired";

const LABEL: Record<Status, string> = {
  watching: "Watching",
  reported: "Reported",
  confirmed: "Confirmed",
  needs_review: "Needs review",
  ask_at_checkin: "Ask at check-in",
  expired: "Expired",
};

export function StatusChip({ status, children }: { status: Status; children?: React.ReactNode }) {
  return <span className={`chip chip-${status}`}>{children ?? LABEL[status]}</span>;
}
