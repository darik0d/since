import { NextResponse } from "next/server";
import { checkToken, loadFacts, renderEmail } from "@/lib/reconnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-render the exact email for the live preview (facts from the DB, copy from the editor).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json();
  if (!checkToken(id, b.t)) return NextResponse.json({ error: "bad or missing token" }, { status: 403 });
  const f = await loadFacts(id);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(renderEmail(f, { subject: String(b.subject ?? ""), opener: String(b.opener ?? ""), ask: String(b.ask ?? "") }));
}
