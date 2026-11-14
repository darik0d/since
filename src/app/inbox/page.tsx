import { query } from "@/lib/db";
import { fmtTime } from "@/lib/time";
import { SOURCE_LABEL, type InboundRow } from "@/lib/inbound";
import { granolaConfigured } from "@/lib/granola";
import { LiveRefresh } from "@/components/LiveRefresh";
import { InboxActions, PasteBox } from "./InboxClient";
import "./inbox.css";

export const dynamic = "force-dynamic";

export default async function Inbox() {
  const [pending, recent] = await Promise.all([
    query<InboundRow>("SELECT * FROM inbound_items WHERE status = 'pending' ORDER BY received_at DESC LIMIT 50"),
    query<InboundRow>("SELECT * FROM inbound_items WHERE status <> 'pending' ORDER BY received_at DESC LIMIT 15"),
  ]);
  const sources = [
    granolaConfigured() ? "meetings" : null,
    process.env.INBOUND_EMAIL_BASIC && process.env.INVESTOR_EMAILS ? "emails" : null,
    "notes",
  ].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1");
  return (
    <>
      <LiveRefresh everyMs={8000} />
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p>&ldquo;Not yet&rdquo;s Since found in your {sources}. Nothing is watched until you confirm it.</p>
        </div>
      </div>

      <PasteBox />

      <h3 className="section-h">Pending {pending.length ? `(${pending.length})` : ""}</h3>
      {pending.length === 0 && <div className="glass card muted">No pending &ldquo;not yet&rdquo;s. Paste an email above{granolaConfigured() ? " or sync Granola in Settings" : ""}.</div>}
      {pending.map((it) => {
        const x = it.extracted_json;
        const prefill = new URLSearchParams(
          Object.entries({
            domain: x?.startup_domain ?? "",
            met_on: x?.met_on ?? "",
            met_where: it.source === "granola" ? (it.title ?? "") : "",
            text: x?.conditions_text ?? x?.quote ?? "",
            founder_name: x?.founder_name ?? "",
            founder_email: x?.founder_email ?? "",
            inbox_id: String(it.id),
          }).filter(([, v]) => v),
        );
        return (
          <div key={it.id} className="glass card inbox-card">
            <div className="inbox-head">
              <span className={`src-badge inbox-src-${it.source}`}>{SOURCE_LABEL[it.source] ?? it.source}</span>
              <strong className="ellipsis">{x?.startup_name ?? it.title ?? "Untitled"}</strong>
              {x?.startup_domain && <span className="mono muted">{x.startup_domain}</span>}
              <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11.5 }}>
                {fmtTime(it.meeting_at ?? it.received_at, { alwaysDate: true })}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {it.title}{it.sender ? ` · ${it.sender}` : ""}{x?.founder_name ? ` · founder: ${x.founder_name}` : ""}
            </div>
            {x?.quote && (
              <div className="quote">
                &ldquo;<mark className="hl">{x.quote}</mark>&rdquo;
              </div>
            )}
            <InboxActions id={it.id} href={`/new?${prefill}`} />
          </div>
        );
      })}

      {recent.length > 0 && (
        <details className="glass card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Processed ({recent.length})</summary>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {recent.map((it) => (
              <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, minWidth: 0 }}>
                <span className={`src-badge inbox-src-${it.source}`}>{SOURCE_LABEL[it.source] ?? it.source}</span>
                <span className="ellipsis" style={{ flex: 1 }}>{it.extracted_json?.startup_name ?? it.title ?? "Untitled"}</span>
                <span className="muted">{it.status === "none" ? it.note ?? "no “not yet” found" : it.status}</span>
                <span className="mono muted" style={{ fontSize: 11.5 }}>{fmtTime(it.received_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
