"use client";

import { useState } from "react";

export function Reschedule() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await fetch("/api/admin/reschedule", { method: "POST" });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        setMsg(j.ok ? `${j.monitors} monitors on the pilot schedule` : `${j.monitors ?? 0} monitors, ${j.failed?.length ?? "?"} failed: ${(j.failed ?? [j.error]).slice(0, 2).join("; ")}`);
      }}>{busy ? "Rescheduling…" : "Put all monitors on the pilot schedule"}</button>
      {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
    </div>
  );
}
