"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Props = { botLink: string | null; connected: boolean; chatTitle: string | null; forwardAddress: string | null; name: string | null; fund: string | null };

export function Onboarding({ botLink, connected, chatTitle, forwardAddress, name, fund }: Props) {
  const [tg, setTg] = useState<{ ok: boolean; title: string | null }>({ ok: connected, title: chatTitle });
  const [waiting, setWaiting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [who, setWho] = useState({ name: name ?? "", fund: fund ?? "" });
  const [text, setText] = useState("");
  const [paste, setPaste] = useState<{ busy: boolean; msg: string; ok: boolean }>({ busy: false, msg: "", ok: false });
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  // after opening the bot link, poll until the /start message has been bound to this account
  useEffect(() => {
    if (!waiting || tg.ok) return;
    const check = async () => {
      const r = await fetch("/api/settings/telegram/detect", { method: "POST" }).catch(() => null);
      const j = await r?.json().catch(() => null);
      if (j?.ok) { setTg({ ok: true, title: j.chat.title }); setWaiting(false); }
    };
    check();
    poll.current = setInterval(check, 3000);
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [waiting, tg.ok]);

  async function saveWho() {
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "investor.name": who.name, "investor.fund": who.fund }) });
  }

  async function addFirst() {
    setPaste({ busy: true, msg: "", ok: false });
    const r = await fetch("/api/inbound/paste", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setPaste({ busy: false, msg: j.error ?? "failed", ok: false });
    setPaste(j.status === "pending"
      ? { busy: false, msg: "Found it. It's waiting in your Inbox: confirm the conditions and Since starts watching.", ok: true }
      : { busy: false, msg: j.note ?? "No “not yet” with conditions found in that text. Try the words you said, e.g. “come back when…”.", ok: false });
  }

  const step = (n: number, title: string, done: boolean, body: React.ReactNode) => (
    <div className="glass card" style={{ display: "grid", gap: 12, maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", fontWeight: 800, color: "#fff", background: done ? "#047857" : "var(--accent)" }}>{done ? "✓" : n}</span>
        <h2 style={{ margin: 0 }}>{title}</h2>
      </div>
      {body}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {step(1, "Who you are", Boolean(who.name), (
        <div className="grid-3" onBlur={saveWho}>
          <label className="field">Your name<input className="input" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} placeholder="Anna Korhonen" /></label>
          <label className="field">Fund<input className="input" value={who.fund} onChange={(e) => setWho({ ...who, fund: e.target.value })} placeholder="Northstar Ventures" /></label>
        </div>
      ))}
      {step(2, "Connect Telegram", tg.ok, botLink ? (
        tg.ok ? <p className="muted" style={{ margin: 0 }}>Connected to <strong>{tg.title}</strong>. Alerts with evidence arrive here.</p> : (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <a className="btn btn-primary" href={botLink} target="_blank" rel="noreferrer" onClick={() => setWaiting(true)}>Open Telegram and press Start</a>
            <span className="muted" style={{ fontSize: 13 }}>{waiting ? "Waiting for your Start…" : "Alerts arrive in a private chat with the Since bot."}</span>
          </div>
        )
      ) : <p className="muted" style={{ margin: 0 }}>Telegram isn&rsquo;t set up on this server.</p>)}
      {forwardAddress && step(3, "Your forwarding address", false, (
        <>
          <p className="muted" style={{ margin: 0 }}>Forward or BCC your pass emails here, from your own address. They appear in your Inbox; nothing is watched until you confirm.</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
            <span className="mono ellipsis" style={{ flex: 1, background: "#fff", borderRadius: 10, padding: "8px 12px" }}>{forwardAddress}</span>
            <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(forwardAddress).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </>
      ))}
      {step(forwardAddress ? 4 : 3, "Add your first “not yet”", paste.ok, (
        <>
          <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Paste a pass email or your notes, e.g. “Great meeting. Come back when you have three paying customers and you're hiring in sales.” Include the startup's name or website." />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={paste.busy || text.trim().length < 20} onClick={addFirst}>{paste.busy ? "Reading…" : "Find the “not yet”"}</button>
            <Link href="/new" className="btn">Or type it in</Link>
            {paste.ok && <Link href="/inbox" className="btn">Open Inbox →</Link>}
          </div>
          {paste.msg && <div style={{ fontSize: 13.5, color: paste.ok ? "#047857" : "#b45309" }}>{paste.msg}</div>}
        </>
      ))}
      <div><Link href="/" className="muted">Skip to your watchlist →</Link></div>
    </div>
  );
}
