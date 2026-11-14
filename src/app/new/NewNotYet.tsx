"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusChip, type Status } from "@/components/StatusChip";
import { SourceBadge } from "@/components/SourceBadge";
import type { ConditionParams, DraftCondition, MarketSignal } from "@/lib/types";
import type { ConditionPreview } from "@/lib/describe";

type Card = DraftCondition & { preview: ConditionPreview; removed?: boolean; open?: boolean };
type Parsed = { domain: string; company: string; logo_url: string | null; conditions: Card[] };
type Started = { startup_id: number; conditions: { id: number; status: Status; summary: string; monitors: { created: string[]; why?: string } }[] };

const KINDS: { value: string; label: string }[] = [
  { value: "announcement:customer", label: "Customer announcement" },
  { value: "announcement:revenue", label: "Revenue figure" },
  { value: "announcement:retention", label: "Retention figure" },
  { value: "market_launch:", label: "Market launch" },
  { value: "hiring_push:", label: "Hiring push" },
  { value: "product_shipped:", label: "Product shipped" },
  { value: "ask_at_checkin:", label: "Ask at check-in" },
];
const FUNCTIONS = ["engineering", "sales", "marketing", "product", "design", "data", "customer_success", "operations", "finance", "people"];
const SIGNALS: { key: MarketSignal; label: string }[] = [
  { key: "language", label: "Site in the language" },
  { key: "currency", label: "Prices in the currency" },
  { key: "country_listed", label: "Country listed as available" },
  { key: "country_domain", label: "Country domain live" },
];

export function NewNotYet() {
  const [form, setForm] = useState({
    domain: "", met_on: new Date().toISOString().slice(0, 10), met_where: "", text: "", founder_name: "", founder_email: "", inbox_id: "",
  });
  // prefill from the inbox ("Start watching" on an inbound item): /new?domain=&met_on=&met_where=&text=&founder_name=&founder_email=&inbox_id=
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const pick = (k: string) => q.get(k) ?? "";
    if (![...q.keys()].length) return;
    setForm((f) => ({
      ...f,
      domain: pick("domain") || f.domain,
      met_on: pick("met_on") || f.met_on,
      met_where: pick("met_where") || f.met_where,
      text: pick("text") || f.text,
      founder_name: pick("founder_name"),
      founder_email: pick("founder_email"),
      inbox_id: pick("inbox_id"),
    }));
  }, []);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [started, setStarted] = useState<Started | null>(null);
  const [busy, setBusy] = useState<"" | "parse" | "start">("");
  const [error, setError] = useState("");

  async function parse(e: React.FormEvent) {
    e.preventDefault();
    setBusy("parse");
    setError("");
    setStarted(null);
    try {
      const r = await fetch("/api/notyet/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "parse failed");
      setParsed(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (!parsed) return;
    setBusy("start");
    setError("");
    try {
      const r = await fetch("/api/notyet/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          domain: parsed.domain,
          company: parsed.company,
          logo_url: parsed.logo_url,
          conditions: parsed.conditions.filter((c) => !c.removed).map(({ preview, removed, open, ...c }) => c),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "start failed");
      setStarted(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const update = (i: number, patch: Partial<Card>) =>
    setParsed((p) => (p ? { ...p, conditions: p.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) } : p));
  const setParam = (i: number, key: keyof ConditionParams, value: unknown) =>
    setParsed((p) => (p ? { ...p, conditions: p.conditions.map((c, j) => (j === i ? { ...c, params: { ...c.params, [key]: value } } : c)) } : p));

  const active = parsed?.conditions.filter((c) => !c.removed) ?? [];
  const monitorCount = active.reduce((n, c) => n + c.preview.monitors.filter((m) => m.priority === "core").length, 0);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <form className="glass card" style={{ display: "grid", gap: 14, maxWidth: 820 }} onSubmit={parse}>
        <div className="grid-3">
          <label className="field">
            Startup domain
            <input className="input mono" required placeholder="nordwind.io" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          </label>
          <label className="field">
            Meeting date
            <input className="input" type="date" value={form.met_on} onChange={(e) => setForm({ ...form, met_on: e.target.value })} />
          </label>
          <label className="field">
            Where
            <input className="input" placeholder="Slush, Helsinki" value={form.met_where} onChange={(e) => setForm({ ...form, met_where: e.target.value })} />
          </label>
        </div>
        <div className="grid-3">
          <label className="field">
            Founder (optional)
            <input className="input" placeholder="Mikko Nordwind" value={form.founder_name} onChange={(e) => setForm({ ...form, founder_name: e.target.value })} />
          </label>
          <label className="field">
            Founder email (optional)
            <input className="input mono" type="email" placeholder="mikko@nordwind.io" value={form.founder_email} onChange={(e) => setForm({ ...form, founder_email: e.target.value })} />
          </label>
        </div>
        <label className="field">
          Come back when&hellip;
          <textarea
            className="input"
            rows={3}
            required
            placeholder="Come back when you have your first enterprise customer and you're selling in Germany. And when revenue is over €1M ARR."
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
          />
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn-primary" type="submit" disabled={busy !== ""}>
            {busy === "parse" ? "Reading your note…" : parsed ? "Parse again" : "Parse conditions"}
          </button>
          {error && <span style={{ color: "#b91c1c" }}>{error}</span>}
        </div>
      </form>

      {parsed && !started && (
        <>
          <div className="glass banner" style={{ borderRadius: 20 }}>
            {parsed.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={parsed.logo_url} alt="" width={28} height={28} style={{ borderRadius: 7 }} />
            ) : (
              <div className="brand-mark" style={{ width: 28, height: 28 }}>{parsed.company[0]}</div>
            )}
            <div>
              <div style={{ fontWeight: 650 }}>{parsed.company}</div>
              <div className="mono muted">{parsed.domain}</div>
            </div>
            <span className="muted" style={{ marginLeft: "auto" }}>
              {active.length} conditions · confirm or edit, then start watching
            </span>
          </div>

          <div className="cond-grid">
            {parsed.conditions.map((c, i) =>
              c.removed ? null : (
                <div key={i} className={`glass card cond-card${c.mechanism === "ask_at_checkin" ? " cond-ask" : ""}`}>
                  <div className="cond-top">
                    <select
                      className="input input-sm"
                      value={`${c.mechanism}:${c.subtype ?? ""}`}
                      onChange={(e) => {
                        const [m, s] = e.target.value.split(":");
                        update(i, { mechanism: m as Card["mechanism"], subtype: (s || null) as Card["subtype"] });
                      }}
                    >
                      {KINDS.map((k) => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </select>
                    <button className="link-btn" type="button" onClick={() => update(i, { removed: true })}>Remove</button>
                  </div>
                  <div className="quote">&ldquo;{c.original_words}&rdquo;</div>
                  <input className="input plain" value={c.plain_words} onChange={(e) => update(i, { plain_words: e.target.value })} />

                  <ParamFields c={c} set={(k, v) => setParam(i, k, v)} setReason={(v) => update(i, { reason: v })} />

                  {c.mechanism !== "ask_at_checkin" && (
                    <button
                      type="button"
                      className="details-toggle"
                      aria-expanded={Boolean(c.open)}
                      onClick={() => update(i, { open: !c.open })}
                    >
                      <span className={`chev${c.open ? " chev-open" : ""}`}>›</span>
                      How we verify
                    </button>
                  )}
                  {c.mechanism !== "ask_at_checkin" && c.open && (
                    <>
                      <div className="kv"><span>How we verify</span>{c.preview.how}</div>
                      {c.preview.sources.length > 0 && (
                        <div className="kv">
                          <span>Sources</span>
                          <div style={{ display: "grid", gap: 4 }}>
                            {c.preview.sources.map((s, k) => (
                              <div key={k} style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                                <SourceBadge type={s.source_type} />
                                <span className={s.url ? "mono ellipsis" : ""}>{s.url ?? s.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="kv">
                        <span>Best possible</span>
                        <div>
                          {c.preview.best_evidence && <StatusChip status={c.preview.best_evidence} />}
                          {c.preview.best_evidence_note && <div className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>{c.preview.best_evidence_note}</div>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ),
            )}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={start} disabled={busy !== "" || !active.length}>
              {busy === "start" ? "Capturing baseline…" : `Start watching (${monitorCount} monitors)`}
            </button>
            <span className="muted">Runs every check once now (baseline), then Context.dev monitors trigger re-checks.</span>
          </div>
        </>
      )}

      {started && (
        <div className="glass card" style={{ display: "grid", gap: 10 }}>
          <h2>Baseline captured</h2>
          <div className="baseline-strip">
            {started.conditions.map((c) => (
              <Link key={c.id} href={`/conditions/${c.id}`} className="baseline-item">
                <StatusChip status={c.status} />
                <span>{c.summary}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {c.monitors.created.length ? `${c.monitors.created.length} monitors` : c.status === "ask_at_checkin" ? "" : c.monitors.why ?? "no monitors"}
                </span>
              </Link>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/" className="btn">Go to watchlist</Link>
            <button className="btn" onClick={() => { setParsed(null); setStarted(null); setForm({ ...form, domain: "", text: "" }); }}>Add another</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ParamFields({ c, set, setReason }: { c: Card; set: (k: keyof ConditionParams, v: unknown) => void; setReason: (v: string) => void }) {
  const p = c.params;
  const num = (v: string) => (v === "" ? null : Number(v));
  switch (c.mechanism) {
    case "market_launch":
      return (
        <div className="params">
          <label>Country<input className="input input-sm" value={p.country ?? ""} onChange={(e) => set("country", e.target.value)} /></label>
          <label>Code<input className="input input-sm mono" value={p.country_code ?? ""} onChange={(e) => set("country_code", e.target.value.toUpperCase())} /></label>
          <label>Language<input className="input input-sm mono" value={p.language_code ?? ""} onChange={(e) => set("language_code", e.target.value.toLowerCase())} /></label>
          <label>Currency<input className="input input-sm mono" value={p.currency ?? ""} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></label>
          <div className="checks">
            <span className="muted">Counts if any of:</span>
            {SIGNALS.map((s) => (
              <label key={s.key} className="check">
                <input
                  type="checkbox"
                  checked={(p.accept ?? []).includes(s.key)}
                  onChange={(e) => set("accept", e.target.checked ? [...(p.accept ?? []), s.key] : (p.accept ?? []).filter((x) => x !== s.key))}
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>
      );
    case "hiring_push":
      return (
        <div className="params">
          <label>Function
            <select className="input input-sm" value={p.job_function ?? "engineering"} onChange={(e) => set("job_function", e.target.value)}>
              {FUNCTIONS.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label>At least<input className="input input-sm" type="number" min={1} value={p.min_roles ?? 1} onChange={(e) => set("min_roles", num(e.target.value))} /></label>
        </div>
      );
    case "announcement":
      if (c.subtype === "customer")
        return (
          <div className="params">
            <label>Customer
              <select className="input input-sm" value={p.customer_kind ?? "any"} onChange={(e) => set("customer_kind", e.target.value)}>
                <option value="enterprise">enterprise</option>
                <option value="any">any named</option>
              </select>
            </label>
            <label>At least<input className="input input-sm" type="number" min={1} value={p.min_customers ?? 1} onChange={(e) => set("min_customers", num(e.target.value))} /></label>
          </div>
        );
      return (
        <div className="params">
          <label>Metric
            <select className="input input-sm" value={p.metric ?? (c.subtype === "revenue" ? "ARR" : "NRR")} onChange={(e) => set("metric", e.target.value)}>
              {(c.subtype === "revenue" ? ["ARR", "MRR", "revenue"] : ["NRR", "GRR", "retention"]).map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label>{c.subtype === "revenue" ? "Threshold" : "Threshold %"}<input className="input input-sm" type="number" value={p.threshold ?? ""} onChange={(e) => set("threshold", num(e.target.value))} /></label>
          {c.subtype === "revenue" && (
            <label>Currency<input className="input input-sm mono" value={p.threshold_currency ?? ""} onChange={(e) => set("threshold_currency", e.target.value.toUpperCase())} /></label>
          )}
        </div>
      );
    case "product_shipped":
      return (
        <div className="params">
          <label>GitHub repo<input className="input input-sm mono" placeholder="org/repo" value={p.github_repo ?? ""} onChange={(e) => set("github_repo", e.target.value || null)} /></label>
          <label>Min version<input className="input input-sm mono" placeholder="1.0" value={p.min_version ?? ""} onChange={(e) => set("min_version", e.target.value || null)} /></label>
          <label>App Store URL<input className="input input-sm mono" value={p.app_store_url ?? ""} onChange={(e) => set("app_store_url", e.target.value || null)} /></label>
          <label>Google Play URL<input className="input input-sm mono" value={p.play_store_url ?? ""} onChange={(e) => set("play_store_url", e.target.value || null)} /></label>
        </div>
      );
    default:
      return (
        <label className="field" style={{ fontWeight: 500 }}>
          Why it can&rsquo;t be watched
          <input className="input input-sm" value={c.reason ?? ""} onChange={(e) => setReason(e.target.value)} />
        </label>
      );
  }
}
