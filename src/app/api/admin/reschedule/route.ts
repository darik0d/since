import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { setPriority } from "@/lib/monitors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Owner-only: put every existing monitor on the pilot schedule (daily; ★ watches every 6 h).
export async function POST() {
  if (!(await currentUser())?.is_admin) return NextResponse.json({ error: "not found" }, { status: 404 });
  const startups = await query<{ id: number; priority: boolean }>("SELECT id, priority FROM startups");
  let monitors = 0;
  const failed: string[] = [];
  for (const s of startups) {
    const r = await setPriority(s.id, s.priority);
    monitors += r.monitors;
    failed.push(...r.failed);
  }
  return NextResponse.json({ ok: failed.length === 0, monitors, failed });
}
