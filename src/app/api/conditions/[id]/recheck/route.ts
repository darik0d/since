import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { context, ContextApiError } from "@/lib/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Re-check now": queue an immediate run for every monitor of this condition.
// Context.dev fires the webhook if a change is found.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conn = db();
  const monitors = conn.prepare("SELECT id FROM monitors WHERE condition_id = ?").all(Number(id)) as { id: string }[];
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
  conn
    .prepare("INSERT INTO timeline_events (condition_id, kind, detail) VALUES (?, 'recheck_requested', ?)")
    .run(Number(id), JSON.stringify(results));
  return NextResponse.json({ ok: true, results });
}
