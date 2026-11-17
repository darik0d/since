import { NextResponse } from "next/server";
import { markEvidenceWrong, ownsCondition } from "@/lib/conditions";
import { currentUserId } from "@/lib/auth";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const evId = Number((await params).id);
  const ev = await one<{ condition_id: number }>("SELECT condition_id FROM evidence WHERE id = $1", [evId]);
  if (!ev || !(await ownsCondition(ev.condition_id, await currentUserId()))) return NextResponse.json({ error: "evidence not found" }, { status: 404 });
  const r = await markEvidenceWrong(evId);
  if (!r) return NextResponse.json({ error: "evidence not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}
