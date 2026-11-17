"use client";

import { useState } from "react";

export function JoinForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"" | "sending" | "sent">("");
  const [err, setErr] = useState("");
  const [dev, setDev] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setErr("");
    try {
      const r = await fetch("/api/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Something went wrong");
      setDev(j.devLink ?? null);
      setState("sent");
    } catch (e) {
      setErr((e as Error).message);
      setState("");
    }
  }

  if (state === "sent") {
    return (
      <div className="w-sent">
        <b>Check your inbox.</b> We sent a sign-in link to {email}.
        {dev && <> <a href={dev}>Dev sign-in link</a></>}
      </div>
    );
  }
  return (
    <form className="w-form" onSubmit={submit}>
      <input type="email" required placeholder="you@fund.vc" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
      <button type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Join the free Slush pilot"}</button>
      {err && <div className="w-err">{err}</div>}
    </form>
  );
}
