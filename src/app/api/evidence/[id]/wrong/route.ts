import { NextResponse } from "next/server";
import { markEvidenceWrong } from "@/lib/conditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await markEvidenceWrong(Number((await params).id));
  if (!r) return NextResponse.json({ error: "evidence not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}
