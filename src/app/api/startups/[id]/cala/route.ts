import { NextResponse } from "next/server";
import { calaConfigured, matchStartup } from "@/lib/cala";
import { syncCalaStartup } from "@/lib/cala-sync";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Find in Cala": {action:"find"} -> auto-match by website or candidates; {entity_id} -> investor's pick;
// {action:"none"} -> "Not in Cala"; {action:"sync"} -> fresh snapshot + re-check.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!calaConfigured()) return NextResponse.json({ error: "CALA_API_KEY not set" }, { status: 400 });
  const id = Number((await params).id);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.entity_id) {
      await query("UPDATE startups SET cala_entity_id = $2, cala_match = 'picked' WHERE id = $1", [id, String(b.entity_id)]);
      return NextResponse.json({ ok: true, status: "matched", sync: await syncCalaStartup(id, "cala_match") });
    }
    if (b.action === "none") {
      await query("UPDATE startups SET cala_entity_id = NULL, cala_match = 'not_found' WHERE id = $1", [id]);
      return NextResponse.json({ ok: true, status: "not_found" });
    }
    if (b.action === "sync") return NextResponse.json({ ok: true, sync: await syncCalaStartup(id, "manual") });
    const m = await matchStartup(id);
    const sync = m.status === "matched" ? await syncCalaStartup(id, "cala_match") : null;
    return NextResponse.json({ ok: true, ...m, sync });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
