const LABEL: Record<string, string> = {
  platform: "Platform",
  independent: "Independent",
  founder_controlled: "Founder-controlled",
};

export function SourceBadge({ type }: { type: string }) {
  return <span className={`src-badge src-${type}`}>{LABEL[type] ?? type}</span>;
}
