"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type CheckOut = { ok: boolean; status?: string; changed?: boolean; summary?: string | null; error?: string; evidence?: { passes: boolean }[]; monitors?: unknown[] };

export function CheckButtons({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "check" | "recheck">("");
  const [msg, setMsg] = useState("");

  async function run(kind: "check" | "recheck") {
    setBusy(kind);
    setMsg("");
    try {
      const r = await fetch(`/api/conditions/${id}/${kind}`, { method: "POST" });
      const j: CheckOut = await r.json();
      if (!j.ok) throw new Error(j.error ?? "failed");
      const ev = j.evidence ? ` · ${j.evidence.filter((e) => e.passes).length} passing evidence` : "";
      const mon = kind === "recheck" ? ` · ${j.monitors?.length ?? 0} monitors queued` : "";
      setMsg(`${j.status}${j.changed ? " (changed)" : ""}: ${j.summary ?? ""}${ev}${mon}`);
      router.refresh();
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  }

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 6 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" disabled={busy !== ""} onClick={() => run("check")} title="Run the verifier once via Context.dev scrape, no monitor">
          {busy === "check" ? "Checking…" : "Check now"}
        </button>
        <button className="btn btn-primary" disabled={busy !== ""} onClick={() => run("recheck")} title="Check now + run this condition's Context.dev monitors">
          {busy === "recheck" ? "Re-checking…" : "Re-check now"}
        </button>
      </div>
      {msg && <div className="muted" style={{ fontSize: 12.5, maxWidth: 460, textAlign: "right" }}>{msg}</div>}
    </div>
  );
}

export function MarkWrong({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="link-btn"
      style={{ marginLeft: "auto" }}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/evidence/${id}/wrong`, { method: "POST" });
        router.refresh();
      }}
    >
      {busy ? "…" : "Mark as wrong"}
    </button>
  );
}
