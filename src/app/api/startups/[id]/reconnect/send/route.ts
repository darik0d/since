import { NextResponse } from "next/server";
import { startupOwner } from "@/lib/auth";
import { checkToken, loadFacts, renderEmail, sendReconnect, smtpConfigured } from "@/lib/reconnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Only ever called from the Send button. The HTML is rendered here again from the DB facts,
// so what is sent is exactly the preview (the client only supplies to / subject / opener / ask).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json();
  if (!checkToken(id, b.t)) return NextResponse.json({ error: "bad or missing token" }, { status: 403 });
  if (!smtpConfigured()) return NextResponse.json({ error: "SMTP is not configured" }, { status: 400 });
  // pilot users copy the email or open it in Gmail; sending through our SMTP is the owner's only
  if (!(await startupOwner(id))?.is_admin) return NextResponse.json({ error: "Use Copy HTML or Open in Gmail" }, { status: 403 });
  const to = String(b.to ?? "").trim();
  if (!/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(to)) return NextResponse.json({ error: "enter one valid email address" }, { status: 400 });
  const f = await loadFacts(id);
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  const copy = { subject: String(b.subject ?? "").slice(0, 200), opener: String(b.opener ?? ""), ask: String(b.ask ?? "") };
  const { html, text } = renderEmail(f, copy);
  try {
    const row = await sendReconnect(id, { to, ...copy, html, text });
    return NextResponse.json({ ok: true, id: row.id, sent_at: row.sent_at });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
