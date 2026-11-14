"use client";

import { useState } from "react";
import type { Settings } from "@/lib/settings";
import { StatusChip } from "@/components/StatusChip";

type Props = {
  initial: Settings;
  telegram: { configured: boolean; bot: string | null };
  lastAlert: { label: string; message: string; ok: boolean; error: string | null; sent_at: string } | null;
};

export function SettingsForm({ initial, telegram, lastAlert }: Props) {
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
