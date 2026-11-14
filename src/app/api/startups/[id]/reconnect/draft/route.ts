import { NextResponse } from "next/server";
import { checkToken, draftCopy, loadFacts, renderEmail } from "@/lib/reconnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// "Regenerate": the LLM writes subject / opener / ask again from the facts list.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json();
  if (!checkToken(id, b.t)) return NextResponse.json({ error: "bad or missing token" }, { status: 403 });
  const f = await loadFacts(id);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  const copy = await draftCopy(f);
  return NextResponse.json({ copy, ...renderEmail(f, copy) });
}
