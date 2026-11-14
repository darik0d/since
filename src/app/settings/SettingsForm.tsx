"use client";

import { useState } from "react";
import type { Settings } from "@/lib/settings";
import { StatusChip } from "@/components/StatusChip";

type Props = {
  initial: Settings;
  telegram: { configured: boolean; bot: string | null };
  lastAlert: { label: string; message: string; ok: boolean; error: string | null; sent_at: string } | null;
  granola: { folder: boolean; last_sync: string | null } | null;
};

export function SettingsForm({ initial, telegram, lastAlert, granola }: Props) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  async function patch(p: Partial<Settings>) {
    setS({ ...s, ...p });
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    const j = await r.json();
    if (j.settings) setS(j.settings);
  }
  async function act(path: string, label: string) {
    setBusy(label);
    setMsg("");
    try {
      const r = await fetch(path, { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      if (j.chat) setS({ ...s, "telegram.chat_id": j.chat.id, "telegram.chat_title": j.chat.title, "telegram.enabled": true });
      setMsg(label === "detect" ? `Connected to ${j.chat.title}` : "Test message sent");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <div className="glass card" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Telegram</h2>
          {telegram.configured && s["telegram.chat_id"] && (
            <Toggle on={s["telegram.enabled"]} onChange={(v) => patch({ "telegram.enabled": v })} />
          )}
        </div>
        {!telegram.configured ? (
          <p className="muted" style={{ margin: 0 }}>
            Create a bot with @BotFather and set <span className="mono">TELEGRAM_BOT_TOKEN</span> on the server.
          </p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Bot: <span className="mono">@{telegram.bot ?? "?"}</span> ·{" "}
              {s["telegram.chat_id"] ? <>sending to <strong>{s["telegram.chat_title"] ?? s["telegram.chat_id"]}</strong></> : "not connected yet"}
            </p>
            {!s["telegram.chat_id"] && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                1. Open <a className="link" href={`https://t.me/${telegram.bot}`} target="_blank" rel="noreferrer">t.me/{telegram.bot}</a> and press Start. 2. Click Detect chat.
              </p>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" disabled={busy !== ""} onClick={() => act("/api/settings/telegram/detect", "detect")}>
                {busy === "detect" ? "Detecting…" : s["telegram.chat_id"] ? "Re-detect chat" : "Detect chat"}
              </button>
              {s["telegram.chat_id"] && (
                <button className="btn" disabled={busy !== ""} onClick={() => act("/api/settings/telegram/test", "test")}>
                  {busy === "test" ? "Sending…" : "Send test"}
                </button>
              )}
            </div>
            {msg && <div className="muted" style={{ fontSize: 13 }}>{msg}</div>}
          </>
        )}
      </div>

      <div className="glass card" style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Alert me when a condition becomes</h2>
        <Row chip="confirmed" text="Always on: a platform or independent source shows it.">
          <Toggle on locked />
        </Row>
        <Row chip="reported" text="Labeled “founder-reported”: only the founder's channels say so.">
          <Toggle on={s["alerts.reported"]} onChange={(v) => patch({ "alerts.reported": v })} />
        </Row>
        <Row chip="needs_review" text="Ambiguous or conflicting evidence.">
          <Toggle on={s["alerts.needs_review"]} onChange={(v) => patch({ "alerts.needs_review": v })} />
        </Row>
      </div>

      <div className="glass card" style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Email signature</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Used at the end of reconnect emails.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label className="field">
            Your name
            <input className="input" value={s["investor.name"] ?? ""} onChange={(e) => setS({ ...s, "investor.name": e.target.value })}
              onBlur={(e) => patch({ "investor.name": e.target.value.trim() })} />
          </label>
          <label className="field">
            Fund
            <input className="input" value={s["investor.fund"] ?? ""} onChange={(e) => setS({ ...s, "investor.fund": e.target.value })}
              onBlur={(e) => patch({ "investor.fund": e.target.value.trim() })} />
          </label>
        </div>
      </div>

      {granola && <GranolaCard folder={granola.folder} initialLastSync={granola.last_sync} />}

      {lastAlert && (
        <div className="glass card" style={{ gridColumn: "1 / -1", display: "grid", gap: 8 }}>
          <h2 style={{ margin: 0 }}>Last alert</h2>
          <div className="muted mono" style={{ fontSize: 12 }}>
            {lastAlert.sent_at} · {lastAlert.label} ·{" "}
            {lastAlert.ok ? "delivered" : `not delivered: ${lastAlert.error}`}
          </div>
          <div className="alert-preview" dangerouslySetInnerHTML={{ __html: lastAlert.message.replace(/\n/g, "<br>") }} />
        </div>
      )}
    </div>
  );
}

function Row({ chip, text, children }: { chip: "confirmed" | "reported" | "needs_review"; text: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr auto", gap: 12, alignItems: "center" }}>
      <StatusChip status={chip} />
      <span className="muted" style={{ fontSize: 13 }}>{text}</span>
      {children}
    </div>
  );
}

function Toggle({ on, locked, onChange }: { on: boolean; locked?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={locked}
      className={`toggle${on ? " toggle-on" : ""}`}
      onClick={() => onChange?.(!on)}
      title={locked ? "Always on" : undefined}
    >
      <span />
    </button>
  );
}

function GranolaCard({ folder, initialLastSync }: { folder: boolean; initialLastSync: string | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastSync, setLastSync] = useState(initialLastSync);
  async function sync() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/granola/sync", { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "sync failed");
      setLastSync("just now");
      setMsg(`${j.seen} note${j.seen === 1 ? "" : "s"} checked · ${j.pending} new “not yet”${j.pending === 1 ? "" : "s"} in the inbox`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="glass card" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Granola meeting notes</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Since reads new meeting notes every 10 minutes and puts any &ldquo;not yet&rdquo; you gave into the Inbox.{" "}
        {folder ? "Only meetings in your Since folder in Granola are read." : "All your Granola meetings are read (set a Since folder to limit this)."}
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn" disabled={busy} onClick={sync}>{busy ? "Syncing…" : "Sync now"}</button>
        <span className="muted mono" style={{ fontSize: 12 }}>last sync: {lastSync ?? "never"}</span>
      </div>
      {msg && <div className="muted" style={{ fontSize: 13 }}>{msg}</div>}
    </div>
  );
}
