import { currentUserId } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCondition } from "@/lib/conditions";
import { query } from "@/lib/db";
import { StatusChip } from "@/components/StatusChip";
import { SourceBadge } from "@/components/SourceBadge";
import { CheckButtons, MarkWrong } from "./Actions";
import { LiveRefresh } from "@/components/LiveRefresh";
import { fmtTime } from "@/lib/time";
import { readiness, reconnectPath } from "@/lib/reconnect";
import { calaConfigured, latestSnapshot } from "@/lib/cala";
import { getCalaBlock } from "@/lib/cala-block";
import { CalaPanel } from "./CalaPanel";

export const dynamic = "force-dynamic";

type Ev = {
  id: number; url: string; source_type: string; snapshot_time: string | null; excerpt: string | null;
  rule_passed: string | null; passes: boolean; marked_wrong: boolean; detected_at: string | null; created_at: string;
};
type Tl = { id: number; kind: string; detail: Record<string, any> | null; at: string };

const TL_LABEL: Record<string, string> = {
  condition_created: "Condition created",
  baseline_captured: "Baseline captured",
  baseline_failed: "Baseline failed",
  monitors_created: "Monitors created",
  change_detected: "Change detected",
  webhook_received: "Webhook received",
  evidence_checked: "Evidence checked",
  status_changed: "Status changed",
  alert_sent: "Alert sent",
  recheck_requested: "Re-check requested",
  evidence_marked_wrong: "Evidence marked wrong",
  customer_site_found: "Customer's own site found",
  reconnected: "Reconnected",
};

const ts = (s: string | null) => fmtTime(s);

/** The investor's whole sentence, with this condition's words highlighted (quotes/apostrophes normalized). */
function Sentence({ full, part }: { full: string | null; part: string }) {
  const n = (x: string) => x.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').toLowerCase();
  const i = full ? n(full).indexOf(n(part)) : -1;
  if (!full || i < 0) return <>&ldquo;{part}&rdquo;</>;
  return (
    <>
      &ldquo;{full.slice(0, i)}
      <mark className="hl">{full.slice(i, i + part.length)}</mark>
      {full.slice(i + part.length)}&rdquo;
    </>
  );
}

export default async function ConditionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wrong?: string }>;
}) {
  const id = Number((await params).id);
  const wrongId = Number((await searchParams).wrong) || null;
  const c = await getCondition(id);
  if (!c || c.owner_id !== (await currentUserId())) notFound();
  const [evidence, tl, monitors, startup, siblings] = await Promise.all([
    query<Ev>("SELECT * FROM evidence WHERE condition_id = $1 ORDER BY passes DESC, created_at DESC", [id]),
    query<Tl>("SELECT * FROM timeline_events WHERE condition_id = $1 ORDER BY at DESC, id DESC LIMIT 60", [id]),
    query<{ id: string; role: string; source_type: string }>("SELECT id, role, source_type FROM monitors WHERE condition_id = $1", [id]),
    query<{ met_on: string | null; met_where: string | null; logo_url: string | null; original_text: string | null; display_domain: string | null }>(
      "SELECT to_char(met_on,'FMDD Mon YYYY') AS met_on, met_where, logo_url, original_text, display_domain FROM startups WHERE id = $1",
      [c.startup_id],
    ),
    query<{ status: string }>("SELECT status FROM conditions WHERE startup_id = $1", [c.startup_id]),
  ]);
  const ready = readiness(siblings.map((x) => x.status));
  // Cala: hidden for the fictional demo domains and when CALA_API_KEY is missing
  const demo = (process.env.DEMO_DOMAINS || "").split(",").map((x) => x.trim()).includes(c.domain);
  const calaRow = await query<{ cala_match: string | null; met_on: string | null }>("SELECT cala_match, met_on::text AS met_on FROM startups WHERE id = $1", [c.startup_id]);
  const showCala = calaConfigured() && !demo;
  const calaBlock = showCala ? await getCalaBlock(c.startup_id, calaRow[0]?.met_on ?? null).catch(() => null) : null;
  const presence = showCala && c.mechanism === "market_launch"
    ? (await latestSnapshot(c.startup_id).catch(() => null))?.snap.presence.filter((p) => !c.params_json.country || p.toLowerCase() === c.params_json.country.toLowerCase()) ?? null
    : null;
  const reconnect = ready.any ? reconnectPath(c.startup_id) : null;
  const s = startup[0];
  const passing = evidence.filter((e) => e.passes && !e.marked_wrong);
  const other = evidence.filter((e) => !e.passes || e.marked_wrong);
  const last = c.last_check;

  return (
    <>
      <LiveRefresh everyMs={3000} />
      <div className="page-head">
        <div>
          <p style={{ margin: 0 }}>
            <Link href="/" className="muted">Watchlist</Link> <span className="muted">/</span>{" "}
            <span>{c.company}</span> <span className="mono muted">{s?.display_domain ?? c.domain}</span>
          </p>
          <h1 style={{ marginTop: 4 }}>{c.plain_words ?? c.original_words}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {reconnect && (
            <Link href={reconnect} className={`btn${ready.all ? " btn-primary" : ""}`} title="Draft an email to the founder with the progress since your “not yet”">
              ✉️ Reconnect
            </Link>
          )}
          {c.status !== "ask_at_checkin" && <CheckButtons id={id} />}
        </div>
      </div>

      <div className="detail-grid">
        <div style={{ display: "grid", gap: 18, alignContent: "start", minWidth: 0 }}>
          <div className="glass card" style={{ display: "grid", gap: 10 }}>
            <div className="quote" style={{ fontSize: 16 }}>
              <Sentence full={s?.original_text ?? null} part={c.original_words} />
            </div>
            <div className="muted">
              {c.company} · said &ldquo;not yet&rdquo; {s?.met_on ? `on ${s.met_on}` : ""} {s?.met_where ? `at ${s.met_where}` : ""}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusChip status={c.status} />
              {c.status_note && <span className="muted">{c.status_note}</span>}
              {c.best_evidence && (
                <span className="muted" style={{ marginLeft: "auto", fontSize: 12.5 }}>
                  Best possible evidence: <strong>{c.best_evidence}</strong>
                </span>
              )}
            </div>
            {c.reason && <div className="kv"><span>Ask at check-in</span>{c.reason}</div>}
            {last && (
              <div className="kv">
                <span>Last check</span>
                <div>
                  {last.summary} <span className="mono muted">· {ts(c.last_checked_at)}</span>
                </div>
              </div>
            )}
          </div>

          {showCala && <CalaPanel startupId={c.startup_id} match={calaRow[0]?.cala_match ?? null} items={calaBlock?.items ?? []} presence={presence} />}

          <h3 className="section-h">Evidence {passing.length ? `(${passing.length})` : ""}</h3>
          {passing.length === 0 && <div className="glass card muted">No qualifying evidence yet.</div>}
          {wrongId && passing.some((e) => e.id === wrongId) && (
            <div className="glass banner" style={{ borderRadius: 16 }}>
              Opened from an alert: is the highlighted evidence wrong? Use &ldquo;Mark as wrong&rdquo; on it and the status is recomputed.
            </div>
          )}
          {passing.map((e) => <EvidenceCard key={e.id} e={e} highlight={e.id === wrongId} />)}

          {other.length > 0 && (
            <details className="glass card">
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Seen but not counted ({other.length})</summary>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {other.map((e) => <EvidenceCard key={e.id} e={e} compact />)}
              </div>
            </details>
          )}

          {last?.sources?.length ? (
            <div className="glass card">
              <h3 className="section-h" style={{ margin: "0 0 8px" }}>Sources checked</h3>
              <div style={{ display: "grid", gap: 6 }}>
                {last.sources.map((src, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                    <SourceBadge type={src.source_type} />
                    <span className="mono ellipsis" style={{ flex: 1 }}>{src.url}</span>
                    <span className={src.ok ? "muted" : ""} style={src.ok ? undefined : { color: "#b91c1c" }}>{src.note}</span>
                  </div>
                ))}
              </div>
              {monitors.length > 0 && (
                <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
                  Monitors: {monitors.map((m) => m.role).join(" · ")}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="glass card" style={{ alignSelf: "start" }}>
          <h3 className="section-h" style={{ margin: "0 0 12px" }}>Timeline</h3>
          <ol className="timeline">
            {tl.map((t) => (
              <li key={t.id}>
                <div className="tl-kind">{TL_LABEL[t.kind] ?? t.kind}</div>
                <div className="mono muted" style={{ fontSize: 11.5 }}>{ts(t.at)}</div>
                <TlDetail t={t} />
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="muted" style={{ textAlign: "center", fontSize: 12, padding: 8 }}>Monitored with Context.dev &amp; Cala</div>
    </>
  );
}

function EvidenceCard({ e, compact, highlight }: { e: Ev; compact?: boolean; highlight?: boolean }) {
  return (
    <div className={compact ? "ev ev-compact" : `glass card ev${highlight ? " ev-highlight" : ""}`}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <SourceBadge type={e.source_type} />
        {e.rule_passed ? <span className="rule">✓ {e.rule_passed}</span> : <span className="muted">no rule passed</span>}
        {e.marked_wrong && <span className="chip chip-bad">marked wrong</span>}
        {!compact && !e.marked_wrong && <MarkWrong id={e.id} />}
      </div>
      {e.excerpt && <blockquote className="excerpt">{e.excerpt}</blockquote>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
        <a href={e.url} target="_blank" rel="noreferrer" className="mono ellipsis link" style={{ flex: 1, minWidth: 0 }}>{e.url}</a>
        <span className="mono muted" style={{ fontSize: 11.5 }}>snapshot {ts(e.snapshot_time)}</span>
      </div>
    </div>
  );
}

function TlDetail({ t }: { t: Tl }) {
  const d = t.detail;
  if (!d) return null;
  let text = "";
  if (t.kind === "status_changed") text = `${d.from} → ${d.to}${d.summary ? `: ${d.summary}` : ""}`;
  else if (t.kind === "evidence_checked") text = `${d.trigger}: ${d.summary}${d.new_evidence ? ` (+${d.new_evidence} evidence)` : ""}`;
  else if (t.kind === "condition_created") text = `${d.mechanism}${d.subtype ? "/" + d.subtype : ""}`;
  else if (t.kind === "baseline_captured") text = d.summary ?? "";
  else if (t.kind === "monitors_created") text = `${d.ids?.length ?? 0} Context.dev monitors`;
  else if (t.kind === "evidence_marked_wrong") text = `${d.from} → ${d.to}`;
  else if (t.kind === "change_detected") text = `${d.monitor}${d.summary ? `: ${d.summary}` : ""}`;
  else if (t.kind === "webhook_received") text = `${d.event} · ${d.id ?? ""}`;
  else if (t.kind === "alert_sent") text = `${d.channel}, ${d.label}: ${d.ok ? "delivered" : `not delivered (${d.error})`}`;
  else if (t.kind === "customer_site_found") text = `${d.name}: ${d.domain}`;
  else if (t.kind === "reconnected") text = `Email sent to ${d.to}`;
  else if (t.kind === "recheck_requested") text = "Context.dev monitors queued";
  else text = typeof d === "string" ? d : "";
  return text ? <div style={{ fontSize: 12.5 }}>{text}</div> : null;
}
