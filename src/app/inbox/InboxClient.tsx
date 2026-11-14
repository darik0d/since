"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PasteBox() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/inbound/paste", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      if (!j.created) setMsg("Already in the inbox.");
      else if (j.status === "pending") { setMsg("Found a “not yet”: added below."); setText(""); }
      else setMsg(j.note ?? "No “not yet” with conditions found.");
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="glass card" style={{ display: "grid", gap: 10 }} onSubmit={submit}>
      <label className="field">
        Paste an email or notes
        <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Hi Mikko, great to meet at Slush. We'll pass for now: come back when you have your first enterprise customer…" />
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn btn-primary" type="submit" disabled={busy || text.trim().length < 20}>{busy ? "Reading…" : "Find the “not yet”"}</button>
        {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </form>
  );
}

export function InboxActions({ id, href }: { id: number; href: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Link className="btn btn-primary" href={href}>Start watching</Link>
      <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true);
        await fetch(`/api/inbound/${id}/dismiss`, { method: "POST" });
        router.refresh();
      }}>Dismiss</button>
    </div>
  );
}
