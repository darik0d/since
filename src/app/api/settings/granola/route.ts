import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import { query } from "@/lib/db";
import { seal } from "@/lib/secretbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Optional per-user Granola API key, stored encrypted (AES-256-GCM). Checked against Granola before saving.
export async function POST(req: Request) {
  const uid = (await currentUserId())!;
  const key = String((await req.json().catch(() => ({}))).key ?? "").trim();
  if (!/^grn_[A-Za-z0-9_-]{10,}$/.test(key)) return NextResponse.json({ error: "That doesn't look like a Granola API key (grn_…)" }, { status: 400 });
  const r = await fetch("https://public-api.granola.ai/v1/notes?page_size=1", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r?.ok) return NextResponse.json({ error: `Granola rejected the key${r ? ` (${r.status})` : ""}` }, { status: 400 });
  await query("UPDATE users SET granola_key_enc = $2 WHERE id = $1", [uid, seal(key)]);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await query("UPDATE users SET granola_key_enc = NULL WHERE id = $1", [(await currentUserId())!]);
  return NextResponse.json({ ok: true });
}
