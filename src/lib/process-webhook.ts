import { checkCondition, timeline } from "./conditions";
import { one, query, type WebhookEventRow } from "./db";

/** Find the first value of `key` anywhere in a JSON payload (payload shapes vary by event). */
export function findKey(obj: unknown, key: string, depth = 0): unknown {
  if (!obj || typeof obj !== "object" || depth > 6) return undefined;
  if (key in (obj as Record<string, unknown>)) return (obj as Record<string, unknown>)[key];
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const f = findKey(v, key, depth + 1);
    if (f !== undefined) return f;
  }
  return undefined;
}

const short = (v: unknown) => (typeof v === "string" ? v.slice(0, 300) : v == null ? null : JSON.stringify(v).slice(0, 300));

/**
 * Webhook -> re-verify. The monitor only says "something changed"; Since re-runs its own
 * deterministic check on the live page and decides the status itself.
 */
export async function processWebhook(rowId: number) {
  const row = await one<WebhookEventRow>("SELECT * FROM webhook_events WHERE id = $1", [rowId]);
  if (!row) return;
  const mark = (note: string) => query("UPDATE webhook_events SET processed_at = now(), signature_note = signature_note || $2 WHERE id = $1", [rowId, ` · ${note}`]);
  if (!row.signature_ok) return mark("not processed: unverified");
  if (row.signature_note?.includes("duplicate of")) return mark("not processed: duplicate delivery");

  let body: any = null;
  try {
    body = JSON.parse(row.body_raw);
  } catch {
    return mark("not processed: bad JSON");
  }
  const event = row.event ?? body?.event;
  const change = body?.data?.change ?? null;
  if (event === "run.completed" && !change) return mark("run completed, no change");

  const monitorId = row.monitor_id ?? (findKey(body, "monitor_id") as string | undefined) ?? null;
  const mon = monitorId
    ? await one<{ condition_id: number | null; role: string | null; source_type: string | null }>(
        "SELECT condition_id, role, source_type FROM monitors WHERE id = $1",
        [monitorId],
      )
    : undefined;
  if (!mon?.condition_id) return mark("no condition for this monitor");

  const cid = mon.condition_id;
  await timeline(cid, "change_detected", {
    monitor: mon.role ?? monitorId,
    source_type: mon.source_type,
    summary: short(findKey(change, "summary") ?? findKey(change, "description") ?? findKey(change, "title")),
    detected_at: (findKey(change, "detected_at") as string | undefined) ?? (findKey(change, "created_at") as string | undefined) ?? body?.created_at ?? null,
  });
  await timeline(cid, "webhook_received", { event, id: row.context_id, delivery: row.delivery_id, received_at: row.received_at, webhook_row: rowId });

  try {
    const r = await checkCondition(cid, { fresh: true, trigger: `webhook (${mon.role ?? "monitor"})`, rawWebhookId: rowId });
    await mark(`re-checked: ${r.condition.status}${r.changed ? " (changed)" : ""}`);
  } catch (e) {
    await mark(`re-check failed: ${(e as Error).message}`);
  }
}
