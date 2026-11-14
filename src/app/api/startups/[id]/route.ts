import { NextResponse } from "next/server";
import { context, ContextApiError } from "@/lib/context";
import { one, pool, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Remove a watch: delete its Context.dev monitors (frees slots), then the startup and everything under it.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const s = await one<{ domain: string }>("SELECT domain FROM startups WHERE id = $1", [id]);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
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
