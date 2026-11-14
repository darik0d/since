import { NextResponse } from "next/server";
import { checkCondition, timeline } from "@/lib/conditions";
import { one, pool, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Demo reset before judging (fictional data, see CLAUDE.md "Demo story"):
// 1. reset both demo sites (unpublish beats), 2. seed the story's startup data,
// 3. clear evidence / timeline / alerts / webhook rows for the demo startup but KEEP its monitors,
// 4. capture a fresh baseline so the timeline starts clean.
const STORY = {
  name: "Nordwind",
  display_domain: "nordwind.io",
  met_on: "2026-11-12",
  met_where: "Slush",
  founder_name: "Mikko Nordwind (fictional)",
  text: "Come back when you have your first enterprise customer and you're selling in Germany. And when revenue is over €1M ARR.",
};

export async function POST(req: Request) {
  const key = process.env.DEMO_KEY;
  if (!key || req.headers.get("x-demo-key") !== key) return NextResponse.json({ error: "bad or missing X-Demo-Key" }, { status: 401 });

  const [nordwind, kallio] = (process.env.DEMO_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!nordwind) return NextResponse.json({ error: "DEMO_DOMAINS not set" }, { status: 400 });
  const startup = await one<{ id: number }>("SELECT id FROM startups WHERE domain = $1", [nordwind]);
  if (!startup) return NextResponse.json({ error: `no watch for ${nordwind}: create it on /new first` }, { status: 404 });

  // 1. demo sites back to their starting state
  const sites: Record<string, string> = {};
  for (const host of [nordwind, kallio].filter(Boolean)) {
    try {
      const r = await fetch(`https://${host}/__demo/reset`, { method: "POST", headers: { "X-Demo-Key": key }, signal: AbortSignal.timeout(8000) });
      sites[host] = r.ok ? "reset" : `HTTP ${r.status} (is DEMO_KEY the same on the site?)`;
    } catch (e) {
      sites[host] = (e as Error).message;
    }
  }

  // 2 + 3. seed + clear, in one transaction
  const conds = await query<{ id: number; mechanism: string }>("SELECT id, mechanism FROM conditions WHERE startup_id = $1 ORDER BY id", [startup.id]);
  const ids = conds.map((c) => c.id);
  const monitorIds = (await query<{ id: string }>("SELECT id FROM monitors WHERE condition_id = ANY($1)", [ids])).map((m) => m.id);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM alerts WHERE condition_id = ANY($1)", [ids]);
    await client.query("DELETE FROM evidence WHERE condition_id = ANY($1)", [ids]);
    await client.query("DELETE FROM timeline_events WHERE condition_id = ANY($1)", [ids]);
    await client.query("DELETE FROM webhook_events WHERE monitor_id = ANY($1)", [monitorIds]);
    await client.query(
      `UPDATE conditions SET status = CASE WHEN mechanism = 'ask_at_checkin' THEN 'ask_at_checkin' ELSE 'watching' END,
              status_note = NULL, last_check = NULL, last_checked_at = NULL, updated_at = now(), created_at = now(),
              params_json = params_json - 'customer_sites'
       WHERE id = ANY($1)`,
      [ids],
    );
    await client.query("DELETE FROM reconnects WHERE startup_id = $1", [startup.id]);
    await client.query(
      `UPDATE startups SET name = $2, display_domain = $3, met_on = $4, met_where = $5, original_text = $6,
              founder_name = $7, founder_email = COALESCE($8, founder_email) WHERE id = $1`,
      [startup.id, STORY.name, STORY.display_domain, STORY.met_on, STORY.met_where, STORY.text, STORY.founder_name, process.env.DEMO_FOUNDER_EMAIL || null],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // 4. clean timeline: created -> baseline
  const baseline: Record<number, string> = {};
  for (const c of conds) {
    await timeline(c.id, "condition_created", { mechanism: c.mechanism, demo_reset: true });
    if (c.mechanism === "ask_at_checkin") continue;
    try {
      const r = await checkCondition(c.id, { fresh: true, trigger: "baseline" });
      await timeline(c.id, "baseline_captured", { summary: r.result?.summary ?? "" });
      baseline[c.id] = `${r.condition.status}: ${r.result?.summary ?? ""}`;
    } catch (e) {
      baseline[c.id] = `failed: ${(e as Error).message}`;
    }
  }
  return NextResponse.json({ ok: true, startup_id: startup.id, sites, monitors_kept: monitorIds.length, baseline });
}
