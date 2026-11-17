import { PriorityStar } from "@/components/PriorityStar";
import { currentUserId } from "@/lib/auth";
import Link from "next/link";
import { one, query } from "@/lib/db";
import { StatusChip, type Status } from "@/components/StatusChip";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ago, fmtTime } from "@/lib/time";
import { readiness, reconnectPath } from "@/lib/reconnect";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  domain: string;
  display_domain: string | null;
  name: string | null;
  logo_url: string | null;
  met_on: string | null;
  met_where: string | null;
  conditions: { id: number; status: Status; label: string }[];
  last_checked: string | null;
  latest_change: string | null;
  latest_change_at: string | null;
  reconnected_at: string | null;
  priority: boolean;
};


export default async function Watchlist() {
  const uid = (await currentUserId())!;
  const rows = await query<Row>(
    `SELECT s.id, s.priority, s.domain, s.display_domain, s.name, s.logo_url, to_char(s.met_on, 'FMDD Mon YYYY') AS met_on, s.met_where,
            COALESCE(json_agg(json_build_object('id', c.id, 'status', c.status, 'label', COALESCE(c.plain_words, c.original_words))
                     ORDER BY c.id) FILTER (WHERE c.id IS NOT NULL), '[]') AS conditions,
            max(c.last_checked_at) AS last_checked,
            (SELECT t.detail->>'summary' || ' (' || (t.detail->>'to') || ')' FROM timeline_events t
              JOIN conditions c2 ON c2.id = t.condition_id
              WHERE c2.startup_id = s.id AND t.kind = 'status_changed' ORDER BY t.at DESC LIMIT 1) AS latest_change,
            (SELECT max(t.at) FROM timeline_events t JOIN conditions c2 ON c2.id = t.condition_id
              WHERE c2.startup_id = s.id AND t.kind = 'status_changed') AS latest_change_at,
            (SELECT max(sent_at) FROM reconnects r WHERE r.startup_id = s.id AND r.status = 'sent') AS reconnected_at
     FROM startups s LEFT JOIN conditions c ON c.startup_id = s.id
     WHERE s.user_id = $1
     GROUP BY s.id ORDER BY s.created_at DESC`,
    [uid],
  );
  const met =
    (
      await one<{ met: number }>(
        `SELECT COUNT(*) AS met FROM conditions c JOIN startups s ON s.id = c.startup_id
         WHERE s.user_id = $1 AND c.status IN ('reported','confirmed') AND c.updated_at >= now() - interval '7 days'`,
        [uid],
      )
    )?.met ?? 0;

  return (
    <>
      <LiveRefresh everyMs={5000} />
      <div className="page-head">
        <div>
          <h1>Watchlist</h1>
          <p>Startups you told &ldquo;not yet&rdquo;. Since watches their conditions so you don&rsquo;t have to.</p>
        </div>
        <Link href="/new" className="btn btn-primary">
          + New &ldquo;not yet&rdquo;
        </Link>
      </div>

      <div className="glass banner">
        <span className="dot-live" />
        <span>
          <strong>{met}</strong> {met === 1 ? "condition" : "conditions"} met this week
        </span>
      </div>

      <div className="glass table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>Nothing on the watchlist yet</h3>
            <p>Add a startup you said &ldquo;not yet&rdquo; to, and the conditions you gave them.</p>
            <p style={{ marginTop: 14, display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {(["watching", "reported", "confirmed", "needs_review", "ask_at_checkin", "expired"] as Status[]).map((s) => (
                <StatusChip key={s} status={s} />
              ))}
            </p>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Startup</th>
                <th>Said &ldquo;not yet&rdquo;</th>
                <th>Conditions</th>
                <th>Latest change</th>
                <th>Last checked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {r.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.logo_url} alt="" width={24} height={24} style={{ borderRadius: 6 }} />
                      ) : (
                        <div className="brand-mark" style={{ width: 24, height: 24, fontSize: 12 }}>
                          {(r.name ?? r.domain)[0]?.toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>{r.name ?? r.domain}<PriorityStar id={r.id} on={r.priority} /></div>
                        <div className="mono muted">{r.display_domain ?? r.domain}</div>
                        <ReconnectCell r={r} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ whiteSpace: "nowrap" }}>{r.met_on ?? "—"}</div>
                    <div className="muted">{r.met_where}</div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {r.conditions.map((c) => {
                        const label = c.label.length > 34 ? c.label.slice(0, 32) + "…" : c.label;
                        return (
                          <Link key={c.id} href={`/conditions/${c.id}`} title={`${c.label} (${c.status.replace("_", " ")})`}>
                            {/* nothing happened yet: plain text, chips only for real signals */}
                            {c.status === "watching" ? <span className="watching-text">{label}</span> : <StatusChip status={c.status}>{label}</StatusChip>}
                          </Link>
                        );
                      })}
                    </div>
                  </td>
                  <td style={{ maxWidth: 280 }}>
                    <div style={{ fontSize: 13 }}>{r.latest_change ?? <span className="muted">—</span>}</div>
                    {r.latest_change_at && <div className="mono muted" style={{ fontSize: 11.5 }}>{ago(r.latest_change_at)}</div>}
                  </td>
                  <td className="mono muted">{ago(r.last_checked)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ReconnectCell({ r }: { r: Row }) {
  const ready = readiness(r.conditions.map((c) => c.status));
  const href = ready.any ? reconnectPath(r.id) : null;
  if (!href && !r.reconnected_at) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
      {href && (
        <Link href={href} className={`btn btn-sm${ready.all ? " btn-primary" : ""}`}>
          ✉️ Reconnect
        </Link>
      )}
      {r.reconnected_at && <span className="muted" style={{ fontSize: 11.5 }} title={fmtTime(r.reconnected_at, { alwaysDate: true })}>Reconnected {ago(r.reconnected_at)}</span>}
    </div>
  );
}
