"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// ★ = priority watch: Context.dev checks every 6 h instead of once a day (max 3).
export function PriorityStar({ id, on }: { id: number; on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const r = await fetch(`/api/startups/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority: !on }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return alert(j.error ?? "failed");
    router.refresh();
  }
  return (
    <button type="button" onClick={toggle} disabled={busy} className="star-btn" title={on ? "Priority: checked every 6 h (click to make it daily)" : "Checked daily. Star it to check every 6 h (max 3)"} aria-pressed={on}
      style={{ color: on ? "#F59E0B" : "#CBD5E1" }}>
      {on ? "★" : "☆"}
    </button>
  );
}
