import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { context, ContextApiError } from "@/lib/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Re-check now": queue an immediate run for every monitor of this condition.
// Context.dev fires the webhook if a change is found.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const monitors = await query<{ id: string }>("SELECT id FROM monitors WHERE condition_id = $1", [Number(id)]);
  if (monitors.length === 0) return NextResponse.json({ ok: false, error: "no monitors for condition" }, { status: 404 });

  const results = await Promise.all(
    monitors.map(async (m) => {
      try {
        const r = await context.runMonitorNow(m.id);
        return { monitor_id: m.id, run_id: r.run_id, queued: r.queued };
      } catch (e) {
        return { monitor_id: m.id, error: e instanceof ContextApiError ? e.body : String(e) };
      }
    }),
  );
  await query("INSERT INTO timeline_events (condition_id, kind, detail) VALUES ($1, 'recheck_requested', $2)", [
    Number(id),
    JSON.stringify(results),
  ]);
  return NextResponse.json({ ok: true, results });
}
