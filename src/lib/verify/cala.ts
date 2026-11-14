import { createHash } from "node:crypto";
import { calaConfigured, fmtMoney, takeSnapshot, latestSnapshot } from "../cala";
import { one } from "../db";
import type { CheckContext, CheckResult, EvidenceCandidate } from "../types";

// funding_round and team_size, verified with Cala data. Deterministic rules; source_type independent.
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function load(ctx: CheckContext) {
  const s = await one<{ id: number; cala_entity_id: string | null; met_on: string | null }>(
    "SELECT id, cala_entity_id, met_on::text AS met_on FROM startups WHERE domain = $1",
    [ctx.domain],
  );
  if (!s) return { error: "startup not found" as const };
  if (!calaConfigured()) return { error: "Cala is not configured (CALA_API_KEY)" as const };
  if (!s.cala_entity_id) return { error: "Not matched in Cala yet: use “Find in Cala” on this page" as const };
  // a fresh check takes a new snapshot; otherwise the latest stored one
  const snap = ctx.fresh ? (await takeSnapshot(s.id, { fresh: true }))?.snap : (await latestSnapshot(s.id))?.snap;
  if (!snap) return { error: "no Cala data" as const };
  return { s, snap };
}

const none = (summary: string, note: string): CheckResult => ({
  status: "watching", summary, evidence: [], sources: [{ url: "https://cala.ai", source_type: "independent", ok: false, note }], observations: {},
});

export async function checkFundingRound(ctx: CheckContext): Promise<CheckResult> {
  const l = await load(ctx);
  if ("error" in l) return none("Waiting for Cala data", l.error!);
  const { s, snap } = l;
  const want = ctx.params.round_series ?? null;
  const metOn = s.met_on ?? "0000";
  const after = snap.rounds.filter((r) => r.event_date && r.event_date.slice(0, 10) > metOn);
  const matching = after.filter((r) => !want || !r.round_type || norm(r.round_type) === norm(want));
  const evidence: EvidenceCandidate[] = matching.map((r) => {
    const src = r.sources[0];
    const what = [r.round_type ?? "Funding round", fmtMoney(r.amount, r.currency)].filter(Boolean).join(", ");
    return {
      url: src?.url ?? `https://cala.ai/entity/${snap.entity_id}`,
      source_type: "independent",
      excerpt: `${snap.name}: ${what}, dated ${r.event_date} (via Cala${src ? `, ${src.name}` : ""}).`,
      snapshot_time: new Date().toISOString(),
      content_hash: hash(`round|${r.id}|${r.event_date}`),
      rule_passed: `${r.round_type ?? "Funding round"} dated ${r.event_date}, after the meeting (${metOn}) · via Cala (${src?.name ?? "Cala"})`,
      passes: true,
      details: { round: r, entity_id: snap.entity_id },
    };
  });
  const latest = snap.rounds.find((r) => r.event_date);
  return {
    status: evidence.length ? "confirmed" : "watching",
    summary: evidence.length
      ? `${evidence.length} funding round${evidence.length > 1 ? "s" : ""} after ${metOn} in Cala`
      : `No ${want ?? "funding round"} after ${metOn} in Cala${latest ? ` (latest: ${latest.event_date})` : ""}`,
    evidence,
    sources: [{ url: `https://cala.ai`, source_type: "independent", ok: true, note: `Cala: ${snap.rounds.length} rounds, ${snap.investors.length} investors` }],
    observations: { rounds: snap.rounds.map((r) => ({ date: r.event_date, type: r.round_type })) },
    note: evidence.length ? "Confirmed via Cala (company data)" : undefined,
  };
}

export async function checkTeamSize(ctx: CheckContext): Promise<CheckResult> {
  const l = await load(ctx);
  if ("error" in l) return none("Waiting for Cala data", l.error!);
  const { s, snap } = l;
  const n = ctx.params.min_employees ?? 1;
  const metOn = s.met_on ?? "0000";
  const ec = snap.employee_count;
  if (!ec) return none(`No headcount in Cala for ${snap.name}`, "Cala has no employee_count");
  const date = ec.source?.date ?? null;
  const fresh = Boolean(date && date.slice(0, 10) > metOn);
  const passes = ec.value >= n && fresh;
  const ev: EvidenceCandidate = {
    url: ec.source?.url ?? `https://cala.ai/entity/${snap.entity_id}`,
    source_type: "independent",
    excerpt: `${snap.name}: about ${ec.value} employees (estimate via Cala, ${ec.source?.name ?? "source"}${date ? `, ${date}` : ""}).`,
    snapshot_time: new Date().toISOString(),
    content_hash: hash(`team|${ec.value}|${date}`),
    rule_passed: passes ? `${ec.value} employees ≥ ${n} · estimate via Cala (${ec.source?.name ?? "Cala"}, ${date})` : null,
    passes,
    details: { employee_count: ec, min: n },
  };
  return {
    status: passes ? "confirmed" : "watching",
    summary: passes
      ? `${ec.value} employees (≥ ${n}), estimate via Cala`
      : ec.value >= n
        ? `${ec.value} employees, but the count's source (${date ?? "undated"}) is not after ${metOn}`
        : `${ec.value} employees seen (need ${n})`,
    evidence: [ev],
    sources: [{ url: "https://cala.ai", source_type: "independent", ok: true, note: `Cala employee_count ${ec.value}` }],
    observations: { employee_count: ec.value, date },
    note: passes ? "Estimate via Cala (company data)" : undefined,
  };
}
