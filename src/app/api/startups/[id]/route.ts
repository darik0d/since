import { NextResponse } from "next/server";
import { context, ContextApiError } from "@/lib/context";
import { one, pool, query } from "@/lib/db";
import { currentUserId } from "@/lib/auth";
import { MAX_PRIORITY, setPriority } from "@/lib/monitors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Remove a watch: delete its Context.dev monitors (frees slots), then the startup and everything under it.
// :id is the numeric id or the startup's domain (DELETE /api/startups/wolt.com).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = decodeURIComponent((await params).id);
  const uid = (await currentUserId())!;
  const s = /^\d+$/.test(key)
    ? await one<{ id: number; domain: string }>("SELECT id, domain FROM startups WHERE id = $1 AND user_id = $2", [Number(key), uid])
    : await one<{ id: number; domain: string }>("SELECT id, domain FROM startups WHERE domain = $1 AND user_id = $2", [key.toLowerCase(), uid]);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  const id = s.id;
  const monitors = await query<{ id: string }>(
    "SELECT m.id FROM monitors m JOIN conditions c ON c.id = m.condition_id WHERE c.startup_id = $1",
    [id],
  );
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const m of monitors) {
    try {
      await context.deleteMonitor(m.id);
      deleted.push(m.id);
    } catch (e) {
      if (e instanceof ContextApiError && e.status === 404) deleted.push(m.id);
      else failed.push(m.id);
    }
  }
  if (failed.length) return NextResponse.json({ error: "some monitors could not be deleted", failed }, { status: 502 });
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM monitors WHERE id = ANY($1)", [deleted]);
    await client.query("DELETE FROM startups WHERE id = $1", [id]); // cascades conditions, evidence, timeline, alerts
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return NextResponse.json({ ok: true, domain: s.domain, monitors_deleted: deleted.length });
}

// Priority watch (checked every 6 h instead of daily); at most MAX_PRIORITY per user.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = (await currentUserId())!;
  const id = Number((await params).id);
  const s = await one<{ priority: boolean }>("SELECT priority FROM startups WHERE id = $1 AND user_id = $2", [id, uid]);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  const on = Boolean((await req.json().catch(() => ({}))).priority);
  if (on && !s.priority) {
    const n = (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM startups WHERE user_id = $1 AND priority", [uid]))?.n ?? 0;
    if (n >= MAX_PRIORITY) return NextResponse.json({ error: `Up to ${MAX_PRIORITY} priority watches. Unstar one first.` }, { status: 400 });
  }
  const r = await setPriority(id, on);
  return NextResponse.json({ ok: true, priority: on, ...r });
}
