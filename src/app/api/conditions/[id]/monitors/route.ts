import { NextResponse } from "next/server";
import { getCondition, timeline } from "@/lib/conditions";
import { query } from "@/lib/db";
import { createMonitors, planMonitors } from "@/lib/monitors";
import { discoverSite } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Create whichever planned monitors this condition is missing (e.g. after a failed create).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const c = await getCondition(id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  const have = new Set((await query<{ role: string }>("SELECT role FROM monitors WHERE condition_id = $1", [id])).map((r) => r.role));
  const site = await discoverSite(c.domain);
  const draft = { original_words: c.original_words, plain_words: c.plain_words ?? c.original_words, mechanism: c.mechanism, subtype: c.subtype, params: c.params_json, reason: c.reason };
  const missing = planMonitors(draft, c.company, site).filter((m) => !have.has(m.role));
  const r = await createMonitors(id, c.domain, missing);
  if (r.created.length) await timeline(id, "monitors_created", { ids: r.created });
  return NextResponse.json({ ok: true, missing: missing.map((m) => m.role), ...r });
}
