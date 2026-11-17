import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ingest } from "@/lib/inbound";
import { currentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Paste an email or notes" on /inbox. Same extractor as email and Granola; nothing starts watching here.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const text = String(b.text ?? "").trim();
  if (text.length < 20) return NextResponse.json({ error: "Paste at least a few sentences" }, { status: 400 });
  const external_id = createHash("sha256").update(text).digest("hex").slice(0, 32);
  const r = await ingest({ user_id: (await currentUserId())!, source: "paste", external_id, title: b.title?.trim() || "Note", raw_text: text });
  return NextResponse.json({ ok: true, ...r });
}
