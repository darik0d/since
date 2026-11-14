import { query, type WebhookEventRow } from "@/lib/db";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";

function pretty(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default async function WebhookLog() {
  const rows = await query<WebhookEventRow>("SELECT * FROM webhook_events ORDER BY id DESC LIMIT 100");
  const base = process.env.PUBLIC_BASE_URL ?? "";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Webhook log</h1>
          <p>
            Every raw Context.dev delivery, stored as received. Endpoint:{" "}
            <span className="mono">{base}/api/webhooks/context</span>
          </p>
        </div>
        <AutoRefresh />
      </div>

      <div className="glass table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>No webhooks yet</h3>
            <p>
              Send a signed test with <span className="mono">npm run webhook:test</span>, or run a monitor with
              &ldquo;run now&rdquo;.
            </p>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Received</th>
                <th>Event</th>
                <th>Monitor</th>
                <th>Signature</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono muted">{r.id}</td>
                  <td className="mono">{r.received_at.replace("T", " ").replace(/\.\d+Z$/, "")}</td>
                  <td>
                    <span className="mono">{r.event ?? "?"}</span>
                    {r.attempt && r.attempt > 1 ? <div className="muted">attempt {r.attempt}</div> : null}
                  </td>
                  <td className="mono muted">{r.monitor_id ?? "—"}</td>
                  <td>
                    <span className={`chip ${r.signature_ok ? "chip-ok" : "chip-bad"}`}>
                      {r.signature_ok ? "verified" : "unverified"}
                    </span>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {r.signature_note}
                    </div>
                  </td>
                  <td style={{ maxWidth: 520 }}>
                    <details className="raw">
                      <summary>{r.body_raw.length.toLocaleString()} bytes</summary>
                      <pre className="json mono">{pretty(r.body_raw)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
