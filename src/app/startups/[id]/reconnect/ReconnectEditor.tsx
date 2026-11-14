"use client";

import { useEffect, useRef, useState } from "react";
import { fmtTime } from "@/lib/time";

type Draft = { to: string; subject: string; opener: string; ask: string };

export function ReconnectEditor({
  id, t, initial, initialHtml, initialText, canSend,
}: { id: number; t: string; initial: Draft; initialHtml: string; initialText: string; canSend: boolean }) {
  const [d, setD] = useState(initial);
  const [html, setHtml] = useState(initialHtml);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState<"" | "regen" | "send">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const first = useRef(true);

  // live preview: re-render the exact email (server template) shortly after each edit
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = setTimeout(async () => {
      const r = await fetch(`/api/startups/${id}/reconnect/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t, ...d }),
      });
      const j = await r.json();
      if (j.html) { setHtml(j.html); setText(j.text); }
    }, 350);
    return () => clearTimeout(h);
  }, [d.subject, d.opener, d.ask]); // eslint-disable-line react-hooks/exhaustive-deps

  async function regenerate() {
    setBusy("regen"); setMsg(null);
    try {
      const r = await fetch(`/api/startups/${id}/reconnect/draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      first.current = true;
      setD({ ...d, ...j.copy }); setHtml(j.html); setText(j.text);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  async function send() {
    if (!confirm(`Send this email to ${d.to}?`)) return;
    setBusy("send"); setMsg(null);
    try {
      const r = await fetch(`/api/startups/${id}/reconnect/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t, ...d }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsg({ ok: true, text: `Sent to ${d.to} at ${fmtTime(j.sent_at)}` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  }

  async function copyHtml() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
    } catch {
      await navigator.clipboard.writeText(html);
    }
    setMsg({ ok: true, text: "Copied: paste into your email client" });
  }

  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(d.to)}&su=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(text.slice(0, 1800))}`;

  return (
    <div className="reconnect-grid">
      <div className="glass card" style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <label className="field">To<input className="input mono" type="email" placeholder="founder@startup.com" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} /></label>
        <label className="field">Subject<input className="input" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} /></label>
        <label className="field">Opener<textarea className="input" rows={4} value={d.opener} onChange={(e) => setD({ ...d, opener: e.target.value })} /></label>
        <label className="field">Ask<textarea className="input" rows={2} value={d.ask} onChange={(e) => setD({ ...d, ask: e.target.value })} /></label>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>The quote, checklist and timeline are filled in from Since&rsquo;s evidence and can&rsquo;t be edited here.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canSend && (
            <button className="btn btn-primary" disabled={busy !== "" || !d.to} onClick={send}>{busy === "send" ? "Sending…" : "Send"}</button>
          )}
          <button className="btn" disabled={busy !== ""} onClick={regenerate}>{busy === "regen" ? "Writing…" : "Regenerate"}</button>
          <button className="btn" onClick={copyHtml}>Copy HTML</button>
          <a className="btn" href={gmail} target="_blank" rel="noreferrer">Open in Gmail</a>
        </div>
        {msg && <div style={{ fontSize: 13, color: msg.ok ? "#047857" : "#b91c1c" }}>{msg.text}</div>}
      </div>
      <div className="glass card" style={{ padding: 10 }}>
        <div className="muted" style={{ fontSize: 12, padding: "2px 6px 8px" }}>Preview: exactly what will be sent</div>
        <iframe title="Email preview" srcDoc={html} sandbox="allow-popups" style={{ width: "100%", height: 820, border: 0, borderRadius: 12, background: "#f6f7f9" }} />
      </div>
    </div>
  );
}
