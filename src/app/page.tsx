import Link from "next/link";
import { one, query } from "@/lib/db";
import { StatusChip, type Status } from "@/components/StatusChip";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  domain: string;
  name: string | null;
  logo_url: string | null;
  met_on: string | null;
  met_where: string | null;
  statuses: string | null;
};

export default async function Watchlist() {
  const rows = await query<Row>(
    `SELECT s.id, s.domain, s.name, s.logo_url, to_char(s.met_on, 'YYYY-MM-DD') AS met_on, s.met_where,
            string_agg(c.status, ',' ORDER BY c.id) AS statuses
     FROM startups s LEFT JOIN conditions c ON c.startup_id = s.id
     GROUP BY s.id ORDER BY s.created_at DESC`,
  );
  const met =
    (
      await one<{ met: number }>(
        `SELECT COUNT(*) AS met FROM conditions
         WHERE status IN ('reported','confirmed') AND updated_at >= now() - interval '7 days'`,
      )
    )?.met ?? 0;

  return (
    <>
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
                        <div style={{ fontWeight: 600 }}>{r.name ?? r.domain}</div>
                        <div className="mono muted">{r.domain}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="mono">{r.met_on ?? "—"}</div>
                    <div className="muted">{r.met_where}</div>
                  </td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(r.statuses ?? "").split(",").filter(Boolean).map((s, i) => (
                      <StatusChip key={i} status={s as Status} />
                    ))}
                  </td>
                  <td className="muted">—</td>
                  <td className="mono muted">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
