import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { context } from "@/lib/context";
import { ago } from "@/lib/time";
import { Reschedule } from "./Reschedule";

export const dynamic = "force-dynamic";

type Row = {
  id: number; email: string; created_at: string; last_login_at: string | null; max_watches: number;
  watches: number; priority: number; monitors: number; runs_per_day: number;
  context_7d: number; context_today: number; cala_7d: number; inbox: number; telegram: boolean; granola: boolean;
};

// Owner-only: pilot users and what each one costs (Context.dev / Cala calls we made, plus scheduled monitor runs).
export default async function Admin() {
  if (!(await currentUser())?.is_admin) notFound();
  const rows = await query<Row>(`
    SELECT u.id, u.email, u.created_at, u.last_login_at, u.max_watches,
      (SELECT COUNT(*)::int FROM startups s WHERE s.user_id = u.id) AS watches,
      (SELECT COUNT(*)::int FROM startups s WHERE s.user_id = u.id AND s.priority) AS priority,
      (SELECT COUNT(*)::int FROM monitors m JOIN conditions c ON c.id = m.condition_id JOIN startups s ON s.id = c.startup_id WHERE s.user_id = u.id) AS monitors,
      (SELECT COALESCE(SUM(1440.0 / GREATEST(m.interval_minutes, 1)), 0)::float FROM monitors m JOIN conditions c ON c.id = m.condition_id JOIN startups s ON s.id = c.startup_id WHERE s.user_id = u.id) AS runs_per_day,
      (SELECT COALESCE(SUM(units), 0)::int FROM api_usage a WHERE a.user_id = u.id AND a.service = 'context' AND a.at > now() - interval '7 days') AS context_7d,
      (SELECT COALESCE(SUM(units), 0)::int FROM api_usage a WHERE a.user_id = u.id AND a.service = 'context' AND a.at > now() - interval '1 day') AS context_today,
      (SELECT COALESCE(SUM(units), 0)::int FROM api_usage a WHERE a.user_id = u.id AND a.service = 'cala' AND a.at > now() - interval '7 days') AS cala_7d,
      (SELECT COUNT(*)::int FROM inbound_items i WHERE i.user_id = u.id) AS inbox,
      EXISTS (SELECT 1 FROM settings st WHERE st.user_id = u.id AND st.key = 'telegram.chat_id' AND st.value <> 'null'::jsonb) AS telegram,
      u.granola_key_enc IS NOT NULL OR u.id = 1 AS granola
    FROM users u ORDER BY u.id`);
  const unattributed = await query<{ service: string; n: number }>(
    "SELECT service, COALESCE(SUM(units), 0)::int AS n FROM api_usage WHERE user_id IS NULL AND at > now() - interval '7 days' GROUP BY service",
  );
  const limits = await context.monitorLimits().catch(() => null);
  const usage = await (async () => {
    try {
      const r = await fetch("https://api.context.dev/v1/org/usage", { headers: { Authorization: `Bearer ${process.env.CONTEXT_API_KEY}` }, cache: "no-store" });
      return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  })();
  const credits = usage ? JSON.stringify(usage).match(/"(credits_remaining|remaining_credits|credits)":\s*(\d+)/)?.[2] : null;
  const totalRuns = rows.reduce((n, r) => n + r.runs_per_day, 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p>Pilot users and their cost. Calls are counted when Since makes them; monitor runs are scheduled on Context.dev (daily, or every 6 h for ★ watches).</p>
        </div>
      </div>
      <div className="glass banner" style={{ gap: 24, flexWrap: "wrap" }}>
        <span><strong>{rows.length}</strong> users</span>
        <span><strong>{rows.reduce((n, r) => n + r.watches, 0)}</strong> watches</span>
        <span><strong>{limits ? `${limits.monitors_used}/${limits.monitors_limit}` : "?"}</strong> Context.dev monitors</span>
        <span><strong>{totalRuns.toFixed(0)}</strong> scheduled monitor runs / day</span>
        {credits && <span><strong>{Number(credits).toLocaleString("en")}</strong> Context.dev credits left</span>}
      </div>
      <Reschedule />
      <div className="glass table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>User</th><th>Watches</th><th>Monitors</th><th>Runs / day</th><th>Context.dev calls (24 h / 7 d)</th><th>Cala calls (7 d)</th><th>Inbox</th><th>Set up</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.email}{r.id === 1 ? " (owner)" : ""}</div>
                  <div className="mono muted" style={{ fontSize: 11.5 }}>joined {ago(r.created_at)} · last login {ago(r.last_login_at)}</div>
                </td>
                <td>{r.watches} / {r.max_watches}{r.priority ? <span className="muted"> · ★{r.priority}</span> : null}</td>
                <td>{r.monitors}</td>
                <td>{r.runs_per_day.toFixed(1)}</td>
                <td className="mono">{r.context_today} / {r.context_7d}</td>
                <td className="mono">{r.cala_7d}</td>
                <td>{r.inbox}</td>
                <td className="muted" style={{ fontSize: 12.5 }}>{[r.telegram && "Telegram", r.granola && "Granola"].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unattributed.length > 0 && (
        <p className="muted" style={{ fontSize: 12.5 }}>Not tied to a user (7 d): {unattributed.map((u) => `${u.service} ${u.n}`).join(" · ")}</p>
      )}
    </>
  );
}
