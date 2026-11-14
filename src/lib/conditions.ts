import { one, pool, query } from "./db";
import { runCheck } from "./verify";
import { statusFrom } from "./verify/status";
import type { CheckResult, ConditionParams, Mechanism, Status, Subtype } from "./types";

export type ConditionRow = {
  id: number;
  startup_id: number;
  original_words: string;
  plain_words: string | null;
  mechanism: Mechanism;
  subtype: Subtype | null;
  params_json: ConditionParams;
  status: Status;
  status_note: string | null;
  best_evidence: string | null;
  reason: string | null;
  deadline: string | null;
  last_checked_at: string | null;
  last_check: CheckResult | null;
  created_at: string;
  updated_at: string;
  domain: string;
  company: string;
};

export async function getCondition(id: number) {
  return one<ConditionRow>(
    `SELECT c.*, s.domain, COALESCE(s.name, s.domain) AS company
     FROM conditions c JOIN startups s ON s.id = c.startup_id WHERE c.id = $1`,
    [id],
  );
}

export async function timeline(conditionId: number, kind: string, detail: unknown = null) {
  await query("INSERT INTO timeline_events (condition_id, kind, detail) VALUES ($1, $2, $3)", [conditionId, kind, detail == null ? null : JSON.stringify(detail)]);
}

const RANK: Record<string, number> = { watching: 0, needs_review: 1, reported: 2, confirmed: 3 };

/**
 * Status transition rules (deterministic):
 * - ask_at_checkin / expired are never touched by checks
 * - confirmed stays confirmed; reported only moves up to confirmed
 * - needs_review never overrides reported/confirmed
 */
export function nextStatus(current: Status, found: CheckResult["status"]): Status {
  if (current === "ask_at_checkin" || current === "expired") return current;
  if (current === "watching" || current === "needs_review") return found;
  return RANK[found] > RANK[current] ? found : current;
}

/** Run the verifier for one condition, store evidence + timeline, move the status. */
export async function checkCondition(id: number, opts: { fresh?: boolean; trigger?: string; rawWebhookId?: number } = {}) {
  const c = await getCondition(id);
  if (!c) throw new Error(`condition ${id} not found`);
  if (c.status === "ask_at_checkin") return { condition: c, result: null, changed: false };

  if (c.deadline && new Date(c.deadline) < new Date() && c.status !== "confirmed") {
    await query("UPDATE conditions SET status = 'expired', updated_at = now() WHERE id = $1", [id]);
    await timeline(id, "status_changed", { from: c.status, to: "expired", why: "deadline passed" });
    return { condition: { ...c, status: "expired" as Status }, result: null, changed: true };
  }

  const result = await runCheck(c.mechanism, {
    domain: c.domain,
    company: c.company,
    params: c.params_json,
    subtype: c.subtype,
    fresh: opts.fresh,
  });

  const client = await pool().connect();
  let changed = false;
  let status: Status = c.status;
  try {
    await client.query("BEGIN");
    // evidence previously marked wrong does not count again
    const wrong = new Set(
      (await client.query("SELECT url, content_hash FROM evidence WHERE condition_id = $1 AND marked_wrong", [id])).rows.map(
        (r) => `${r.url}|${r.content_hash}`,
      ),
    );
    const usable = result.evidence.filter((e) => !wrong.has(`${e.url}|${e.content_hash}`));
    const effective: CheckResult = { ...result, evidence: usable };
    if (usable.length !== result.evidence.length) {
      const capReported = c.mechanism === "announcement" && c.subtype !== "customer";
      const s = statusFrom(usable.filter((e) => e.passes), capReported ? "reported" : "confirmed");
      effective.status = s === "watching" && result.status === "needs_review" ? "needs_review" : s;
    }

    const newIds: number[] = [];
    for (const e of usable) {
      const r = await client.query(
        `INSERT INTO evidence (condition_id, url, source_type, snapshot_time, content_hash, excerpt, detected_at, verified_at,
                               rule_passed, passes, details, raw_webhook_id, webhook_received_at)
         VALUES ($1,$2,$3,$4,$5,$6, now(), now(), $7,$8,$9,$10,
                 (SELECT received_at FROM webhook_events WHERE id = $10))
         ON CONFLICT (condition_id, url, content_hash) DO NOTHING RETURNING id`,
        [id, e.url, e.source_type, e.snapshot_time, e.content_hash, e.excerpt, e.rule_passed, e.passes, JSON.stringify(e.details ?? null), opts.rawWebhookId ?? null],
      );
      if (r.rows[0]) newIds.push(r.rows[0].id);
    }

    status = nextStatus(c.status, effective.status);
    changed = status !== c.status;
    const note = changed
      ? c.status === "reported" && status === "confirmed"
        ? "Upgraded from Reported: an independent or platform source now confirms it"
        : null
      : c.status_note;
    await client.query(
      `UPDATE conditions SET status = $2, status_note = $3, last_checked_at = now(), last_check = $4,
              updated_at = CASE WHEN $5 THEN now() ELSE updated_at END WHERE id = $1`,
      [id, status, note, JSON.stringify(effective), changed],
    );
    await client.query("INSERT INTO timeline_events (condition_id, kind, detail) VALUES ($1, 'evidence_checked', $2)", [
      id,
      JSON.stringify({
        trigger: opts.trigger ?? "manual",
        found: effective.status,
        summary: effective.summary,
        new_evidence: newIds.length,
        sources: effective.sources.map((s) => `${s.source_type}: ${s.url} (${s.note})`),
      }),
    ]);
    if (changed) {
      await client.query("INSERT INTO timeline_events (condition_id, kind, detail) VALUES ($1, 'status_changed', $2)", [
        id,
        JSON.stringify({ from: c.status, to: status, summary: effective.summary }),
      ]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { condition: { ...c, status }, result, changed };
}

/** "Mark as wrong": exclude that evidence and recompute the status from what is left. */
export async function markEvidenceWrong(evidenceId: number) {
  const ev = await one<{ condition_id: number }>("UPDATE evidence SET marked_wrong = true WHERE id = $1 RETURNING condition_id", [evidenceId]);
  if (!ev) return null;
  const c = await getCondition(ev.condition_id);
  if (!c) return null;
  const left = await query<{ source_type: string }>(
    "SELECT source_type FROM evidence WHERE condition_id = $1 AND passes AND NOT marked_wrong",
    [c.id],
  );
  const capReported = c.mechanism === "announcement" && c.subtype !== "customer";
  const recomputed: Status = left.some((e) => e.source_type !== "founder_controlled")
    ? capReported ? "reported" : "confirmed"
    : left.length ? "reported" : "watching";
  const status = c.status === "ask_at_checkin" || c.status === "expired" ? c.status : recomputed;
  await query("UPDATE conditions SET status = $2, status_note = $3, updated_at = now() WHERE id = $1", [
    c.id, status, status !== c.status ? "Evidence marked wrong by the investor" : c.status_note,
  ]);
  await timeline(c.id, "evidence_marked_wrong", { evidence_id: evidenceId, from: c.status, to: status });
  return { condition_id: c.id, status };
}
