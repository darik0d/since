"use client";

import { useState } from "react";
import type { Settings } from "@/lib/settings";
import { StatusChip } from "@/components/StatusChip";

type Props = {
  initial: Settings;
  telegram: { configured: boolean; bot: string | null; startToken: string };
  lastAlert: { label: string; message: string; ok: boolean; error: string | null; sent_at: string } | null;
  granola: { connected: boolean; own: boolean; folder: boolean; last_sync: string | null };
  inboundEmail: string | null;
};

export function SettingsForm({ initial, telegram, lastAlert, granola, inboundEmail }: Props) {
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
                1. Open <a className="link" href={`https://t.me/${telegram.bot}?start=${telegram.startToken}`} target="_blank" rel="noreferrer">your Since bot link</a> and press Start. 2. Click Connect.
              </p>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" disabled={busy !== ""} onClick={() => act("/api/settings/telegram/detect", "detect")}>
                {busy === "detect" ? "Checking…" : s["telegram.chat_id"] ? "Reconnect" : "Connect"}
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

      <GranolaCard connected={granola.connected} own={granola.own} folder={granola.folder} initialLastSync={granola.last_sync} />
      {inboundEmail && <InboundEmailCard address={inboundEmail} />}

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

function GranolaCard({ connected, own, folder, initialLastSync }: { connected: boolean; own: boolean; folder: boolean; initialLastSync: string | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastSync, setLastSync] = useState(initialLastSync);
  const [isOn, setOn] = useState(connected);
  const [key, setKey] = useState("");
  async function call(method: string, path: string, body?: unknown) {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error ?? "failed");
      return j;
    } catch (e) {
      setMsg((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    const j = await call("POST", "/api/granola/sync");
    if (j) { setLastSync("just now"); setMsg(`${j.seen} note${j.seen === 1 ? "" : "s"} checked · ${j.pending} new “not yet”${j.pending === 1 ? "" : "s"} in the inbox`); }
  }
  return (
    <div className="glass card" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Granola meeting notes</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Since reads new meeting notes every 2 minutes, recognises the startup from the meeting's attendees (e.g. bryan@nordwind.io → nordwind.io) and puts any &ldquo;not yet&rdquo; you gave into the Inbox.{" "}
        {isOn && (folder ? "Only meetings in your Since folder in Granola are read." : "")}
      </p>
      {isOn ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" disabled={busy} onClick={sync}>{busy ? "Working…" : "Sync now"}</button>
          <span className="muted mono" style={{ fontSize: 12 }}>last sync: {lastSync ?? "never"}</span>
          {own && <button className="btn btn-sm" disabled={busy} style={{ marginLeft: "auto" }} onClick={async () => { if (await call("DELETE", "/api/settings/granola")) setOn(false); }}>Disconnect</button>}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input mono" style={{ flex: 1, minWidth: 220 }} placeholder="grn_… (Granola → Settings → API)" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !key} onClick={async () => { if (await call("POST", "/api/settings/granola", { key })) { setOn(true); setKey(""); setMsg("Connected. Your key is stored encrypted."); } }}>{busy ? "Checking…" : "Connect"}</button>
        </div>
      )}
      {msg && <div className="muted" style={{ fontSize: 13 }}>{msg}</div>}
    </div>
  );
}

function InboundEmailCard({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="glass card" style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Email in</h2>
      <p className="muted" style={{ margin: 0 }}>Forward or BCC your pass emails here. They land in the Inbox as pending; nothing starts watching until you confirm.</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
        <span className="mono ellipsis" style={{ flex: 1 }}>{address}</span>
        <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(address).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}
