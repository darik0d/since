import { NextResponse } from "next/server";
import { requestLogin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Join the free Slush pilot" / "Sign in": emails a one-time link. No passwords.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  try {
    const r = await requestLogin(String(b.email ?? ""));
    const dev = process.env.NODE_ENV !== "production" ? r.devLink : undefined;
    return NextResponse.json({ ok: true, sent: r.sent, devLink: dev });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
