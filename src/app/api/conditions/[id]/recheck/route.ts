import { currentUserId } from "@/lib/auth";
import { ownsCondition } from "@/lib/conditions";
import { NextResponse } from "next/server";
import { checkCondition } from "@/lib/conditions";
import { context, ContextApiError } from "@/lib/context";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// "Re-check now": run the verifier against the live web immediately, and queue an immediate
// run for every Context.dev monitor of this condition (their webhooks trigger further re-checks).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!(await ownsCondition(id, await currentUserId()))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const monitors = await query<{ id: string }>("SELECT id FROM monitors WHERE condition_id = $1", [id]);
  const queued = await Promise.all(
    monitors.map(async (m) => {
      try {
        const r = await context.runMonitorNow(m.id);
        return { monitor_id: m.id, run_id: r.run_id, queued: r.queued };
      } catch (e) {
        return { monitor_id: m.id, error: e instanceof ContextApiError ? e.body : String(e) };
      }
    }),
  );
  try {
    const r = await checkCondition(id, { fresh: true, trigger: "re-check now" });
    return NextResponse.json({ ok: true, status: r.condition.status, changed: r.changed, summary: r.result?.summary ?? null, monitors: queued });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, monitors: queued }, { status: 500 });
  }
}
