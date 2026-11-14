import { NextResponse } from "next/server";
import { normalizeDomain } from "@/lib/brand";
import { checkCondition, timeline } from "@/lib/conditions";
import { one } from "@/lib/db";
import { normalize } from "@/lib/mapping";
import { createMonitors, planMonitors } from "@/lib/monitors";
import { discoverSite } from "@/lib/sources";
import { bestPossibleEvidence, MECHANISMS, type DraftCondition } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Step 2: the investor confirmed the conditions. Store them, capture a baseline (runs every verifier
// once, now), and create the Context.dev monitors that will trigger re-checks.
export async function POST(req: Request) {
  const b = await req.json();
  const domain = normalizeDomain(b.domain ?? "");
  const drafts: DraftCondition[] = (b.conditions ?? [])
    .filter((c: DraftCondition) => MECHANISMS.includes(c.mechanism) && c.original_words)
    .map(normalize);
  if (!domain || !drafts.length) return NextResponse.json({ error: "domain and at least one condition required" }, { status: 400 });

  const startup = await one<{ id: number }>(
    `INSERT INTO startups (domain, name, logo_url, met_on, met_where, original_text, founder_name, founder_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name, logo_url = COALESCE(EXCLUDED.logo_url, startups.logo_url),
       met_on = EXCLUDED.met_on, met_where = EXCLUDED.met_where, original_text = EXCLUDED.original_text,
       founder_name = COALESCE(EXCLUDED.founder_name, startups.founder_name),
       founder_email = COALESCE(EXCLUDED.founder_email, startups.founder_email)
     RETURNING id`,
    [domain, b.company || null, b.logo_url || null, b.met_on || null, b.met_where || null, b.text || null,
     b.founder_name?.trim() || null, b.founder_email?.trim() || null],
  );
  // started from an inbox item: mark it accepted
  if (Number(b.inbox_id)) {
    await one("UPDATE inbound_items SET status = 'accepted', startup_id = $2 WHERE id = $1 RETURNING id", [Number(b.inbox_id), startup!.id]);
  }
  const site = await discoverSite(domain);

  const results = await Promise.all(
    drafts.map(async (d) => {
      const row = await one<{ id: number }>(
        `INSERT INTO conditions (startup_id, original_words, plain_words, mechanism, subtype, params_json, status, best_evidence, reason, deadline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          startup!.id, d.original_words, d.plain_words, d.mechanism, d.subtype, JSON.stringify(d.params),
          d.mechanism === "ask_at_checkin" ? "ask_at_checkin" : "watching",
          bestPossibleEvidence(d.mechanism, d.subtype), d.reason, b.deadline || null,
        ],
      );
      const id = row!.id;
      await timeline(id, "condition_created", { original_words: d.original_words, mechanism: d.mechanism, subtype: d.subtype, params: d.params });
      if (d.mechanism === "ask_at_checkin") return { id, status: "ask_at_checkin", summary: d.reason, monitors: { created: [], skipped: 0 } };

      let status = "watching";
      let summary = "";
      try {
        const r = await checkCondition(id, { trigger: "baseline", fresh: true });
        status = r.condition.status;
        summary = r.result?.summary ?? "";
        await timeline(id, "baseline_captured", { summary, sources: r.result?.sources.length ?? 0, observations: r.result?.observations });
      } catch (e) {
        summary = `Baseline failed: ${(e as Error).message}`;
        await timeline(id, "baseline_failed", { error: summary });
      }
      const monitors = await createMonitors(id, domain, planMonitors(d, b.company || domain, site));
      if (monitors.created.length) await timeline(id, "monitors_created", { ids: monitors.created });
      return { id, status, summary, monitors };
    }),
  );

  return NextResponse.json({ startup_id: startup!.id, conditions: results });
}
