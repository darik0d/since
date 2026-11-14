"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Cand = { id: string; name: string; entity_type: string; description: string | null; website: string | null };
type Item = { text: string; source: string | null; url: string | null };

/** Cala match + "Since you passed" facts for this startup. Hidden for the fictional demo and without CALA_API_KEY. */
export function CalaPanel({ startupId, match, items, presence }: { startupId: number; match: string | null; items: Item[]; presence: string[] | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [msg, setMsg] = useState("");

  async function call(body: unknown) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/startups/${startupId}/cala`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      if (j.status === "candidates") { setCands(j.candidates); setMsg("No website match: pick the right company, or “Not in Cala”."); }
      else if (j.status === "not_found") { setCands(null); setMsg("Not in Cala."); }
      else { setCands(null); setMsg(j.sync ? `Synced: ${j.sync.rounds} rounds, ${j.sync.investors} investors${j.sync.employee_count ? `, ${j.sync.employee_count} people` : ""}` : "Matched"); }
      router.refresh();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  const matched = match === "auto" || match === "picked";
  return (
    <div className="glass card" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 className="section-h" style={{ margin: 0 }}>Since you passed</h3>
        <span className="muted" style={{ fontSize: 12 }}>{matched ? `Cala match: ${match === "auto" ? "website matches" : "picked by you"}` : match === "not_found" ? "Not in Cala" : "Not matched in Cala yet"}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {!matched && <button className="btn btn-sm" disabled={busy} onClick={() => call({ action: "find" })}>{busy ? "Searching…" : "Find in Cala"}</button>}
          {matched && <button className="btn btn-sm" disabled={busy} onClick={() => call({ action: "sync" })}>{busy ? "Syncing…" : "Sync Cala"}</button>}
        </span>
      </div>
      {cands && (
        <div style={{ display: "grid", gap: 6 }}>
          {cands.map((c) => (
            <button key={c.id} className="btn" style={{ justifyContent: "flex-start", textAlign: "left", borderRadius: 12 }} disabled={busy} onClick={() => call({ entity_id: c.id })}>
              <span><strong>{c.name}</strong> <span className="mono muted">{c.website ?? "no website"}</span><br /><span className="muted" style={{ fontSize: 12 }}>{c.description}</span></span>
            </button>
          ))}
          <button className="btn btn-sm" disabled={busy} onClick={() => call({ action: "none" })}>Not in Cala</button>
        </div>
      )}
      {items.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 13.5 }}>
          {items.map((i, k) => (
            <li key={k}>{i.text}{i.url ? <> · <a className="link" href={i.url} target="_blank" rel="noreferrer">{i.source ?? "source"}</a></> : i.source ? <span className="muted"> · {i.source}</span> : null}</li>
          ))}
        </ul>
      )}
      {matched && items.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Nothing dated after the meeting in Cala yet.</div>}
      {presence && presence.length > 0 && (
        <div className="muted" style={{ fontSize: 12.5 }}>Supporting only (never changes the status): Cala lists presence in {presence.join(", ")}.</div>
      )}
      {msg && <div className="muted" style={{ fontSize: 12.5 }}>{msg}</div>}
      {matched && <div className="muted" style={{ fontSize: 11 }}>Company data via Cala</div>}
    </div>
  );
}
